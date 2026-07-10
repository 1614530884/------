/**
 * 宝塔面板信息 API
 *
 * GET /api/server-tools/bt-panels  - 列表（支持 connectionId 过滤）
 */
import { NextRequest, NextResponse } from 'next/server';
import { btPanelStore } from '@/lib/services/server-tools/store';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

export const GET = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connectionId') ?? undefined;
  const list = btPanelStore.list(currentUser, { connectionId });
  return NextResponse.json({ success: true, data: list });
}, 'st-bt-panels-get');
