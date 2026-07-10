'use client';

/**
 * 服务器工具 - 统一前端 API 请求封装
 *
 * 职责：
 * 1. 统一处理 401（会话过期）→ toast 提示 + 调用 handleAuthExpired 自动跳登录页
 * 2. 解析 JSON 响应失败时给出可读错误
 * 3. 网络异常时返回明确错误
 *
 * 使用方式：
 *   const result = await apiFetch<{ id: string }>('/api/server-tools/connections', { method: 'POST', ... });
 *   if (result.ok && result.data) { ... } else if (!result.ok) { toast.error(result.message); }
 */
import { toast } from 'sonner';
import { handleAuthExpired } from '@/lib/auth-client';

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  message?: string;
  status: number;
}

/**
 * 发起 server-tools API 请求。
 * - 401 时自动 toast + 触发跳转登录页（不需要调用方重复提示）
 * - 其他失败由调用方根据返回的 ok / message 处理
 */
export async function apiFetch<T = unknown>(
  url: string,
  options?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const resp = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });

    if (resp.status === 401) {
      toast.error('会话已过期，请重新登录');
      void handleAuthExpired();
      return { ok: false, message: '会话已过期', status: 401 };
    }

    let data: { success?: boolean; data?: T; message?: string } | null = null;
    try {
      data = await resp.json() as { success?: boolean; data?: T; message?: string } | null;
    } catch {
      return { ok: false, message: `服务器返回非 JSON 响应 (HTTP ${resp.status})`, status: resp.status };
    }

    if (data && data.success) {
      return { ok: true, data: data.data, status: resp.status };
    }

    return {
      ok: false,
      message: data?.message || `请求失败 (HTTP ${resp.status})`,
      status: resp.status,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : '网络请求失败',
      status: 0,
    };
  }
}
