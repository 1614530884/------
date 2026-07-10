/**
 * 清理规则管理 API
 *
 * GET   /api/server-tools/cleanup        - 获取当前用户的清理规则
 * PATCH /api/server-tools/cleanup        - 更新某个清理规则（enabled + retainDays）
 * POST  /api/server-tools/cleanup        - 立即执行清理（按当前规则）
 * DELETE /api/server-tools/cleanup?scope=connections - 彻底清除指定 scope 的全部数据（不限时间）
 */
import { NextRequest, NextResponse } from 'next/server';
import { cleanupRuleStore } from '@/lib/services/server-tools/store';
import type { CleanupScope } from '@/lib/services/server-tools/types';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

const VALID_SCOPES: CleanupScope[] = ['tasks', 'connections', 'bt_panels'];
const MIN_RETAIN_DAYS = 1;
const MAX_RETAIN_DAYS = 365;

export const GET = withAuth(async (_request, currentUser) => {
  const rules = cleanupRuleStore.list(currentUser);
  return NextResponse.json({ success: true, data: rules });
}, 'st-cleanup-get');

export const PATCH = withAuth(async (request, currentUser) => {
  const body = await request.json() as { scope?: string; enabled?: boolean; retainDays?: number; _loginUser?: string };
  const { _loginUser, ...input } = body;
  void _loginUser;

  if (!input.scope || !VALID_SCOPES.includes(input.scope as CleanupScope)) {
    return NextResponse.json({ success: false, message: '无效的清理范围' }, { status: 400 });
  }
  if (typeof input.enabled !== 'boolean') {
    return NextResponse.json({ success: false, message: 'enabled 必须为布尔值' }, { status: 400 });
  }
  if (typeof input.retainDays !== 'number' || input.retainDays < MIN_RETAIN_DAYS || input.retainDays > MAX_RETAIN_DAYS) {
    return NextResponse.json({ success: false, message: `保留天数必须在 ${MIN_RETAIN_DAYS}-${MAX_RETAIN_DAYS} 之间` }, { status: 400 });
  }

  const rule = cleanupRuleStore.upsert({
    scope: input.scope as CleanupScope,
    enabled: input.enabled,
    retainDays: input.retainDays,
  }, currentUser);
  return NextResponse.json({ success: true, data: rule });
}, 'st-cleanup-patch');

export const POST = withAuth(async (_request, currentUser) => {
  // 立即执行清理（全局，但只清理当前用户的数据需要额外支持；当前 executeCleanup 是全局的）
  // 为安全起见，普通用户只能触发自己的规则；admin 可触发全部
  const rules = cleanupRuleStore.list(currentUser);
  const enabledRules = rules.filter(r => r.enabled);

  if (enabledRules.length === 0) {
    return NextResponse.json({ success: false, message: '没有启用的清理规则' }, { status: 400 });
  }

  const results = enabledRules.map(rule => {
    const result = cleanupRuleStore.executeCleanup(rule.scope, rule.retainDays);
    return { scope: rule.scope, deleted: result.deleted, retainDays: rule.retainDays };
  });

  return NextResponse.json({ success: true, data: results });
}, 'st-cleanup-post');

export const DELETE = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const scopeParam = url.searchParams.get('scope');
  if (!scopeParam || !VALID_SCOPES.includes(scopeParam as CleanupScope)) {
    return NextResponse.json({ success: false, message: '无效的清理范围' }, { status: 400 });
  }

  const result = cleanupRuleStore.purgeAll(scopeParam as CleanupScope);
  return NextResponse.json({ success: true, data: { scope: scopeParam, deleted: result.deleted } });
}, 'st-cleanup-delete');
