/**
 * 服务器管理工具 - 清理调度器
 *
 * 职责：
 * 1. 每 6 小时执行一次自动清理
 * 2. 遍历所有启用的清理规则，按 retainDays 删除过期数据
 * 3. 记录清理日志
 */
import { cleanupRuleStore } from './store';
import type { CleanupScope } from './types';

const SCHEDULE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时

class CleanupScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    // 启动后 1 分钟执行首次清理（避免与启动逻辑冲突）
    setTimeout(() => this.runCleanup(), 60 * 1000);
    // 之后每 6 小时执行一次
    this.timer = setInterval(() => this.runCleanup(), SCHEDULE_INTERVAL_MS);
    console.log('[ServerTools] 清理调度器已启动（每 6 小时执行）');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.started = false;
  }

  /**
   * 执行一次清理（手动触发也用此方法）
   */
  runCleanup(): { scope: CleanupScope; deleted: number }[] {
    const rules = cleanupRuleStore.listAllEnabled();
    if (rules.length === 0) {
      console.log('[ServerTools] 无启用的清理规则，跳过');
      return [];
    }

    const results: { scope: CleanupScope; deleted: number }[] = [];
    for (const rule of rules) {
      try {
        const result = cleanupRuleStore.executeCleanup(rule.scope, rule.retainDays);
        results.push({ scope: rule.scope, deleted: result.deleted });
        console.log(`[ServerTools] 清理 ${rule.scope}: 删除 ${result.deleted} 条（保留 ${rule.retainDays} 天）`);
      } catch (err) {
        console.error(`[ServerTools] 清理 ${rule.scope} 失败:`, err);
      }
    }
    return results;
  }

  isRunning(): boolean {
    return this.started;
  }
}

export const cleanupScheduler = new CleanupScheduler();
