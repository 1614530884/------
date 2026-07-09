import { NextRequest, NextResponse } from 'next/server';
import { MfyService } from '@/lib/services/mfy-service';
import { asyncPool } from '@/lib/async-pool';
import { executeMfyAction } from '../shared/handler';

interface BatchRequest {
  action: string;
  id?: string | number;
  diskId?: string | number;
  snapshotId?: string | number;
  [key: string]: unknown;
}

const MAX_BATCH_SIZE = 200;
const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 10;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { _loginUser, concurrency: rawConcurrency, requests: rawRequests } = body;

    if (!Array.isArray(rawRequests) || rawRequests.length === 0) {
      return NextResponse.json({ success: false, message: 'requests 必须是非空数组' });
    }

    if (rawRequests.length > MAX_BATCH_SIZE) {
      return NextResponse.json({ success: false, message: `单次批量请求最多 ${MAX_BATCH_SIZE} 个` });
    }

    const requests: BatchRequest[] = rawRequests;
    for (let i = 0; i < requests.length; i++) {
      if (!requests[i] || typeof requests[i].action !== 'string') {
        return NextResponse.json({ success: false, message: `第 ${i + 1} 个请求缺少 action 字段` });
      }
    }

    const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawConcurrency) || DEFAULT_CONCURRENCY));

    const config = MfyService.readConfig();
    const account = MfyService.resolveMfyAccount(config, _loginUser);
    if (!account.mfyUrl || !account.mfyUsername || !account.mfyPassword) {
      return NextResponse.json({ success: false, message: '魔方云API未配置' });
    }

    const startTime = Date.now();
    const settled = await asyncPool(requests, concurrency, (req) => {
      const { action, ...params } = req;
      return executeMfyAction(account, action, params);
    });

    const results = settled.map((r) => {
      if (r.status === 'fulfilled') {
        return r.value as Record<string, unknown>;
      }
      return { success: false, msg: r.reason instanceof Error ? r.reason.message : '请求异常' };
    });

    const succeeded = results.filter((r) => r.success).length;
    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      results,
      summary: {
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        durationMs,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `批量请求失败: ${message}` });
  }
}
