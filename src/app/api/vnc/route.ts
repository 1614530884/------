import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { MfyService, MfyCredentials } from '@/lib/services/mfy-service';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

const VNC_PAGE_PATH = join(process.cwd(), 'public', 'vnc', 'vnc_page.html');

// VNC凭证缓存（内存，30分钟有效）
interface VncCache {
  vncUrl: string;
  vncPass: string;
  osPassword: string;
  token: string;
  expireAt: number;
}

const vncCacheMap = new Map<number, VncCache>();

function getVncCache(hostid: number): VncCache | null {
  const cache = vncCacheMap.get(hostid);
  if (!cache) return null;
  if (Date.now() > cache.expireAt) {
    vncCacheMap.delete(hostid);
    return null;
  }
  return cache;
}

function setVncCache(hostid: number, data: { vncUrl: string; vncPass: string; osPassword: string; token: string }): void {
  vncCacheMap.set(hostid, {
    ...data,
    expireAt: Date.now() + 30 * 60 * 1000, // 30分钟
  });
}

// 调用魔方云VNC API
async function fetchVncFromMfy(account: MfyCredentials, cloudId: number): Promise<Record<string, any>> {
  const token = await MfyService.login(account);
  const url = `${account.mfyUrl}/v1/clouds/${cloudId}/vnc`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'access-token': token,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    if (resp.status === 401) {
      MfyService.clearTokenCache(account.mfyUrl, account.mfyUsername);
      const newToken = await MfyService.login(account, true);
      // 重试一次
      const resp2 = await fetch(url, {
        method: 'POST',
        headers: {
          'access-token': newToken,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      const text = await resp2.text();
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }

    const text = await resp.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('魔方云VNC API请求超时');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// POST: 获取VNC页面URL
export async function POST(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'vnc-post');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { hostid, _loginUser } = body;

    if (!hostid) {
      return NextResponse.json({ success: false, message: '缺少hostid参数' });
    }

    const config = MfyService.readConfig();
    const account = MfyService.resolveMfyAccount(config, _loginUser);
    if (!account.mfyUrl || !account.mfyUsername || !account.mfyPassword) {
      return NextResponse.json({ success: false, message: '魔方云API未配置' });
    }

    // 调用魔方云API获取VNC凭证
    const vncData = await fetchVncFromMfy(account, Number(hostid));

    // 提取VNC连接信息
    const data = vncData?.data || vncData;
    const vncUrl = data?.vnc_url || data?.url || data?.vnc_url_http || data?.vnc_url_https || '';
    const vncPass = data?.vnc_pass || data?.password || '';
    const osPassword = data?.password || '';

    if (!vncUrl) {
      return NextResponse.json({ success: false, message: '魔方云未返回VNC地址', raw: vncData });
    }

    // 生成临时token
    const tmpToken = createHash('md5').update(randomBytes(16).toString()).digest('hex');

    // 缓存凭证
    setVncCache(Number(hostid), {
      vncUrl,
      vncPass,
      osPassword,
      token: tmpToken,
    });

    // 构建VNC页面URL
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const vncPageUrl = `${protocol}://${host}/api/vnc?hostid=${hostid}&tmp_token=${encodeURIComponent(tmpToken)}`;

    return NextResponse.json({
      success: true,
      url: vncPageUrl,
      vnc_url: vncPageUrl,
      console_url: vncPageUrl,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `VNC请求失败: ${message}` });
  }
}

// GET: 渲染VNC页面
export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'vnc-get');
    return new NextResponse('未授权，请先登录', { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  try {
    const { searchParams } = new URL(request.url);
    const hostid = searchParams.get('hostid');
    const tmpToken = searchParams.get('tmp_token');

    if (!hostid || !tmpToken) {
      return new NextResponse('缺少必要参数', { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // 验证token
    const cache = getVncCache(Number(hostid));
    if (!cache || cache.token !== tmpToken) {
      return new NextResponse('VNC凭证已过期，请重新打开控制台', { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    // 读取VNC页面模板
    let html = readFileSync(VNC_PAGE_PATH, 'utf-8');

    // 替换占位符为实际凭证值
    html = html.replace(/__VNC_URL__/g, JSON.stringify(cache.vncUrl));
    html = html.replace(/__VNC_PASS__/g, JSON.stringify(cache.vncPass));
    html = html.replace(/__OS_PASSWORD__/g, JSON.stringify(cache.osPassword));

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return new NextResponse(`VNC页面渲染失败: ${message}`, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
