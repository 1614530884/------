/**
 * CPU 限制管理 - 主服务单例
 *
 * 职责：
 * 1. 定时轮询启用规则的节点指标（CPU/memory/disk，复用 node-monitor 的指标获取逻辑）
 * 2. 超阈值 + 连续触发次数达标 + 冷却结束 → 派发 limit-executor 异步执行
 * 3. 同一规则+节点的限制任务互斥（防止重复派发）
 * 4. 限制成功后将新事件写入 cpu_limit_events 表
 * 5. 启动 release-scheduler 自动解除到期限制
 *
 * 设计参考 bandwidth-manager/service.ts，但触发条件为节点指标超上限。
 */
import { MfyService } from '@/lib/services/mfy-service';
import { asyncPool } from '@/lib/async-pool';
import { cpuLimitRuleStore, cpuLimitLogStore, cpuLimitEventStore, cpuLimitAlertStore } from './store';
import { executeCpuLimit } from './limit-executor';
import { cpuLimitReleaseScheduler } from './release-scheduler';
import type { CpuLimitRule, CpuLimitServiceStatus, CpuLimitMetric } from './types';

/** 告警防抖间隔（毫秒），同一目标在此时长内不重复告警 */
const ALERT_DEBOUNCE_MS = 5 * 60 * 1000; // 5 分钟

class CpuLimitManagerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;
  private started = false;
  /** 最后执行动作时间（冷却用）：key = `${ruleId}:${nodeId}` */
  private lastActionTime = new Map<string, number>();
  /** 连续触发计数：key = `${ruleId}:${nodeId}` */
  private consecutiveHits = new Map<string, number>();
  /** 正在执行的限制任务：key = `${ruleId}:${nodeId}`，value = Promise */
  private runningTasks = new Map<string, Promise<void>>();
  private lastCheckAt: number | null = null;
  /** 告警防抖：key = `instance:${cloudId}` 或 `node:${nodeId}` */
  private lastAlertTime = new Map<string, number>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext();
    // 同时启动自动解除调度器
    cpuLimitReleaseScheduler.start();
    console.log('[CpuLimitManager] 服务已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    // 同步停止自动解除调度器
    cpuLimitReleaseScheduler.stop();
    console.log('[CpuLimitManager] 服务已停止');
  }

  restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.consecutiveHits.clear();
    this.scheduleNext();
    console.log('[CpuLimitManager] 服务已重启');
  }

  getStatus(): CpuLimitServiceStatus {
    const rules = cpuLimitRuleStore.list();
    const activeRules = rules.filter(r => r.enabled);
    const checkIntervalMs = this.calcIntervalMs(activeRules);
    return {
      running: this.started,
      isChecking: this.isChecking,
      checkIntervalMs,
      nextCheckAt: this.timer ? Date.now() + checkIntervalMs : null,
      ruleCount: rules.length,
      activeRuleCount: activeRules.length,
      lastCheckAt: this.lastCheckAt,
      activeTasks: this.runningTasks.size,
      activeEventCount: cpuLimitEventStore.countActive(),
      releaseSchedulerRunning: cpuLimitReleaseScheduler.isRunning(),
    };
  }

  /** 手动触发检查周期 */
  async runCheckCycle(): Promise<void> {
    if (this.isChecking) {
      console.log('[CpuLimitManager] 上一周期未结束，跳过');
      return;
    }
    this.isChecking = true;
    this.lastCheckAt = Date.now();

    try {
      const activeRules = cpuLimitRuleStore.listEnabled();
      if (activeRules.length === 0) return;

      // 清理不再活跃的规则+节点的连续计数
      const activeKeys = new Set(
        activeRules.flatMap(r => r.nodeIds.map(nid => `${r.id}:${nid}`)),
      );
      for (const key of this.consecutiveHits.keys()) {
        if (!activeKeys.has(key)) {
          this.consecutiveHits.delete(key);
        }
      }

      const targetNodeIds = [...new Set(activeRules.flatMap(r => r.nodeIds))];
      await asyncPool(targetNodeIds, 5, (nodeId) => this.processNode(nodeId, activeRules));
    } finally {
      this.isChecking = false;
    }
  }

  /** 处理单个节点的所有匹配规则 */
  private async processNode(nodeId: number, activeRules: CpuLimitRule[]): Promise<void> {
    try {
      const nodeInfo = await this.getNodeInfo(nodeId);
      if (!nodeInfo) return;

      const matchingRules = activeRules
        .filter(r => r.nodeIds.includes(nodeId))
        .sort((a, b) => a.createdAt - b.createdAt);

      // 缓存节点指标值，避免同节点多规则重复查询
      const metricCache = new Map<string, number | null>();

      for (const rule of matchingRules) {
        const cacheKey = `${nodeId}:${rule.metric}`;
        let metricValue = metricCache.get(cacheKey);
        if (metricValue === undefined) {
          metricValue = await this.getNodeMetric(nodeId, rule.metric);
          metricCache.set(cacheKey, metricValue);
        }
        if (metricValue === null) continue;

        await this.checkRule(rule, nodeId, nodeInfo.name, metricValue);
      }
    } catch (err) {
      console.error(`[CpuLimitManager] 节点${nodeId}处理失败:`, err);
    }
  }

  /** 检查规则是否触发 */
  private async checkRule(
    rule: CpuLimitRule,
    nodeId: number,
    nodeName: string,
    metricValue: number,
  ): Promise<void> {
    const hitKey = `${rule.id}:${nodeId}`;
    const requiredHits = rule.triggerCount || 1;

    // 触发条件：节点指标超上限
    const isTriggered = metricValue > rule.threshold;
    if (!isTriggered) {
      this.consecutiveHits.set(hitKey, 0);
      return;
    }

    const currentCount = this.consecutiveHits.get(hitKey) ?? 0;
    const newCount = currentCount + 1;
    this.consecutiveHits.set(hitKey, newCount);

    if (newCount < requiredHits) {
      cpuLimitLogStore.append({
        ts: Date.now(),
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValue,
        threshold: rule.threshold,
        result: 'skipped',
        error: `连续触发${newCount}/${requiredHits}次`,
      });
      return;
    }

    // 达到触发次数，重置计数
    this.consecutiveHits.set(hitKey, 0);

    // 冷却检查
    const now = Date.now();
    const lastAction = this.lastActionTime.get(hitKey) || 0;
    if (now - lastAction < rule.cooldown * 1000) {
      cpuLimitLogStore.append({
        ts: now,
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValue,
        threshold: rule.threshold,
        result: 'skipped',
        error: '冷却中',
      });
      return;
    }

    // 任务互斥：同一规则+节点已有任务在执行，跳过
    if (this.runningTasks.has(hitKey)) {
      cpuLimitLogStore.append({
        ts: now,
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValue,
        threshold: rule.threshold,
        result: 'skipped',
        error: '上一轮限制任务仍在执行',
      });
      return;
    }

    // 派发限制任务
    this.lastActionTime.set(hitKey, now);
    cpuLimitLogStore.append({
      ts: now,
      ruleId: rule.id,
      ruleName: rule.name,
      nodeId,
      nodeName,
      eventType: 'limit_trigger',
      metricValue,
      threshold: rule.threshold,
      topN: rule.topN,
      result: 'success',
    });

    const taskPromise = this.executeLimitTask(rule, nodeId, nodeName, metricValue);
    this.runningTasks.set(hitKey, taskPromise);
    try {
      await taskPromise;
    } finally {
      this.runningTasks.delete(hitKey);
    }
  }

  /** 异步执行限制任务 */
  private async executeLimitTask(
    rule: CpuLimitRule,
    nodeId: number,
    nodeName: string,
    metricValue: number,
  ): Promise<void> {
    try {
      // 获取当前活跃限制的实例信息（用于基于当前值单步惩罚）
      const activeLimits = cpuLimitEventStore.getActiveLimits();

      const output = await executeCpuLimit({
        rule,
        nodeId,
        nodeName,
        metricValue,
        activeLimits,
      });

      // 原子性替换事件：标记旧事件为 superseded + 创建新 active 事件（事务保证一致性）
      const now = Date.now();
      cpuLimitEventStore.replaceEvents(output.supersededEventIds, output.newEvents);

      cpuLimitLogStore.append({
        ts: now,
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_execute',
        metricValue,
        threshold: rule.threshold,
        topN: rule.topN,
        affectedCount: output.affectedCount,
        details: JSON.stringify({
          instances: output.instances,
          metricValue,
          skippedByNodeLimit: output.skippedByNodeLimit ?? false,
          supersededCount: output.supersededEventIds.length,
        }),
        result: output.success ? 'success' : 'failed',
        error: output.error,
      });

      // 限制成功后检查告警阈值
      if (output.success && output.affectedCount > 0) {
        const limitedInstances = output.instances
          .filter(r => r.limited)
          .map(r => ({ cloudId: r.cloudId, cloudName: r.cloudName }));
        this.checkAlertThresholds(rule.name, nodeId, nodeName, limitedInstances);
      }
    } catch (err) {
      cpuLimitLogStore.append({
        ts: Date.now(),
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_execute',
        metricValue,
        threshold: rule.threshold,
        result: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 检查告警阈值：对刚限制的实例/节点，统计时间窗口内累计次数，达阈值则生成告警
   * - 实例级：同一实例在窗口内被限制次数达 instanceThreshold
   * - 节点级：同一节点下所有实例累计被限制次数达 nodeThreshold
   * - 防抖：同一目标在 ALERT_DEBOUNCE_MS 内不重复告警
   */
  private checkAlertThresholds(
    ruleName: string,
    nodeId: number,
    nodeName: string,
    limitedInstances: Array<{ cloudId: number; cloudName: string }>,
  ): void {
    try {
      const config = cpuLimitAlertStore.getConfig();
      if (!config.enabled || limitedInstances.length === 0) return;

      const now = Date.now();
      const sinceTs = now - config.windowMin * 60 * 1000;

      // 顺便清理超出窗口 2 倍时长的旧事件，避免表无限增长
      cpuLimitEventStore.cleanExpiredEvents(now - config.windowMin * 60 * 1000 * 2);

      // 实例级检查
      for (const inst of limitedInstances) {
        const count = cpuLimitEventStore.countEventsByCloud(inst.cloudId, sinceTs);
        if (count >= config.instanceThreshold) {
          const debounceKey = `instance:${inst.cloudId}`;
          const lastAlert = this.lastAlertTime.get(debounceKey) ?? 0;
          if (now - lastAlert < ALERT_DEBOUNCE_MS) continue;
          this.lastAlertTime.set(debounceKey, now);
          cpuLimitAlertStore.appendAlert({
            level: 'instance',
            ruleName,
            nodeId,
            nodeName,
            cloudId: inst.cloudId,
            cloudName: inst.cloudName,
            triggerCount: count,
            threshold: config.instanceThreshold,
            windowMin: config.windowMin,
          });
        }
      }

      // 节点级检查
      const nodeCount = cpuLimitEventStore.countEventsByNode(nodeId, sinceTs);
      if (nodeCount >= config.nodeThreshold) {
        const debounceKey = `node:${nodeId}`;
        const lastAlert = this.lastAlertTime.get(debounceKey) ?? 0;
        if (now - lastAlert >= ALERT_DEBOUNCE_MS) {
          this.lastAlertTime.set(debounceKey, now);
          cpuLimitAlertStore.appendAlert({
            level: 'node',
            ruleName,
            nodeId,
            nodeName,
            triggerCount: nodeCount,
            threshold: config.nodeThreshold,
            windowMin: config.windowMin,
          });
        }
      }
    } catch (err) {
      console.error('[CpuLimitManager] 告警阈值检查失败:', err);
    }
  }

  private scheduleNext(): void {
    const activeRules = cpuLimitRuleStore.listEnabled();
    const intervalMs = this.calcIntervalMs(activeRules);

    this.timer = setInterval(async () => {
      try {
        await this.runCheckCycle();
      } catch (err) {
        console.error('[CpuLimitManager] 检查周期异常:', err);
      }
    }, intervalMs);
  }

  private calcIntervalMs(activeRules: CpuLimitRule[]): number {
    if (activeRules.length === 0) return 60000;
    const minInterval = Math.min(...activeRules.map(r => r.interval));
    return Math.max(minInterval * 1000, 60000);
  }

  /** 获取节点信息（名称） */
  private async getNodeInfo(nodeId: number): Promise<{ name: string } | null> {
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      const result = await MfyService.request(account, `nodes/${nodeId}`, {}, 'GET');
      if (!result.success || !result.data) return null;
      const data = (result.data as Record<string, unknown>).data ?? result.data;
      return { name: String((data as Record<string, unknown>).name ?? `节点${nodeId}`) };
    } catch {
      return null;
    }
  }

  /**
   * 获取节点指标值（百分比）
   * 复用 node-monitor-service 的指标获取逻辑
   */
  private async getNodeMetric(nodeId: number, metric: CpuLimitMetric): Promise<number | null> {
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      const result = await MfyService.request(account, `nodes/${nodeId}/real_data`, {}, 'GET');
      if (!result.success || !result.data) return null;

      const data = (result.data as Record<string, unknown>).data ?? result.data;
      const d = data as Record<string, unknown>;

      switch (metric) {
        case 'cpu':
          return Number(d.cpu_use_percent ?? 0) || 0;
        case 'memory': {
          const mem = d.memory as Record<string, unknown> | undefined;
          return Number(mem?.use_percent ?? 0) || 0;
        }
        case 'disk': {
          const diskArr = d.disk as unknown[];
          if (!Array.isArray(diskArr) || diskArr.length === 0) return null;
          const firstDisk = diskArr[0] as Record<string, string>;
          return parseFloat(firstDisk.disk_percent) || 0;
        }
      }
    } catch {
      return null;
    }
  }
}

// 使用 globalThis 确保单例（与 bandwidth-manager 和 node-monitor 一致）
const globalForCpuLimit = globalThis as unknown as { __cpuLimitManagerService?: CpuLimitManagerService };
if (!globalForCpuLimit.__cpuLimitManagerService) {
  globalForCpuLimit.__cpuLimitManagerService = new CpuLimitManagerService();
}
export const cpuLimitManagerService = globalForCpuLimit.__cpuLimitManagerService;
