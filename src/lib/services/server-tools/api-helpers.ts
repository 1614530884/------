/**
 * Server Tools API 辅助函数
 *
 * 统一身份验证逻辑，消除路由文件中的重复代码
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCurrentUser } from './auth';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';
import type { CurrentUser } from './types';

/**
 * 统一的 401 未授权响应
 */
export function createUnauthorizedResponse(): NextResponse {
  return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
}

/**
 * 验证请求身份
 * 先校验 session token（失败则记录未授权访问日志），再获取当前用户
 * 返回 null 表示未通过验证
 */
export async function authenticateRequest(
  request: NextRequest,
  logTag: string,
): Promise<CurrentUser | null> {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, logTag);
    return null;
  }
  return await getCurrentUser(request);
}

/**
 * 高阶函数：包装路由处理器，统一处理身份验证
 * 验证失败返回 401；验证通过后将 currentUser 注入到 handler
 *
 * @example
 * // 普通路由
 * export const GET = withAuth(async (request, currentUser) => { ... }, 'st-xxx-get');
 *
 * // 动态路由（带 params）
 * export const GET = withAuth(async (request, currentUser, { params }) => { ... }, 'st-xxx-get');
 */
export function withAuth<TArgs extends unknown[]>(
  handler: (request: NextRequest, user: CurrentUser, ...args: TArgs) => Promise<NextResponse>,
  logTag: string,
): (request: NextRequest, ...args: TArgs) => Promise<NextResponse> {
  return async (request: NextRequest, ...args: TArgs): Promise<NextResponse> => {
    const currentUser = await authenticateRequest(request, logTag);
    if (!currentUser) {
      return createUnauthorizedResponse();
    }
    return handler(request, currentUser, ...args);
  };
}
