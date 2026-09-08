/**
 * CPU 限制 - 到期自动解除调度器
 *
 * 独立定时器，每 30 秒扫描一次 cpu_limit_events 表：
 * - 查询 status='active' 且 expire_time <= now 的事件
 * - 对每个到期事件调用 PUT clouds/{id}/cpu_limit 设置 cpu_limit=100 解除限制
 * - 解除成功 → 标记为 'released'；失败 → 指数退避重试
 * - 超过最大重试次数 → 标记为 'failed' 并生成告警通知
 * - 支持手动解除（供 API 调用）
 *
 * 这是 CPU 限制功能特有的组件，因为 clouds/:id/cpu_limit 接口
 * 不像 clouds/:id/bw 那样支持 temp_bw_expire_time 自动到期恢复。
 */
import { MfyService } from '@/lib/services/mfy-service';
import { getDb } from '@/lib/services/server-tools/db';
import { cpuLimitEventStore, cpuLimitLogStore, cpuLimitAlertStore } from './store';
import { releaseInstanceCpu, CPU_LIMIT_RELEASE_PERCENT } from './limit-executor';
import type { CpuLimitEvent } from './types';

/** 扫描间隔（毫秒） */
const SCAN_INTERVAL_MS = 30 * 1000; // 30 秒

/** 单个事件最大重试次数（避免无限重试） */
const MAX_RELEASE_RETRY = 5;

/**
 * 计算指数退避延迟（毫秒）
 * 重试间隔：30s → 60s → 120s → 240s → 480s
 * 第 N 次重试延迟 = 30 * 2^(N-1) 秒
 */
function calcBackoffDelay(retryCount: number): number {
  return Math.min(30 * Math.pow(2, retryCount) * 1000, 10 * 60 * 1000); // 上限 10 分钟
}

class CpuLimitReleaseScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private isScanning = false;
  /** 重试计数：key = eventId，value = 已重试次数（持久化到 DB 的 release_retry_count） */

  start(): void {
    if (this.started) return;
    this.started = true;
    // 立即执行一次（启动时清理启动前已到期的事件）
    setTimeout(() => { void this.scan(); }, 5000);
    this.timer = setInterval(() => { void this.scan(); }, SCAN_INTERVAL_MS);
    console.log('[CpuLimitReleaseScheduler] 调度器已启动，扫描间隔 30s');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
    console.log('[CpuLimitReleaseScheduler] 调度器已停止');
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
      const expired = cpuLimitEventStore.listExpired(now);
      if (expired.length === 0) return;

      console.log(`[CpuLimitReleaseScheduler] 发现 ${expired.length} 个到期事件需解除`);

      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);

      // 串行解除（避免并发对同一节点的 API 压力）
      for (const event of expired) {
        await this.releaseOne(account, event);
      }
    } catch (err) {
      console.error('[CpuLimitReleaseScheduler] 扫描异常:', err);
    } finally {
      this.isScanning = false;
    }
  }

  /** 解除单个事件的 CPU 限制（带指数退避重试） */
  private async releaseOne(account: ReturnType<typeof MfyService.resolveMfyAccount>, event: CpuLimitEvent): Promise<void> {
    const retry = event.releaseRetryCount ?? 0;
    if (retry >= MAX_RELEASE_RETRY) {
      // 超过最大重试次数，标记为 failed 并生成告警
      const errorMsg = `超过最大重试次数 ${MAX_RELEASE_RETRY}，放弃解除`;
      cpuLimitEventStore.markReleased(event.id, Date.now(), errorMsg);
      cpuLimitLogStore.append({
        ts: Date.now(),
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        eventType: 'limit_release',
        details: JSON.stringify({
          cloudId: event.cloudId,
          cloudName: event.cloudName,
          cpuLimitPercent: CPU_LIMIT_RELEASE_PERCENT,
        }),
        result: 'failed',
        error: errorMsg,
      });
      // 生成解除失败告警
      cpuLimitAlertStore.appendAlert({
        level: 'instance',
        ruleName: event.ruleName,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        cloudId: event.cloudId,
        cloudName: event.cloudName,
        triggerCount: retry,
        threshold: MAX_RELEASE_RETRY,
        windowMin: 0, // 0 表示非限速次数告警，而是解除失败告警
      });
      console.warn(`[CpuLimitReleaseScheduler] 事件 ${event.id} (${event.cloudName}) ${errorMsg}`);
      return;
    }

    const result = await releaseInstanceCpu(account, event.cloudId);
    const releasedAt = Date.now();

    if (result.success) {
      cpuLimitEventStore.markReleased(event.id, releasedAt);
      cpuLimitLogStore.append({
        ts: releasedAt,
        ruleId: event.ruleId,
        ruleName: event.ruleName,
        nodeId: event.nodeId,
        nodeName: event.nodeName,
        eventType: 'limit_release',
        details: JSON.stringify({
          cloudId: event.cloudId,
          cloudName: event.cloudName,
          cpuLimitPercent: CPU_LIMIT_RELEASE_PERCENT,
          durationSec: Math.round((releasedAt - event.startTime) / 1000),
          retryCount: retry,
        }),
        result: 'success',
      });
      console.log(`[CpuLimitReleaseScheduler] 实例 ${event.cloudName}(#${event.cloudId}) CPU 限制已解除 (重试 ${retry} 次)`);
    } else {
      // 解除失败：增加重试计数，并通过更新 expire_time 实现退避延迟
      // （listExpired 查询 expire_time <= now，将到期时间延后可避免立即被下一轮拾取）
      const newRetryCount = cpuLimitEventStore.incrementRetryCount(event.id);
      const backoffDelay = calcBackoffDelay(newRetryCount);
      this.updateEventExpireTime(event.id, Date.now() + backoffDelay);

      console.warn(`[CpuLimitReleaseScheduler] 实例 ${event.cloudName}(#${event.cloudId}) 解除失败 (重试 ${newRetryCount}/${MAX_RELEASE_RETRY}), ${backoffDelay / 1000}s 后重试: ${result.error}`);
    }
  }

  /** 更新事件到期时间（用于退避延迟控制） */
  private updateEventExpireTime(eventId: string, newExpireTime: number): void {
    try {
      const db = getDb();
      db.prepare('UPDATE cpu_limit_events SET expire_time = ? WHERE id = ? AND status = ?').run(newExpireTime, eventId, 'active');
    } catch (err) {
      console.error('[CpuLimitReleaseScheduler] 更新到期时间失败:', err);
    }
  }

  /**
   * 手动解除单个事件（供 API 调用）
   * 不受重试次数限制，立即执行
   */
  async manualRelease(eventId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const event = cpuLimitEventStore.getById(eventId);
      if (!event) {
        return { success: false, error: '事件不存在' };
      }
      if (event.status !== 'active') {
        // 根据状态给出友好错误信息
        const statusMessages: Record<string, string> = {
          released: '该事件已解除，无需重复操作',
          superseded: '该事件已被新限制替代，请解除最新的限制事件',
          failed: '该事件解除失败（超过最大重试次数）',
        };
        return { success: false, error: statusMessages[event.status] ?? `事件状态为 ${event.status}，无法解除` };
      }

      const config = MfyService.readConfig();
      const account = MfyService.resolveMfyAccount(config);

      const result = await releaseInstanceCpu(account, event.cloudId);
      const releasedAt = Date.now();

      if (result.success) {
        cpuLimitEventStore.markReleased(event.id, releasedAt);
        cpuLimitLogStore.append({
          ts: releasedAt,
          ruleId: event.ruleId,
          ruleName: event.ruleName,
          nodeId: event.nodeId,
          nodeName: event.nodeName,
          eventType: 'limit_release',
          details: JSON.stringify({
            cloudId: event.cloudId,
            cloudName: event.cloudName,
            cpuLimitPercent: CPU_LIMIT_RELEASE_PERCENT,
            durationSec: Math.round((releasedAt - event.startTime) / 1000),
            manual: true,
          }),
          result: 'success',
        });
        console.log(`[CpuLimitReleaseScheduler] 手动解除实例 ${event.cloudName}(#${event.cloudId}) CPU 限制成功`);
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
const globalForReleaseScheduler = globalThis as unknown as { __cpuLimitReleaseScheduler?: CpuLimitReleaseScheduler };
if (!globalForReleaseScheduler.__cpuLimitReleaseScheduler) {
  globalForReleaseScheduler.__cpuLimitReleaseScheduler = new CpuLimitReleaseScheduler();
}
export const cpuLimitReleaseScheduler = globalForReleaseScheduler.__cpuLimitReleaseScheduler;
