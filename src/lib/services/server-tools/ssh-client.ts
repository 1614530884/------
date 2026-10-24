/**
 * 服务器管理工具 - SSH 客户端管理
 *
 * 单例模式，管理所有 SSH 会话。
 * 参考 网页ssh远程/src/lib/ssh/client.ts
 */
import { Client, type ClientChannel } from 'ssh2';

// 20s 主动 ping 一次，连续 3 次没响应才判定断线
// 注意：ssh2 的 keepaliveInterval 只主动发 ping 保活，服务端收到任何包都会重置 ClientAlive 计数
const KEEPALIVE_INTERVAL_MS = 20000;
const KEEPALIVE_COUNT_MAX = 3;
// 单条命令最多保留 4MB 输出，超出截断，避免长任务输出撑爆进程内存
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface SSHConnectionConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  readyTimeout?: number;
}

export interface SSHSession {
  sessionId: string;
  connectionId: string;
  client: Client;
  stream: ClientChannel;
  isConnected: boolean;
  connectedAt: Date;
}

class SSHClientManager {
  private sessions: Map<string, SSHSession> = new Map();

  /**
   * 创建 SSH 连接
   */
  async createConnection(config: SSHConnectionConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let settled = false;
      client
        // 必须先挂 error：握手阶段失败走 reject；建连成功后的运行期错误不能让它变成未捕获异常
        .on('error', err => {
          if (!settled) reject(new Error(`SSH连接失败: ${err.message}`));
        })
        .on('ready', () => {
          settled = true;
          resolve(client);
        })
        .connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          readyTimeout: config.readyTimeout ?? 30000,
          keepaliveInterval: KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: KEEPALIVE_COUNT_MAX,
        });
    });
  }

  /**
   * 创建交互式 shell
   * @param cols 初始列数（默认 80）
   * @param rows 初始行数（默认 24）
   */
  async createShell(
    client: Client,
    onData: (data: Buffer) => void,
    onClose: () => void,
    cols = 80,
    rows = 24,
  ): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      // 传入初始窗口尺寸 + 终端类型，避免 pty 默认尺寸与 xterm 不匹配导致光标定位错乱
      client.shell({ cols, rows, term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          reject(new Error(`创建Shell失败: ${err.message}`));
          return;
        }
        stream
          .on('data', onData)
          .on('close', onClose)
          .stderr.on('data', onData);
        resolve(stream);
      });
    });
  }

  /**
   * 执行命令并返回完整输出（不通过 shell）
   *
   * 输出上限：安装宝塔/跑脚本这类任务动辄几十 MB 输出，全量累积在内存里会把进程撑爆。
   * 因此只保留前 maxOutputBytes 字节，超出后丢弃后续输出（流继续消费，命令不会卡住）。
   */
  async executeCommand(client: Client, command: string, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`执行命令失败: ${err.message}`));
          return;
        }
        const chunks: Buffer[] = [];
        let keptBytes = 0;
        let truncated = false;

        const append = (chunk: Buffer): void => {
          if (truncated) return;
          const remain = maxOutputBytes - keptBytes;
          if (chunk.length >= remain) {
            chunks.push(chunk.subarray(0, remain));
            keptBytes += remain;
            truncated = true;
            return;
          }
          chunks.push(chunk);
          keptBytes += chunk.length;
        };

        stream
          .on('data', append)
          .stderr.on('data', append)
          .on('close', () => {
            const output = Buffer.concat(chunks).toString('utf-8');
            resolve(truncated ? `${output}\n...[输出过多，已截断]` : output);
          })
          .on('error', err => reject(err));
      });
    });
  }

  writeToShell(stream: ClientChannel, data: string): void {
    if (stream && stream.writable) stream.write(data);
  }

  resizeShell(stream: ClientChannel, cols: number, rows: number): void {
    if (stream && stream.setWindow) stream.setWindow(rows, cols, 0, 0);
  }

  closeConnection(client: Client): void {
    if (client) client.end();
  }

  closeShell(stream: ClientChannel): void {
    if (stream && stream.end) stream.end();
  }

  saveSession(sessionId: string, session: SSHSession): void {
    this.sessions.set(sessionId, session);
  }

  getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId);
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      // 先解绑数据回调：已经废弃的会话不应再往前端推输出，也不该触发 disconnected 把新连接的状态改掉
      session.stream?.removeAllListeners('data');
      session.stream?.removeAllListeners('close');
      session.stream?.stderr?.removeAllListeners('data');
      this.closeConnection(session.client);
      try {
        this.closeShell(session.stream);
      } catch {
        // ignore
      }
      this.sessions.delete(sessionId);
    }
  }

  getActiveSessions(): SSHSession[] {
    return Array.from(this.sessions.values());
  }

  cleanupAllSessions(): void {
    for (const sessionId of this.sessions.keys()) {
      this.removeSession(sessionId);
    }
  }
}

export const sshClientManager = new SSHClientManager();
