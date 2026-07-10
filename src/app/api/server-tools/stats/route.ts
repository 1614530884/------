/**
 * 仪表盘统计 API
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDashboardStats } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-stats');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  // scope=all 仅管理员可用，用于查看全部用户的统计；与 connections 接口一致
  const scopeParam = request.nextUrl.searchParams.get('scope');
  const includeAll = scopeParam === 'all' && currentUser.isAdmin;
  const stats = getDashboardStats(currentUser, includeAll);
  // 同时返回当前用户身份信息，前端用于决定是否显示'我的/全部'切换按钮
  return NextResponse.json({
    success: true,
    data: {
      ...stats,
      currentUser: { username: currentUser.username, isAdmin: currentUser.isAdmin },
    },
  });
}
