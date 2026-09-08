import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, SESSION_COOKIE_NAME, getSessionUser } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';
import { loadAdminUsernames } from '@/lib/services/server-tools/auth';
import {
  cpuLimitRuleStore,
  cpuLimitLogStore,
  cpuLimitEventStore,
  cpuLimitAlertStore,
  cpuLimitManagerService,
  cpuLimitReleaseScheduler,
} from '@/lib/services/cpu-limit-manager';
import type {
  CpuLimitRule,
  CpuLimitMetric,
  CpuLimitResult,
  CpuLimitPenaltyMode,
  CpuLimitAlertConfig,
} from '@/lib/services/cpu-limit-manager';
import { randomUUID } from 'crypto';

/** 校验是否管理员 */
function isAdmin(username: string | null): boolean {
  if (!username) return false;
  return loadAdminUsernames().includes(username);
}

/** 统一鉴权：session + 管理员 */
function authCheck(request: NextRequest): { ok: true; user: string } | { ok: false; response: NextResponse } {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'cpu-limit');
    return { ok: false, response: NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 }) };
  }
  const user = getSessionUser(sessionCookie);
  if (!user || !isAdmin(user)) {
    return { ok: false, response: NextResponse.json({ success: false, message: '需要管理员权限' }, { status: 403 }) };
  }
  return { ok: true, user };
}

/** 规则校验 */
function validateRule(rule: Partial<CpuLimitRule>): string | null {
  if (!rule.name?.trim()) return '规则名称不能为空';
  if (!rule.nodeIds?.length) return '请选择至少一个节点';
  if (!rule.metric || !['cpu', 'memory', 'disk'].includes(rule.metric)) return '监控指标无效';
  if (rule.threshold === undefined || rule.threshold <= 0 || rule.threshold > 100) {
    return '节点指标阈值须在 1-100 之间';
  }
  if (!rule.topN || rule.topN < 1) return '限制实例数量必须≥1';
  if (!rule.cpuLimitPercent || rule.cpuLimitPercent < 1 || rule.cpuLimitPercent > 100) {
    return 'CPU 限制百分比须在 1-100 之间（100=无限制）';
  }
  if (rule.cpuLimitPercent === 100) return 'CPU 限制百分比不能为 100（100 表示无限制）';
  if (!rule.durationMin || rule.durationMin < 1) return '限制持续时间必须≥1分钟';
  if (rule.interval && rule.interval < 60) return '检查间隔最小 60 秒';
  if (rule.cooldown && rule.cooldown < 60) return '冷却时间最小 60 秒';

  // 节点并发限制上限校验
  if (rule.maxActiveInstances !== undefined && rule.maxActiveInstances < 0) {
    return '节点并发限制上限不能为负数（0=不限制）';
  }

  // 惩罚机制校验
  if (rule.penaltyEnabled) {
    if (!rule.penaltyWindowMin || rule.penaltyWindowMin < 1) return '惩罚统计窗口必须≥1分钟';
    if (!rule.penaltyThreshold || rule.penaltyThreshold < 1) return '惩罚触发阈值必须≥1次';
    if (!rule.penaltyMode || !['multiply', 'add_extra'].includes(rule.penaltyMode)) {
      return '惩罚模式无效（multiply 或 add_extra）';
    }
    if (!rule.penaltyValue || rule.penaltyValue < 1) {
      return rule.penaltyMode === 'multiply' ? '惩罚倍数必须≥1' : '惩罚额外分钟数必须≥1';
    }
    // CPU 限制值惩罚校验
    if (!rule.penaltyCpuLimitMode || !['multiply', 'add_extra'].includes(rule.penaltyCpuLimitMode)) {
      return 'CPU 限制值惩罚模式无效（multiply 或 add_extra）';
    }
    if (!rule.penaltyCpuLimitValue || rule.penaltyCpuLimitValue < 1) {
      return rule.penaltyCpuLimitMode === 'multiply' ? 'CPU 限制惩罚除数必须≥1' : 'CPU 限制惩罚降低值必须≥1';
    }
    if (rule.minCpuLimitPercent === undefined || rule.minCpuLimitPercent < 1 || rule.minCpuLimitPercent > 100) {
      return 'CPU 限制最低百分比须在 1-100 之间';
    }
    // 检查 add_extra 模式下基础值是否足够降低
    if (rule.penaltyCpuLimitMode === 'add_extra' && rule.cpuLimitPercent <= rule.minCpuLimitPercent) {
      return `基础 CPU 限制 ${rule.cpuLimitPercent}% 已低于或等于最低下限 ${rule.minCpuLimitPercent}%，无法惩罚`;
    }
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = authCheck(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'listRules';

  try {
    switch (action) {
      case 'listRules': {
        const rules = cpuLimitRuleStore.list();
        return NextResponse.json({ success: true, data: rules });
      }
      case 'status': {
        return NextResponse.json({ success: true, data: cpuLimitManagerService.getStatus() });
      }
      case 'listLogs': {
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const perPage = Math.min(100, Math.max(1, Number(searchParams.get('perPage')) || 50));
        const resultFilter = searchParams.get('result') as CpuLimitResult | null;
        const result = cpuLimitLogStore.listPaginated({
          page,
          perPage,
          result: resultFilter || undefined,
        });
        return NextResponse.json({ success: true, data: result });
      }
      case 'listActive': {
        // 当前活跃的 CPU 限制事件（用于展示剩余时间）
        const events = cpuLimitEventStore.listActive();
        return NextResponse.json({ success: true, data: events });
      }
      case 'getAlertConfig': {
        return NextResponse.json({ success: true, data: cpuLimitAlertStore.getConfig() });
      }
      case 'listAlerts': {
        const page = Math.max(1, Number(searchParams.get('page')) || 1);
        const perPage = Math.min(100, Math.max(1, Number(searchParams.get('perPage')) || 50));
        const result = cpuLimitAlertStore.list(page, perPage);
        return NextResponse.json({ success: true, data: result });
      }
      case 'listUnreadAlerts': {
        const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));
        const items = cpuLimitAlertStore.listUnread(limit);
        const unreadCount = cpuLimitAlertStore.countUnread();
        return NextResponse.json({ success: true, data: { items, unreadCount } });
      }
      case 'nodeEventCounts': {
        // 查询节点在时间窗口内的限制次数（前端节点列表展示用）
        const config = cpuLimitAlertStore.getConfig();
        const windowMin = Number(searchParams.get('windowMin')) || config.windowMin;
        const nodeIdsParam = searchParams.get('nodeIds') || '';
        const nodeIds = nodeIdsParam
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => !isNaN(n) && n > 0);
        const sinceTs = Date.now() - windowMin * 60 * 1000;
        const map = cpuLimitEventStore.getNodeEventCounts(nodeIds, sinceTs);
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
        const rule = body.rule as Partial<CpuLimitRule> | undefined;
        if (!rule) return NextResponse.json({ success: false, message: '缺少规则数据' });

        const error = validateRule(rule);
        if (error) return NextResponse.json({ success: false, message: error });

        const ruleData: Omit<CpuLimitRule, 'id' | 'createdAt'> = {
          name: rule.name!.trim(),
          nodeIds: rule.nodeIds!,
          metric: rule.metric as CpuLimitMetric,
          threshold: Number(rule.threshold),
          topN: Number(rule.topN),
          cpuLimitPercent: Number(rule.cpuLimitPercent),
          durationMin: Number(rule.durationMin),
          interval: Number(rule.interval ?? 60),
          cooldown: Number(rule.cooldown ?? 300),
          triggerCount: Number(rule.triggerCount ?? 1),
          enabled: rule.enabled !== false,
          // 节点并发限制上限
          maxActiveInstances: Math.max(0, Number(rule.maxActiveInstances ?? 0)),
          // 惩罚机制
          penaltyEnabled: !!rule.penaltyEnabled,
          penaltyWindowMin: Math.max(1, Number(rule.penaltyWindowMin ?? 60)),
          penaltyThreshold: Math.max(1, Number(rule.penaltyThreshold ?? 2)),
          penaltyMode: (rule.penaltyMode ?? 'multiply') as CpuLimitPenaltyMode,
          penaltyValue: Math.max(1, Number(rule.penaltyValue ?? 2)),
          // CPU 限制值惩罚
          penaltyCpuLimitMode: (rule.penaltyCpuLimitMode ?? 'multiply') as CpuLimitPenaltyMode,
          penaltyCpuLimitValue: Math.max(1, Number(rule.penaltyCpuLimitValue ?? 2)),
          minCpuLimitPercent: Math.max(1, Math.min(100, Number(rule.minCpuLimitPercent ?? 5))),
        };

        let saved: CpuLimitRule;
        if (rule.id) {
          saved = { ...ruleData, id: rule.id, createdAt: rule.createdAt ?? Date.now() };
          cpuLimitRuleStore.update(saved);
          cpuLimitLogStore.append({
            ts: Date.now(),
            ruleId: saved.id,
            ruleName: saved.name,
            nodeId: saved.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_update',
            result: 'success',
          });
        } else {
          saved = { ...ruleData, id: randomUUID(), createdAt: Date.now() };
          cpuLimitRuleStore.create(saved);
          cpuLimitLogStore.append({
            ts: Date.now(),
            ruleId: saved.id,
            ruleName: saved.name,
            nodeId: saved.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_create',
            result: 'success',
          });
        }

        cpuLimitManagerService.restart();
        return NextResponse.json({ success: true, data: saved });
      }

      case 'deleteRule': {
        const ruleId = body.ruleId as string | undefined;
        if (!ruleId) return NextResponse.json({ success: false, message: '缺少规则ID' });
        const rule = cpuLimitRuleStore.get(ruleId);
        cpuLimitRuleStore.delete(ruleId);
        if (rule) {
          cpuLimitLogStore.append({
            ts: Date.now(),
            ruleId,
            ruleName: rule.name,
            nodeId: rule.nodeIds[0] ?? 0,
            nodeName: '系统',
            eventType: 'rule_delete',
            result: 'success',
          });
        }
        cpuLimitManagerService.restart();
        return NextResponse.json({ success: true });
      }

      case 'toggleRule': {
        const ruleId = body.ruleId as string | undefined;
        const enabled = body.enabled as boolean | undefined;
        if (!ruleId || enabled === undefined) return NextResponse.json({ success: false, message: '参数不完整' });
        cpuLimitRuleStore.setEnabled(ruleId, enabled);
        cpuLimitManagerService.restart();
        return NextResponse.json({ success: true });
      }

      case 'clearLogs': {
        cpuLimitLogStore.clear();
        return NextResponse.json({ success: true });
      }

      case 'manualCheck': {
        cpuLimitManagerService.runCheckCycle().catch(err => {
          console.error('[CpuLimitManager] 手动触发检查失败:', err);
        });
        return NextResponse.json({ success: true, message: '已触发检查' });
      }

      case 'startService': {
        cpuLimitManagerService.start();
        return NextResponse.json({ success: true });
      }

      case 'stopService': {
        cpuLimitManagerService.stop();
        return NextResponse.json({ success: true });
      }

      case 'saveAlertConfig': {
        const config = body.config as CpuLimitAlertConfig | undefined;
        if (!config) return NextResponse.json({ success: false, message: '缺少配置数据' });
        if (config.windowMin < 1) return NextResponse.json({ success: false, message: '统计窗口必须≥1分钟' });
        if (config.instanceThreshold < 1) return NextResponse.json({ success: false, message: '实例阈值必须≥1次' });
        if (config.nodeThreshold < 1) return NextResponse.json({ success: false, message: '节点阈值必须≥1次' });
        cpuLimitAlertStore.saveConfig(config);
        return NextResponse.json({ success: true });
      }

      case 'markAllAlertsRead': {
        cpuLimitAlertStore.markAllRead();
        return NextResponse.json({ success: true });
      }

      case 'manualRelease': {
        // 手动解除单个活跃事件（不受重试次数限制）
        const eventId = body.eventId as string | undefined;
        if (!eventId) return NextResponse.json({ success: false, message: '缺少事件ID' });
        const result = await cpuLimitReleaseScheduler.manualRelease(eventId);
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
