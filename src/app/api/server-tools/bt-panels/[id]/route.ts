/**
 * 单个宝塔面板信息 API
 *
 * DELETE /api/server-tools/bt-panels/[id]  - 删除（软删除）
 */
import { NextRequest, NextResponse } from 'next/server';
import { btPanelStore } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-bt-panel-id-delete');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const ok = btPanelStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '宝塔信息不存在或无权删除' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
