/**
 * 仪表盘统计 API
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDashboardStats } from '@/lib/services/server-tools/store';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

export const GET = withAuth(async (request, currentUser) => {
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
}, 'st-stats');
