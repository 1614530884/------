import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth-server';
import { Navbar } from '@/components/layout/navbar';
import { ScrollToTop } from '@/components/layout/scroll-to-top';

export default async function ProtectedLayout({
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ScrollToTop />
      <Navbar username={username} />
      <main>{children}</main>
    </div>
  );
}
