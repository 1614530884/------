import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { NextRequest } from 'next/server';

export const SESSION_COOKIE_NAME = 'idc_session';
const CONFIG_PATH = join(process.cwd(), 'idc-config.json');
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 天

let cachedSecret: string | null = null;

/**
 * 从 idc-config.json 读取 sessionSecret，不存在则生成并写回。
 * 仅在 Node.js runtime 调用（API route、server component），Edge middleware 不可用。
 */
export function getAuthSecret(): string {
  if (cachedSecret) return cachedSecret;

  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch { /* 配置文件可能不存在 */ }

  if (typeof config.sessionSecret === 'string' && config.sessionSecret) {
    cachedSecret = config.sessionSecret;
    return cachedSecret;
  }

  // 生成新密钥并写回配置文件
  cachedSecret = randomBytes(32).toString('hex');
  config.sessionSecret = cachedSecret;
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  } catch { /* 写入失败忽略，下次会重新生成 */ }

  return cachedSecret;
}

function base64UrlEncode(buf: Buffer | string): string {
  const buffer = typeof buf === 'string' ? Buffer.from(buf, 'utf-8') : buf;
  return buffer.toString('base64url');
}

function base64UrlDecode(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

/**
 * 生成签名 session token：base64url(payload).base64url(hmac)
 * payload = { exp: <unix_seconds>, user: <username> }
 */
export function createSessionToken(username: string): string {
  const secret = getAuthSecret();
  const payload = JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS, user: username });
  const payloadB64 = base64UrlEncode(payload);
  const hmac = createHmac('sha256', secret).update(payloadB64).digest();
  const sigB64 = base64UrlEncode(hmac);
  return `${payloadB64}.${sigB64}`;
}

/**
 * 从 session token 中提取用户名。
 * 旧 token（无 user 字段）返回 null。不验证签名——调用前应先通过 verifySessionToken。
 */
export function getSessionUser(token: string | undefined | null): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[0]).toString('utf-8')) as { exp?: number; user?: string };
    if (typeof payload.user === 'string' && payload.user) return payload.user;
    return null;
  } catch {
    return null;
  }
}

/**
 * 验证 session token 签名 + 过期时间。
 * 返回 true 表示有效。
 */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;

  try {
    const secret = getAuthSecret();
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest();
    const providedSig = base64UrlDecode(sigB64);

    // 长度不一致直接拒绝，避免 timingSafeEqual 抛错
    if (expectedSig.length !== providedSig.length) return false;

    if (!timingSafeEqual(expectedSig, providedSig)) return false;

    // 验证过期时间
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf-8')) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * 根据请求实际协议动态生成 session cookie 选项。
 * secure 仅在 HTTPS（含反向代理 x-forwarded-proto）下开启，
 * 避免 HTTP 直接访问时浏览器丢弃 secure cookie 导致登录后无法跳转。
 */
export function getSessionCookieOptions(request?: NextRequest) {
  const isHttps = request
    ? request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:'
    : false;
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
