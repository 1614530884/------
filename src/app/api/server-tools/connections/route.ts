/**
 * 服务器连接管理 API
 *
 * GET  /api/server-tools/connections       - 列表
 * POST /api/server-tools/connections       - 创建
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectionStore } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import type { ServerConnectionInput } from '@/lib/services/server-tools/types';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-connections-get');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  // scope=all 仅管理员可用，用于查看全部用户的服务器；其他值或非管理员均退化为 mine
  const scopeParam = request.nextUrl.searchParams.get('scope');
  const includeAll = scopeParam === 'all' && currentUser.isAdmin;
  const list = connectionStore.list(currentUser, includeAll);
  // 列表接口不返回密码
  const safe = list.map(c => ({ ...c, password: undefined }));
  return NextResponse.json({ success: true, data: safe });
}

export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-connections-post');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const body = await request.json() as Partial<ServerConnectionInput> & { _loginUser?: string };
  const { _loginUser, ...input } = body;
  if (!input.name || !input.host || !input.username || !input.password) {
    return NextResponse.json({ success: false, message: '缺少必填字段: name, host, username, password' }, { status: 400 });
  }
  try {
    const conn = connectionStore.create({
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      password: input.password,
      description: input.description,
    }, currentUser);
    return NextResponse.json({ success: true, data: { ...conn, password: undefined } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message: `创建失败: ${message}` }, { status: 500 });
  }
}
