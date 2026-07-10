import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE_NAME = 'idc_session';

// 排除的路径：登录页、API、静态资源、ping
const PUBLIC_PATHS = /^\/(login|api|_next|favicon\.ico|ping)/;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 公开路径直接放行
  if (PUBLIC_PATHS.test(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  // 无 session cookie → 重定向到登录页
  if (!sessionCookie) {
    // 从请求头获取真实 host，避免自定义服务器下 request.nextUrl.host 默认为 hostname（127.0.0.1）的问题
    const host =
      request.headers.get('x-forwarded-host') ||
      request.headers.get('host') ||
      request.nextUrl.host;
    const proto =
      request.headers.get('x-forwarded-proto') ||
      (request.nextUrl.protocol === 'https:' ? 'https' : 'http');
    const loginUrl = new URL(
      `/login?reason=unauthenticated&from=${encodeURIComponent(pathname)}`,
      `${proto}://${host}`,
    );
    console.warn(`[middleware] 未授权访问: ${pathname}`);
    return NextResponse.redirect(loginUrl);
  }

  // cookie 存在则放行（签名验证由 (protected)/layout.tsx 在服务端完成）
  return NextResponse.next();
}

export const config = {
  // 匹配所有路径，排除公开路径（在 middleware 内部判断）
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
