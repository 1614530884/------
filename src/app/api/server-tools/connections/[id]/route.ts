/**
 * 单个服务器连接管理 API
 *
 * GET    /api/server-tools/connections/[id]   - 详情（不返回密码）
 * PATCH  /api/server-tools/connections/[id]   - 更新
 * DELETE /api/server-tools/connections/[id]   - 软删除
 */
import { NextRequest, NextResponse } from 'next/server';
import { connectionStore } from '@/lib/services/server-tools/store';
import type { ServerConnectionUpdate } from '@/lib/services/server-tools/types';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  const conn = connectionStore.getById(id, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }
  // 详情接口返回密码，供 SSH 连接使用（前端不持久化）
  return NextResponse.json({ success: true, data: conn });
}, 'st-conn-id-get');

export const PATCH = withAuth(async (request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  const body = await request.json() as Partial<ServerConnectionUpdate> & { _loginUser?: string };
  const { _loginUser, ...update } = body;
  const conn = connectionStore.update(id, update, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权修改' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { ...conn, password: undefined } });
}, 'st-conn-id-patch');

export const DELETE = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  const ok = connectionStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '连接不存在或无权删除' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}, 'st-conn-id-delete');
