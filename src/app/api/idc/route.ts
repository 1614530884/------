import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, buildHeaders } from './shared/config';
import { dispatchAction } from './modules/router';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, cookie, token, phpSessId, ...params } = body;

    const baseUrl = getBaseUrl();
    const headers = buildHeaders(baseUrl, cookie, phpSessId);

    const ctx = { baseUrl, headers, cookie: cookie || '', phpSessId: phpSessId || '' };

    return await dispatchAction(action, params, ctx);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `请求失败: ${message}` });
  }
}
