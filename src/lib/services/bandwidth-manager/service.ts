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
import { bandwidthRuleStore, bandwidthLogStore } from './store';
import { executeBandwidthLimit } from './limit-executor';
import type { BandwidthRule, BandwidthServiceStatus, BandwidthMetric } from './types';

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
  /** 每台机器的最近限速时间戳：key = cloudId，用于 per-machine 冷却判断 */
  private machineLimitTime = new Map<number, number>();
  private lastCheckAt: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext();
    console.log('[BandwidthManager] 服务已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

      for (const rule of matchingRules) {
        // 双方向检测：查上行/下行节点带宽，判断是否触发
        const upBw = rule.thresholdUp ? await this.getNodeBandwidth(nodeId, 'bandwidth_up') : null;
        const downBw = rule.thresholdDown ? await this.getNodeBandwidth(nodeId, 'bandwidth_down') : null;

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
      const output = await executeBandwidthLimit({
        rule,
        nodeId,
        nodeName,
        triggerUp,
        triggerDown,
        metricValueUp,
        metricValueDown,
        machineLimitTime: this.machineLimitTime,
      });

      // 限速成功的机器记录到 per-machine 冷却表
      for (const inst of output.instances) {
        if (inst.limited) {
          this.machineLimitTime.set(inst.cloudId, now);
        }
      }
      // 清理过期条目（超过 durationMin 的），避免内存无限增长
      this.cleanupExpiredMachineLimits(rule.durationMin);

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

  /** 清理已过期的 per-machine 冷却记录（含缓冲时间） */
  private cleanupExpiredMachineLimits(durationMin: number): void {
    // 缓冲 2 分钟，与 limit-executor 的 COOLDOWN_BUFFER_MS 保持一致
    const expireMs = (durationMin + 2) * 60 * 1000;
    const now = Date.now();
    for (const [cloudId, ts] of this.machineLimitTime) {
      if (now - ts >= expireMs) {
        this.machineLimitTime.delete(cloudId);
      }
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

  /** 获取节点实时带宽（bps） */
  private async getNodeBandwidth(
    nodeId: number,
    metric: BandwidthMetric,
  ): Promise<number | null> {
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      // 节点状态接口含 net_card.inbw/outbw
      const result = await MfyService.request(account, `nodes/${nodeId}/status`, {}, 'GET');
      if (!result.success || !result.data) return null;
      const data = (result.data as Record<string, unknown>).data ?? result.data;
      const netCard = (data as Record<string, unknown>).net_card as Record<string, unknown> | undefined;
      if (!netCard) return null;
      // bandwidth_up → 出站 outbw；bandwidth_down → 入站 inbw
      const bps = metric === 'bandwidth_up'
        ? Number(netCard.outbw ?? 0)
        : Number(netCard.inbw ?? 0);
      return isNaN(bps) ? 0 : bps;
    } catch {
      return null;
    }
  }
}

// 使用 globalThis 确保单例（与 server-tools 和 node-monitor 一致）
const globalForBandwidth = globalThis as unknown as { __bandwidthManagerService?: BandwidthManagerService };
if (!globalForBandwidth.__bandwidthManagerService) {
  globalForBandwidth.__bandwidthManagerService = new BandwidthManagerService();
}
export const bandwidthManagerService = globalForBandwidth.__bandwidthManagerService;
