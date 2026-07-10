/**
 * 脚本管理 API
 *
 * GET  /api/server-tools/scripts        - 列表（支持 category 筛选）
 * POST /api/server-tools/scripts        - 创建自定义脚本
 */
import { NextRequest, NextResponse } from 'next/server';
import { scriptStore } from '@/lib/services/server-tools/store';
import type { ScriptCategory, ScriptDefInput } from '@/lib/services/server-tools/types';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

const VALID_CATEGORIES: ScriptCategory[] = ['maintenance', 'install', 'inspect', 'custom'];

export const GET = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const categoryParam = url.searchParams.get('category');
  const category = categoryParam && VALID_CATEGORIES.includes(categoryParam as ScriptCategory)
    ? categoryParam as ScriptCategory
    : undefined;

  const list = scriptStore.list(currentUser, category ? { category } : undefined);
  return NextResponse.json({ success: true, data: list });
}, 'st-scripts-get');

export const POST = withAuth(async (request, currentUser) => {
  const body = await request.json() as Partial<ScriptDefInput> & { _loginUser?: string };
  const { _loginUser, ...input } = body;
  void _loginUser;

  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    return NextResponse.json({ success: false, message: '脚本名称不能为空' }, { status: 400 });
  }
  if (!input.category || !VALID_CATEGORIES.includes(input.category)) {
    return NextResponse.json({ success: false, message: '分类无效，必须为 maintenance/install/inspect/custom' }, { status: 400 });
  }
  if (!input.content || typeof input.content !== 'string' || !input.content.trim()) {
    return NextResponse.json({ success: false, message: '脚本内容不能为空' }, { status: 400 });
  }

  const params = Array.isArray(input.params) ? input.params : [];

  // builtin 仅管理员可设
  const builtin = input.builtin === true && currentUser.isAdmin ? true : false;

  try {
    const script = scriptStore.create({
      name: input.name.trim(),
      category: input.category,
      description: input.description?.trim() || undefined,
      content: input.content,
      params,
      builtin,
    }, currentUser);
    return NextResponse.json({ success: true, data: script });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message: `创建失败: ${message}` }, { status: 500 });
  }
}, 'st-scripts-post');
