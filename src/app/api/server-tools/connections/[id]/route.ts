/**
 * 单个服务器连接管理 API
 *
 * GET    /api/server-tools/connections/[id]   - 详情（不返回密码）
 * PATCH  /api/server-tools/connections/[id]   - 更新
 * DELETE /api/server-tools/connections/[id]   - 软删除
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectionStore } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import type { ServerConnectionUpdate } from '@/lib/services/server-tools/types';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-conn-id-get');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const conn = connectionStore.getById(id, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }
  // 详情接口返回密码，供 SSH 连接使用（前端不持久化）
  return NextResponse.json({ success: true, data: conn });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-conn-id-patch');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const body = await request.json() as Partial<ServerConnectionUpdate> & { _loginUser?: string };
  const { _loginUser, ...update } = body;
  const conn = connectionStore.update(id, update, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权修改' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { ...conn, password: undefined } });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-conn-id-delete');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const ok = connectionStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '连接不存在或无权删除' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
