import { randomUUID } from 'crypto';
import { MfyService } from './mfy-service';
import { readConfig, appendLog } from './node-monitor-store';
import { asyncPool } from '@/lib/async-pool';
import type { MonitorRule, MonitorConfig, MonitorMetric, MonitorLog, MonitorServiceStatus, MonitorAction } from './node-monitor-types';

class NodeMonitorService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isChecking = false;
  private lastActionTime = new Map<string, number>();
  private lastCheckAt: number | null = null;
  private started = false;
  // 连续触发计数: key = `${ruleId}:${nodeId}`
  // side: 'h'(高位), 'l'(低位), 's'(单条件), null(空闲)
  private consecutiveHits = new Map<string, { count: number; side: 'h' | 'l' | 's' | null }>();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.scheduleNext();
    console.log('[NodeMonitor] 服务已启动');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    console.log('[NodeMonitor] 服务已停止');
  }

  restart(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.consecutiveHits.clear();
    console.log('[NodeMonitor] 连续计数已清空，重新调度');
    this.scheduleNext();
  }

  getStatus(): MonitorServiceStatus {
    const config = readConfig();
    const activeRules = config.rules.filter(r => r.enabled);
    const checkIntervalMs = this.calcIntervalMs(config);

    return {
      running: this.started,
      isChecking: this.isChecking,
      checkIntervalMs,
      nextCheckAt: this.timer ? Date.now() + checkIntervalMs : null,
      ruleCount: config.rules.length,
      activeRuleCount: activeRules.length,
      lastCheckAt: this.lastCheckAt,
    };
  }

  async runCheckCycle(): Promise<void> {
    if (this.isChecking) {
      console.log('[NodeMonitor] 上一周期未结束，跳过');
      return;
    }
    this.isChecking = true;
    this.lastCheckAt = Date.now();

    try {
      const config = readConfig();
      if (!config.globalEnabled) return;

      const activeRules = config.rules.filter(r => r.enabled);
      if (activeRules.length === 0) return;

      // 清理不再活跃的规则+节点的连续计数
      const activeKeys = new Set(
        activeRules.flatMap(r => r.nodeIds.map(nid => `${r.id}:${nid}`))
      );
      for (const key of this.consecutiveHits.keys()) {
        if (!activeKeys.has(key)) {
          this.consecutiveHits.delete(key);
        }
      }

      const targetNodeIds = [...new Set(activeRules.flatMap(r => r.nodeIds))];
      // 缓存每个节点的指标值，避免同节点多规则重复查询
      const metricCache = new Map<string, number | null>();

      await asyncPool(targetNodeIds, 5, (nodeId) =>
        this.processNode(nodeId, activeRules, metricCache)
      );
    } finally {
      this.isChecking = false;
    }
  }

  /** 处理单个节点的所有匹配规则 */
  private async processNode(
    nodeId: number,
    activeRules: MonitorRule[],
    metricCache: Map<string, number | null>
  ): Promise<void> {
    try {
      const nodeInfo = await this.getNodeInfo(nodeId);
      if (!nodeInfo) return;

      const matchingRules = activeRules
        .filter(r => r.nodeIds.includes(nodeId))
        .sort((a, b) => a.createdAt - b.createdAt);

      for (const rule of matchingRules) {
        const cacheKey = `${nodeId}:${rule.metric}`;
        let metricValue = metricCache.get(cacheKey);
        if (metricValue === undefined) {
          metricValue = await this.getNodeMetric(nodeId, rule.metric);
          metricCache.set(cacheKey, metricValue);
        }
        if (metricValue === null) continue;

        if (rule.operator === 'range') {
          await this.checkRangeRule(rule, nodeId, nodeInfo, metricValue);
        } else {
          await this.checkSingleRule(rule, nodeId, nodeInfo, metricValue);
        }
      }
    } catch (err) {
      console.error(`[NodeMonitor] 节点${nodeId}处理失败:`, err);
    }
  }

  /** 区间模式：统一计数，同侧连续才累计，区间切换清空计数 */
  private async checkRangeRule(
    rule: MonitorRule,
    nodeId: number,
    nodeInfo: { enable: number; name: string },
    metricValue: number
  ): Promise<void> {
    const hitKey = `${rule.id}:${nodeId}`;
    const requiredHits = rule.triggerCount || 1;
    const lowThreshold = rule.thresholdLow ?? 0;

    const isHighTriggered = metricValue > rule.threshold;
    const isLowTriggered = metricValue < lowThreshold;

    // 死区：两个阈值都不触发，重置计数
    if (!isHighTriggered && !isLowTriggered) {
      const current = this.consecutiveHits.get(hitKey);
      // 仅当之前有累计计数时才记录（避免每次死区都刷屏）
      if (current && current.side !== null && current.count > 0) {
        this.writeLog(rule, nodeId, nodeInfo.name, metricValue, 0, 'skipped',
          `进入安全区间(${lowThreshold}%~${rule.threshold}%)，计数已重置`, undefined, rule.action);
      }
      this.consecutiveHits.set(hitKey, { count: 0, side: null });
      return;
    }

    const triggeredSide: 'h' | 'l' = isHighTriggered ? 'h' : 'l';
    const triggerSide: 'high' | 'low' = isHighTriggered ? 'high' : 'low';
    const action: MonitorAction = isHighTriggered ? rule.action : (rule.actionLow ?? 'enable');

    const current = this.consecutiveHits.get(hitKey) ?? { count: 0, side: null as 'h' | 'l' | 's' | null };

    let newCount: number;
    if (current.side === triggeredSide) {
      // 同侧连续触发，累计
      newCount = current.count + 1;
    } else {
      // 区间切换：清空前侧计数，从1开始
      if (current.side !== null && current.count > 0) {
        this.writeLog(rule, nodeId, nodeInfo.name, metricValue, 0, 'skipped',
          `区间切换(从${current.side === 'h' ? '高位' : '低位'})，计数已清空`, triggerSide, action);
      }
      newCount = 1;
    }

    this.consecutiveHits.set(hitKey, { count: newCount, side: triggeredSide });

    if (newCount < requiredHits) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        `连续触发${newCount}/${requiredHits}次`, triggerSide, action);
      return;
    }

    // 达到触发次数，重置计数
    this.consecutiveHits.set(hitKey, { count: 0, side: null });

    // 冷却检查（高低位各自冷却）
    const cooldownKey = `${rule.id}:${nodeId}:${triggeredSide}`;
    const now = Date.now();
    const lastAction = this.lastActionTime.get(cooldownKey) || 0;
    if (now - lastAction < rule.cooldown * 1000) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        '冷却中', triggerSide, action);
      return;
    }

    // 幂等检查
    const targetEnable = action === 'enable' ? 1 : 0;
    if (nodeInfo.enable === targetEnable) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        '节点已是目标状态', triggerSide, action);
      return;
    }

    // 执行动作
    const result = await this.executeAction(nodeId, action);
    this.lastActionTime.set(cooldownKey, Date.now());
    nodeInfo.enable = targetEnable;
    this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount,
      result.success ? 'success' : 'failed', result.error, triggerSide, action);
  }

  /** 单条件模式(above/below)：独立计数 */
  private async checkSingleRule(
    rule: MonitorRule,
    nodeId: number,
    nodeInfo: { enable: number; name: string },
    metricValue: number
  ): Promise<void> {
    const hitKey = `${rule.id}:${nodeId}`;
    const requiredHits = rule.triggerCount || 1;
    const action: MonitorAction = rule.action;

    const isTriggered = rule.operator === 'above'
      ? metricValue > rule.threshold
      : metricValue < rule.threshold;

    if (!isTriggered) {
      this.consecutiveHits.set(hitKey, { count: 0, side: 's' });
      return;
    }

    const current = this.consecutiveHits.get(hitKey) ?? { count: 0, side: null as 'h' | 'l' | 's' | null };
    const newCount = current.side === 's' ? current.count + 1 : 1;
    this.consecutiveHits.set(hitKey, { count: newCount, side: 's' });

    if (newCount < requiredHits) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        `连续触发${newCount}/${requiredHits}次`, undefined, action);
      return;
    }

    // 达到触发次数，重置计数
    this.consecutiveHits.set(hitKey, { count: 0, side: 's' });

    // 冷却检查
    const cooldownKey = `${rule.id}:${nodeId}:s`;
    const now = Date.now();
    const lastAction = this.lastActionTime.get(cooldownKey) || 0;
    if (now - lastAction < rule.cooldown * 1000) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        '冷却中', undefined, action);
      return;
    }

    // 幂等检查
    const targetEnable = action === 'enable' ? 1 : 0;
    if (nodeInfo.enable === targetEnable) {
      this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount, 'skipped',
        '节点已是目标状态', undefined, action);
      return;
    }

    // 执行动作
    const result = await this.executeAction(nodeId, action);
    this.lastActionTime.set(cooldownKey, Date.now());
    nodeInfo.enable = targetEnable;
    this.writeLog(rule, nodeId, nodeInfo.name, metricValue, newCount,
      result.success ? 'success' : 'failed', result.error, undefined, action);
  }

  private scheduleNext(): void {
    const config = readConfig();
    const intervalMs = this.calcIntervalMs(config);

    this.timer = setInterval(async () => {
      try {
        await this.runCheckCycle();
      } catch (err) {
        console.error('[NodeMonitor] 检查周期异常:', err);
      }
    }, intervalMs);
  }

  private calcIntervalMs(config: MonitorConfig): number {
    const activeRules = config.rules.filter(r => r.enabled);
    if (activeRules.length === 0 || !config.globalEnabled) return 60000;
    const minInterval = Math.min(...activeRules.map(r => r.interval));
    return Math.max(minInterval * 1000, 60000);
  }

  private async getNodeInfo(nodeId: number): Promise<{ enable: number; name: string } | null> {
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      const result = await MfyService.request(account, `nodes/${nodeId}`, {}, 'GET');
      if (!result.success || !result.data) return null;

      const data = (result.data as Record<string, unknown>).data ?? result.data;
      return {
        enable: Number((data as Record<string, unknown>).enable ?? 0) || 0,
        name: String((data as Record<string, unknown>).name ?? `节点${nodeId}`),
      };
    } catch {
      return null;
    }
  }

  private async getNodeMetric(nodeId: number, metric: MonitorMetric): Promise<number | null> {
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

  private async executeAction(nodeId: number, action: string): Promise<{ success: boolean; error?: string }> {
    try {
      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);
      const enable = action === 'enable' ? 1 : 0;
      await MfyService.request(account, `nodes/${nodeId}`, { enable }, 'PUT');
      return { success: true };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : '未知错误' };
    }
  }

  private writeLog(
    rule: MonitorRule,
    nodeId: number,
    nodeName: string,
    metricValue: number,
    consecutiveHits: number,
    result: MonitorLog['actionResult'],
    error: string | undefined,
    triggerSide: 'high' | 'low' | undefined,
    actualAction: MonitorAction
  ): void {
    appendLog({
      id: randomUUID(),
      timestamp: Date.now(),
      ruleId: rule.id,
      ruleName: rule.name,
      nodeId,
      nodeName,
      metric: rule.metric,
      metricValue,
      operator: rule.operator,
      threshold: rule.threshold,
      thresholdLow: rule.operator === 'range' ? rule.thresholdLow : undefined,
      action: actualAction,
      triggerCount: rule.triggerCount || 1,
      consecutiveHits,
      triggerSide,
      actionResult: result,
      actionError: error,
    });
  }
}

export const nodeMonitorService = new NodeMonitorService();
