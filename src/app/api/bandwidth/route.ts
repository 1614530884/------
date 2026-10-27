import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';
import { loadAdminUsernames } from '@/lib/services/server-tools/auth';
import {
  bandwidthRuleStore,
  bandwidthLogStore,
  bandwidthAlertStore,
  bandwidthManagerService,
  bandwidthReleaseScheduler,
} from '@/lib/services/bandwidth-manager';
import type { BandwidthRule, BandwidthLimitMode, BandwidthEventType, BandwidthResult, BandwidthAlertConfig, BandwidthPenaltyMode } from '@/lib/services/bandwidth-manager';

/** 校验是否管理员（复用 server-tools/auth 的 loadAdminUsernames，直接读取 idc-config.json） */
function isAdmin(username: string | null): boolean {
  if (!username) return false;
  return loadAdminUsernames().includes(username);
}

/** 统一鉴权：session + 管理员 */
function authCheck(request: NextRequest): { ok: true; user: string } | { ok: false; response: NextResponse } {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'bandwidth');
    return { ok: false, response: NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 }) };
  }
  const user = getSessionUser(sessionCookie);
  if (!user || !isAdmin(user)) {
    return { ok: false, response: NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** 规则校验 */
function validateRule(rule: Partial<BandwidthRule>): string | null {
  if (!rule.name?.trim()) return '规则名称不能为空';
  if (!rule.nodeIds?.length) return '请选择至少一个节点';
  // 至少配置一个方向的阈值
  const hasUp = rule.thresholdUp !== undefined && rule.thresholdUp > 0;
  const hasDown = rule.thresholdDown !== undefined && rule.thresholdDown > 0;
  if (!hasUp && !hasDown) return '至少需要配置上行或下行阈值';
  if (!rule.topN || rule.topN < 1) return '限速实例数量必须≥1';
  if (!rule.limitMode || !['percent', 'fixed'].includes(rule.limitMode)) return '限速模式无效';
  if (!rule.limitValue || rule.limitValue <= 0) return '限速值必须大于0';
  if (rule.limitMode === 'percent' && (!rule.reducePercent || rule.reducePercent < 1 || rule.reducePercent > 99)) {
    return '带宽降低比例须在1-99之间';
  }
  if (!rule.durationMin || rule.durationMin < 1) return '限速持续时间必须≥1分钟';
  if (rule.continuousEnabled) {
    if (!rule.continuousWindowMin || rule.continuousWindowMin < 1) return '持续监控时间窗口必须≥1分钟';
    if (rule.continuousPercent === undefined || rule.continuousPercent < 1 || rule.continuousPercent > 100) {
      return '持续监控带宽使用率须在1-100之间';
    }
  }
  if (rule.interval && rule.interval < 60) return '检查间隔最小60秒';
  if (rule.cooldown && rule.cooldown < 60) return '冷却时间最小60秒';

  // 惩罚机制校验
  if (rule.penaltyEnabled) {
    if (!rule.penaltyWindowMin || rule.penaltyWindowMin < 1) return '惩罚统计窗口必须≥1分钟';
    if (!rule.penaltyThreshold || rule.penaltyThreshold < 1) return '惩罚触发阈值必须≥1次';
    if (!rule.penaltyMode || !['multiply', 'add_extra'].includes(rule.penaltyMode)) {
      return '惩罚模式无效（multiply 或 add_extra）';
    }
    if (!rule.penaltyValue || rule.penaltyValue < 1) {
      return rule.penaltyMode === 'multiply' ? '时间惩罚倍数必须≥1' : '时间惩罚值必须≥1';
    }
    // 带宽降低比例惩罚校验（独立于时间惩罚）
    if (!rule.penaltyBwMode || !['multiply', 'add_extra'].includes(rule.penaltyBwMode)) {
      return '带宽惩罚模式无效（multiply 或 add_extra）';
    }
    if (!rule.penaltyBwValue || rule.penaltyBwValue < 1) {
      return rule.penaltyBwMode === 'multiply' ? '带宽惩罚倍数必须≥1' : '带宽惩罚降低值必须≥1';
    }
    if (rule.minBandwidthMbps === undefined || rule.minBandwidthMbps < 1) {
      return '最低带宽保留（Mbps）必须≥1';
    }
  }
  if (rule.whitelistHostnames !== undefined && rule.whitelistHostnames.length > 500) {
    return '主机名白名单最多 500 条';
  }
  return null;
}

/** 归一化主机名白名单：去空格、去空项、去重，最多 500 条 */
function normalizeWhitelist(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    const name = String(item ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
    if (result.length >= 500) break;
  }
  return result;
}

export async function GET(request: NextRequest) {
  const auth = authCheck(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'listRules';

  try {
    switch (action) {
      case 'listRules': {
        const rules = bandwidthRuleStore.list();
        return NextResponse.json({ success: true, data: rules });
      }
      case 'status': {
        return NextResponse.json({ success: true, data: bandwidthManagerService.getStatus() });
      }
      case 'listLogs': {
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const perPage = Math.min(100, Math.max(1, Number(searchParams.get('perPage')) || 50));
        const ruleId = searchParams.get('ruleId') || undefined;
        const nodeIdParam = searchParams.get('nodeId');
        const nodeId = nodeIdParam ? Number(nodeIdParam) : undefined;
        const eventType = searchParams.get('eventType') as BandwidthEventType | null;
        const resultFilter = searchParams.get('result') as BandwidthResult | null;
        const result = bandwidthLogStore.list({
          page,
          perPage,
          ruleId: ruleId || undefined,
          nodeId: nodeId && !isNaN(nodeId) ? nodeId : undefined,
          eventType: eventType || undefined,
          result: resultFilter || undefined,
        });
        return NextResponse.json({ success: true, data: result });
      }
      case 'getAlertConfig': {
        return NextResponse.json({ success: true, data: bandwidthAlertStore.getConfig() });
      }
      case 'listActive': {
        // 当前活跃的限速事件（用于展示剩余时间 + 手动解除）
        const events = bandwidthAlertStore.listActiveEvents();
        return NextResponse.json({ success: true, data: events });
      }
      case 'listAlerts': {
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const perPage = Math.min(100, Math.max(1, Number(searchParams.get('perPage')) || 50));
        const result = bandwidthAlertStore.list(page, perPage);
        return NextResponse.json({ success: true, data: result });
      }
      case 'listUnreadAlerts': {
        const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));
        const items = bandwidthAlertStore.listUnread(limit);
        const unreadCount = bandwidthAlertStore.countUnread();
        return NextResponse.json({ success: true, data: { items, unreadCount } });
      }
      case 'nodeEventCounts': {
        // 查询节点在时间窗口内的限速次数（前端节点列表展示用）
        const config = bandwidthAlertStore.getConfig();
        const windowMin = Number(searchParams.get('windowMin')) || config.windowMin;
        const nodeIdsParam = searchParams.get('nodeIds') || '';
        const nodeIds = nodeIdsParam
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => !isNaN(n) && n > 0);
        const sinceTs = Date.now() - windowMin * 60 * 1000;
        const map = bandwidthAlertStore.getNodeEventCounts(nodeIds, sinceTs);
        // Map → 普通对象，方便 JSON 序列化
        const counts: Record<number, number> = {};
        for (const [id, cnt] of map) counts[id] = cnt;
        return NextResponse.json({ success: true, data: { counts, windowMin } });
      }
      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务异常';
    return NextResponse.json({ success: false, message });
  }
}

export async function POST(request: NextRequest) {
  const auth = authCheck(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {
      case 'saveRule': {
        const rule = body.rule as Partial<BandwidthRule> | undefined;
        if (!rule) return NextResponse.json({ success: false, message: '缺少规则数据' });

        const error = validateRule(rule);
        if (error) return NextResponse.json({ success: false, message: error });

        const ruleData: Omit<BandwidthRule, 'id' | 'createdAt'> = {
          name: rule.name!.trim(),
          nodeIds: rule.nodeIds!,
          thresholdUp: rule.thresholdUp ? Number(rule.thresholdUp) : undefined,
          thresholdDown: rule.thresholdDown ? Number(rule.thresholdDown) : undefined,
          topN: Number(rule.topN),
          limitMode: rule.limitMode as BandwidthLimitMode,
          limitValue: Number(rule.limitValue),
          continuousEnabled: !!rule.continuousEnabled,
          continuousWindowMin: rule.continuousWindowMin ? Number(rule.continuousWindowMin) : undefined,
          continuousPercent: rule.continuousPercent !== undefined ? Number(rule.continuousPercent) : undefined,
          durationMin: Number(rule.durationMin),
          reducePercent: rule.limitMode === 'percent' ? Number(rule.reducePercent) : 0,
          interval: Number(rule.interval ?? 60),
          cooldown: Number(rule.cooldown ?? 300),
          triggerCount: Number(rule.triggerCount ?? 1),
          enabled: rule.enabled !== false,
          // 惩罚机制
          penaltyEnabled: !!rule.penaltyEnabled,
          penaltyWindowMin: Math.max(1, Number(rule.penaltyWindowMin ?? 60)),
          penaltyThreshold: Math.max(1, Number(rule.penaltyThreshold ?? 2)),
          penaltyMode: (rule.penaltyMode ?? 'multiply') as BandwidthPenaltyMode,
          penaltyValue: Math.max(1, Number(rule.penaltyValue ?? 2)),
          // 带宽降低比例惩罚（独立于时间惩罚）
          penaltyBwMode: (rule.penaltyBwMode ?? 'add_extra') as BandwidthPenaltyMode,
          penaltyBwValue: Math.max(1, Number(rule.penaltyBwValue ?? 10)),
          minBandwidthMbps: Math.max(1, Number(rule.minBandwidthMbps ?? 10)),
          whitelistHostnames: normalizeWhitelist(rule.whitelistHostnames),
        };

        let saved: BandwidthRule;
        if (rule.id) {
          saved = bandwidthRuleStore.update(rule.id, ruleData) ?? bandwidthRuleStore.create(ruleData);
          bandwidthLogStore.append({
            ruleId: saved.id,
            ruleName: saved.name,
            nodeId: saved.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_update',
            result: 'success',
          });
        } else {
          saved = bandwidthRuleStore.create(ruleData);
          bandwidthLogStore.append({
            ruleId: saved.id,
            ruleName: saved.name,
            nodeId: saved.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_create',
            result: 'success',
          });
        }

        bandwidthManagerService.restart();
        return NextResponse.json({ success: true, data: saved });
      }

      case 'deleteRule': {
        const ruleId = body.ruleId as string | undefined;
        if (!ruleId) return NextResponse.json({ success: false, message: '缺少规则ID' });
        const rule = bandwidthRuleStore.getById(ruleId);
        bandwidthRuleStore.delete(ruleId);
        if (rule) {
          bandwidthLogStore.append({
            ruleId,
            ruleName: rule.name,
            nodeId: rule.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_delete',
            result: 'success',
          });
        }
        bandwidthManagerService.restart();
        return NextResponse.json({ success: true });
      }

      case 'toggleRule': {
        const ruleId = body.ruleId as string | undefined;
        const enabled = body.enabled as boolean | undefined;
        if (!ruleId || enabled === undefined) return NextResponse.json({ success: false, message: '参数不完整' });
        bandwidthRuleStore.setEnabled(ruleId, enabled);
        bandwidthManagerService.restart();
        return NextResponse.json({ success: true });
      }

      case 'clearLogs': {
        bandwidthLogStore.clear();
        return NextResponse.json({ success: true });
      }

      case 'manualCheck': {
        bandwidthManagerService.runCheckCycle().catch(err => {
          console.error('[BandwidthManager] 手动触发检查失败:', err);
        });
        return NextResponse.json({ success: true, message: '已触发检查' });
      }

      case 'startService': {
        bandwidthManagerService.start();
        return NextResponse.json({ success: true });
      }

      case 'stopService': {
        bandwidthManagerService.stop();
        return NextResponse.json({ success: true });
      }

      case 'saveAlertConfig': {
        const config = body.config as BandwidthAlertConfig | undefined;
        if (!config) return NextResponse.json({ success: false, message: '缺少配置数据' });
        bandwidthAlertStore.saveConfig(config);
        return NextResponse.json({ success: true });
      }

      case 'markAllAlertsRead': {
        bandwidthAlertStore.markAllRead();
        return NextResponse.json({ success: true });
      }

      case 'manualRelease': {
        // 手动解除单个活跃事件（不受重试次数限制，立即执行）
        const eventId = body.eventId as string | undefined;
        if (!eventId) return NextResponse.json({ success: false, message: '缺少事件ID' });
        const result = await bandwidthReleaseScheduler.manualRelease(eventId);
        if (!result.success) {
          return NextResponse.json({ success: false, message: result.error });
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ success: false, message: `未知操作: ${action}` });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : '服务异常';
    return NextResponse.json({ success: false, message });
  }
}
