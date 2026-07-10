/**
 * SFTP 客户端管理器
 *
 * 管理每个 connectionId 对应的 SFTP 会话，带 TTL 自动回收。
 * 通过 connectionStore.getByIdInternal 获取连接信息后建立 SFTP。
 */
import { Client } from 'ssh2';
import type { Stats } from 'ssh2';
import type { Readable, Writable } from 'stream';
import { connectionStore } from './store';
import { sshClientManager } from './ssh-client';

export interface SftpEntry {
  name: string;
  longname: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  modifyTime: number;
  accessTime: number;
  rights: { user: string; group: string; other: string };
  owner: string;
  group: string;
}

interface CachedSftp {
  client: Client;
  sftp: SftpWrapper;
  lastUsed: number;
}

type SftpWrapper = {
  readdir(path: string, cb: (err: Error | null, list: SftpEntry[]) => void): void;
  stat(path: string, cb: (err: Error | null, stats: Stats) => void): void;
  mkdir(path: string, cb: (err: Error | null) => void): void;
  rmdir(path: string, cb: (err: Error | null) => void): void;
  unlink(path: string, cb: (err: Error | null) => void): void;
  rename(oldPath: string, newPath: string, cb: (err: Error | null) => void): void;
  createReadStream(path: string, options?: unknown): Readable;
  createWriteStream(path: string, options?: unknown): Writable;
  end(): void;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 分钟

class SftpClientManager {
  private cache = new Map<string, CachedSftp>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const [, cached] of this.cache) {
      try { cached.sftp.end(); } catch { /* ignore */ }
      try { cached.client.end(); } catch { /* ignore */ }
    }
    this.cache.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [connId, cached] of this.cache) {
      if (now - cached.lastUsed > CACHE_TTL_MS) {
        try { cached.sftp.end(); } catch { /* ignore */ }
        try { cached.client.end(); } catch { /* ignore */ }
        this.cache.delete(connId);
      }
    }
  }

  /**
   * 获取或创建 SFTP 会话
   */
  async getSftp(connectionId: string): Promise<SftpWrapper> {
    const cached = this.cache.get(connectionId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.sftp;
    }

    const conn = connectionStore.getByIdInternal(connectionId);
    if (!conn) throw new Error('连接不存在');

    const client = await sshClientManager.createConnection({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      readyTimeout: 15000,
    });

    const sftp = await new Promise<SftpWrapper>((resolve, reject) => {
      client.sftp((err, s) => {
        if (err) reject(new Error(`SFTP 会话创建失败: ${err.message}`));
        else resolve(s as unknown as SftpWrapper);
      });
    });

    this.cache.set(connectionId, { client, sftp, lastUsed: Date.now() });
    return sftp;
  }

  /**
   * 列出目录内容
   *
   * ssh2 的 readdir 回调返回 { filename, longname, attrs } 原始对象，
   * 此处映射为前端使用的 SftpEntry 格式：
   * - filename → name
   * - attrs.isDirectory()/isFile()/isSymbolicLink() → type
   * - attrs.size/mtime/atime → size/modifyTime/accessTime
   * - attrs.mode → rights（解析 rwx 权限位）
   * - attrs.uid/gid → owner/group（数字形式，前端可自行解析用户名）
   */
  async list(connectionId: string, path: string): Promise<SftpEntry[]> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      sftp.readdir(path, (err, list) => {
        if (err) {
          reject(new Error(`读取目录失败: ${err.message}`));
          return;
        }
        // list 是 ssh2 返回的原始 { filename, longname, attrs } 数组
        const rawList = list as unknown as Array<{
          filename: string;
          longname: string;
          attrs: {
            mode?: number;
            uid?: number;
            gid?: number;
            size?: number;
            atime?: number | Date;
            mtime?: number | Date;
            isDirectory?: () => boolean;
            isFile?: () => boolean;
            isSymbolicLink?: () => boolean;
          };
        }>;
        const entries: SftpEntry[] = rawList
          .filter(item => item && item.filename && item.filename !== '.' && item.filename !== '..')
          .map(item => {
            const attrs = item.attrs ?? {};
            let type: SftpEntry['type'] = 'other';
            if (typeof attrs.isDirectory === 'function' && attrs.isDirectory()) {
              type = 'dir';
            } else if (typeof attrs.isSymbolicLink === 'function' && attrs.isSymbolicLink()) {
              type = 'symlink';
            } else if (typeof attrs.isFile === 'function' && attrs.isFile()) {
              type = 'file';
            }
            const mode = attrs.mode ?? 0;
            const rights = {
              user: modeToRightsStr(mode >> 6 & 7),
              group: modeToRightsStr(mode >> 3 & 7),
              other: modeToRightsStr(mode & 7),
            };
            return {
              name: item.filename,
              longname: item.longname ?? '',
              type,
              size: attrs.size ?? 0,
              modifyTime: toUnixSeconds(attrs.mtime),
              accessTime: toUnixSeconds(attrs.atime),
              rights,
              owner: attrs.uid !== undefined ? String(attrs.uid) : '',
              group: attrs.gid !== undefined ? String(attrs.gid) : '',
            };
          });
        resolve(entries);
      });
    });
  }

  /**
   * 读取文件内容（小文件，用于文本预览）
   */
  async readFile(connectionId: string, path: string, maxSize = 1024 * 1024): Promise<Buffer> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalSize = 0;
      const stream = sftp.createReadStream(path, { encoding: null });
      stream.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          stream.destroy();
          reject(new Error('文件过大，超过 1MB 限制'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', err => reject(new Error(`读取文件失败: ${err.message}`)));
    });
  }

  /**
   * 创建读流（用于下载）
   */
  async createReadStream(connectionId: string, path: string): Promise<Readable> {
    const sftp = await this.getSftp(connectionId);
    return sftp.createReadStream(path);
  }

  /**
   * 创建写流（用于上传）
   */
  async createWriteStream(connectionId: string, path: string): Promise<Writable> {
    const sftp = await this.getSftp(connectionId);
    return sftp.createWriteStream(path);
  }

  /**
   * 创建目录
   */
  async mkdir(connectionId: string, path: string): Promise<void> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      sftp.mkdir(path, err => {
        if (err) reject(new Error(`创建目录失败: ${err.message}`));
        else resolve();
      });
    });
  }

  /**
   * 删除文件
   */
  async unlink(connectionId: string, path: string): Promise<void> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      sftp.unlink(path, err => {
        if (err) reject(new Error(`删除文件失败: ${err.message}`));
        else resolve();
      });
    });
  }

  /**
   * 删除目录
   */
  async rmdir(connectionId: string, path: string): Promise<void> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      sftp.rmdir(path, err => {
        if (err) reject(new Error(`删除目录失败: ${err.message}`));
        else resolve();
      });
    });
  }

  /**
   * 重命名
   */
  async rename(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSftp(connectionId);
    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, err => {
        if (err) reject(new Error(`重命名失败: ${err.message}`));
        else resolve();
      });
    });
  }
}

export const sftpClientManager = new SftpClientManager();

/**
 * 将 rwx 权限位数字（0-7）转为字符串（如 'rwx', 'r-x', '---'）
 */
function modeToRightsStr(n: number): string {
  return (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-');
}

/**
 * 将 ssh2 的 mtime/atime（可能是 number 秒 或 Date 对象）统一转为 Unix 秒数
 */
function toUnixSeconds(v: number | Date | undefined): number {
  if (v === undefined) return 0;
  if (v instanceof Date) return Math.floor(v.getTime() / 1000);
  if (typeof v === 'number') return v;
  return 0;
}
