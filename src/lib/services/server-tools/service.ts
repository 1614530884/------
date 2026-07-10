/**
 * 服务器管理工具 - 主服务（单例）
 *
 * 职责：
 * 1. 管理 WebSocket Token（签发/校验/过期清理）
 * 2. 启动时初始化 DB（建表）
 * 3. 启动时把 running 任务标记为 interrupted
 * 4. 启动 CleanupScheduler（P7 阶段实现）
 * 5. 提供 TaskRunner 实例（P3 阶段实现）
 * 6. 优雅关闭
 */
import { randomBytes } from 'crypto';
import { getDb, closeDb } from './db';
import { taskStore } from './store';
import { sshClientManager } from './ssh-client';
import { sftpClientManager } from './sftp-client';
import { seedBuiltinScripts } from './builtin-scripts';
import { cleanupScheduler } from './cleanup-scheduler';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const TOKEN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5min

class ServerToolsService {
  private started = false;
  private tokenCleanupTimer: ReturnType<typeof setInterval> | null = null;
  private validTokens = new Map<string, number>(); // token -> expireAt

  /**
   * 注册访问令牌
   */
  registerToken(): string {
    const token = randomBytes(32).toString('hex');
    this.validTokens.set(token, Date.now() + TOKEN_TTL_MS);
    return token;
  }

  /**
   * 校验 token
   */
  validateToken(token: string | null): boolean {
    if (!token) return false;
    const expireAt = this.validTokens.get(token);
    if (!expireAt) return false;
    if (Date.now() > expireAt) {
      this.validTokens.delete(token);
      return false;
    }
    return true;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // 1. 初始化数据库（建表）
    getDb();
    console.log('[ServerTools] 数据库已初始化');

    // 2. seed 内置脚本
    seedBuiltinScripts();

    // 3. 服务重启后把 running 任务标记为 interrupted
    const interruptedCount = taskStore.markRunningAsInterrupted();
    if (interruptedCount > 0) {
      console.log(`[ServerTools] ${interruptedCount} 个运行中任务因服务重启标记为中断`);
    }

    // 4. 启动 Token 清理定时器
    this.tokenCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, expireAt] of this.validTokens) {
        if (now > expireAt) this.validTokens.delete(token);
      }
    }, TOKEN_CLEANUP_INTERVAL_MS);

    // P3 阶段：启动 TaskRunner
    // 启动清理调度器（每 6 小时执行）
    cleanupScheduler.start();

    // 启动 SFTP 客户端管理器
    sftpClientManager.start();

    console.log('[ServerTools] 服务已启动');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.tokenCleanupTimer) {
      clearInterval(this.tokenCleanupTimer);
      this.tokenCleanupTimer = null;
    }

    // 停止清理调度器
    cleanupScheduler.stop();

    // 关闭所有 SFTP 会话
    sftpClientManager.stop();

    // 关闭所有 SSH 会话
    sshClientManager.cleanupAllSessions();

    closeDb();
    console.log('[ServerTools] 服务已停止');
  }
}

// 使用 globalThis 确保单例跨模块实例共享
// （Next.js dev 模式下，server.ts 和 API 路由可能各自加载一次模块，
//   导致两个 serverToolsService 实例，token Map 不共享 → WS 连接 401）
const globalForServerTools = globalThis as unknown as {
  __serverToolsService?: ServerToolsService;
};

if (!globalForServerTools.__serverToolsService) {
  globalForServerTools.__serverToolsService = new ServerToolsService();
}

export const serverToolsService = globalForServerTools.__serverToolsService;
