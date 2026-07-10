/**
 * 服务器管理工具 - 鉴权辅助
 *
 * 优先从 session token 获取可信用户名，fallback 到 _loginUser（兼容旧 token）
 * 通过读取 idc-config.json 获取 adminUsernames 判断是否管理员
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { NextRequest } from 'next/server';
import type { CurrentUser } from './types';
import { verifySessionToken, getSessionUser, SESSION_COOKIE_NAME } from '@/lib/auth-server';

const ADMIN_CACHE_TTL_MS = 60 * 1000;
let adminCache: { usernames: string[]; expireAt: number } = { usernames: [], expireAt: 0 };

const CONFIG_PATH = join(process.cwd(), 'idc-config.json');

/**
 * 同步读取管理员用户名列表（从 idc-config.json）
 */
export function loadAdminUsernames(): string[] {
  const now = Date.now();
  if (adminCache.expireAt > now) return adminCache.usernames;

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    const list = (config.adminUsernames as string | undefined)
      ?.split(',')
      .map(s => s.trim())
      .filter(Boolean) ?? [];
    adminCache = { usernames: list, expireAt: now + ADMIN_CACHE_TTL_MS };
    return list;
  } catch {
    return [];
  }
}

/**
 * 从请求中提取当前用户。
 * 优先使用 session token 中的可信用户名（不可伪造）；
 * 旧 token（无 user 字段）fallback 到客户端 _loginUser / x-current-user header。
 */
export async function getCurrentUser(request: NextRequest, body?: Record<string, unknown>): Promise<CurrentUser | null> {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (verifySessionToken(sessionCookie)) {
    const tokenUser = getSessionUser(sessionCookie);
    if (tokenUser) {
      const adminList = loadAdminUsernames();
      return { username: tokenUser, isAdmin: adminList.includes(tokenUser) };
    }
  }

  let username: string | undefined;
  if (body && typeof body._loginUser === 'string') {
    username = body._loginUser;
  } else {
    const headerUser = request.headers.get('x-current-user');
    if (headerUser) username = headerUser;
  }
  if (!username) return null;

  const adminList = loadAdminUsernames();
  return {
    username,
    isAdmin: adminList.includes(username),
  };
}
