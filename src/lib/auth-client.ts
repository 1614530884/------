'use client';

export const STORAGE_KEY = 'idc_auth';
const ENCRYPT_KEY = 'idc-auth-enc-2026';

export interface AuthData {
  token: string;
  cookie: string;
  username: string;
  password: string;
}

/** XOR + base64 加密（与现有数据兼容） */
export function encrypt(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ ENCRYPT_KEY.charCodeAt(i % ENCRYPT_KEY.length));
  }
  return typeof window !== 'undefined' ? btoa(result) : Buffer.from(result, 'binary').toString('base64');
}

/** XOR + base64 解密（与现有数据兼容） */
export function decrypt(encoded: string): string {
  if (!encoded) return '';
  try {
    const decoded = typeof window !== 'undefined' ? atob(encoded) : Buffer.from(encoded, 'base64').toString('binary');
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ ENCRYPT_KEY.charCodeAt(i % ENCRYPT_KEY.length));
    }
    return result;
  } catch {
    return '';
  }
}

/** 保存认证信息到 localStorage */
export function saveAuth(params: AuthData): void {
  if (typeof window === 'undefined') return;
  try {
    const data = {
      token: params.token,
      cookie: params.cookie,
      username: encrypt(params.username),
      password: encrypt(params.password),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

/** 从 localStorage 读取并解密认证信息 */
export function loadAuth(): AuthData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      token: data.token || '',
      cookie: data.cookie || '',
      username: decrypt(data.username || ''),
      password: decrypt(data.password || ''),
    };
  } catch { /* ignore */ }
  return null;
}

/** 清除 localStorage 中的认证信息 */
export function clearAuthStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('idc_selectedUser');
  } catch { /* ignore */ }
}

/** 检查 localStorage 是否有有效认证（仅检查存在性，不验证 token 有效性） */
export function isAuthenticated(): boolean {
  const auth = loadAuth();
  return !!(auth && auth.token && auth.cookie);
}

/** 获取当前登录用户名 */
export function getLoginUser(): string {
  const auth = loadAuth();
  return auth?.username || '';
}

/**
 * 认证过期处理：清 localStorage → 调 /api/logout 清 cookie → 跳转 /login
 * 在 API 返回 401/未登录且重登失败后调用。
 */
export async function handleAuthExpired(): Promise<void> {
  clearAuthStorage();
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.location.href = '/login?reason=session_expired';
  }
}

/**
 * 主动登出：清 localStorage → 调 /api/logout 清 cookie → 跳转 /login
 */
export async function logout(): Promise<void> {
  clearAuthStorage();
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}
