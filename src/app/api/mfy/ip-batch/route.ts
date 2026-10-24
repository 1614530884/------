import { NextRequest, NextResponse } from 'next/server';
import { MfyService, MfyCredentials } from '@/lib/services/mfy-service';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';
import { executeMfyAction } from '../shared/handler';

/**
 * 节点实例批量 IP 操作
 * - fill:  给节点下的实例批量分配随机空闲 IP（每个实例随机 1~N 个）
 * - clear: 批量删除指定 IP 段内、绑定在该节点实例上的 IP（仅保留主 IP）
 *
 * 接口依据魔方云 API 文档：
 * - GET  v1/clouds?node=&page=&per_page=      实例列表（响应 total 在 meta.total）
 * - GET  v1/clouds/:id/ip                     获取实例 IP（含每个 IP 的 ip_segment_id）
 * - POST v1/clouds/:id/ip  { num, bw_group }  按数量添加 IP（按空闲池自动分配）
 * - DELETE v1/clouds/:id/floatip { ip[], type: id }  删除实例 IP
 * - GET  v1/ipSegment?node=                   节点 IP 段列表
 *
 * 进程内串行执行：同一时间只有一个批量任务在跑，避免并发触发接口限流。
 */

const MAX_NODE_INSTANCES = 1000;
const MAX_TASKS = 5000;
const SERIAL_QUEUE = 'ip-batch';

interface IpBatchTask {
  id: number;
  running: boolean;
  startedAt: number;
  finishedAt: number | null;
  intervalMs: number;
  current: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  logs: string[];
}

interface InstanceInfo {
  id: number;
  name: string;
  mainIp: string;
  ipCount: number;
}

interface CloudIp {
  id: number;
  ip: string;
  segmentId: number;
}

interface SegmentInfo {
  id: number;
  name: string;
}

interface TaskLog {
  (msg: string): void;
}

const tasks = new Map<number, IpBatchTask>();
let taskSeq = 0;

function createLogger(task: IpBatchTask): TaskLog {
  return (msg: string): void => {
    task.logs.push(`[${new Date().toLocaleTimeString('zh-CN')}] ${msg}`);
    if (task.logs.length > 2000) task.logs.splice(0, task.logs.length - 2000);
  };
}

function createTask(total: number, intervalMs: number): IpBatchTask {
  const task: IpBatchTask = {
    id: ++taskSeq,
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    intervalMs,
    current: '准备中',
    total,
    processed: 0,
    succeeded: 0,
    failed: 0,
    logs: [],
  };
  tasks.set(task.id, task);
  // 只保留最近的任务记录
  if (tasks.size > MAX_TASKS) {
    for (const [id, t] of tasks) {
      if (!t.running) {
        tasks.delete(id);
        if (tasks.size <= MAX_TASKS) break;
      }
    }
  }
  return task;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** 取响应中的业务数据（兼容 { data: {...} } 与 { data: { data: {...} } }） */
function unwrapData(raw: Record<string, unknown>): Record<string, unknown> | null {
  const data = raw.data;
  if (!data || typeof data !== 'object') return null;
  const inner = (data as Record<string, unknown>).data;
  return (inner && typeof inner === 'object' ? inner : data) as Record<string, unknown>;
}

function pickList(data: Record<string, unknown>): unknown[] {
  if (Array.isArray(data)) return data;
  const list = data.list ?? data.data ?? data.items ?? data.clouds;
  return Array.isArray(list) ? list : [];
}

function normalizeInstance(raw: unknown): InstanceInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const id = Number(c.id);
  if (!id) return null;
  const mainRaw = c.mainip ?? c.main_ip ?? '';
  const mainIp = typeof mainRaw === 'string' ? mainRaw : String((mainRaw as Record<string, unknown> | null)?.ip ?? '');
  return {
    id,
    name: String(c.hostname ?? c.name ?? `实例#${id}`),
    mainIp,
    ipCount: Number(c.ip_num) || 0,
  };
}

/** 拉取节点下全部实例（分页读取，总数取 meta.total） */
async function fetchNodeInstances(
  account: MfyCredentials,
  nodeId: number,
  log: TaskLog
): Promise<InstanceInfo[]> {
  const all: InstanceInfo[] = [];
  const perPage = 100;
  const maxPages = 50;

  for (let page = 1; page <= maxPages; page++) {
    const res = await executeMfyAction(account, 'cloudList', { node: nodeId, page, per_page: perPage });
    if (!res.success) {
      if (page === 1) throw new Error(`获取节点实例列表失败: ${String(res.msg || '未知错误')}`);
      log(`第 ${page} 页获取失败，跳过: ${String(res.msg || '')}`);
      break;
    }
    const data = unwrapData(res);
    if (!data) break;
    const list = pickList(data).map(normalizeInstance).filter((x): x is InstanceInfo => x !== null);
    if (list.length === 0) break;
    all.push(...list);

    const meta = (data.meta ?? {}) as Record<string, unknown>;
    const total = Number(meta.total) || 0;
    const totalPage = Number(meta.total_page) || 0;
    if (all.length >= MAX_NODE_INSTANCES) {
      log(`实例数超过 ${MAX_NODE_INSTANCES}，仅处理前 ${all.length} 个`);
      break;
    }
    if (totalPage > 0 ? page >= totalPage : list.length < perPage) break;
    if (total > 0 && all.length >= total) break;
  }

  return all;
}

/** 拉取节点下全部 IP 段 */
async function fetchNodeSegments(
  account: MfyCredentials,
  nodeId: number,
  log: TaskLog
): Promise<SegmentInfo[]> {
  const result: SegmentInfo[] = [];
  const maxPages = 10;

  for (let page = 1; page <= maxPages; page++) {
    const res = await executeMfyAction(account, 'ipSegmentList', { node: nodeId, page, per_page: 100 });
    if (!res.success) {
      if (page === 1) throw new Error(`获取IP段失败: ${String(res.msg || '未知错误')}`);
      log(`IP段第 ${page} 页获取失败，跳过`);
      break;
    }
    const data = unwrapData(res);
    if (!data) break;
    const list = pickList(data);
    if (list.length === 0) break;
    for (const item of list) {
      const s = item as Record<string, unknown>;
      const id = Number(s.id);
      if (id) {
        result.push({ id, name: String(s.ip_name || s.ip_sengmen || `IP段#${id}`) });
      }
    }
    const meta = (data.meta ?? {}) as Record<string, unknown>;
    const totalPage = Number(meta.total_page) || 0;
    if (totalPage > 0 ? page >= totalPage : list.length < 100) break;
  }

  return result;
}

/** 获取实例全部公网 IP（文档：public_ip[] 与 interface[].public_ip[]） */
async function fetchInstanceIps(account: MfyCredentials, instanceId: number): Promise<CloudIp[]> {
  const res = await executeMfyAction(account, 'cloudIpList', { id: instanceId });
  if (!res.success) {
    throw new Error(String(res.msg || '获取实例 IP 失败'));
  }
  const data = unwrapData(res);
  if (!data) return [];

  const result: CloudIp[] = [];
  const pushPublicIps = (raw: unknown): void => {
    if (!Array.isArray(raw)) return;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = Number(o.id);
      const addr = String(o.ip ?? '');
      if (!id || !addr) continue;
      if (result.some((x) => x.id === id)) continue;
      result.push({ id, ip: addr, segmentId: Number(o.ip_segment_id) || 0 });
    }
  };

  pushPublicIps(data.public_ip);
  const interfaces = data.interface;
  if (Array.isArray(interfaces)) {
    for (const itf of interfaces) {
      pushPublicIps((itf as Record<string, unknown>)?.public_ip);
    }
  }
  return result;
}

/** 读取实例当前限速组 ID（default_bw_group.id，其次 bw_group[0].id） */
async function fetchInstanceBwGroup(account: MfyCredentials, instanceId: number): Promise<number> {
  const res = await executeMfyAction(account, 'cloudDetail', { id: instanceId });
  if (!res.success) return 0;
  const data = unwrapData(res);
  if (!data) return 0;
  const def = data.default_bw_group as Record<string, unknown> | undefined;
  const defId = Number(def?.id) || 0;
  if (defId > 0) return defId;
  const groups = data.bw_group;
  if (Array.isArray(groups) && groups.length > 0) {
    return Number((groups[0] as Record<string, unknown>)?.id) || 0;
  }
  return 0;
}

function parseIdList(raw: unknown): number[] {
  return (Array.isArray(raw) ? raw : []).map((v) => Number(v)).filter((v) => v > 0);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const { _loginUser, action } = body;

    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!verifySessionToken(sessionCookie)) {
      logUnauthorizedAccess(request, 'ip-batch');
      return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
    }

    if (action !== 'fill' && action !== 'clear') {
      return NextResponse.json({ success: false, message: 'action 必须是 fill 或 clear' });
    }

    const nodeIds = parseIdList(body.nodeIds);
    if (nodeIds.length === 0) {
      return NextResponse.json({ success: false, message: '请选择节点' });
    }
    if (nodeIds.length > 1) {
      return NextResponse.json({ success: false, message: '单次只能处理一个节点' });
    }
    const nodeId = nodeIds[0];

    const intervalMs = Math.max(0, Math.min(5000, Number(body.intervalMs) || 0));

    const config = MfyService.readConfig();
    const account = MfyService.resolveMfyAccount(config, typeof _loginUser === 'string' ? _loginUser : undefined);
    if (!account.mfyUrl || !account.mfyUsername || !account.mfyPassword) {
      return NextResponse.json({ success: false, message: '魔方云API未配置' });
    }

    const instanceIds = parseIdList(body.instanceIds);
    const targetIds = instanceIds.length > 0 ? new Set(instanceIds) : null;

    if (action === 'fill') {
      const segmentIds = parseIdList(body.segmentIds);
      if (segmentIds.length === 0) {
        return NextResponse.json({ success: false, message: '请选择要分配 IP 的 IP 段' });
      }
      // ipsPerInstance = -1 表示每个实例在 [min, max] 内随机
      const ipsPerInstance = Number(body.ipsPerInstance);
      const min = Number(body.minPerInstance);
      const max = Number(body.maxPerInstance);
      const randomPerInstance = ipsPerInstance === -1;
      if (!randomPerInstance && (!Number.isInteger(ipsPerInstance) || ipsPerInstance < 1 || ipsPerInstance > 50)) {
        return NextResponse.json({ success: false, message: '每个实例的 IP 数量需为 1-50 的整数' });
      }
      if (randomPerInstance && (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max > 50 || min > max)) {
        return NextResponse.json({ success: false, message: '随机模式需填写 1-50 且最小值不大于最大值的数量范围' });
      }

      const task = createTask(0, intervalMs);
      const log = createLogger(task);

      void MfyService.runSerial(SERIAL_QUEUE, async () => {
        try {
          log(`开始为节点 #${nodeId} 分配 IP，IP段ID: ${segmentIds.join(', ')}`);
          const instances = await fetchNodeInstances(account, nodeId, log);
          const targets = targetIds ? instances.filter((inst) => targetIds.has(inst.id)) : instances;
          if (targets.length === 0) {
            throw new Error('该节点下没有可处理的实例');
          }
          task.total = targets.length;
          log(`共 ${instances.length} 个实例，本次处理 ${targets.length} 个`);

          for (const inst of targets) {
            task.current = `分配 IP: ${inst.name}`;
            const need = randomPerInstance
              ? Math.floor(Math.random() * (max - min + 1)) + min
              : ipsPerInstance;

            const groupId = await fetchInstanceBwGroup(account, inst.id);
            if (!groupId) {
              task.failed++;
              task.processed++;
              log(`✗ ${inst.name}: 未取到实例当前限速组，跳过（避免新建 0 带宽限速组）`);
              await sleep(intervalMs);
              continue;
            }

            // 按数量添加：不传 bw_group 会新建限速组，因此必须带上实例现有限速组
            const addRes = await executeMfyAction(account, 'cloudAddIpNum', {
              id: inst.id,
              num: need,
              bw_group: groupId,
              ip_type: 'normal',
              ip_segment_id: segmentIds.length === 1 ? segmentIds[0] : segmentIds,
            });

            if (addRes.success) {
              const added = extractAddedIps(addRes);
              task.succeeded++;
              log(`✓ ${inst.name}: 请求分配 ${need} 个 IP${added ? `（${added}）` : ''}`);
            } else {
              task.failed++;
              log(`✗ ${inst.name}: 分配失败 (${String(addRes.msg || '未知错误')})`);
            }
            task.processed++;
            await sleep(intervalMs);
          }
          log('任务完成');
        } catch (err) {
          log(`任务终止: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
          task.running = false;
          task.finishedAt = Date.now();
          task.current = '';
        }
      });

      return NextResponse.json({ success: true, taskId: task.id });
    }

    // action === 'clear'
    const segmentIds = parseIdList(body.segmentIds);
    const allSegments = segmentIds.length === 0;
    const keepMainIps = body.keepMainIps !== false;
    const dryRun = body.dryRun === true;

    const task = createTask(0, intervalMs);
    const log = createLogger(task);

    void MfyService.runSerial(SERIAL_QUEUE, async () => {
      try {
        const segments = await fetchNodeSegments(account, nodeId, log);
        const targetSegments = allSegments ? segments : segments.filter((s) => segmentIds.includes(s.id));
        if (targetSegments.length === 0) {
          throw new Error('未找到可处理的 IP 段，请刷新后重试');
        }
        const targetSegmentIds = new Set(targetSegments.map((s) => s.id));
        log(`目标 IP 段: ${targetSegments.map((s) => `${s.name}(#${s.id})`).join(', ')}`);

        const instances = await fetchNodeInstances(account, nodeId, log);
        const targets = targetIds ? instances.filter((inst) => targetIds.has(inst.id)) : instances;
        if (targets.length === 0) {
          throw new Error('该节点下没有可处理的实例');
        }
        task.total = targets.length;
        log(`共 ${instances.length} 个实例，本次处理 ${targets.length} 个${dryRun ? '（预检模式，不会实际删除）' : ''}`);

        for (const inst of targets) {
          task.current = `${dryRun ? '预检' : '删除'} IP: ${inst.name}`;
          try {
            // ip_segment_id 为 0 时说明接口未返回归属，回退用实例主 IP 匹配网段
            let ips;
            try {
              ips = await fetchInstanceIps(account, inst.id);
            } catch (err) {
              task.failed++;
              log(`✗ ${inst.name}: ${err instanceof Error ? err.message : String(err)}`);
              task.processed++;
              await sleep(intervalMs);
              continue;
            }

            const matched = ips.filter((item) => {
              if (item.segmentId > 0) return targetSegmentIds.has(item.segmentId);
              return isInSegments(item.ip, targetSegments);
            });
            log(`[诊断] ${inst.name} 共 ${ips.length} 个IP: ${ips.map((x) => `${x.ip}(段#${x.segmentId})`).join(', ') || '空'}；命中 ${matched.length} 个`);
            const deletable = matched.filter((item) => !(keepMainIps && item.ip === inst.mainIp));

            if (deletable.length === 0) {
              task.succeeded++;
              log(`- ${inst.name}: 无需要删除的 IP`);
            } else if (dryRun) {
              task.succeeded++;
              log(`✓ ${inst.name}: 将删除 ${deletable.length} 个 IP（${deletable.map((p) => p.ip).join(', ')}）`);
            } else {
              const delRes = await executeMfyAction(account, 'cloudIpDelete', {
                id: inst.id,
                ip: deletable.map((p) => p.id),
                type: 'id',
              });
              if (delRes.success) {
                task.succeeded++;
                log(`✓ ${inst.name}: 删除 ${deletable.length} 个 IP（${deletable.map((p) => p.ip).join(', ')}）`);
              } else {
                task.failed++;
                log(`✗ ${inst.name}: 删除失败 (${String(delRes.msg || '未知错误')})`);
              }
            }
          } catch (err) {
            task.failed++;
            log(`✗ ${inst.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
          task.processed++;
          await sleep(intervalMs);
        }
        log('任务完成');
      } catch (err) {
        log(`任务终止: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        task.running = false;
        task.finishedAt = Date.now();
        task.current = '';
      }
    });

    return NextResponse.json({ success: true, taskId: task.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({ success: false, message: `批量IP操作失败: ${message}` });
  }
}

/** 从添加 IP 的响应中取出实际分配的地址，用于日志展示 */
function extractAddedIps(raw: Record<string, unknown>): string {
  const data = unwrapData(raw);
  if (!data) return '';
  const list = data.ip;
  if (!Array.isArray(list)) return '';
  return list
    .map((item) => String((item as Record<string, unknown>)?.ip ?? ''))
    .filter(Boolean)
    .join(', ');
}

/**
 * 判断 IP 是否属于给定 IP 段（ip_segment_id 缺失时的兜底）。
 * 段名称支持以下写法：
 * - a.b.c.d/n        CIDR，如 189.105.76.0/24
 * - a.b.c.d-e        起止范围，末位可省略公共前缀，如 189.105.76.3-253
 * - a.b.c.           网段前缀
 * - a.b.c.d          单个 IP
 */
function isInSegments(ip: string, segments: SegmentInfo[]): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return segments.some((seg) => {
    const name = seg.name.trim();

    // CIDR
    const cidr = name.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
    if (cidr) {
      const base = ipv4ToInt(cidr[1]);
      const bits = Number(cidr[2]);
      if (base === null || bits < 1 || bits > 32) return false;
      const mask = (~0 << (32 - bits)) >>> 0;
      return ((value & mask) >>> 0) === ((base & mask) >>> 0);
    }

    // 起止范围：prefix.a-prefix.b，如 189.105.76.3-253
    const range = name.match(/^(\d+\.\d+\.\d+)\.(\d{1,3})-(\d{1,3})$/);
    if (range) {
      const from = ipv4ToInt(`${range[1]}.${range[2]}`);
      const to = ipv4ToInt(`${range[1]}.${range[3]}`);
      if (from === null || to === null) return false;
      return value >= Math.min(from, to) && value <= Math.max(from, to);
    }

    // 网段前缀 a.b.c.
    const tail = name.match(/^(\d+\.\d+\.\d+)\.?$/);
    if (tail) {
      return ip.startsWith(`${tail[1]}.`);
    }

    // 单个 IP
    return name === ip;
  });
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = (value << 8) + n;
  }
  return value >>> 0;
}

export async function GET(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'ip-batch-status');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const id = Number(request.nextUrl.searchParams.get('taskId'));
  const task = tasks.get(id);
  if (!task) {
    return NextResponse.json({ success: false, message: '任务不存在或已过期' });
  }
  return NextResponse.json({ success: true, task });
}
