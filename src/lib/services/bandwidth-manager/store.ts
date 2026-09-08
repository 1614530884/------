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
  BandwidthAlertConfig,
  BandwidthAlertLog,
  BandwidthAlertLevel,
  BandwidthLimitEvent,
  BandwidthEventStatus,
  BandwidthPenaltyMode,
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
  penalty_enabled: number;
  penalty_window_min: number;
  penalty_threshold: number;
  penalty_mode: string;
  penalty_value: number;
  penalty_bw_mode: string;
  penalty_bw_value: number;
  min_bandwidth_mbps: number;
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

// ─── 事件表行类型 ──────────────────────────────────────────
interface BandwidthEventRow {
  id: string;
  ts: number;
  rule_id: string;
  rule_name: string;
  node_id: number;
  node_name: string;
  cloud_id: number;
  cloud_name: string;
  status: string;
  start_time: number;
  expire_time: number;
  original_in_bw: number | null;
  original_out_bw: number | null;
  new_in_bw: number | null;
  new_out_bw: number | null;
  limit_direction: string | null;
  actual_duration_min: number | null;
  penalized: number;
  release_retry_count: number;
  released_at: number | null;
  release_error: string | null;
}

function rowToEvent(row: BandwidthEventRow): BandwidthLimitEvent {
  return {
    id: row.id,
    ts: row.ts,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    cloudId: row.cloud_id,
    cloudName: row.cloud_name,
    status: row.status as BandwidthEventStatus,
    startTime: row.start_time,
    expireTime: row.expire_time,
    originalInBw: row.original_in_bw,
    originalOutBw: row.original_out_bw,
    newInBw: row.new_in_bw,
    newOutBw: row.new_out_bw,
    limitDirection: (row.limit_direction as 'in' | 'out' | 'both' | null) ?? null,
    actualDurationMin: row.actual_duration_min,
    penalized: row.penalized === 1,
    releaseRetryCount: row.release_retry_count,
    releasedAt: row.released_at,
    releaseError: row.release_error,
  };
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
    penaltyEnabled: (row.penalty_enabled ?? 0) === 1,
    penaltyWindowMin: row.penalty_window_min ?? 60,
    penaltyThreshold: row.penalty_threshold ?? 2,
    penaltyMode: (row.penalty_mode ?? 'multiply') as BandwidthPenaltyMode,
    penaltyValue: row.penalty_value ?? 2,
    penaltyBwMode: (row.penalty_bw_mode ?? 'add_extra') as BandwidthPenaltyMode,
    penaltyBwValue: row.penalty_bw_value ?? 10,
    minBandwidthMbps: row.min_bandwidth_mbps ?? 10,
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
        duration_min, reduce_percent, interval, cooldown, trigger_count, enabled, created_at,
        penalty_enabled, penalty_window_min, penalty_threshold, penalty_mode, penalty_value,
        penalty_bw_mode, penalty_bw_value, min_bandwidth_mbps
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, rule.name, JSON.stringify(rule.nodeIds),
      rule.thresholdUp ?? null, rule.thresholdDown ?? null,
      rule.topN, rule.limitMode, rule.limitValue,
      rule.continuousEnabled ? 1 : 0, rule.continuousWindowMin ?? null, rule.continuousPercent ?? null,
      rule.durationMin, rule.reducePercent, rule.interval, rule.cooldown, rule.triggerCount,
      rule.enabled ? 1 : 0, createdAt,
      rule.penaltyEnabled ? 1 : 0, rule.penaltyWindowMin, rule.penaltyThreshold,
      rule.penaltyMode, rule.penaltyValue,
      rule.penaltyBwMode, rule.penaltyBwValue, rule.minBandwidthMbps,
    );
    return this.getById(id)!;
  },

  update(id: string, rule: Omit<BandwidthRule, 'id' | 'createdAt'>): BandwidthRule | null {
    const db = getDb();
    db.prepare(`
      UPDATE bandwidth_rules SET
        name = ?, node_ids = ?, threshold_up = ?, threshold_down = ?, top_n = ?, limit_mode = ?, limit_value = ?,
        continuous_enabled = ?, continuous_window_min = ?, continuous_percent = ?,
        duration_min = ?, reduce_percent = ?, interval = ?, cooldown = ?, trigger_count = ?, enabled = ?,
        penalty_enabled = ?, penalty_window_min = ?, penalty_threshold = ?, penalty_mode = ?, penalty_value = ?,
        penalty_bw_mode = ?, penalty_bw_value = ?, min_bandwidth_mbps = ?
      WHERE id = ?
    `).run(
      rule.name, JSON.stringify(rule.nodeIds),
      rule.thresholdUp ?? null, rule.thresholdDown ?? null,
      rule.topN, rule.limitMode, rule.limitValue,
      rule.continuousEnabled ? 1 : 0, rule.continuousWindowMin ?? null, rule.continuousPercent ?? null,
      rule.durationMin, rule.reducePercent, rule.interval, rule.cooldown, rule.triggerCount,
      rule.enabled ? 1 : 0,
      rule.penaltyEnabled ? 1 : 0, rule.penaltyWindowMin, rule.penaltyThreshold,
      rule.penaltyMode, rule.penaltyValue,
      rule.penaltyBwMode, rule.penaltyBwValue, rule.minBandwidthMbps,
      id,
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

// ─── 告警配置 + 限速事件 + 告警日志 Store ──────────────────────

function rowToAlertConfig(row: Record<string, unknown>): BandwidthAlertConfig {
  return {
    enabled: !!row.enabled,
    windowMin: Number(row.window_min) || 60,
    instanceThreshold: Number(row.instance_threshold) || 3,
    nodeThreshold: Number(row.node_threshold) || 5,
  };
}

function rowToAlertLog(row: Record<string, unknown>): BandwidthAlertLog {
  return {
    id: String(row.id),
    ts: Number(row.ts),
    level: String(row.level) as BandwidthAlertLevel,
    ruleName: String(row.rule_name),
    nodeId: Number(row.node_id),
    nodeName: String(row.node_name),
    cloudId: row.cloud_id != null ? Number(row.cloud_id) : undefined,
    cloudName: row.cloud_name != null ? String(row.cloud_name) : undefined,
    triggerCount: Number(row.trigger_count),
    threshold: Number(row.threshold),
    windowMin: Number(row.window_min),
    read: !!row.read,
  };
}

export const bandwidthAlertStore = {
  // ── 配置 ──────────────────────────────────────────
  getConfig(): BandwidthAlertConfig {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bandwidth_alert_config WHERE id = ?').get('default') as Record<string, unknown> | undefined;
    if (!row) {
      // 默认配置：未启用，60分钟窗口，实例3次，节点5次
      return { enabled: false, windowMin: 60, instanceThreshold: 3, nodeThreshold: 5 };
    }
    return rowToAlertConfig(row);
  },

  saveConfig(config: BandwidthAlertConfig): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO bandwidth_alert_config (id, enabled, window_min, instance_threshold, node_threshold)
      VALUES ('default', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        enabled = excluded.enabled,
        window_min = excluded.window_min,
        instance_threshold = excluded.instance_threshold,
        node_threshold = excluded.node_threshold
    `).run(
      config.enabled ? 1 : 0,
      config.windowMin,
      config.instanceThreshold,
      config.nodeThreshold,
    );
  },

  // ── 限速事件 ──────────────────────────────────────
  /** 创建活跃限速事件（含原始带宽、限速值、到期时间等完整信息，供 release-scheduler 跟踪） */
  createEvent(event: Omit<BandwidthLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>): void {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO bandwidth_limit_events (
        id, ts, rule_id, rule_name, node_id, node_name, cloud_id, cloud_name,
        status, start_time, expire_time,
        original_in_bw, original_out_bw, new_in_bw, new_out_bw,
        limit_direction, actual_duration_min, penalized, release_retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id, event.ts, event.ruleId, event.ruleName, event.nodeId, event.nodeName, event.cloudId, event.cloudName,
      'active', event.startTime ?? event.ts, event.expireTime ?? 0,
      event.originalInBw ?? null, event.originalOutBw ?? null, event.newInBw ?? null, event.newOutBw ?? null,
      event.limitDirection ?? null, event.actualDurationMin ?? null, event.penalized ? 1 : 0,
    );
  },

  /** 兼容旧接口：recordEvent → createEvent（仅基础字段，无到期恢复信息） */
  recordEvent(input: Omit<BandwidthLimitEvent, 'id'>): void {
    this.createEvent({
      ts: input.ts,
      ruleId: input.ruleId,
      ruleName: input.ruleName,
      nodeId: input.nodeId,
      nodeName: input.nodeName,
      cloudId: input.cloudId,
      cloudName: input.cloudName,
    });
  },

  /** 统计时间窗口内某实例的限速次数 */
  countEventsByCloud(cloudId: number, sinceTs: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM bandwidth_limit_events WHERE cloud_id = ? AND ts >= ?'
    ).get(cloudId, sinceTs) as { cnt: number };
    return row.cnt;
  },

  /** 批量统计多实例在时间窗口内的限速次数（一次 SQL，避免逐个查询） */
  countCloudEventsInWindowBatch(cloudIds: number[], sinceTs: number): Map<number, number> {
    const result = new Map<number, number>();
    if (cloudIds.length === 0) return result;
    const db = getDb();
    const placeholders = cloudIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT cloud_id, COUNT(*) as cnt FROM bandwidth_limit_events WHERE cloud_id IN (${placeholders}) AND ts >= ? GROUP BY cloud_id`
    ).all(...cloudIds, sinceTs) as Array<{ cloud_id: number; cnt: number }>;
    for (const r of rows) {
      result.set(r.cloud_id, r.cnt);
    }
    return result;
  },

  /** 统计时间窗口内某节点的限速次数（所有实例） */
  countEventsByNode(nodeId: number, sinceTs: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM bandwidth_limit_events WHERE node_id = ? AND ts >= ?'
    ).get(nodeId, sinceTs) as { cnt: number };
    return row.cnt;
  },

  /** 清理过期限速事件（超过指定时间戳的） */
  cleanExpiredEvents(beforeTs: number): void {
    const db = getDb();
    db.prepare('DELETE FROM bandwidth_limit_events WHERE ts < ? AND status != ?').run(beforeTs, 'active');
  },

  // ── 活跃事件管理（release-scheduler 使用） ──────────

  /** 获取当前活跃限制的实例信息：key=cloudId
   *  用于限速内再惩罚（保留真实原始带宽）+ 到期恢复 */
  getActiveLimits(): Map<number, {
    inBw: number; outBw: number; expireTime: number; eventId: string;
    actualDurationMin?: number; limitDirection?: 'in' | 'out' | 'both';
    originalInBw?: number; originalOutBw?: number;
  }> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, cloud_id, new_in_bw, new_out_bw, expire_time, actual_duration_min, limit_direction, original_in_bw, original_out_bw FROM bandwidth_limit_events WHERE status = ?'
    ).all('active') as Array<{
      id: string; cloud_id: number; new_in_bw: number | null; new_out_bw: number | null;
      expire_time: number; actual_duration_min: number | null; limit_direction: string | null;
      original_in_bw: number | null; original_out_bw: number | null;
    }>;
    const map = new Map<number, {
      inBw: number; outBw: number; expireTime: number; eventId: string;
      actualDurationMin?: number; limitDirection?: 'in' | 'out' | 'both';
      originalInBw?: number; originalOutBw?: number;
    }>();
    for (const r of rows) {
      const existing = map.get(r.cloud_id);
      if (!existing || r.expire_time > existing.expireTime) {
        map.set(r.cloud_id, {
          inBw: r.new_in_bw ?? 0,
          outBw: r.new_out_bw ?? 0,
          expireTime: r.expire_time,
          eventId: r.id,
          actualDurationMin: r.actual_duration_min ?? undefined,
          limitDirection: (r.limit_direction as 'in' | 'out' | 'both' | null) ?? undefined,
          originalInBw: r.original_in_bw ?? undefined,
          originalOutBw: r.original_out_bw ?? undefined,
        });
      }
    }
    return map;
  },

  /** 列出所有活跃事件（按到期时间升序，供前端展示） */
  listActiveEvents(): BandwidthLimitEvent[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM bandwidth_limit_events WHERE status = ? ORDER BY expire_time ASC').all('active') as BandwidthEventRow[];
    return rows.map(rowToEvent);
  },

  /** 查询到期需解除的事件 */
  listExpiredEvents(now: number): BandwidthLimitEvent[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM bandwidth_limit_events WHERE status = ? AND expire_time <= ?').all('active', now) as BandwidthEventRow[];
    return rows.map(rowToEvent);
  },

  /** 标记事件已解除（仅对 active 状态生效，避免覆盖 superseded） */
  markReleased(id: string, releasedAt: number, error?: string): void {
    const db = getDb();
    const status: BandwidthEventStatus = error ? 'failed' : 'released';
    db.prepare(`
      UPDATE bandwidth_limit_events SET status = ?, released_at = ?, release_error = ? WHERE id = ? AND status = 'active'
    `).run(status, releasedAt, error ?? null, id);
  },

  /** 标记事件已被新限制替代（仅对 active 状态生效，避免覆盖已 released 的状态） */
  markSuperseded(id: string, supersededAt: number): void {
    const db = getDb();
    db.prepare(`
      UPDATE bandwidth_limit_events SET status = ?, released_at = ? WHERE id = ? AND status = 'active'
    `).run('superseded', supersededAt, id);
  },

  /** 原子性替换事件：标记旧事件为 superseded + 创建新 active 事件（事务保证一致性） */
  replaceEvents(
    supersededIds: string[],
    newEvents: Array<Omit<BandwidthLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>>,
  ): void {
    if (supersededIds.length === 0 && newEvents.length === 0) return;
    const db = getDb();
    const txn = db.transaction(() => {
      const now = Date.now();
      for (const id of supersededIds) {
        this.markSuperseded(id, now);
      }
      for (const evt of newEvents) {
        this.createEvent(evt);
      }
    });
    txn();
  },

  /** 更新解除重试次数（仅对 active 状态生效） */
  incrementRetryCount(id: string): number {
    const db = getDb();
    db.prepare('UPDATE bandwidth_limit_events SET release_retry_count = release_retry_count + 1 WHERE id = ? AND status = ?').run(id, 'active');
    const row = db.prepare('SELECT release_retry_count as cnt FROM bandwidth_limit_events WHERE id = ?').get(id) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  },

  /** 更新事件到期时间（用于退避延迟控制） */
  updateEventExpireTime(id: string, newExpireTime: number): void {
    const db = getDb();
    db.prepare('UPDATE bandwidth_limit_events SET expire_time = ? WHERE id = ? AND status = ?').run(newExpireTime, id, 'active');
  },

  /** 获取单个事件 */
  getEventById(id: string): BandwidthLimitEvent | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bandwidth_limit_events WHERE id = ?').get(id) as BandwidthEventRow | undefined;
    return row ? rowToEvent(row) : null;
  },

  /** 统计活跃事件数 */
  countActiveEvents(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM bandwidth_limit_events WHERE status = ?').get('active') as { cnt: number };
    return row.cnt;
  },

  /** 查询节点在时间窗口内的限速次数（前端展示用） */
  getNodeEventCounts(nodeIds: number[], sinceTs: number): Map<number, number> {
    const db = getDb();
    const result = new Map<number, number>();
    if (nodeIds.length === 0) return result;
    const placeholders = nodeIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT node_id, COUNT(*) as cnt FROM bandwidth_limit_events WHERE node_id IN (${placeholders}) AND ts >= ? GROUP BY node_id`
    ).all(...nodeIds, sinceTs) as Array<{ node_id: number; cnt: number }>;
    for (const r of rows) {
      result.set(r.node_id, r.cnt);
    }
    return result;
  },

  // ── 告警日志 ──────────────────────────────────────
  appendAlert(input: {
    level: BandwidthAlertLevel;
    ruleName: string;
    nodeId: number;
    nodeName: string;
    cloudId?: number;
    cloudName?: string;
    triggerCount: number;
    threshold: number;
    windowMin: number;
  }): BandwidthAlertLog {
    const db = getDb();
    const id = randomUUID();
    const ts = Date.now();
    db.prepare(`
      INSERT INTO bandwidth_alert_logs (id, ts, level, rule_name, node_id, node_name, cloud_id, cloud_name, trigger_count, threshold, window_min, read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id, ts, input.level, input.ruleName,
      input.nodeId, input.nodeName,
      input.cloudId ?? null, input.cloudName ?? null,
      input.triggerCount, input.threshold, input.windowMin,
    );
    return {
      id, ts, level: input.level, ruleName: input.ruleName,
      nodeId: input.nodeId, nodeName: input.nodeName,
      cloudId: input.cloudId, cloudName: input.cloudName,
      triggerCount: input.triggerCount, threshold: input.threshold,
      windowMin: input.windowMin, read: false,
    };
  },

  /** 查询未读告警列表（最新的 limit 条） */
  listUnread(limit = 20): BandwidthAlertLog[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM bandwidth_alert_logs WHERE read = 0 ORDER BY ts DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map(rowToAlertLog);
  },

  /** 查询告警列表（分页） */
  list(page = 1, perPage = 50): { items: BandwidthAlertLog[]; total: number } {
    const db = getDb();
    const offset = (page - 1) * perPage;
    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM bandwidth_alert_logs').get() as { cnt: number };
    const rows = db.prepare(
      'SELECT * FROM bandwidth_alert_logs ORDER BY ts DESC LIMIT ? OFFSET ?'
    ).all(perPage, offset) as Record<string, unknown>[];
    return { items: rows.map(rowToAlertLog), total: totalRow.cnt };
  },

  /** 未读告警数量 */
  countUnread(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM bandwidth_alert_logs WHERE read = 0').get() as { cnt: number };
    return row.cnt;
  },

  /** 标记所有告警为已读 */
  markAllRead(): void {
    const db = getDb();
    db.prepare('UPDATE bandwidth_alert_logs SET read = 1 WHERE read = 0').run();
  },
};
