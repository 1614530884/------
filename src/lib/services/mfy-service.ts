import { readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import { decrypt, encrypt, isEncrypted } from '@/lib/crypto';

const CONFIG_PATH = join(process.cwd(), 'idc-config.json');
const TOKEN_CACHE_PATH = join(process.cwd(), 'mfy-token-cache.json');

export interface MfyAccount {
  loginUser: string;
  mfyUrl: string;
  mfyUsername: string;
  mfyPassword: string;
}

export interface MfyConfig {
  mfyUrl: string;
  mfyUsername: string;
  mfyPassword: string;
  mfyAccounts: MfyAccount[];
}

export interface MfyCredentials {
  mfyUrl: string;
  mfyUsername: string;
  mfyPassword: string;
}

export class MfyService {
  private static tokenCacheMap = new Map<string, { token: string; expireAt: number }>();
  private static configCache: MfyConfig | null = null;
  private static configMtime = 0;
  private static loginInFlight = new Map<string, Promise<string>>();
  private static writeQueue: Promise<void> = Promise.resolve();

  /** 清除配置缓存（配置保存后调用） */
  static clearConfigCache(): void {
    this.configCache = null;
    this.configMtime = 0;
  }

  /** 读取魔方云配置（带内存缓存 + mtime 检测） */
  static readConfig(): MfyConfig {
    try {
      const stat = statSync(CONFIG_PATH);
      const mtime = stat.mtimeMs;
      if (this.configCache && this.configMtime === mtime) {
        return this.configCache;
      }
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw);
      const result: MfyConfig = {
        mfyUrl: config.mfyUrl || '',
        mfyUsername: config.mfyUsername || '',
        mfyPassword: decrypt(config.mfyPassword || ''),
        mfyAccounts: Array.isArray(config.mfyAccounts)
          ? config.mfyAccounts.map((a: Record<string, string>) => ({
              loginUser: a.loginUser || '',
              mfyUrl: a.mfyUrl || '',
              mfyUsername: a.mfyUsername || '',
              mfyPassword: decrypt(a.mfyPassword || ''),
            }))
          : [],
      };
      this.configCache = result;
      this.configMtime = mtime;
      return result;
    } catch {
      return { mfyUrl: '', mfyUsername: '', mfyPassword: '', mfyAccounts: [] };
    }
  }

  /** 根据登录用户名解析对应的魔方云账号 */
  static resolveMfyAccount(config: MfyConfig, loginUser?: string): MfyCredentials {
    if (loginUser && config.mfyAccounts.length > 0) {
      const match = config.mfyAccounts.find(a => a.loginUser === loginUser);
      if (match) {
        return { mfyUrl: match.mfyUrl, mfyUsername: match.mfyUsername, mfyPassword: match.mfyPassword };
      }
    }
    return { mfyUrl: config.mfyUrl, mfyUsername: config.mfyUsername, mfyPassword: config.mfyPassword };
  }

  /** 生成账号缓存键 */
  private static accountKey(url: string, user: string): string {
    return `${url}|${user}`;
  }

  /** 读取Token缓存 */
  private static readTokenCache(key: string): string | null {
    const mem = this.tokenCacheMap.get(key);
    if (mem && Date.now() < mem.expireAt) return mem.token;

    try {
      const raw = readFileSync(TOKEN_CACHE_PATH, 'utf-8');
      const cache = JSON.parse(raw);
      // 向后兼容：旧格式 {token, expireAt} 无key，忽略
      if (cache && typeof cache === 'object' && !Array.isArray(cache) && key in cache) {
        const entry = (cache as Record<string, { token: string; expireAt: number }>)[key];
        if (entry?.token && entry.expireAt && Date.now() < entry.expireAt) {
          // 解密token（兼容明文token）
          const token = isEncrypted(entry.token) ? decrypt(entry.token) : entry.token;
          this.tokenCacheMap.set(key, { token, expireAt: entry.expireAt });
          return token;
        }
      }
    } catch { /* ignore */ }

    return null;
  }

  /** 写入Token缓存（内存同步更新 + 队列化延迟刷盘） */
  private static writeTokenCache(key: string, token: string): void {
    const expireAt = Date.now() + 12 * 3600 * 1000;
    this.tokenCacheMap.set(key, { token, expireAt });
    this.queuePersistTokenCache();
  }

  /** 清除Token缓存（内存同步删除 + 队列化延迟刷盘） */
  static clearTokenCache(url: string, username: string): void {
    const key = this.accountKey(url, username);
    this.tokenCacheMap.delete(key);
    this.queuePersistTokenCache();
  }

  /** 队列化持久化 token 缓存（串行化避免竞态） */
  private static queuePersistTokenCache(): void {
    this.writeQueue = this.writeQueue.then(() => this.persistTokenCache()).catch(() => { /* ignore */ });
  }

  /** 从内存全量写入文件（source of truth 是 tokenCacheMap） */
  private static async persistTokenCache(): Promise<void> {
    const now = Date.now();
    const cache: Record<string, { token: string; expireAt: number }> = {};
    for (const [k, v] of this.tokenCacheMap) {
      if (v.expireAt > now) {
        cache[k] = { token: encrypt(v.token), expireAt: v.expireAt };
      } else {
        this.tokenCacheMap.delete(k);
      }
    }
    try {
      writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  /** 登录获取access_token（带单飞去重：并发请求复用同一登录 Promise） */
  static async login(credentials: MfyCredentials, force = false): Promise<string> {
    const { mfyUrl, mfyUsername } = credentials;
    const key = this.accountKey(mfyUrl, mfyUsername);

    if (!force) {
      const cached = this.readTokenCache(key);
      if (cached) return cached;
    }

    const inFlight = this.loginInFlight.get(key);
    if (inFlight && !force) return inFlight;

    const loginPromise = this.doLogin(credentials);
    this.loginInFlight.set(key, loginPromise);
    try {
      return await loginPromise;
    } finally {
      this.loginInFlight.delete(key);
    }
  }

  /** 实际执行登录 HTTP 请求 */
  private static async doLogin(credentials: MfyCredentials): Promise<string> {
    const { mfyUrl, mfyUsername, mfyPassword } = credentials;
    const key = this.accountKey(mfyUrl, mfyUsername);

    const loginUrl = `${mfyUrl}/v1/login?a=a`;
    const body = `username=${encodeURIComponent(mfyUsername)}&password=${encodeURIComponent(mfyPassword)}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const resp = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'text/plain',
        },
        body,
        signal: controller.signal,
      });

      const rawToken = await resp.text();
      const trimmed = rawToken.trim();

      if (resp.status >= 200 && resp.status < 300 && trimmed.length > 4) {
        const token = trimmed.replace(/^"|"$/g, '');
        if (token) {
          this.writeTokenCache(key, token);
          return token;
        }
      }

      throw new Error(`魔方云登录失败: ${trimmed.substring(0, 200)}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('魔方云API连接超时，请检查网络或API地址配置');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** 通用请求方法 */
  static async request(
    credentials: MfyCredentials,
    path: string,
    data: Record<string, unknown> = {},
    method: string = 'GET',
    retry = true
  ): Promise<Record<string, unknown>> {
    const { mfyUrl, mfyUsername, mfyPassword } = credentials;
    const token = await this.login(credentials);
    const baseUrl = `${mfyUrl}/v1/${path.replace(/^\//, '')}`;

    const headers: Record<string, string> = {
      'access-token': token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = { method, headers };

    // 构建query string（支持数组参数：ip[]=1&ip[]=2）
    const buildQs = (params: Record<string, unknown>) => Object.entries(params)
      .filter(([_, v]) => v !== undefined && v !== null && v !== '')
      .flatMap(([k, v]) => {
        if (Array.isArray(v)) {
          return v.map(item => `${encodeURIComponent(k + '[]')}=${encodeURIComponent(String(item))}`);
        }
        return [`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`];
      })
      .join('&');

    let targetUrl = baseUrl;

    switch (method) {
      case 'GET': {
        const qs = buildQs(data);
        if (qs) targetUrl = `${baseUrl}?${qs}`;
        break;
      }
      case 'POST':
        fetchOptions.body = JSON.stringify(data);
        break;
      case 'PUT':
        fetchOptions.body = JSON.stringify(data);
        break;
      case 'DELETE': {
        // 有数组参数时用body传参，否则用query string
        const hasArrayParam = Object.values(data).some(v => Array.isArray(v));
        if (hasArrayParam) {
          fetchOptions.body = JSON.stringify(data);
        } else {
          const qs = buildQs(data);
          if (qs) targetUrl = `${baseUrl}?${qs}`;
        }
        break;
      }
    }

    return this.doRequest(credentials, targetUrl, fetchOptions, retry);
  }

  /** 执行HTTP请求 */
  private static async doRequest(
    credentials: MfyCredentials,
    url: string,
    fetchOptions: RequestInit,
    retry: boolean
  ): Promise<Record<string, unknown>> {
    const { mfyUrl, mfyUsername, mfyPassword } = credentials;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    fetchOptions.signal = controller.signal;

    try {
      const resp = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      // 401: token过期，重新登录
      if (resp.status === 401 && retry) {
        this.clearTokenCache(mfyUrl, mfyUsername);
        try {
          const newToken = await this.login(credentials, true);
          (fetchOptions.headers as Record<string, string>)['access-token'] = newToken;
          return this.doRequest(credentials, url, fetchOptions, false);
        } catch {
          return { success: false, status: 401, msg: 'Token过期且重新登录失败' };
        }
      }

      const text = await resp.text();
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(text);
      } catch {
        content = { raw: text };
      }

      if (resp.status >= 200 && resp.status < 300) {
        return { success: true, status: 200, data: content, http_code: resp.status };
      }

      const errorMsg = (content as Record<string, unknown>).msg
        || (content as Record<string, unknown>).message
        || (content as Record<string, unknown>).error
        || `请求失败 (HTTP ${resp.status})`;
      return { success: false, status: resp.status, msg: errorMsg, data: content };
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, status: 0, msg: '魔方云API请求超时' };
      }
      const message = err instanceof Error ? err.message : '请求异常';
      return { success: false, status: 0, msg: `魔方云API请求失败: ${message}` };
    }
  }
}
