import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME, getSessionCookieOptions } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getSessionCookieOptions(request),
    maxAge: 0,
  });
  return response;
}
