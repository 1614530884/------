import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, buildHeaders } from './shared/config';
import { dispatchAction } from './modules/router';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, cookie, token, phpSessId, ...params } = body;

    // 身份验证：校验 httpOnly session cookie
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!verifySessionToken(sessionCookie)) {
      logUnauthorizedAccess(request, action);
      return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
    }

    const baseUrl = getBaseUrl();
    const headers = buildHeaders(baseUrl, cookie, phpSessId);

    const ctx = { baseUrl, headers, cookie: cookie || '', phpSessId: phpSessId || '' };

    return await dispatchAction(action, params, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `请求失败: ${message}` });
  }
}
