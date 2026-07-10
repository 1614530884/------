/**
 * 宝塔面板信息 API
 *
 * GET /api/server-tools/bt-panels  - 列表（支持 connectionId 过滤）
 */
import { NextRequest, NextResponse } from 'next/server';
import { btPanelStore } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-bt-panels-get');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connectionId') ?? undefined;
  const list = btPanelStore.list(currentUser, { connectionId });
  return NextResponse.json({ success: true, data: list });
}
