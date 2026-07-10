import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { NextRequest } from 'next/server';

const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, 'access.log');

/**
 * 记录未授权访问到 logs/access.log。
 * 仅在 Node.js runtime 调用（API route），Edge middleware 不可用。
 */
export function logUnauthorizedAccess(request: NextRequest, action?: string): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const ip = request.headers.get('x-forwarded-for')
      || request.headers.get('x-real-ip')
      || 'unknown';
    const ua = request.headers.get('user-agent') || '';
    const referrer = request.headers.get('referer') || '';
    const entry = `[${new Date().toISOString()}] UNAUTHORIZED ${request.method} ${request.nextUrl.pathname} action=${action || '-'} ip=${ip} ref=${referrer} ua=${ua.substring(0, 200)}\n`;
    appendFileSync(LOG_FILE, entry, 'utf-8');
  } catch { /* 日志写入失败不影响主流程 */ }
}
