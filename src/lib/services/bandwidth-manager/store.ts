/**
 * 智能带宽管理 - SQLite 存储层
 *
 * 复用 server-tools 的 getDb() 单例，操作 bandwidth_rules 和 bandwidth_logs 两张表。
 * 规则和日志均为全局数据（无 owner 隔离，与现有节点监控一致）。
 */
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/services/server-tools/db';
import type {
  BandwidthRule,
  BandwidthLog,
  BandwidthInstanceResult,
  BandwidthEventType,
  BandwidthResult,
} from './types';

// ─── 内部行类型（DB 字段名 snake_case） ──────────────────────
interface BandwidthRuleRow {
  id: string;
  name: string;
  node_ids: string;
  threshold_up: number | null;
  threshold_down: number | null;
  top_n: number;
  limit_mode: string;
  limit_value: number;
  continuous_enabled: number;
  continuous_window_min: number | null;
  continuous_percent: number | null;
  duration_min: number;
  reduce_percent: number;
  interval: number;
  cooldown: number;
  trigger_count: number;
  enabled: number;
  created_at: number;
}

interface BandwidthLogRow {
  id: string;
  ts: number;
  rule_id: string;
  rule_name: string;
  node_id: number;
  node_name: string;
  event_type: string;
  metric_value: number | null;
  metric_value_up: number | null;
  metric_value_down: number | null;
  top_n: number | null;
  affected_count: number | null;
  details: string | null;
  result: string;
  error: string | null;
}

// ─── 行→对象转换 ──────────────────────────────────────────
function rowToRule(row: BandwidthRuleRow): BandwidthRule {
  return {
    id: row.id,
    name: row.name,
    nodeIds: JSON.parse(row.node_ids) as number[],
    thresholdUp: row.threshold_up ?? undefined,
    thresholdDown: row.threshold_down ?? undefined,
    topN: row.top_n,
    limitMode: row.limit_mode as BandwidthRule['limitMode'],
    limitValue: row.limit_value,
    continuousEnabled: row.continuous_enabled === 1,
    continuousWindowMin: row.continuous_window_min ?? undefined,
    continuousPercent: row.continuous_percent ?? undefined,
    durationMin: row.duration_min,
    reducePercent: row.reduce_percent,
    interval: row.interval,
    cooldown: row.cooldown,
    triggerCount: row.trigger_count,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
  };
}

function rowToLog(row: BandwidthLogRow): BandwidthLog {
  return {
    id: row.id,
    ts: row.ts,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    eventType: row.event_type as BandwidthEventType,
    metricValue: row.metric_value ?? undefined,
    metricValueUp: row.metric_value_up ?? undefined,
    metricValueDown: row.metric_value_down ?? undefined,
    topN: row.top_n ?? undefined,
    affectedCount: row.affected_count ?? undefined,
    details: row.details ? JSON.parse(row.details) as BandwidthLog['details'] : undefined,
    result: row.result as BandwidthResult,
    error: row.error ?? undefined,
  };
}

// ─── 带宽规则 Store ────────────────────────────────────────
export const bandwidthRuleStore = {
  list(): BandwidthRule[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM bandwidth_rules ORDER BY created_at ASC').all() as BandwidthRuleRow[];
    return rows.map(rowToRule);
  },

  getById(id: string): BandwidthRule | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bandwidth_rules WHERE id = ?').get(id) as BandwidthRuleRow | undefined;
    return row ? rowToRule(row) : null;
  },

  listEnabled(): BandwidthRule[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM bandwidth_rules WHERE enabled = 1 ORDER BY created_at ASC').all() as BandwidthRuleRow[];
    return rows.map(rowToRule);
  },

  create(rule: Omit<BandwidthRule, 'id' | 'createdAt'>): BandwidthRule {
    const db = getDb();
    const id = randomUUID();
    const createdAt = Date.now();
    db.prepare(`
      INSERT INTO bandwidth_rules (
        id, name, node_ids, threshold_up, threshold_down, top_n, limit_mode, limit_value,
        continuous_enabled, continuous_window_min, continuous_percent,
        duration_min, reduce_percent, interval, cooldown, trigger_count, enabled, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, rule.name, JSON.stringify(rule.nodeIds),
      rule.thresholdUp ?? null, rule.thresholdDown ?? null,
      rule.topN, rule.limitMode, rule.limitValue,
      rule.continuousEnabled ? 1 : 0, rule.continuousWindowMin ?? null, rule.continuousPercent ?? null,
      rule.durationMin, rule.reducePercent, rule.interval, rule.cooldown, rule.triggerCount,
      rule.enabled ? 1 : 0, createdAt,
    );
    return this.getById(id)!;
  },

  update(id: string, rule: Omit<BandwidthRule, 'id' | 'createdAt'>): BandwidthRule | null {
    const db = getDb();
    db.prepare(`
      UPDATE bandwidth_rules SET
        name = ?, node_ids = ?, threshold_up = ?, threshold_down = ?, top_n = ?, limit_mode = ?, limit_value = ?,
        continuous_enabled = ?, continuous_window_min = ?, continuous_percent = ?,
        duration_min = ?, reduce_percent = ?, interval = ?, cooldown = ?, trigger_count = ?, enabled = ?
      WHERE id = ?
    `).run(
      rule.name, JSON.stringify(rule.nodeIds),
      rule.thresholdUp ?? null, rule.thresholdDown ?? null,
      rule.topN, rule.limitMode, rule.limitValue,
      rule.continuousEnabled ? 1 : 0, rule.continuousWindowMin ?? null, rule.continuousPercent ?? null,
      rule.durationMin, rule.reducePercent, rule.interval, rule.cooldown, rule.triggerCount,
      rule.enabled ? 1 : 0, id,
    );
    return this.getById(id);
  },

  delete(id: string): boolean {
    const db = getDb();
    const result = db.prepare('DELETE FROM bandwidth_rules WHERE id = ?').run(id);
    return result.changes > 0;
  },

  setEnabled(id: string, enabled: boolean): void {
    const db = getDb();
    db.prepare('UPDATE bandwidth_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },
};

// ─── 带宽日志 Store ────────────────────────────────────────
export const bandwidthLogStore = {
  append(input: {
    ruleId: string;
    ruleName: string;
    nodeId: number;
    nodeName: string;
    eventType: BandwidthEventType;
    metricValue?: number;
    metricValueUp?: number;
    metricValueDown?: number;
    topN?: number;
    affectedCount?: number;
    instances?: BandwidthInstanceResult[];
    taskId?: string;
    /** 触发时规则的上行阈值（bps），历史快照 */
    thresholdUp?: number;
    /** 触发时规则的下行阈值（bps），历史快照 */
    thresholdDown?: number;
    /** 触发方向：up/down/both */
    triggerDirection?: 'up' | 'down' | 'both';
    result: BandwidthResult;
    error?: string;
  }): BandwidthLog {
    const db = getDb();
    const id = randomUUID();
    const ts = Date.now();
    const details: BandwidthLog['details'] = {};
    if (input.instances && input.instances.length > 0) {
      details.instances = input.instances;
    }
    if (input.taskId) {
      details.taskId = input.taskId;
    }
    if (input.thresholdUp !== undefined) {
      details.thresholdUp = input.thresholdUp;
    }
    if (input.thresholdDown !== undefined) {
      details.thresholdDown = input.thresholdDown;
    }
    if (input.triggerDirection) {
      details.triggerDirection = input.triggerDirection;
    }
    db.prepare(`
      INSERT INTO bandwidth_logs (
        id, ts, rule_id, rule_name, node_id, node_name, event_type,
        metric_value, metric_value_up, metric_value_down, top_n, affected_count, details, result, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, ts, input.ruleId, input.ruleName, input.nodeId, input.nodeName, input.eventType,
      input.metricValue ?? null, input.metricValueUp ?? null, input.metricValueDown ?? null,
      input.topN ?? null, input.affectedCount ?? null,
      Object.keys(details).length > 0 ? JSON.stringify(details) : null,
      input.result, input.error ?? null,
    );
    return this.getByIdInternal(id)!;
  },

  list(options?: {
    ruleId?: string;
    nodeId?: number;
    eventType?: BandwidthEventType;
    result?: BandwidthResult;
    page?: number;
    perPage?: number;
  }): { items: BandwidthLog[]; total: number; page: number; perPage: number } {
    const db = getDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (options?.ruleId) {
      conditions.push('rule_id = ?');
      params.push(options.ruleId);
    }
    if (options?.nodeId) {
      conditions.push('node_id = ?');
      params.push(options.nodeId);
    }
    if (options?.eventType) {
      conditions.push('event_type = ?');
      params.push(options.eventType);
    }
    if (options?.result) {
      conditions.push('result = ?');
      params.push(options.result);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = Math.max(1, options?.page ?? 1);
    const perPage = Math.min(100, Math.max(1, options?.perPage ?? 50));
    const offset = (page - 1) * perPage;

    const totalRow = db.prepare(`SELECT COUNT(*) as cnt FROM bandwidth_logs ${where}`).get(...params) as { cnt: number };
    const total = totalRow.cnt;
    const rows = db.prepare(
      `SELECT * FROM bandwidth_logs ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    ).all(...params, perPage, offset) as BandwidthLogRow[];

    return { items: rows.map(rowToLog), total, page, perPage };
  },

  getByIdInternal(id: string): BandwidthLog | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bandwidth_logs WHERE id = ?').get(id) as BandwidthLogRow | undefined;
    return row ? rowToLog(row) : null;
  },

  clear(): void {
    const db = getDb();
    db.prepare('DELETE FROM bandwidth_logs').run();
  },
};
