/**
 * 单个宝塔面板信息 API
 *
 * DELETE /api/server-tools/bt-panels/[id]  - 删除（软删除）
 */
import { NextRequest, NextResponse } from 'next/server';
import { btPanelStore } from '@/lib/services/server-tools/store';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const DELETE = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  const ok = btPanelStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '宝塔信息不存在或无权删除' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}, 'st-bt-panel-id-delete');
