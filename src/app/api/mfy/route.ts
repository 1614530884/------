import { NextRequest, NextResponse } from 'next/server';
import { MfyService } from '@/lib/services/mfy-service';
import { actionMap } from './shared/actions';
import { executeMfyAction } from './shared/handler';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, _loginUser, ...params } = body;

    // 身份验证：校验 httpOnly session cookie
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!verifySessionToken(sessionCookie)) {
      logUnauthorizedAccess(request, action);
      return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
    }

    const config = MfyService.readConfig();
    const account = MfyService.resolveMfyAccount(config, _loginUser);
    if (!account.mfyUrl || !account.mfyUsername || !account.mfyPassword) {
      return NextResponse.json({ success: false, message: '魔方云API未配置，请在设置中填写魔方云地址、账号和密码' });
    }

    if (action === 'testConnection') {
      try {
        const token = await MfyService.login(account, true);
        return NextResponse.json({ success: true, message: '连接成功', token: token.substring(0, 8) + '...' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '连接失败';
        return NextResponse.json({ success: false, message: msg });
      }
    }

    const apiDef = actionMap[action];
    if (!apiDef) {
      return NextResponse.json({ success: false, message: `未知魔方云操作: ${action}` });
    }

    const id = params.id;
    const diskId = params.diskId;
    const snapshotId = params.snapshotId;

    if (action === 'diskStores') {
      const result = await MfyService.request(account, 'disk_cleaner/stores', {}, 'GET');
      return NextResponse.json(result);
    }

    if (action === 'diskList' && id) {
      const result = await MfyService.request(account, `clouds/${id}`, {}, 'GET');
      if (result.success && result.data) {
        const cloudData = (result.data as Record<string, unknown>).data || result.data;
        const diskData = (cloudData as Record<string, unknown>)?.disk;
        if (diskData) {
          return NextResponse.json({ success: true, data: diskData });
        }
      }
      return NextResponse.json(result);
    }

    if (action === 'downloadRdp' && id) {
      const token = await MfyService.login(account);
      const rdpUrl = `${account.mfyUrl}/v1/clouds/${id}/download_rdp`;
      const rdpResp = await fetch(rdpUrl, {
        method: 'GET',
        headers: { 'access-token': token, 'Accept': '*/*' },
      });
      if (!rdpResp.ok) {
        return NextResponse.json({ success: false, message: `RDP下载失败 (HTTP ${rdpResp.status})` });
      }
      const contentType = rdpResp.headers.get('content-type') || 'application/octet-stream';
      const buffer = await rdpResp.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `attachment; filename="${id}.rdp"`,
        },
      });
    }

    const result = await executeMfyAction(account, action, { ...params, id, diskId, snapshotId });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `魔方云API请求失败: ${message}` });
  }
}
