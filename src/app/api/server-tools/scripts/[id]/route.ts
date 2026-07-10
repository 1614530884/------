/**
 * 单个脚本管理 API
 *
 * GET    /api/server-tools/scripts/[id]   - 详情
 * PATCH  /api/server-tools/scripts/[id]   - 更新（管理员可改内置脚本，可切换 builtin 状态）
 * DELETE /api/server-tools/scripts/[id]   - 删除（管理员可删内置脚本）
 */
import { NextRequest, NextResponse } from 'next/server';
import { scriptStore } from '@/lib/services/server-tools/store';
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import type { ScriptCategory, ScriptDefUpdate } from '@/lib/services/server-tools/types';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

const VALID_CATEGORIES: ScriptCategory[] = ['maintenance', 'install', 'inspect', 'custom'];

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-script-id-get');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const script = scriptStore.getById(id, currentUser);
  if (!script) {
    return NextResponse.json({ success: false, message: '脚本不存在或无权访问' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: script });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-script-id-patch');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const existing = scriptStore.getById(id, currentUser);
  if (!existing) {
    return NextResponse.json({ success: false, message: '脚本不存在或无权访问' }, { status: 404 });
  }
  // 非管理员不可改内置脚本
  if (existing.builtin && !currentUser.isAdmin) {
    return NextResponse.json({ success: false, message: '内置脚本不可修改' }, { status: 403 });
  }

  const body = await request.json() as Partial<ScriptDefUpdate> & { _loginUser?: string };
  const { _loginUser, ...update } = body;
  void _loginUser;

  if (update.category !== undefined && !VALID_CATEGORIES.includes(update.category)) {
    return NextResponse.json({ success: false, message: '分类无效' }, { status: 400 });
  }
  if (update.name !== undefined && (!update.name || !update.name.trim())) {
    return NextResponse.json({ success: false, message: '脚本名称不能为空' }, { status: 400 });
  }
  if (update.content !== undefined && (!update.content || !update.content.trim())) {
    return NextResponse.json({ success: false, message: '脚本内容不能为空' }, { status: 400 });
  }

  const sanitized: ScriptDefUpdate = {};
  if (update.name !== undefined) sanitized.name = update.name.trim();
  if (update.category !== undefined) sanitized.category = update.category;
  if (update.description !== undefined) sanitized.description = update.description.trim() || undefined;
  if (update.content !== undefined) sanitized.content = update.content;
  if (update.params !== undefined) sanitized.params = Array.isArray(update.params) ? update.params : [];
  // builtin 字段仅管理员可改
  if (update.builtin !== undefined && currentUser.isAdmin) sanitized.builtin = update.builtin;

  const updated = scriptStore.update(id, sanitized, currentUser);
  if (!updated) {
    return NextResponse.json({ success: false, message: '更新失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-script-id-delete');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
  const { id } = await params;
  const existing = scriptStore.getById(id, currentUser);
  if (!existing) {
    return NextResponse.json({ success: false, message: '脚本不存在或无权访问' }, { status: 404 });
  }
  // 非管理员不可删内置脚本
  if (existing.builtin && !currentUser.isAdmin) {
    return NextResponse.json({ success: false, message: '内置脚本不可删除' }, { status: 403 });
  }

  const ok = scriptStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '删除失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
