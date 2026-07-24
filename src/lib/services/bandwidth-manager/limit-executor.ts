/**
 * 智能带宽管理 - 限速执行器
 *
 * 职责：接收规则触发输入，执行完整的限速流程：
 * 1. 拉取节点下所有实例（cloudList）
 * 2. 批量获取实例实时带宽（realDataList）
 * 3. 按带宽排序，取 Top N
 * 4. 若开启持续监控：查实例带宽图表二次过滤
 * 5. 对剩余实例执行 cloudUpdateBw 限速
 * 6. 返回每台实例的处理结果
 *
 * 直接调用 MfyService（服务端），不走 HTTP 代理，避免请求开销。
 */
import { MfyService, type MfyCredentials } from '@/lib/services/mfy-service';
import { asyncPool } from '@/lib/async-pool';
import type {
  BandwidthRule,
  BandwidthInstanceResult,
  LimitExecutorInput,
  LimitExecutorOutput,
} from './types';

/**
 * Per-machine 冷却缓冲时间（毫秒）
 * 魔方云 temp_bw_expire_time 到期后，API 状态同步可能有延迟，
 * 增加此缓冲确保在魔方云完全解除限速前不会重复限速同一台机器。
 */
const COOLDOWN_BUFFER_MS = 120 * 1000; // 2 分钟

/** 提取魔方云 API 返回中的 data 层 */
function extractData(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const dataField = obj.data;
  if (dataField && typeof dataField === 'object' && !Array.isArray(dataField)) {
    return dataField as Record<string, unknown>;
  }
  return obj;
}

/**
 * 从 API 响应中提取数组列表（兼容多种包装格式）
 * 支持的格式：[...] / { data: [...] } / { data: { data: [...] } }
 */
function extractList(respData: unknown): unknown[] {
  if (Array.isArray(respData)) return respData;
  if (!respData || typeof respData !== 'object') return [];
  const obj = respData as Record<string, unknown>;
  // 直接是 { data: [...] }
  if (Array.isArray(obj.data)) return obj.data;
  // 嵌套 { data: { data: [...] } }
  const inner = obj.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const innerObj = inner as Record<string, unknown>;
    if (Array.isArray(innerObj.data)) return innerObj.data;
  }
  return [];
}

/** Mbps 转 bps */
function mbpsToBps(mbps: number): number {
  return mbps * 1_000_000;
}

/** bps 转 Mbps */
function bpsToMbps(bps: number): number {
  return bps / 1_000_000;
}

/**
 * 将带宽显示字符串（如 "1.5 Mbps"、"100 Kbps"）或数值解析为 bps
 * clouds/real_data API 返回的 current_in_bw/current_out_bw 是显示字符串，需解析为原始 bps
 */
function parseBwToBps(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const s = String(value).trim().toLowerCase();
  if (!s || s === '-' || s === 'n/a') return 0;
  // 匹配 "1.5 Mbps"、"100 Kbps"、"2.3 Gbps"、"500 bps" 等
  const match = s.match(/^([\d.]+)\s*(gbps|mbps|kbps|bps|gb|mb|kb)?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;
  const unit = match[2] || 'bps';
  switch (unit) {
    case 'gbps':
    case 'gb':
      return num * 1_000_000_000;
    case 'mbps':
    case 'mb':
      return num * 1_000_000;
    case 'kbps':
    case 'kb':
      return num * 1_000;
    default:
      return num;
  }
}

/**
 * 获取节点下所有实例列表（自动分页遍历所有页）
 * 返回 [{ id, name, inBw, outBw }]，inBw/outBw 为配置的带宽上限（Mbps）
 */
async function getNodeInstances(
  account: MfyCredentials,
  nodeId: number,
): Promise<Array<{ id: number; name: string; inBw: number; outBw: number }>> {
  const instances: Array<{ id: number; name: string; inBw: number; outBw: number }>= [];
  let page = 1;
  const perPage = 100;
  // 最多拉 20 页（2000 实例）防死循环
  for (let i = 0; i < 20; i++) {
    const result = await MfyService.request(account, 'clouds', { node: nodeId, page, per_page: perPage }, 'GET');
    if (!result.success || !result.data) break;
    const list = extractList(result.data);
    if (list.length === 0) break;
    for (const item of list) {
      const c = item as Record<string, unknown>;
      // in_bw/out_bw 直接在实例对象上（Mbps），default_bw_group 作为兼容 fallback
      const bwGroup = c.default_bw_group as Record<string, unknown> | undefined;
      instances.push({
        id: Number(c.id) || 0,
        name: String(c.name ?? c.hostname ?? `实例${c.id}`),
        inBw: Number(bwGroup?.in_bw ?? c.in_bw ?? 0) || 0,
        outBw: Number(bwGroup?.out_bw ?? c.out_bw ?? 0) || 0,
      });
    }
    // 翻页判断：
    // 1. 本页数据少于 perPage → 肯定是最后一页
    // 2. meta.total 可用时，已获取数 >= total → 已拉完
    // 注意：meta 在 result.data.meta（与 data 同级），不在 result.data.data.meta
    const rootObj = result.data as Record<string, unknown>;
    const meta = rootObj.meta as Record<string, unknown> | undefined;
    const total = Number(meta?.total ?? 0);
    if (list.length < perPage) break;
    if (total > 0 && page * perPage >= total) break;
    page++;
  }
  return instances;
}

/**
 * 批量获取实例实时带宽
 * clouds/real_data API 返回 current_in_bw/current_out_bw（显示字符串，如 "1.5 Mbps"）
 * 需解析为 bps 数值
 * 大量实例时分批查询（每批 50 个），避免 API 请求体过大或返回不全
 * 返回 Map<cloudId, { inbwBps, outwyBps }>
 */
async function getInstancesRealtimeBandwidth(
  account: MfyCredentials,
  cloudIds: number[],
): Promise<Map<number, { inbwBps: number; outbwBps: number }>> {
  const result = new Map<number, { inbwBps: number; outbwBps: number }>();
  if (cloudIds.length === 0) return result;

  // 分批查询，每批 50 个实例
  const BATCH_SIZE = 50;
  for (let i = 0; i < cloudIds.length; i += BATCH_SIZE) {
    const batch = cloudIds.slice(i, i + BATCH_SIZE);
    try {
      const resp = await MfyService.request(account, 'clouds/real_data', { id: batch }, 'POST');
      if (!resp.success || !resp.data) continue;

      const list = extractList(resp.data);
      for (const item of list) {
        const r = item as Record<string, unknown>;
        const cloudId = Number(r.cloud_id ?? r.id ?? 0);
        if (!cloudId) continue;
        // current_in_bw/current_out_bw 是显示字符串（如 "1.5 Mbps"），需解析为 bps
        // 兼容 net_card.inbw/outbw 原始数值（部分 API 版本可能返回）
        const netCard = r.net_card as Record<string, unknown> | undefined;
        result.set(cloudId, {
          inbwBps: parseBwToBps(netCard?.inbw ?? r.current_in_bw ?? r.inbw ?? 0),
          outbwBps: parseBwToBps(netCard?.outbw ?? r.current_out_bw ?? r.outbw ?? 0),
        });
      }
    } catch {
      // 单批失败不影响其他批次
    }
  }
  return result;
}

/**
 * 获取实例带宽图表，判断是否在时间窗口内持续超过百分比阈值
 *
 * 调用 cloudChartTotal API，尝试从返回中提取带宽时间序列。
 * 若无法解析图表数据，降级为用当前实时带宽判断（仅判断当前是否超阈值）。
 *
 * @param account 魔方云账号
 * @param cloudId 实例 ID
 * @param windowMin 时间窗口（分钟）
 * @param percent 带宽使用率百分比阈值（0-100）
 * @param currentBwBps 当前实时带宽（bps），用于降级判断
 * @param configBwMbps 配置的带宽上限（Mbps），用于计算使用率
 * @param isUp true=出站方向，false=入站方向（决定提取图表中的 outbw 还是 inbw）
 * @returns true 表示持续超带宽（应限速）
 */
async function isContinuouslyOverThreshold(
  account: MfyCredentials,
  cloudId: number,
  windowMin: number,
  percent: number,
  currentBwBps: number,
  configBwMbps: number,
  isUp: boolean,
): Promise<boolean> {
  const configBwBps = mbpsToBps(configBwMbps);
  if (configBwBps <= 0) {
    // 无配置带宽上限，无法计算使用率，降级：当前带宽 > 0 即认为超阈值
    return currentBwBps > 0;
  }

  try {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - windowMin * 60;
    const result = await MfyService.request(
      account,
      `clouds/${cloudId}/chart_total`,
      { start_time: startTime, end_time: endTime },
      'GET',
    );
    if (!result.success || !result.data) {
      // API 失败，降级为当前带宽判断
      const currentUsagePercent = (currentBwBps / configBwBps) * 100;
      return currentUsagePercent >= percent;
    }

    const data = extractData(result.data);
    // 按规则方向提取对应带宽时间序列（出站 outbw / 入站 inbw）
    const bwSeries = extractBandwidthSeries(data, isUp);
    if (bwSeries.length === 0) {
      // 无法解析图表，降级
      const currentUsagePercent = (currentBwBps / configBwBps) * 100;
      return currentUsagePercent >= percent;
    }

    // 判断是否所有数据点都超过百分比阈值（持续超带宽）
    // 使用率 = 实际带宽(bps) / 配置带宽上限(bps) × 100
    const allOver = bwSeries.every(bps => (bps / configBwBps) * 100 >= percent);
    return allOver;
  } catch {
    // 异常，降级
    const currentUsagePercent = (currentBwBps / configBwBps) * 100;
    return currentUsagePercent >= percent;
  }
}

/**
 * 从图表返回数据中提取带宽时间序列（bps 数组）
 * 按 isUp 参数优先提取对应方向（出站 outbw / 入站 inbw）的数据
 * 兼容多种魔方云返回格式
 */
function extractBandwidthSeries(data: Record<string, unknown>, isUp: boolean): number[] {
  // 按方向优先级排列子字段名：isUp=true 优先 outbw，isUp=false 优先 inbw
  const preferredKeys = isUp
    ? ['outbw', 'out_bw', 'out', 'inbw', 'in_bw', 'in']
    : ['inbw', 'in_bw', 'in', 'outbw', 'out_bw', 'out'];

  const candidates = ['net', 'network', 'bandwidth', 'bw', 'flow'];

  // 第一轮：尝试嵌套结构 data.net.outbw / data.net.inbw（按方向优先级）
  for (const key of candidates) {
    const val = data[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      for (const subKey of preferredKeys) {
        if (Array.isArray(obj[subKey])) {
          const series: number[] = [];
          for (const point of obj[subKey] as unknown[]) {
            const bps = extractBpsFromPoint(point);
            if (bps !== null) series.push(bps);
          }
          if (series.length > 0) return series;
        }
      }
    }
  }

  // 第二轮：顶层数组格式（无法区分方向，作为 fallback）
  for (const key of candidates) {
    const val = data[key];
    if (Array.isArray(val)) {
      const series: number[] = [];
      for (const point of val) {
        const bps = extractBpsFromPoint(point);
        if (bps !== null) series.push(bps);
      }
      if (series.length > 0) return series;
    }
  }

  return [];
}

/** 从单个数据点提取 bps 值，兼容 [ts, value] 和 { ts, value } 格式 */
function extractBpsFromPoint(point: unknown): number | null {
  if (Array.isArray(point)) {
    // [timestamp, value] 格式
    const val = Number(point[1]);
    return isNaN(val) ? null : val;
  }
  if (point && typeof point === 'object') {
    const p = point as Record<string, unknown>;
    // 尝试常见字段名
    for (const key of ['value', 'bw', 'bps', 'inbw', 'outbw', 'y']) {
      if (typeof p[key] === 'number') return p[key] as number;
      if (typeof p[key] === 'string') {
        const val = Number(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return null;
}

/**
 * 执行限速
 * PUT clouds/{id}/bw，参数 { in_bw, out_bw, temp_bw_expire_time }
 */
async function limitInstance(
  account: MfyCredentials,
  cloudId: number,
  inBw: number,
  outBw: number,
  durationMin: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const expireTime = new Date(Date.now() + durationMin * 60 * 1000);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const tempBwExpireTime = `${expireTime.getFullYear()}-${pad(expireTime.getMonth() + 1)}-${pad(expireTime.getDate())} ${pad(expireTime.getHours())}:${pad(expireTime.getMinutes())}:${pad(expireTime.getSeconds())}`;

    const result = await MfyService.request(
      account,
      `clouds/${cloudId}/bw`,
      { in_bw: inBw, out_bw: outBw, temp_bw_expire_time: tempBwExpireTime },
      'PUT',
    );
    if (result.success) return { success: true };
    return { success: false, error: String(result.msg ?? '限速失败') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 限速执行器主函数（支持双方向同时触发）
 *
 * - triggerUp only: 按 outbw 排序，只限 out_bw
 * - triggerDown only: 按 inbw 排序，只限 in_bw
 * - both: 分别排序，同一实例合并为单次 API 调用（双向限速）
 */
export async function executeBandwidthLimit(input: LimitExecutorInput): Promise<LimitExecutorOutput> {
  const { rule, nodeId, triggerUp, triggerDown, loginUser, machineLimitTime } = input;
  const config = MfyService.readConfig();
  const account = MfyService.resolveMfyAccount(config, loginUser);

  const results: BandwidthInstanceResult[] = [];

  try {
    // 1. 获取节点下所有实例（共享）
    const instances = await getNodeInstances(account, nodeId);
    if (instances.length === 0) {
      return { success: true, affectedCount: 0, instances: [], error: '节点下无实例' };
    }

    // 2. 批量获取实例实时带宽（共享）
    const cloudIds = instances.map(i => i.id);
    const realtimeMap = await getInstancesRealtimeBandwidth(account, cloudIds);

    const now = Date.now();
    const cooldownMs = rule.durationMin * 60 * 1000;
    const effectiveCooldownMs = cooldownMs + COOLDOWN_BUFFER_MS;

    // 3. 按触发方向分别排序 + 冷却过滤 + Top N + 持续监控
    type Candidate = { inst: typeof instances[0]; bwBps: number };
    const processDirection = async (
      isUp: boolean,
    ): Promise<{ candidates: Candidate[]; skipped: BandwidthInstanceResult[] }> => {
      const skipped: BandwidthInstanceResult[] = [];
      const limitDir: 'in' | 'out' = isUp ? 'out' : 'in';

      // 排序：按目标方向带宽降序
      const sorted = instances
        .map(inst => {
          const rt = realtimeMap.get(inst.id);
          const bwBps = isUp ? (rt?.outbwBps ?? 0) : (rt?.inbwBps ?? 0);
          return { inst, bwBps } as Candidate;
        })
        .filter(x => x.bwBps > 0)
        .sort((a, b) => b.bwBps - a.bwBps);

      // 冷却过滤
      const available: Candidate[] = [];
      for (const item of sorted) {
        const limitTs = machineLimitTime?.get(item.inst.id) ?? 0;
        if (limitTs && now - limitTs < effectiveCooldownMs) {
          const configBw = isUp ? item.inst.outBw : item.inst.inBw;
          skipped.push({
            cloudId: item.inst.id,
            cloudName: item.inst.name,
            bandwidthBefore: configBw,
            bandwidthAfter: configBw,
            realtimeBwMbps: bpsToMbps(item.bwBps),
            originalInBw: item.inst.inBw,
            originalOutBw: item.inst.outBw,
            limitDirection: limitDir,
            limited: false,
            reason: 'in_cooldown',
          });
        } else {
          available.push(item);
        }
      }

      // Top N
      const topN = Math.min(rule.topN, available.length);
      let topInstances = available.slice(0, topN);

      // 持续监控二次过滤
      if (rule.continuousEnabled && rule.continuousWindowMin && rule.continuousPercent) {
        const filtered: Candidate[] = [];
        for (const item of topInstances) {
          const configBw = isUp ? item.inst.outBw : item.inst.inBw;
          const overThreshold = await isContinuouslyOverThreshold(
            account, item.inst.id, rule.continuousWindowMin,
            rule.continuousPercent, item.bwBps, configBw, isUp,
          );
          if (overThreshold) {
            filtered.push(item);
          } else {
            skipped.push({
              cloudId: item.inst.id,
              cloudName: item.inst.name,
              bandwidthBefore: configBw,
              bandwidthAfter: configBw,
              realtimeBwMbps: bpsToMbps(item.bwBps),
              originalInBw: item.inst.inBw,
              originalOutBw: item.inst.outBw,
              limitDirection: limitDir,
              limited: false,
              reason: 'continuous_filtered',
            });
          }
        }
        topInstances = filtered;
      }

      return { candidates: topInstances, skipped };
    };

    // 分别处理上行和下行
    const upResult = triggerUp ? await processDirection(true) : { candidates: [], skipped: [] };
    const downResult = triggerDown ? await processDirection(false) : { candidates: [], skipped: [] };

    // 收集所有跳过的实例（去重：同一实例可能被两个方向都跳过）
    const skippedMap = new Map<number, BandwidthInstanceResult>();
    for (const r of [...upResult.skipped, ...downResult.skipped]) {
      // 如果已有记录且是 in_cooldown，保留（冷却比 continuous_filtered 优先）
      const existing = skippedMap.get(r.cloudId);
      if (!existing || (existing.reason !== 'in_cooldown' && r.reason === 'in_cooldown')) {
        skippedMap.set(r.cloudId, r);
      }
    }
    for (const r of skippedMap.values()) {
      results.push(r);
    }

    // 4. 合并两个方向的候选列表
    // 对于同一实例：如果两个方向都选中 → 双向限速（单次 API 调用）
    //               如果只一个方向选中 → 单向限速
    interface MergedPlan {
      inst: typeof instances[0];
      limitUp: boolean;
      limitDown: boolean;
      upBwBps: number;
      downBwBps: number;
    }
    const mergedMap = new Map<number, MergedPlan>();
    for (const c of upResult.candidates) {
      mergedMap.set(c.inst.id, {
        inst: c.inst, limitUp: true, limitDown: false,
        upBwBps: c.bwBps, downBwBps: 0,
      });
    }
    for (const c of downResult.candidates) {
      const existing = mergedMap.get(c.inst.id);
      if (existing) {
        // 两个方向都选中 → 双向限速
        existing.limitDown = true;
        existing.downBwBps = c.bwBps;
      } else {
        mergedMap.set(c.inst.id, {
          inst: c.inst, limitUp: false, limitDown: true,
          upBwBps: 0, downBwBps: c.bwBps,
        });
      }
    }

    const mergedCandidates = Array.from(mergedMap.values());
    if (mergedCandidates.length === 0) {
      const hasSkipped = results.length > 0;
      return {
        success: true, affectedCount: 0, instances: results,
        error: hasSkipped ? '候选实例均被过滤（冷却/持续监控）' : '无带宽数据的实例',
      };
    }

    // 5. 并发限速（并发度 3）
    const limitResults = await asyncPool(mergedCandidates, 3, async (plan) => {
      const { inst, limitUp, limitDown, upBwBps, downBwBps } = plan;
      let newInBw = inst.inBw;
      let newOutBw = inst.outBw;

      // 计算各方向限速值
      if (rule.limitMode === 'percent') {
        const factor = (100 - rule.reducePercent) / 100;
        if (limitUp) newOutBw = Math.max(1, Math.round(inst.outBw * factor));
        if (limitDown) newInBw = Math.max(1, Math.round(inst.inBw * factor));
      } else {
        if (limitUp) newOutBw = Math.max(1, rule.limitValue);
        if (limitDown) newInBw = Math.max(1, rule.limitValue);
      }

      const limitResult = await limitInstance(account, inst.id, newInBw, newOutBw, rule.durationMin);

      // 确定方向标签和展示值
      const limitDir: 'in' | 'out' | 'both' = limitUp && limitDown ? 'both' : limitUp ? 'out' : 'in';
      const primaryBwBps = limitUp ? upBwBps : downBwBps;
      // bandwidthBefore/After 用配置值（Mbps），表示限速前后带宽配置变化
      const configBefore = limitUp ? inst.outBw : inst.inBw;
      const displayAfter = limitUp && limitDown
        ? newOutBw  // 双向时展示出站值，详情看 newInBw/newOutBw
        : limitUp ? newOutBw : newInBw;

      return {
        cloudId: inst.id,
        cloudName: inst.name,
        bandwidthBefore: configBefore,
        bandwidthAfter: displayAfter,
        realtimeBwMbps: bpsToMbps(primaryBwBps),
        originalInBw: inst.inBw,
        originalOutBw: inst.outBw,
        newInBw,
        newOutBw,
        limitDirection: limitDir,
        limited: limitResult.success,
        reason: limitResult.success ? 'top_n' as const : 'error' as const,
        error: limitResult.error,
      };
    });

    for (const r of limitResults) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          cloudId: 0,
          cloudName: 'unknown',
          bandwidthBefore: 0,
          bandwidthAfter: 0,
          realtimeBwMbps: 0,
          limited: false,
          reason: 'error',
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    const affectedCount = results.filter(r => r.limited).length;
    return { success: true, affectedCount, instances: results };
  } catch (err) {
    return {
      success: false,
      affectedCount: 0,
      instances: results,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
