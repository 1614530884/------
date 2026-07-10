/**
 * 脚本排序 API（仅管理员）
 *
 * POST /api/server-tools/scripts/reorder
 * body: { items: [{ id, sortOrder }] }
 */
import { NextRequest, NextResponse } from 'next/server';
import { scriptStore } from '@/lib/services/server-tools/store';
import type { ScriptReorderItem } from '@/lib/services/server-tools/types';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

export const POST = withAuth(async (request, currentUser) => {
  if (!currentUser.isAdmin) {
    return NextResponse.json({ success: false, message: '仅管理员可调整排序' }, { status: 403 });
  }

  const body = await request.json() as { items?: ScriptReorderItem[] };
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    return NextResponse.json({ success: false, message: '排序列表为空' }, { status: 400 });
  }

  // 校验每项格式
  for (const item of items) {
    if (!item.id || typeof item.id !== 'string' || typeof item.sortOrder !== 'number') {
      return NextResponse.json({ success: false, message: '排序列表格式错误' }, { status: 400 });
    }
  }

  const ok = scriptStore.reorder(items, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '排序失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}, 'st-scripts-reorder');
