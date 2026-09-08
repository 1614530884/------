/**
 * 智能带宽管理 - 监控服务单例
 *
 * 职责：
 * 1. 定时轮询启用规则的节点带宽
 * 2. 超阈值 + 连续触发次数达标 + 冷却结束 → 派发 limit-executor 异步执行
 * 3. 同一规则+节点的限速任务互斥（防止重复派发）
 *
 * 设计参考 node-monitor-service.ts，但动作从"启停节点"变为"限速实例"。
 */
import { MfyService } from '@/lib/services/mfy-service';
import { asyncPool } from '@/lib/async-pool';
import { bandwidthRuleStore, bandwidthLogStore, bandwidthAlertStore } from './store';
import { executeBandwidthLimit } from './limit-executor';
import { bandwidthReleaseScheduler } from './release-scheduler';
import type { BandwidthRule, BandwidthServiceStatus } from './types';

class BandwidthManagerService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;
  private started = false;
  /** 最后执行动作时间（冷却用）：key = `${ruleId}:${nodeId}` */
  private lastActionTime = new Map<string, number>();
  /** 连续触发计数：key = `${ruleId}:${nodeId}` */
  private consecutiveHits = new Map<string, number>();
  /** 正在执行的限速任务：key = `${ruleId}:${nodeId}`，value = Promise */
  private runningTasks = new Map<string, Promise<void>>();
  /** 告警防抖：key=level:targetId，value=上次告警时间戳，防止同一目标短时间内重复告警 */
  private lastAlertTime = new Map<string, number>();
  /** 告警防抖冷却期（毫秒）：同一实例/节点在此期间内不重复告警 */
  private readonly ALERT_DEBOUNCE_MS = 5 * 60 * 1000; // 5 分钟
  private lastCheckAt: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext();
    // 启动到期自动恢复调度器
    bandwidthReleaseScheduler.start();
    console.log('[BandwidthManager] 服务已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    bandwidthReleaseScheduler.stop();
    this.started = false;
    console.log('[BandwidthManager] 服务已停止');
  }

  restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.consecutiveHits.clear();
    this.scheduleNext();
  }

  getStatus(): BandwidthServiceStatus {
    const rules = bandwidthRuleStore.list();
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
      releaseSchedulerRunning: bandwidthReleaseScheduler.isRunning(),
      activeEventCount: bandwidthAlertStore.countActiveEvents(),
    };
  }

  /** 手动触发检查周期 */
  async runCheckCycle(): Promise<void> {
    if (this.isChecking) {
      console.log('[BandwidthManager] 上一周期未结束，跳过');
      return;
    }
    this.isChecking = true;
    this.lastCheckAt = Date.now();

    try {
      const activeRules = bandwidthRuleStore.listEnabled();
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
  private async processNode(nodeId: number, activeRules: BandwidthRule[]): Promise<void> {
    try {
      const nodeInfo = await this.getNodeInfo(nodeId);
      if (!nodeInfo) return;

      const matchingRules = activeRules
        .filter(r => r.nodeIds.includes(nodeId))
        .sort((a, b) => a.createdAt - b.createdAt);

      // 节点级带宽缓存：一次 API 调用获取双向带宽，同节点多规则共享
      // 只有存在需要上行/下行阈值的规则时才查询对应方向
      const needUp = matchingRules.some(r => r.thresholdUp);
      const needDown = matchingRules.some(r => r.thresholdDown);
      let cachedBw: { up: number | null; down: number | null } | null = null;
      const getNodeBandwidthCached = async (): Promise<{ up: number | null; down: number | null }> => {
        if (cachedBw) return cachedBw;
        cachedBw = await this.getNodeBandwidthBoth(nodeId, needUp, needDown);
        return cachedBw;
      };

      for (const rule of matchingRules) {
        // 双方向检测：使用缓存的双向带宽
        const bw = await getNodeBandwidthCached();
        const upBw = rule.thresholdUp ? bw.up : null;
        const downBw = rule.thresholdDown ? bw.down : null;

        const triggerUp = upBw !== null && upBw > rule.thresholdUp!;
        const triggerDown = downBw !== null && downBw > rule.thresholdDown!;

        if (!triggerUp && !triggerDown) {
          // 两个方向都未触发，重置连续计数
          const hitKey = `${rule.id}:${nodeId}`;
          this.consecutiveHits.set(hitKey, 0);
          continue;
        }

        await this.checkRule(
          rule, nodeId, nodeInfo.name,
          triggerUp, triggerDown,
          upBw ?? 0, downBw ?? 0,
        );
      }
    } catch (err) {
      console.error(`[BandwidthManager] 节点${nodeId}处理失败:`, err);
    }
  }

  /** 检查规则是否触发（已确定至少一个方向触发） */
  private async checkRule(
    rule: BandwidthRule,
    nodeId: number,
    nodeName: string,
    triggerUp: boolean,
    triggerDown: boolean,
    metricValueUp: number,
    metricValueDown: number,
  ): Promise<void> {
    const hitKey = `${rule.id}:${nodeId}`;
    const requiredHits = rule.triggerCount || 1;
    const triggerDirection: 'up' | 'down' | 'both' = triggerUp && triggerDown ? 'both' : triggerUp ? 'up' : 'down';

    const currentCount = this.consecutiveHits.get(hitKey) ?? 0;
    const newCount = currentCount + 1;
    this.consecutiveHits.set(hitKey, newCount);

    if (newCount < requiredHits) {
      bandwidthLogStore.append({
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValueUp,
        metricValueDown,
        thresholdUp: rule.thresholdUp,
        thresholdDown: rule.thresholdDown,
        triggerDirection,
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
      bandwidthLogStore.append({
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValueUp,
        metricValueDown,
        thresholdUp: rule.thresholdUp,
        thresholdDown: rule.thresholdDown,
        triggerDirection,
        result: 'skipped',
        error: '冷却中',
      });
      return;
    }

    // 任务互斥：同一规则+节点已有任务在执行，跳过
    if (this.runningTasks.has(hitKey)) {
      bandwidthLogStore.append({
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_skip',
        metricValueUp,
        metricValueDown,
        thresholdUp: rule.thresholdUp,
        thresholdDown: rule.thresholdDown,
        triggerDirection,
        result: 'skipped',
        error: '上一轮限速任务仍在执行',
      });
      return;
    }

    // 派发限速任务（await 确保同节点多规则串行执行，防止并发竞争）
    this.lastActionTime.set(hitKey, now);
    bandwidthLogStore.append({
      ruleId: rule.id,
      ruleName: rule.name,
      nodeId,
      nodeName,
      eventType: 'limit_trigger',
      metricValueUp,
      metricValueDown,
      thresholdUp: rule.thresholdUp,
      thresholdDown: rule.thresholdDown,
      triggerDirection,
      topN: rule.topN,
      result: 'success',
    });

    const taskPromise = this.executeLimitTask(
      rule, nodeId, nodeName,
      triggerUp, triggerDown,
      metricValueUp, metricValueDown,
    );
    this.runningTasks.set(hitKey, taskPromise);
    try {
      await taskPromise;
    } finally {
      this.runningTasks.delete(hitKey);
    }
  }

  /** 异步执行限速任务 */
  private async executeLimitTask(
    rule: BandwidthRule,
    nodeId: number,
    nodeName: string,
    triggerUp: boolean,
    triggerDown: boolean,
    metricValueUp: number,
    metricValueDown: number,
  ): Promise<void> {
    const triggerDirection: 'up' | 'down' | 'both' = triggerUp && triggerDown ? 'both' : triggerUp ? 'up' : 'down';
    try {
      const now = Date.now();
      // 获取当前活跃限制事件（用于替代旧事件 + 冷却判断）
      const activeLimits = bandwidthAlertStore.getActiveLimits();
      const output = await executeBandwidthLimit({
        rule,
        nodeId,
        nodeName,
        triggerUp,
        triggerDown,
        metricValueUp,
        metricValueDown,
        activeLimits,
      });

      // 原子性替换事件：标记旧事件为 superseded + 创建新 active 事件
      // 事务保证一致性，避免"旧事件已 superseded 但新事件未创建"导致实例永久被限速
      if ((output.supersededEventIds?.length ?? 0) > 0 || (output.newEvents?.length ?? 0) > 0) {
        bandwidthAlertStore.replaceEvents(output.supersededEventIds ?? [], output.newEvents ?? []);
      }

      // 告警阈值检查：对刚限速的实例和节点分别检查
      this.checkAlertThresholds(rule.name, nodeId, nodeName, output.instances.filter(i => i.limited).map(i => ({
        cloudId: i.cloudId,
        cloudName: i.cloudName,
      })));

      bandwidthLogStore.append({
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_execute',
        metricValueUp,
        metricValueDown,
        thresholdUp: rule.thresholdUp,
        thresholdDown: rule.thresholdDown,
        triggerDirection,
        topN: rule.topN,
        affectedCount: output.affectedCount,
        instances: output.instances,
        result: output.success ? 'success' : 'failed',
        error: output.error,
      });
    } catch (err) {
      bandwidthLogStore.append({
        ruleId: rule.id,
        ruleName: rule.name,
        nodeId,
        nodeName,
        eventType: 'limit_execute',
        metricValueUp,
        metricValueDown,
        thresholdUp: rule.thresholdUp,
        thresholdDown: rule.thresholdDown,
        triggerDirection,
        result: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * 检查告警阈值：对刚限速的实例/节点，统计时间窗口内累计次数，达阈值则生成告警
   * - 实例级：同一实例在窗口内被限速次数达 instanceThreshold
   * - 节点级：同一节点下所有实例累计限速次数达 nodeThreshold
   * - 防抖：同一目标在 ALERT_DEBOUNCE_MS 内不重复告警
   */
  private checkAlertThresholds(
    ruleName: string,
    nodeId: number,
    nodeName: string,
    limitedInstances: Array<{ cloudId: number; cloudName: string }>,
  ): void {
    try {
      const config = bandwidthAlertStore.getConfig();
      if (!config.enabled || limitedInstances.length === 0) return;

      const now = Date.now();
      const sinceTs = now - config.windowMin * 60 * 1000;

      // 顺便清理超出窗口 2 倍时长的旧事件，避免表无限增长
      bandwidthAlertStore.cleanExpiredEvents(now - config.windowMin * 60 * 1000 * 2);

      // 实例级检查
      for (const inst of limitedInstances) {
        const count = bandwidthAlertStore.countEventsByCloud(inst.cloudId, sinceTs);
        if (count >= config.instanceThreshold) {
          const debounceKey = `instance:${inst.cloudId}`;
          const lastAlert = this.lastAlertTime.get(debounceKey) ?? 0;
          if (now - lastAlert < this.ALERT_DEBOUNCE_MS) continue;
          this.lastAlertTime.set(debounceKey, now);
          bandwidthAlertStore.appendAlert({
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
      const nodeCount = bandwidthAlertStore.countEventsByNode(nodeId, sinceTs);
      if (nodeCount >= config.nodeThreshold) {
        const debounceKey = `node:${nodeId}`;
        const lastAlert = this.lastAlertTime.get(debounceKey) ?? 0;
        if (now - lastAlert >= this.ALERT_DEBOUNCE_MS) {
          this.lastAlertTime.set(debounceKey, now);
          bandwidthAlertStore.appendAlert({
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
      console.error('[BandwidthManager] 告警阈值检查失败:', err);
    }
  }

  private scheduleNext(): void {
    const activeRules = bandwidthRuleStore.listEnabled();
    const intervalMs = this.calcIntervalMs(activeRules);

    this.timer = setInterval(async () => {
      try {
        await this.runCheckCycle();
      } catch (err) {
        console.error('[BandwidthManager] 检查周期异常:', err);
      }
    }, intervalMs);
  }

  private calcIntervalMs(activeRules: BandwidthRule[]): number {
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

  /** 一次 API 调用获取节点双向实时带宽（bps）
   *  needUp/needDown 控制是否解析对应方向，避免无用字段解析
   *  - up: 出站带宽（net_card.outbw）
   *  - down: 入站带宽（net_card.inbw）
   */
  private async getNodeBandwidthBoth(
    nodeId: number,
    needUp: boolean,
    needDown: boolean,
  ): Promise<{ up: number | null; down: number | null }> {
    const empty = { up: null as number | null, down: null as number | null };
    if (!needUp && !needDown) return empty;
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      const result = await MfyService.request(account, `nodes/${nodeId}/status`, {}, 'GET');
      if (!result.success || !result.data) return empty;
      const data = (result.data as Record<string, unknown>).data ?? result.data;
      const netCard = (data as Record<string, unknown>).net_card as Record<string, unknown> | undefined;
      if (!netCard) return empty;
      // bandwidth_up → 出站 outbw；bandwidth_down → 入站 inbw
      const up = needUp ? (Number(netCard.outbw ?? 0) || 0) : null;
      const down = needDown ? (Number(netCard.inbw ?? 0) || 0) : null;
      return {
        up: up !== null && !isNaN(up) ? up : null,
        down: down !== null && !isNaN(down) ? down : null,
      };
    } catch {
      return empty;
    }
  }
}

// 使用 globalThis 确保单例（与 server-tools 和 node-monitor 一致）
const globalForBandwidth = globalThis as unknown as { __bandwidthManagerService?: BandwidthManagerService };
if (!globalForBandwidth.__bandwidthManagerService) {
  globalForBandwidth.__bandwidthManagerService = new BandwidthManagerService();
}
export const bandwidthManagerService = globalForBandwidth.__bandwidthManagerService;
