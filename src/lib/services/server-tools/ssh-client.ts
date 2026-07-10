/**
 * 服务器管理工具 - SSH 客户端管理
 *
 * 单例模式，管理所有 SSH 会话。
 * 参考 网页ssh远程/src/lib/ssh/client.ts
 */
import { Client, type ClientChannel } from 'ssh2';

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
      client
        .on('ready', () => resolve(client))
        .on('error', err => reject(new Error(`SSH连接失败: ${err.message}`)))
        .connect({
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          readyTimeout: config.readyTimeout ?? 30000,
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
   */
  async executeCommand(client: Client, command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(new Error(`执行命令失败: ${err.message}`));
          return;
        }
        let output = '';
        stream
          .on('data', (chunk: Buffer) => {
            output += chunk.toString('utf-8');
          })
          .stderr.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf-8');
          })
          .on('close', () => resolve(output))
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
