import { NextResponse } from 'next/server';
import { IdcRequestContext } from './types';

const FRONTEND_UPGRADE_ACTIONS = ['upgradeConfigPage', 'upgradeConfigCalc', 'upgradeConfigCheckout'];
const FORM_URLENCODED_ACTIONS = ['upgradeConfigCalc', 'adminUpgradeConfig', 'upgradeConfigCheckout', 'updateHostAmount', 'saveServiceInfo2'];

export function buildFullUrl(apiPath: string, ctx: IdcRequestContext, isFrontendApi: boolean): string {
  if (isFrontendApi) {
    const domainOnly = ctx.baseUrl.replace(/\/[^/]+AdMIn$/, '').replace(/\/admin$/, '');
    return `${domainOnly}${apiPath}`;
  }
  return `${ctx.baseUrl}${apiPath}`;
}

export function resolvePathParams(apiPath: string, params: Record<string, unknown>): { path: string; params: Record<string, unknown> } {
  let path = apiPath;
  const remaining = { ...params };
  if (path.includes(':uid') && remaining.uid) {
    path = path.replace(':uid', String(remaining.uid));
    delete remaining.uid;
  }
  if (path.includes(':client_id') && remaining.client_id) {
    path = path.replace(':client_id', String(remaining.client_id));
    delete remaining.client_id;
  }
  return { path, params: remaining };
}

export function buildQueryString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([_, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

function buildFormUrlencodedBody(params: Record<string, unknown>, action: string): string {
  const parts: string[] = [];
  const internalKeys = ['_useFormUrlencoded'];

  // DELETE模拟：添加 _method=DELETE
  if (action === 'hostDelete' || action === 'invoiceDelete') {
    parts.push(`${encodeURIComponent('_method')}=${encodeURIComponent('DELETE')}`);
  }

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (internalKeys.includes(k)) continue;
    if ((k === 'configoption' || k === 'configoptionqty') && typeof v === 'object' && v !== null) {
      for (const [optId, optVal] of Object.entries(v as Record<string, unknown>)) {
        if (optVal !== undefined && optVal !== null) {
          parts.push(`${encodeURIComponent(`${k}[${optId}]`)}=${encodeURIComponent(String(optVal))}`);
        }
      }
    } else if (Array.isArray(v)) {
      for (const item of v) {
        parts.push(`${encodeURIComponent(k + '[]')}=${encodeURIComponent(String(item))}`);
      }
    } else if (typeof v === 'object' && v !== null) {
      const obj = v as Record<string, unknown>;
      let extractedVal: unknown = '';
      if (obj[k] !== undefined && obj[k] !== null) {
        extractedVal = obj[k];
      } else if (obj.name !== undefined) {
        extractedVal = obj.name;
      } else if (obj.value !== undefined) {
        extractedVal = obj.value;
      } else {
        for (const ov of Object.values(obj)) {
          if (typeof ov === 'string' && ov) { extractedVal = ov; break; }
        }
      }
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(extractedVal))}`);
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join('&');
}

export async function executeIdcRequest(
  action: string,
  apiPath: string,
  method: string,
  params: Record<string, unknown>,
  ctx: IdcRequestContext,
  isFrontendApi: boolean = false
): Promise<NextResponse> {
  const isDeleteMethod = method === 'DELETE';
  const needsFormUrlencoded = FORM_URLENCODED_ACTIONS.includes(action) || isDeleteMethod;

  // 处理路径参数
  const { path: resolvedPath, params: resolvedParams } = resolvePathParams(apiPath, params);

  // 构建完整URL
  let fullUrl = buildFullUrl(resolvedPath, ctx, isFrontendApi);
  const fetchOptions: RequestInit = { method, headers: { ...ctx.headers } };

  // 根据请求方法构建请求体
  if (method === 'GET') {
    const qs = buildQueryString(resolvedParams);
    if (qs) fullUrl += `?${qs}`;
  } else if (isDeleteMethod) {
    // ThinkPHP通过POST+_method=DELETE模拟DELETE
    fetchOptions.body = buildFormUrlencodedBody(resolvedParams, action);
    fetchOptions.method = 'POST';
    (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (needsFormUrlencoded) {
    fetchOptions.body = buildFormUrlencodedBody(resolvedParams, action);
    (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    fetchOptions.body = JSON.stringify(resolvedParams);
  }

  // 设置60秒超时
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  fetchOptions.signal = controller.signal;

  const resp = await fetch(fullUrl, fetchOptions);
  clearTimeout(timeoutId);

  // DELETE请求重定向视为成功
  if (isDeleteMethod && [301, 302, 303, 307, 308].includes(resp.status)) {
    return NextResponse.json({ success: true, message: '操作成功', data: null });
  }

  // 处理Cookie
  const setCookieHeader = resp.headers.get('set-cookie');
  const newCookie = setCookieHeader ? setCookieHeader.split(';')[0] : undefined;
  const mergedCookie = [ctx.cookie, newCookie].filter(Boolean).join('; ');

  // 读取响应体，处理gzip
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let text = buffer.toString('utf-8');
  try {
    JSON.parse(text);
  } catch {
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try {
        text = await new Promise<string>((resolve, reject) => {
          const { createUnzip } = require('zlib');
          const unzip = createUnzip();
          const chunks: Buffer[] = [];
          unzip.on('data', (chunk: Buffer) => chunks.push(chunk));
          unzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          unzip.on('error', reject);
          unzip.write(buffer);
          unzip.end();
        });
      } catch { /* decompress failed, use raw text */ }
    }
  }

  // WAF拦截检测
  if (text.includes('弱密码') || text.includes('防火墙')) {
    return NextResponse.json({ success: false, message: '后台安全拦截，请检查账户权限' });
  }

  // 解析JSON响应
  try {
    const result = JSON.parse(text);
    const isSuccess = result.status === 200 || result.status === 1 || result.msg === '请求成功' || (result.data && !result.status);
    return NextResponse.json({ success: isSuccess, ...result, cookie: mergedCookie });
  } catch {
    // DELETE请求非JSON响应可能正常
    if (isDeleteMethod) {
      if (resp.status >= 200 && resp.status < 400) {
        return NextResponse.json({ success: true, message: '操作成功', data: null });
      }
      return NextResponse.json({ success: false, message: `删除操作失败 (HTTP ${resp.status})` });
    }
    return NextResponse.json({ success: false, message: `服务器返回非JSON响应 (HTTP ${resp.status})` });
  }
}

export async function executeRawFetch(
  url: string,
  options: RequestInit,
  ctx: IdcRequestContext,
  overrides?: { contentType?: string; referer?: string }
): Promise<{ text: string; status: number }> {
  const mergedHeaders = { ...ctx.headers, ...options.headers } as Record<string, string>;
  if (overrides?.contentType) mergedHeaders['Content-Type'] = overrides.contentType;
  if (overrides?.referer) mergedHeaders['Referer'] = overrides.referer;

  const resp = await fetch(url, { ...options, headers: mergedHeaders });
  const text = await resp.text();
  return { text, status: resp.status };
}
