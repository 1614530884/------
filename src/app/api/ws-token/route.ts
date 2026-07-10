/**
 * WebSocket Token 签发
 *
 * 同源校验后签发 24h 有效期的 token，供前端建立 WS 连接时使用
 */
import { NextRequest, NextResponse } from 'next/server';
import { serverToolsService } from '@/lib/services/server-tools/service';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'ws-token');
    return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  }

  // 同源校验
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const token = serverToolsService.registerToken();
  return NextResponse.json({ token });
}
