/**
 * CPU 限制 - 执行器
 *
 * 职责（参考 bandwidth-manager/limit-executor.ts）：
 * 1. 节点并发限制上限检查：统计规则+节点当前正在限制的实例数（status='active'），超上限则跳过
 * 2. 拉取节点下所有实例（clouds 分页）
 * 3. 批量获取实例实时 CPU 使用率（clouds/real_data，字段 cpu_usage）
 * 4. 按 CPU 使用率降序排序，过滤已在限制中的实例，取 Top N
 * 5. 惩罚时长计算：实例在窗口内被限制次数达阈值 → 递增限制时长
 * 6. 对每个实例调用 PUT clouds/{id}/cpu_limit 设置 cpu_limit
 * 7. 返回处理结果 + 新建活跃事件列表（含实际时长和惩罚标记）
 *
 * 与带宽限制的关键差异：
 * - CPU 限制接口无 temp_expire_time 参数，到期解除由 release-scheduler 负责
 * - 实例级冷却通过查询 cpu_limit_events 表的 active 状态判断
 */
import { MfyService, type MfyCredentials } from '@/lib/services/mfy-service';
import { asyncPool } from '@/lib/async-pool';
import { cpuLimitEventStore } from './store';
import type {
  CpuLimitRule,
  CpuInstanceResult,
  CpuLimitExecutorInput,
  CpuLimitExecutorOutput,
} from './types';

/** 解除限制时的百分比（100 = 无限制） */
export const CPU_LIMIT_RELEASE_PERCENT = 100;

/** 惩罚时长上限（分钟），避免指数爆炸 */
const MAX_PENALTY_DURATION_MIN = 24 * 60; // 24 小时

/** 从 API 响应中提取数组列表（兼容多种包装格式） */
function extractList(respData: unknown): unknown[] {
  if (Array.isArray(respData)) return respData;
  if (!respData || typeof respData !== 'object') return [];
  const obj = respData as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  const inner = obj.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const innerObj = inner as Record<string, unknown>;
    if (Array.isArray(innerObj.data)) return innerObj.data;
  }
  return [];
}

/**
 * 获取节点下所有实例列表（自动分页）
 * 返回 [{ id, name }]，仅需 ID 和名称（CPU 使用率从 real_data 获取）
 */
async function getNodeInstances(
  account: MfyCredentials,
  nodeId: number,
): Promise<Array<{ id: number; name: string }>> {
  const instances: Array<{ id: number; name: string }> = [];
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
      instances.push({
        id: Number(c.id) || 0,
        name: String(c.name ?? c.hostname ?? `实例${c.id}`),
      });
    }
    if (list.length < perPage) break;
    const rootObj = result.data as Record<string, unknown>;
    const meta = rootObj.meta as Record<string, unknown> | undefined;
    const total = Number(meta?.total ?? 0);
    if (total > 0 && page * perPage >= total) break;
    page++;
  }
  return instances;
}

/**
 * 批量获取实例实时 CPU 使用率
 * 调用 POST clouds/real_data，返回字段 cpu_usage（float，0-100）
 * 分批查询，每批 50 个实例
 */
async function getInstancesCpuUsage(
  account: MfyCredentials,
  cloudIds: number[],
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (cloudIds.length === 0) return result;

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
        // cpu_usage 字段：float，0-100
        const cpuUsage = Number(r.cpu_usage ?? 0);
        if (!isNaN(cpuUsage)) result.set(cloudId, cpuUsage);
      }
    } catch {
      // 单批失败不影响其他批次
    }
  }
  return result;
}

/**
 * 对单台实例执行 CPU 限制
 * PUT clouds/{id}/cpu_limit，参数 { cpu_limit: percent }
 * 注意：API 文档参数类型为 string，但传 int 也能识别（保守起见转 string）
 */
async function limitInstanceCpu(
  account: MfyCredentials,
  cloudId: number,
  cpuLimitPercent: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await MfyService.request(
      account,
      `clouds/${cloudId}/cpu_limit`,
      { cpu_limit: String(cpuLimitPercent) },
      'PUT',
    );
    if (result.success) return { success: true };
    return { success: false, error: String(result.msg ?? 'CPU 限制失败') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * 计算单步惩罚后的 CPU 限制值和限制时长
 *
 * 设计原则（与带宽惩罚一致：时间惩罚和限制值惩罚独立配置）：
 *
 * 1. 时间惩罚：基于规则基础时长，触发惩罚时按 mode 单步放大
 *    - multiply: durationMin × penaltyValue
 *    - add_extra: durationMin + penaltyValue
 *    - 上限：MAX_PENALTY_DURATION_MIN（24h），避免指数爆炸
 *
 * 2. CPU 限制值惩罚：基于"当前实际限制值"，触发惩罚时按 mode 单步降低
 *    - multiply: currentCpuLimit / penaltyCpuLimitValue（value=2 → 减半）
 *    - add_extra: currentCpuLimit - penaltyCpuLimitValue（value=10 → 降10%）
 *    - 下限保护：minCpuLimitPercent（默认 5%，防止实例卡死）
 *    - 首次惩罚（无 active 限制）时基于规则基础值 cpuLimitPercent
 *
 * 触发条件：
 * - 实例当前已有 active 限制（限速时间内再次触发） → 必定惩罚
 *   （"限速时间内再次被检测触发限速"本身就是惩罚信号）
 * - 实例无 active 限制，但窗口内被限制次数达 penaltyThreshold → 惩罚
 * - 否则 → 不惩罚，使用规则基础值
 *
 * @param rule 规则
 * @param currentCpuLimit 当前实际 CPU 限制值（无 active 限制时传 null）
 * @param currentDurationMin 当前实际限制时长（分钟，无 active 限制时传 null）
 * @param instanceLimitCount 窗口内被限制次数（含本次触发）
 * @returns { durationMin, cpuLimitPercent, penalized, atMinLimit }
 *          atMinLimit=true 表示已达到最低下限，无法再降低，调用方应跳过
 */
function calculatePenalty(
  rule: CpuLimitRule,
  currentCpuLimit: number | null,
  currentDurationMin: number | null,
  instanceLimitCount: number,
): { durationMin: number; cpuLimitPercent: number; penalized: boolean; atMinLimit: boolean } {
  // 判定是否触发惩罚（必须启用惩罚）：
  // 1. 实例当前已有 active 限制（限速时间内再次触发）→ 必定惩罚
  // 2. 无 active 限制，但窗口内被限制次数达阈值 → 惩罚
  const hasActiveLimit = currentCpuLimit !== null;
  const triggerByCount = instanceLimitCount >= rule.penaltyThreshold;
  const shouldPenalize = rule.penaltyEnabled && (hasActiveLimit || triggerByCount);

  if (!shouldPenalize) {
    return {
      durationMin: rule.durationMin,
      cpuLimitPercent: rule.cpuLimitPercent,
      penalized: false,
      atMinLimit: false,
    };
  }

  // 1. 时间惩罚：基于当前实际限制时长叠加（每次惩罚都更长，实现"翻倍"效果）
  //    首次惩罚（无 active 限制）时基于规则基础时长
  //    限速时间内再次触发时基于上次实际时长继续放大，如 30→60→120→240
  const baseDuration = currentDurationMin ?? rule.durationMin;
  let durationMin: number;
  if (rule.penaltyMode === 'multiply') {
    durationMin = baseDuration * rule.penaltyValue;
  } else {
    durationMin = baseDuration + rule.penaltyValue;
  }
  durationMin = Math.min(Math.round(durationMin), MAX_PENALTY_DURATION_MIN);

  // 2. CPU 限制值惩罚：基于当前实际限制值（首次惩罚时基于规则基础值）
  const baseCpuLimit = currentCpuLimit ?? rule.cpuLimitPercent;
  let cpuLimitPercent: number;
  if (rule.penaltyCpuLimitMode === 'multiply') {
    // multiply: 每次降低到 1/value（value=2 → 每次减半）
    cpuLimitPercent = baseCpuLimit / rule.penaltyCpuLimitValue;
  } else {
    // add_extra: 每次降低 value%
    cpuLimitPercent = baseCpuLimit - rule.penaltyCpuLimitValue;
  }
  // 下限保护：至少保留 minCpuLimitPercent
  const minLimit = Math.max(1, Math.min(100, rule.minCpuLimitPercent));
  cpuLimitPercent = Math.max(Math.round(cpuLimitPercent), minLimit);

  // 判定是否已达下限：实例已在限制中，但新计算值 >= 当前值，无法再降低
  const atMinLimit = hasActiveLimit && cpuLimitPercent >= (currentCpuLimit as number);

  return { durationMin, cpuLimitPercent, penalized: true, atMinLimit };
}

/**
 * CPU 限制执行器主函数
 *
 * 流程：
 * 1. 节点并发限制上限检查（规则+节点当前活跃实例数）
 * 2. 拉取节点下所有实例
 * 3. 批量获取实例实时 CPU 使用率
 * 4. 按 CPU 使用率降序排序
 * 5. 取 Top N（不再过滤 active 实例，允许在限速时间内再次触发惩罚）
 * 6. 对每个实例计算惩罚时长和限制值（基于当前实际限制值单步惩罚）
 *    - 已达 minCpuLimitPercent 的实例跳过（不创建新事件）
 * 7. 并发执行 CPU 限制
 * 8. 限制成功后，旧 active 事件标记为 superseded，新建 active 事件
 * 9. 返回结果 + 新建活跃事件列表 + 被替代的旧事件 ID
 */
export async function executeCpuLimit(input: CpuLimitExecutorInput): Promise<CpuLimitExecutorOutput> {
  const { rule, nodeId, nodeName, activeLimits } = input;
  // metricValue 仅用于日志记录，执行器不直接使用
  const config = MfyService.readConfig();
  const account = MfyService.resolveMfyAccount(config);

  const results: CpuInstanceResult[] = [];
  const newEvents: CpuLimitExecutorOutput['newEvents'] = [];
  const supersededEventIds: string[] = [];

  try {
    // 1. 节点并发限制上限检查：统计该规则+节点当前正在限制的实例数（status='active'）
    let remainingQuota = Infinity;
    if (rule.maxActiveInstances > 0) {
      const activeCount = cpuLimitEventStore.countActiveByRuleNode(rule.id, nodeId);
      if (activeCount >= rule.maxActiveInstances) {
        return {
          success: true,
          affectedCount: 0,
          instances: [],
          newEvents: [],
          supersededEventIds: [],
          error: `节点并发限制上限已达上限：${activeCount}/${rule.maxActiveInstances}（当前活跃实例数）`,
          skippedByNodeLimit: true,
        };
      }
      // 剩余可限制名额 = 上限 - 当前活跃数
      remainingQuota = rule.maxActiveInstances - activeCount;
    }

    // 2. 获取节点下所有实例
    const instances = await getNodeInstances(account, nodeId);
    if (instances.length === 0) {
      return { success: true, affectedCount: 0, instances: [], newEvents: [], supersededEventIds: [], error: '节点下无实例' };
    }

    // 3. 批量获取实例实时 CPU 使用率
    const cloudIds = instances.map(i => i.id);
    const cpuUsageMap = await getInstancesCpuUsage(account, cloudIds);

    // 4. 按 CPU 使用率降序排序，过滤无数据的实例
    //    注意：不再过滤 active 实例 —— 限速时间内若 CPU 仍高，应基于当前限制值再次惩罚
    const sorted = instances
      .map(inst => ({
        inst,
        cpuUsage: cpuUsageMap.get(inst.id) ?? -1,
      }))
      .filter(x => x.cpuUsage >= 0)  // -1 表示未获取到数据，过滤掉
      .sort((a, b) => b.cpuUsage - a.cpuUsage);

    if (sorted.length === 0) {
      return { success: true, affectedCount: 0, instances: [], newEvents: [], supersededEventIds: [], error: '无 CPU 使用率数据的实例' };
    }

    // 5. 取 Top N（考虑节点并发限制上限剩余配额 + 自动跳过不会实际限制的实例）
    //    以下 active 实例不会实际限制，不占用 Top N 名额，自动顺延到下一台：
    //    - penaltyEnabled=false 时，active 实例不再次限制（让原限速自然到期）
    //    - penaltyEnabled=true 但 currentCpuLimit <= minLimit 时，已达下限无法再降
    //    其他 active 实例（替代旧事件，不增加 active 数，不消耗 quota）和非 active 实例（消耗 quota）正常选取
    const minLimit = Math.max(1, Math.min(100, rule.minCpuLimitPercent));
    const topInstances: typeof sorted = [];
    let quotaLeft = remainingQuota;
    for (const item of sorted) {
      if (topInstances.length >= rule.topN) break;
      const activeInfo = activeLimits.get(item.inst.id);
      if (activeInfo) {
        // 已 active：判断是否会实际限制
        const skipReason = !rule.penaltyEnabled
          ? 'already_limited' as const  // 未启用惩罚，不再次限制
          : activeInfo.cpuLimit <= minLimit
            ? 'at_min_limit' as const    // 已达下限，无法再降
            : null;
        if (skipReason) {
          // 不会实际限制，跳过，不占用 Top N 名额，让下一台顺延
          results.push({
            cloudId: item.inst.id,
            cloudName: item.inst.name,
            cpuUsage: item.cpuUsage,
            cpuLimitAfter: activeInfo.cpuLimit,
            limited: false,
            reason: skipReason,
          });
          continue;
        }
        // 未达下限且启用惩罚，加入候选（替代旧事件，不消耗 quota）
        topInstances.push(item);
      } else {
        // 非 active：消耗 quota
        if (quotaLeft <= 0) continue;
        quotaLeft--;
        topInstances.push(item);
      }
    }

    if (topInstances.length === 0) {
      return {
        success: true, affectedCount: 0, instances: results, newEvents: [], supersededEventIds: [],
        error: results.length > 0
          ? '所有候选实例已在限制中且无法再次限制（未启用惩罚或已达下限）'
          : (rule.maxActiveInstances > 0 ? `节点并发限制上限已达上限（${rule.maxActiveInstances}）` : '无可用实例'),
        skippedByNodeLimit: rule.maxActiveInstances > 0 && results.length === 0,
      };
    }

    // 6. 并发执行 CPU 限制（并发度 3），每台实例独立计算惩罚时长和限制值
    const now = Date.now();

    // 预查询各实例在窗口内的被限制次数（仅启用惩罚时才需要）
    const instanceCountMap = new Map<number, number>();
    if (rule.penaltyEnabled) {
      const penaltySinceTs = now - rule.penaltyWindowMin * 60 * 1000;
      // 批量查询：一次 SQL 获取所有 cloudId 的计数，避免逐个查询
      const cloudIdToCount = cpuLimitEventStore.countCloudEventsInWindowBatch(
        topInstances.map(x => x.inst.id),
        penaltySinceTs,
      );
      for (const [cid, cnt] of cloudIdToCount) {
        instanceCountMap.set(cid, cnt);
      }
    }

    const limitResults = await asyncPool(topInstances, 3, async (item) => {
      const { inst, cpuUsage } = item;
      // 获取实例当前 active 限制（若有）—— 用于基于当前值单步惩罚
      const activeInfo = activeLimits.get(inst.id);
      const currentCpuLimit = activeInfo ? activeInfo.cpuLimit : null;

      // Bug 修复：未启用惩罚时，active 实例不再次限制（让原限速自然到期）
      if (!rule.penaltyEnabled && currentCpuLimit !== null) {
        return {
          cloudId: inst.id,
          cloudName: inst.name,
          cpuUsage,
          cpuLimitAfter: currentCpuLimit,
          limited: false,
          reason: 'already_limited' as CpuInstanceResult['reason'],
          error: undefined,
          actualDurationMin: 0,
          penalized: false,
          effectiveCpuLimit: currentCpuLimit,
          expireTime: 0,
          supersededEventId: undefined as string | undefined,
        };
      }

      // 计算惩罚：基于当前实际限制值（限速时间内再次触发必定惩罚）
      // 时间惩罚基于当前实际限制时长叠加（无 active 时传 null，fallback 到规则基础时长）
      const instanceCount = instanceCountMap.get(inst.id) ?? 0;
      const currentDurationMin = activeInfo ? (activeInfo.actualDurationMin ?? null) : null;
      const {
        durationMin: actualDurationMin,
        cpuLimitPercent: effectiveCpuLimit,
        penalized,
        atMinLimit,
      } = calculatePenalty(rule, currentCpuLimit, currentDurationMin, instanceCount + 1);

      // 已达下限：跳过，不创建新事件，旧事件保持 active（让其自然到期解除）
      if (atMinLimit) {
        return {
          cloudId: inst.id,
          cloudName: inst.name,
          cpuUsage,
          cpuLimitAfter: currentCpuLimit ?? rule.cpuLimitPercent,
          limited: false,
          reason: 'at_min_limit' as CpuInstanceResult['reason'],
          error: undefined,
          actualDurationMin: 0,
          penalized: false,
          effectiveCpuLimit: currentCpuLimit ?? rule.cpuLimitPercent,
          expireTime: 0,
          supersededEventId: undefined as string | undefined,
        };
      }

      const instanceExpireTime = now + actualDurationMin * 60 * 1000;
      const limitResult = await limitInstanceCpu(account, inst.id, effectiveCpuLimit);
      if (penalized) {
        const fromLimit = currentCpuLimit ?? rule.cpuLimitPercent;
        console.log(`[CpuLimit] 实例 ${inst.name}(#${inst.id}) 触发惩罚：时长 ${rule.durationMin}→${actualDurationMin}分，CPU 限制 ${fromLimit}→${effectiveCpuLimit}%（窗口内已限制 ${instanceCount + 1} 次）`);
      }

      // 限制成功且当前有旧 active 事件 → 收集旧事件 ID 用于标记 superseded
      const supersededEventId = (limitResult.success && activeInfo) ? activeInfo.eventId : undefined;

      return {
        cloudId: inst.id,
        cloudName: inst.name,
        cpuUsage,
        cpuLimitAfter: effectiveCpuLimit,
        limited: limitResult.success,
        reason: (limitResult.success ? 'top_n' : 'error') as CpuInstanceResult['reason'],
        error: limitResult.error,
        actualDurationMin,
        penalized,
        effectiveCpuLimit,
        expireTime: instanceExpireTime,
        supersededEventId,
      };
    });

    for (const r of limitResults) {
      if (r.status === 'fulfilled') {
        const v = r.value;
        // 收集被替代的旧事件 ID
        if (v.supersededEventId) {
          supersededEventIds.push(v.supersededEventId);
        }
        results.push({
          cloudId: v.cloudId,
          cloudName: v.cloudName,
          cpuUsage: v.cpuUsage,
          cpuLimitAfter: v.cpuLimitAfter,
          limited: v.limited,
          reason: v.reason,
          error: v.error,
          penalized: v.penalized,
          actualDurationMin: v.actualDurationMin,
        });
        // 限制成功的实例 → 生成活跃事件（含实际时长、CPU 限制值和惩罚标记）
        if (v.limited) {
          newEvents.push({
            ruleId: rule.id,
            ruleName: rule.name,
            nodeId,
            nodeName,
            cloudId: v.cloudId,
            cloudName: v.cloudName,
            cpuLimitPercent: v.effectiveCpuLimit,
            startTime: now,
            expireTime: v.expireTime,
            actualDurationMin: v.actualDurationMin,
            penalized: v.penalized,
          });
        }
      } else {
        results.push({
          cloudId: 0,
          cloudName: 'unknown',
          cpuUsage: 0,
          cpuLimitAfter: rule.cpuLimitPercent,
          limited: false,
          reason: 'error',
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    const affectedCount = results.filter(r => r.limited).length;
    return { success: true, affectedCount, instances: results, newEvents, supersededEventIds };
  } catch (err) {
    return {
      success: false,
      affectedCount: 0,
      instances: results,
      newEvents,
      supersededEventIds,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 解除单台实例的 CPU 限制（设为 100%）
 * 供 release-scheduler 调用
 */
export async function releaseInstanceCpu(
  account: MfyCredentials,
  cloudId: number,
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await MfyService.request(
      account,
      `clouds/${cloudId}/cpu_limit`,
      { cpu_limit: String(CPU_LIMIT_RELEASE_PERCENT) },
      'PUT',
    );
    if (result.success) return { success: true };
    return { success: false, error: String(result.msg ?? '解除 CPU 限制失败') };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
