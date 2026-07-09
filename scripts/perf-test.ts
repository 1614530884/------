/**
 * 并发性能测试脚本
 * 用法: npx tsx scripts/perf-test.ts [targetUrl]
 * 默认目标: http://localhost:5000
 */
const TARGET = process.argv[2] || 'http://localhost:5000';

interface RequestResult {
  ok: boolean;
  latencyMs: number;
  status: number;
}

interface ScenarioResult {
  name: string;
  totalRequests: number;
  concurrency: number;
  totalMs: number;
  succeeded: number;
  failed: number;
  latencies: number[];
}

async function singleRequest(
  path: string,
  options: RequestInit = {},
  checkOk?: (data: unknown) => boolean
): Promise<RequestResult> {
  const start = Date.now();
  try {
    const resp = await fetch(`${TARGET}${path}`, options);
    const latencyMs = Date.now() - start;
    if (resp.status >= 200 && resp.status < 300) {
      if (checkOk) {
        const data = await resp.json();
        return { ok: checkOk(data), latencyMs, status: resp.status };
      }
      return { ok: true, latencyMs, status: resp.status };
    }
    return { ok: false, latencyMs, status: resp.status };
  } catch {
    return { ok: false, latencyMs: Date.now() - start, status: 0 };
  }
}

async function concurrentRequests(
  count: number,
  fn: () => Promise<RequestResult>
): Promise<RequestResult[]> {
  const promises: Promise<RequestResult>[] = [];
  for (let i = 0; i < count; i++) {
    promises.push(fn());
  }
  return Promise.all(promises);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

async function runScenario(
  name: string,
  count: number,
  fn: () => Promise<RequestResult>
): Promise<ScenarioResult> {
  console.log(`\n=== ${name} ===`);
  console.log(`并发数: ${count}`);

  const start = Date.now();
  const results = await concurrentRequests(count, fn);
  const totalMs = Date.now() - start;

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;
  const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const throughput = (results.length / (totalMs / 1000)).toFixed(1);

  console.log(`总耗时: ${totalMs}ms | 吞吐量: ${throughput} req/s`);
  console.log(`延迟: P50=${p50}ms P95=${p95}ms P99=${p99}ms`);
  console.log(`成功率: ${succeeded}/${results.length} (${((succeeded / results.length) * 100).toFixed(1)}%)`);

  return { name, totalRequests: count, concurrency: count, totalMs, succeeded, failed, latencies };
}

function mfyBody(action: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ action, _loginUser: 'lengling', ...extra });
}

function batchBody(requests: Array<Record<string, unknown>>, concurrency = 5): string {
  return JSON.stringify({ _loginUser: 'lengling', concurrency, requests });
}

async function main() {
  console.log(`性能测试目标: ${TARGET}`);
  console.log(`测试时间: ${new Date().toISOString()}`);
  console.log('========================================');

  const results: ScenarioResult[] = [];

  results.push(await runScenario(
    'S1: MFY 单接口吞吐 (nodeList)',
    100,
    () => singleRequest('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: mfyBody('nodeList', { page: 1, per_page: 20 }),
    }, (d) => !!(d as Record<string, unknown>)?.success)
  ));

  results.push(await runScenario(
    'S2: Token 单飞验证 (nodeStatus 同一 loginUser)',
    100,
    () => singleRequest('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: mfyBody('nodeStatus', { id: 1 }),
    }, (d) => !!(d as Record<string, unknown>)?.success)
  ));

  const batchRequests: Array<Record<string, unknown>> = [];
  for (let i = 1; i <= 10; i++) {
    batchRequests.push({ action: 'nodeStatus', id: i });
    batchRequests.push({ action: 'nodeRealData', id: i });
  }
  results.push(await runScenario(
    'S3: 批量接口 (20 sub-requests)',
    10,
    () => singleRequest('/api/mfy/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: batchBody(batchRequests, 5),
    }, (d) => !!(d as Record<string, unknown>)?.success)
  ));

  results.push(await runScenario(
    'S4: 节点页面模拟 (nodeList + 批量)',
    10,
    async () => {
      const listRes = await singleRequest('/api/mfy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: mfyBody('nodeList', { page: 1, per_page: 50 }),
      }, (d) => !!(d as Record<string, unknown>)?.success);
      if (!listRes.ok) return listRes;

      const batchReqs: Array<Record<string, unknown>> = [];
      for (let i = 1; i <= 50; i++) {
        batchReqs.push({ action: 'nodeStatus', id: i });
        batchReqs.push({ action: 'nodeRealData', id: i });
      }
      return singleRequest('/api/mfy/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: batchBody(batchReqs, 5),
      }, (d) => !!(d as Record<string, unknown>)?.success);
    }
  ));

  results.push(await runScenario(
    'S5: IDC 配置缓存命中',
    100,
    () => singleRequest('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'productListPage' }),
    }, (d) => d !== null)
  ));

  console.log('\n========================================');
  console.log('测试汇总:');
  console.log('========================================');
  for (const r of results) {
    const p95 = percentile(r.latencies, 95);
    const rate = ((r.succeeded / r.totalRequests) * 100).toFixed(1);
    const status = p95 < 2000 && r.failed === 0 ? 'PASS' : (p95 < 3000 ? 'WARN' : 'FAIL');
    console.log(`[${status}] ${r.name}: P95=${p95}ms 成功率=${rate}%`);
  }
  console.log('\n完成。');
}

main().catch(console.error);
