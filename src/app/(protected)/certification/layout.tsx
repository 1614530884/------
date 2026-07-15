import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { readFileSync } from 'fs';
import { join } from 'path';
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth-server';

const CONFIG_PATH = join(process.cwd(), 'idc-config.json');

function getAdminUsernames(): string[] {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    const raw = String(config.adminUsernames || '');
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export default async function CertificationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(sessionCookie)) {
    redirect('/login?reason=session_expired');
  }

  const username = getSessionUser(sessionCookie) || '';
  const adminList = getAdminUsernames();

  if (!adminList.includes(username)) {
    redirect('/?reason=no_permission');
  }

  return <>{children}</>;
}
