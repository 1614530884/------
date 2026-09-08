/**
 * 智能带宽管理 - 到期自动恢复调度器
 *
 * 独立定时器，每 30 秒扫描一次 bandwidth_limit_events 表：
 * - 查询 status='active' 且 expire_time <= now 的事件
 * - 对每个到期事件调用 PUT clouds/{id}/bw 恢复原始带宽
 * - 恢复成功 → 标记为 'released'；失败 → 指数退避重试
 * - 超过最大重试次数 → 标记为 'failed' 并生成告警通知
 * - 支持手动解除（供 API 调用）
 *
 * 与 CPU release-scheduler 的关键差异：
 * - 恢复时使用事件记录的 original_in_bw/original_out_bw（而非固定值 100%）
 * - 未限速方向（limitDirection 不含该方向）不恢复，保持当前值
 */
import { MfyService, type MfyCredentials } from '@/lib/services/mfy-service';
import { getDb } from '@/lib/services/server-tools/db';
import { bandwidthAlertStore, bandwidthLogStore } from './store';
import { restoreInstanceBandwidth } from './limit-executor';
import type { BandwidthLimitEvent } from './types';

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL_MS = 30 * 1000; // 30 秒

/** 单个事件最大重试次数（避免无限重试） */
const MAX_RELEASE_RETRY = 5;

/**
 * 计算指数退避延迟（毫秒）
 * 重试间隔：30s → 60s → 120s → 240s → 480s
 */
function calcBackoffDelay(retryCount: number): number {
  return Math.min(30 * Math.pow(2, retryCount) * 1000, 10 * 60 * 1000); // 上限 10 分钟
}

class BandwidthReleaseScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private isScanning = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    // 立即执行一次（启动时清理启动前已到期的事件）
    setTimeout(() => { void this.scan(); }, 5000);
    this.timer = setInterval(() => { void this.scan(); }, SCAN_INTERVAL_MS);
    console.log('[BandwidthReleaseScheduler] 调度器已启动，扫描间隔 30s');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    console.log('[BandwidthReleaseScheduler] 调度器已停止');
  }

  isRunning(): boolean {
    return this.started;
  }

  /** 主扫描循环 */
  private async scan(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;
    try {
      const now = Date.now();
      const expired = bandwidthAlertStore.listExpiredEvents(now);
      if (expired.length === 0) return;

      console.log(`[BandwidthReleaseScheduler] 发现 ${expired.length} 个到期事件需恢复`);

      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);

      // 串行恢复（避免并发对同一节点的 API 压力）
      for (const event of expired) {
        await this.releaseOne(account, event);
      }
    } catch (err) {
      console.error('[BandwidthReleaseScheduler] 扫描异常:', err);
    } finally {
      this.isScanning = false;
    }
  }

  /** 恢复单个事件的带宽限制（带指数退避重试） */
  private async releaseOne(account: MfyCredentials, event: BandwidthLimitEvent): Promise<void> {
    const retry = event.releaseRetryCount ?? 0;
    if (retry >= MAX_RELEASE_RETRY) {
      const errorMsg = `超过最大重试次数 ${MAX_RELEASE_RETRY}，放弃恢复`;
      bandwidthAlertStore.markReleased(event.id, Date.now(), errorMsg);
      bandwidthLogStore.append({
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        eventType: 'limit_release',
        result: 'failed',
        error: errorMsg,
      });
      console.warn(`[BandwidthReleaseScheduler] 事件 ${event.id} (${event.cloudName}) ${errorMsg}`);
      return;
    }

    // 竞态保护：重新检查事件状态（可能在 listExpiredEvents 查询后已被 superseded）
    // 如果已被新限速替代，则不应恢复带宽（会覆盖新限速值）
    const currentEvent = bandwidthAlertStore.getEventById(event.id);
    if (!currentEvent || currentEvent.status !== 'active') {
      console.log(`[BandwidthReleaseScheduler] 事件 ${event.id} (${event.cloudName}) 状态已变更为 ${currentEvent?.status ?? 'null'}，跳过恢复`);
      return;
    }

    // 恢复带宽：使用事件记录的原始带宽值（始终是真实原始值，跨 superseded 事件继承）
    const originalInBw = event.originalInBw ?? 0;
    const originalOutBw = event.originalOutBw ?? 0;
    const result = await restoreInstanceBandwidth(account, event.cloudId, originalInBw, originalOutBw);
    const releasedAt = Date.now();

    if (result.success) {
      bandwidthAlertStore.markReleased(event.id, releasedAt);
      bandwidthLogStore.append({
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        eventType: 'limit_release',
        result: 'success',
      });
      console.log(`[BandwidthReleaseScheduler] 实例 ${event.cloudName}(#${event.cloudId}) 带宽已恢复 (重试 ${retry} 次)`);
    } else {
      // 恢复失败：增加重试计数，并通过更新 expire_time 实现退避延迟
      const newRetryCount = bandwidthAlertStore.incrementRetryCount(event.id);
      const backoffDelay = calcBackoffDelay(newRetryCount);
      bandwidthAlertStore.updateEventExpireTime(event.id, Date.now() + backoffDelay);

      console.warn(`[BandwidthReleaseScheduler] 实例 ${event.cloudName}(#${event.cloudId}) 恢复失败 (重试 ${newRetryCount}/${MAX_RELEASE_RETRY}), ${backoffDelay / 1000}s 后重试: ${result.error}`);
    }
  }

  /**
   * 手动解除单个事件（供 API 调用）
   * 不受重试次数限制，立即执行
   */
  async manualRelease(eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const event = bandwidthAlertStore.getEventById(eventId);
      if (!event) {
        return { success: false, error: '事件不存在' };
      }
      if (event.status !== 'active') {
        const statusMessages: Record<string, string> = {
          released: '该事件已恢复，无需重复操作',
          superseded: '该事件已被新限速替代，请解除最新的限速事件',
          failed: '该事件恢复失败（超过最大重试次数）',
        };
        return { success: false, error: statusMessages[event.status ?? ''] ?? `事件状态为 ${event.status}，无法解除` };
      }

      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);

      const originalInBw = event.originalInBw ?? 0;
      const originalOutBw = event.originalOutBw ?? 0;
      const result = await restoreInstanceBandwidth(account, event.cloudId, originalInBw, originalOutBw);
      const releasedAt = Date.now();

      if (result.success) {
        bandwidthAlertStore.markReleased(event.id, releasedAt);
        bandwidthLogStore.append({
          ruleId: event.ruleId,
          ruleName: event.ruleName,
          nodeId: event.nodeId,
          nodeName: event.nodeName,
          eventType: 'limit_release',
          result: 'success',
        });
        console.log(`[BandwidthReleaseScheduler] 手动恢复实例 ${event.cloudName}(#${event.cloudId}) 带宽成功`);
        return { success: true };
      } else {
        return { success: false, error: result.error };
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

// 使用 globalThis 确保单例
const globalForBwReleaseScheduler = globalThis as unknown as { __bandwidthReleaseScheduler?: BandwidthReleaseScheduler };
if (!globalForBwReleaseScheduler.__bandwidthReleaseScheduler) {
  globalForBwReleaseScheduler.__bandwidthReleaseScheduler = new BandwidthReleaseScheduler();
}
export const bandwidthReleaseScheduler = globalForBwReleaseScheduler.__bandwidthReleaseScheduler;
