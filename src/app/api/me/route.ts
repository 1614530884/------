import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth-server';

const CONFIG_PATH = join(process.cwd(), 'idc-config.json');

function getAdminUsernames(): string[] {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    const raw = String(config.adminUsernames || '');
    return raw.split(',').map((s: string) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    return NextResponse.json({ success: false, message: '未授权' }, { status: 401 });
  }
  const username = getSessionUser(sessionCookie) || '';
  const adminList = getAdminUsernames();
  const isAdmin = adminList.includes(username);
  return NextResponse.json({ success: true, username, isAdmin });
}
