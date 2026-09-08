/**
 * CPU 限制管理 - 数据库存取层
 *
 * 三张表：
 * - cpu_limit_rules: 规则配置
 * - cpu_limit_events: 活跃事件（用于到期自动解除）
 * - cpu_limit_logs: 操作日志
 */
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/services/server-tools/db';
import type {
  CpuLimitRule,
  CpuLimitEvent,
  CpuLimitLog,
  CpuLimitMetric,
  CpuLimitEventType,
  CpuLimitResult,
  CpuLimitEventStatus,
  CpuLimitPenaltyMode,
  CpuLimitAlertConfig,
  CpuLimitAlertLog,
  CpuLimitAlertLevel,
} from './types';

// ─── 规则表行类型（DB snake_case） ───────────────────────────
interface CpuLimitRuleRow {
  id: string;
  name: string;
  node_ids: string;
  metric: string;
  threshold: number;
  top_n: number;
  cpu_limit_percent: number;
  duration_min: number;
  interval: number;
  cooldown: number;
  trigger_count: number;
  enabled: number;
  created_at: number;
  // 旧字段（保留兼容，不再使用）：max_instances_per_window, limit_window_min
  max_instances_per_window?: number;
  limit_window_min?: number;
  max_active_instances: number;
  penalty_enabled: number;
  penalty_window_min: number;
  penalty_threshold: number;
  penalty_mode: string;
  penalty_value: number;
  penalty_cpu_limit_mode: string;
  penalty_cpu_limit_value: number;
  min_cpu_limit_percent: number;
}

function rowToRule(row: CpuLimitRuleRow): CpuLimitRule {
  let nodeIds: number[] = [];
  try {
    const parsed = JSON.parse(row.node_ids);
    if (Array.isArray(parsed)) nodeIds = parsed.map(Number).filter(n => !isNaN(n));
  } catch { /* ignore */ }
  return {
    id: row.id,
    name: row.name,
    nodeIds,
    metric: row.metric as CpuLimitMetric,
    threshold: row.threshold,
    topN: row.top_n,
    cpuLimitPercent: row.cpu_limit_percent,
    durationMin: row.duration_min,
    interval: row.interval,
    cooldown: row.cooldown,
    triggerCount: row.trigger_count,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    // 优先使用新字段 max_active_instances，fallback 到旧字段
    maxActiveInstances: row.max_active_instances ?? row.max_instances_per_window ?? 0,
    penaltyEnabled: row.penalty_enabled === 1,
    penaltyWindowMin: row.penalty_window_min ?? 60,
    penaltyThreshold: row.penalty_threshold ?? 2,
    penaltyMode: (row.penalty_mode ?? 'multiply') as CpuLimitPenaltyMode,
    penaltyValue: row.penalty_value ?? 2,
    penaltyCpuLimitMode: (row.penalty_cpu_limit_mode ?? 'multiply') as CpuLimitPenaltyMode,
    penaltyCpuLimitValue: row.penalty_cpu_limit_value ?? 2,
    minCpuLimitPercent: row.min_cpu_limit_percent ?? 5,
  };
}

function ruleToRow(rule: CpuLimitRule): CpuLimitRuleRow {
  return {
    id: rule.id,
    name: rule.name,
    node_ids: JSON.stringify(rule.nodeIds),
    metric: rule.metric,
    threshold: rule.threshold,
    top_n: rule.topN,
    cpu_limit_percent: rule.cpuLimitPercent,
    duration_min: rule.durationMin,
    interval: rule.interval,
    cooldown: rule.cooldown,
    trigger_count: rule.triggerCount,
    enabled: rule.enabled ? 1 : 0,
    created_at: rule.createdAt,
    max_active_instances: rule.maxActiveInstances ?? 0,
    penalty_enabled: rule.penaltyEnabled ? 1 : 0,
    penalty_window_min: rule.penaltyWindowMin ?? 60,
    penalty_threshold: rule.penaltyThreshold ?? 2,
    penalty_mode: rule.penaltyMode ?? 'multiply',
    penalty_value: rule.penaltyValue ?? 2,
    penalty_cpu_limit_mode: rule.penaltyCpuLimitMode ?? 'multiply',
    penalty_cpu_limit_value: rule.penaltyCpuLimitValue ?? 2,
    min_cpu_limit_percent: rule.minCpuLimitPercent ?? 5,
  };
}

// ─── 事件表行类型 ──────────────────────────────────────────
interface CpuLimitEventRow {
  id: string;
  rule_id: string;
  rule_name: string;
  node_id: number;
  node_name: string;
  cloud_id: number;
  cloud_name: string;
  cpu_limit_percent: number;
  start_time: number;
  expire_time: number;
  status: string;
  released_at: number | null;
  release_error: string | null;
  actual_duration_min: number | null;
  penalized: number | null;
  release_retry_count: number | null;
}

function rowToEvent(row: CpuLimitEventRow): CpuLimitEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    cloudId: row.cloud_id,
    cloudName: row.cloud_name,
    cpuLimitPercent: row.cpu_limit_percent,
    startTime: row.start_time,
    expireTime: row.expire_time,
    status: row.status as CpuLimitEventStatus,
    releasedAt: row.released_at ?? undefined,
    releaseError: row.release_error ?? undefined,
    actualDurationMin: row.actual_duration_min ?? undefined,
    penalized: row.penalized === 1,
    releaseRetryCount: row.release_retry_count ?? 0,
  };
}

// ─── 日志表行类型 ──────────────────────────────────────────
interface CpuLimitLogRow {
  id: string;
  ts: number;
  rule_id: string;
  rule_name: string;
  node_id: number;
  node_name: string;
  event_type: string;
  metric_value: number | null;
  threshold: number | null;
  top_n: number | null;
  affected_count: number | null;
  details: string | null;
  result: string;
  error: string | null;
}

function rowToLog(row: CpuLimitLogRow): CpuLimitLog {
  return {
    id: row.id,
    ts: row.ts,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    eventType: row.event_type as CpuLimitEventType,
    metricValue: row.metric_value ?? undefined,
    threshold: row.threshold ?? undefined,
    topN: row.top_n ?? undefined,
    affectedCount: row.affected_count ?? undefined,
    details: row.details ?? undefined,
    result: row.result as CpuLimitResult,
    error: row.error ?? undefined,
  };
}

// ─── 规则 Store ────────────────────────────────────────────
export const cpuLimitRuleStore = {
  list(): CpuLimitRule[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cpu_limit_rules ORDER BY created_at ASC').all() as CpuLimitRuleRow[];
    return rows.map(rowToRule);
  },

  listEnabled(): CpuLimitRule[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cpu_limit_rules WHERE enabled = 1 ORDER BY created_at ASC').all() as CpuLimitRuleRow[];
    return rows.map(rowToRule);
  },

  get(id: string): CpuLimitRule | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cpu_limit_rules WHERE id = ?').get(id) as CpuLimitRuleRow | undefined;
    return row ? rowToRule(row) : null;
  },

  create(rule: CpuLimitRule): void {
    const db = getDb();
    const row = ruleToRow(rule);
    db.prepare(`
      INSERT INTO cpu_limit_rules (
        id, name, node_ids, metric, threshold, top_n, cpu_limit_percent,
        duration_min, interval, cooldown, trigger_count, enabled, created_at,
        max_active_instances,
        penalty_enabled, penalty_window_min, penalty_threshold, penalty_mode, penalty_value,
        penalty_cpu_limit_mode, penalty_cpu_limit_value, min_cpu_limit_percent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      row.id, row.name, row.node_ids, row.metric, row.threshold, row.top_n, row.cpu_limit_percent,
      row.duration_min, row.interval, row.cooldown, row.trigger_count, row.enabled, row.created_at,
      row.max_active_instances,
      row.penalty_enabled, row.penalty_window_min, row.penalty_threshold, row.penalty_mode, row.penalty_value,
      row.penalty_cpu_limit_mode, row.penalty_cpu_limit_value, row.min_cpu_limit_percent,
    );
  },

  update(rule: CpuLimitRule): void {
    const db = getDb();
    const row = ruleToRow(rule);
    db.prepare(`
      UPDATE cpu_limit_rules SET
        name = ?, node_ids = ?, metric = ?, threshold = ?, top_n = ?,
        cpu_limit_percent = ?, duration_min = ?, interval = ?, cooldown = ?,
        trigger_count = ?, enabled = ?,
        max_active_instances = ?,
        penalty_enabled = ?, penalty_window_min = ?, penalty_threshold = ?, penalty_mode = ?, penalty_value = ?,
        penalty_cpu_limit_mode = ?, penalty_cpu_limit_value = ?, min_cpu_limit_percent = ?
      WHERE id = ?
    `).run(
      row.name, row.node_ids, row.metric, row.threshold, row.top_n,
      row.cpu_limit_percent, row.duration_min, row.interval, row.cooldown,
      row.trigger_count, row.enabled,
      row.max_active_instances,
      row.penalty_enabled, row.penalty_window_min, row.penalty_threshold, row.penalty_mode, row.penalty_value,
      row.penalty_cpu_limit_mode, row.penalty_cpu_limit_value, row.min_cpu_limit_percent,
      row.id,
    );
  },

  delete(id: string): void {
    const db = getDb();
    db.prepare('DELETE FROM cpu_limit_rules WHERE id = ?').run(id);
  },

  setEnabled(id: string, enabled: boolean): void {
    const db = getDb();
    db.prepare('UPDATE cpu_limit_rules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  },
};

// ─── 事件 Store（活跃/已解除的 CPU 限制事件） ────────────────
export const cpuLimitEventStore = {
  /** 获取当前活跃限制的实例信息：key=cloudId, value={cpuLimit, expireTime, eventId}
   *  用于实现"限速时间内再次触发则惩罚"：基于当前实际限制值进一步降低 */
  getActiveLimits(): Map<number, { cpuLimit: number; expireTime: number; eventId: string; actualDurationMin?: number }> {
    const db = getDb();
    const rows = db.prepare(
      'SELECT id, cloud_id, cpu_limit_percent, expire_time, actual_duration_min FROM cpu_limit_events WHERE status = ?'
    ).all('active') as Array<{ id: string; cloud_id: number; cpu_limit_percent: number; expire_time: number; actual_duration_min: number | null }>;
    const map = new Map<number, { cpuLimit: number; expireTime: number; eventId: string; actualDurationMin?: number }>();
    for (const r of rows) {
      // 同一 cloudId 理论上只有一条 active，若有重复取到期时间最晚的
      const existing = map.get(r.cloud_id);
      if (!existing || r.expire_time > existing.expireTime) {
        map.set(r.cloud_id, {
          cpuLimit: r.cpu_limit_percent,
          expireTime: r.expire_time,
          eventId: r.id,
          actualDurationMin: r.actual_duration_min ?? undefined,
        });
      }
    }
    return map;
  },

  /** 列出所有活跃事件（按到期时间升序，便于展示剩余时间） */
  listActive(): CpuLimitEvent[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cpu_limit_events WHERE status = ? ORDER BY expire_time ASC').all('active') as CpuLimitEventRow[];
    return rows.map(rowToEvent);
  },

  /** 查询到期需解除的事件 */
  listExpired(now: number): CpuLimitEvent[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cpu_limit_events WHERE status = ? AND expire_time <= ?').all('active', now) as CpuLimitEventRow[];
    return rows.map(rowToEvent);
  },

  /** 创建活跃事件 */
  create(event: Omit<CpuLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>): CpuLimitEvent {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO cpu_limit_events (
        id, rule_id, rule_name, node_id, node_name, cloud_id, cloud_name,
        cpu_limit_percent, start_time, expire_time, status,
        actual_duration_min, penalized, release_retry_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      id, event.ruleId, event.ruleName, event.nodeId, event.nodeName, event.cloudId, event.cloudName,
      event.cpuLimitPercent, event.startTime, event.expireTime, 'active',
      event.actualDurationMin ?? null, event.penalized ? 1 : 0,
    );
    return { ...event, id, status: 'active', releaseRetryCount: 0 };
  },

  /** 标记事件已解除 */
  markReleased(id: string, releasedAt: number, error?: string): void {
    const db = getDb();
    const status: CpuLimitEventStatus = error ? 'failed' : 'released';
    db.prepare(`
      UPDATE cpu_limit_events SET status = ?, released_at = ?, release_error = ? WHERE id = ?
    `).run(status, releasedAt, error ?? null, id);
  },

  /** 标记事件已被新限制替代（不调用 release API，避免覆盖新限制值） */
  markSuperseded(id: string, supersededAt: number): void {
    const db = getDb();
    db.prepare(`
      UPDATE cpu_limit_events SET status = ?, released_at = ? WHERE id = ?
    `).run('superseded', supersededAt, id);
  },

  /** 原子性替换事件：标记旧事件为 superseded + 创建新 active 事件
   *  使用事务保证一致性，避免"旧事件已 superseded 但新事件未创建"导致实例永久被限制
   *  better-sqlite3 的 transaction 支持嵌套（savepoint），可安全调用内部方法
   */
  replaceEvents(
    supersededIds: string[],
    newEvents: Array<Omit<CpuLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>>,
  ): void {
    if (supersededIds.length === 0 && newEvents.length === 0) return;
    const db = getDb();
    const txn = db.transaction(() => {
      const now = Date.now();
      for (const id of supersededIds) {
        this.markSuperseded(id, now);
      }
      for (const evt of newEvents) {
        this.create(evt);
      }
    });
    txn();
  },

  /** 更新解除重试次数 */
  incrementRetryCount(id: string): number {
    const db = getDb();
    db.prepare('UPDATE cpu_limit_events SET release_retry_count = release_retry_count + 1 WHERE id = ?').run(id);
    const row = db.prepare('SELECT release_retry_count as cnt FROM cpu_limit_events WHERE id = ?').get(id) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  },

  /** 获取单个事件 */
  getById(id: string): CpuLimitEvent | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cpu_limit_events WHERE id = ?').get(id) as CpuLimitEventRow | undefined;
    return row ? rowToEvent(row) : null;
  },

  /** 统计活跃事件数 */
  countActive(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM cpu_limit_events WHERE status = ?').get('active') as { cnt: number };
    return row.cnt;
  },

  /** 统计规则+节点在时间窗口内的限制事件数（用于告警统计） */
  countRuleNodeEventsInWindow(ruleId: string, nodeId: number, sinceTs: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM cpu_limit_events WHERE rule_id = ? AND node_id = ? AND start_time >= ?'
    ).get(ruleId, nodeId, sinceTs) as { cnt: number };
    return row.cnt;
  },

  /** 统计规则+节点当前正在限制的实例数（用于节点并发限制上限判断）
   *  只统计 status='active' 的事件，反映瞬时并发数 */
  countActiveByRuleNode(ruleId: string, nodeId: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM cpu_limit_events WHERE rule_id = ? AND node_id = ? AND status = ?'
    ).get(ruleId, nodeId, 'active') as { cnt: number };
    return row.cnt;
  },

  /** 统计时间窗口内某实例的被限制次数（含 active/superseded/released） */
  countCloudEventsInWindow(cloudId: number, sinceTs: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM cpu_limit_events WHERE cloud_id = ? AND start_time >= ?'
    ).get(cloudId, sinceTs) as { cnt: number };
    return row.cnt;
  },

  /** 批量统计时间窗口内多个实例的被限制次数（避免逐个查询）
   *  返回 Map<cloudId, count>，未在结果中的 cloudId 表示 0 次 */
  countCloudEventsInWindowBatch(cloudIds: number[], sinceTs: number): Map<number, number> {
    const result = new Map<number, number>();
    if (cloudIds.length === 0) return result;
    const db = getDb();
    const placeholders = cloudIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT cloud_id, COUNT(*) as cnt FROM cpu_limit_events WHERE cloud_id IN (${placeholders}) AND start_time >= ? GROUP BY cloud_id`
    ).all(...cloudIds, sinceTs) as Array<{ cloud_id: number; cnt: number }>;
    for (const r of rows) {
      result.set(r.cloud_id, r.cnt);
    }
    return result;
  },

  /** 统计节点在时间窗口内被限制的次数（用于告警判断） */
  countNodeEventsInWindow(nodeId: number, sinceTs: number): number {
    const db = getDb();
    const row = db.prepare(
      'SELECT COUNT(*) as cnt FROM cpu_limit_events WHERE node_id = ? AND start_time >= ?'
    ).get(nodeId, sinceTs) as { cnt: number };
    return row.cnt;
  },

  /** 统计实例在时间窗口内被限制的次数（用于告警判断，与 countCloudEventsInWindow 相同） */
  countEventsByCloud(cloudId: number, sinceTs: number): number {
    return this.countCloudEventsInWindow(cloudId, sinceTs);
  },

  /** 统计节点在时间窗口内被限制的次数（用于告警判断） */
  countEventsByNode(nodeId: number, sinceTs: number): number {
    return this.countNodeEventsInWindow(nodeId, sinceTs);
  },

  /** 查询多个节点在时间窗口内的限制次数（前端展示用） */
  getNodeEventCounts(nodeIds: number[], sinceTs: number): Map<number, number> {
    const db = getDb();
    const result = new Map<number, number>();
    if (nodeIds.length === 0) return result;
    const placeholders = nodeIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT node_id, COUNT(*) as cnt FROM cpu_limit_events WHERE node_id IN (${placeholders}) AND start_time >= ? GROUP BY node_id`
    ).all(...nodeIds, sinceTs) as Array<{ node_id: number; cnt: number }>;
    for (const r of rows) {
      result.set(r.node_id, r.cnt);
    }
    return result;
  },

  /** 清理过期事件（超过指定时间戳的已结束事件） */
  cleanExpiredEvents(beforeTs: number): void {
    const db = getDb();
    db.prepare("DELETE FROM cpu_limit_events WHERE start_time < ? AND status != 'active'").run(beforeTs);
  },
};

// ─── 日志 Store ────────────────────────────────────────────
export const cpuLimitLogStore = {
  append(log: Omit<CpuLimitLog, 'id'>): void {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO cpu_limit_logs (
        id, ts, rule_id, rule_name, node_id, node_name, event_type,
        metric_value, threshold, top_n, affected_count, details, result, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, log.ts, log.ruleId, log.ruleName, log.nodeId, log.nodeName, log.eventType,
      log.metricValue ?? null, log.threshold ?? null, log.topN ?? null,
      log.affectedCount ?? null, log.details ?? null, log.result, log.error ?? null,
    );
  },

  /** 分页查询日志 */
  listPaginated(options: { page: number; perPage: number; result?: string }): { logs: CpuLimitLog[]; total: number } {
    const db = getDb();
    const { page, perPage, result } = options;
    const offset = (page - 1) * perPage;

    if (result) {
      const rows = db.prepare('SELECT * FROM cpu_limit_logs WHERE result = ? ORDER BY ts DESC LIMIT ? OFFSET ?').all(result, perPage, offset) as CpuLimitLogRow[];
      const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM cpu_limit_logs WHERE result = ?').get(result) as { cnt: number };
      return { logs: rows.map(rowToLog), total: totalRow.cnt };
    }

    const rows = db.prepare('SELECT * FROM cpu_limit_logs ORDER BY ts DESC LIMIT ? OFFSET ?').all(perPage, offset) as CpuLimitLogRow[];
    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM cpu_limit_logs').get() as { cnt: number };
    return { logs: rows.map(rowToLog), total: totalRow.cnt };
  },

  /** 读取全部日志（最多 1000 条，兼容简单查看） */
  readAll(): CpuLimitLog[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cpu_limit_logs ORDER BY ts DESC LIMIT 1000').all() as CpuLimitLogRow[];
    return rows.map(rowToLog);
  },

  clear(): void {
    const db = getDb();
    db.prepare('DELETE FROM cpu_limit_logs').run();
  },
};

// ─── 告警 Store ───────────────────────────────────────────
function rowToAlertConfig(row: Record<string, unknown>): CpuLimitAlertConfig {
  return {
    enabled: !!row.enabled,
    windowMin: Number(row.window_min),
    instanceThreshold: Number(row.instance_threshold),
    nodeThreshold: Number(row.node_threshold),
  };
}

function rowToAlertLog(row: Record<string, unknown>): CpuLimitAlertLog {
  return {
    id: String(row.id),
    ts: Number(row.ts),
    level: row.level as CpuLimitAlertLevel,
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

export const cpuLimitAlertStore = {
  // ── 配置 ──────────────────────────────────────────
  getConfig(): CpuLimitAlertConfig {
    const db = getDb();
    const row = db.prepare('SELECT * FROM cpu_limit_alert_config WHERE id = ?').get('default') as Record<string, unknown> | undefined;
    if (!row) {
      return { enabled: false, windowMin: 60, instanceThreshold: 3, nodeThreshold: 5 };
    }
    return rowToAlertConfig(row);
  },

  saveConfig(config: CpuLimitAlertConfig): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO cpu_limit_alert_config (id, enabled, window_min, instance_threshold, node_threshold)
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

  // ── 告警日志 ──────────────────────────────────────
  appendAlert(input: {
    level: CpuLimitAlertLevel;
    ruleName: string;
    nodeId: number;
    nodeName: string;
    cloudId?: number;
    cloudName?: string;
    triggerCount: number;
    threshold: number;
    windowMin: number;
  }): CpuLimitAlertLog {
    const db = getDb();
    const id = randomUUID();
    const ts = Date.now();
    db.prepare(`
      INSERT INTO cpu_limit_alert_logs (id, ts, level, rule_name, node_id, node_name, cloud_id, cloud_name, trigger_count, threshold, window_min, read)
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

  /** 查询未读告警列表 */
  listUnread(limit = 20): CpuLimitAlertLog[] {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM cpu_limit_alert_logs WHERE read = 0 ORDER BY ts DESC LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
    return rows.map(rowToAlertLog);
  },

  /** 分页查询告警列表 */
  list(page = 1, perPage = 50): { items: CpuLimitAlertLog[]; total: number } {
    const db = getDb();
    const offset = (page - 1) * perPage;
    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM cpu_limit_alert_logs').get() as { cnt: number };
    const rows = db.prepare(
      'SELECT * FROM cpu_limit_alert_logs ORDER BY ts DESC LIMIT ? OFFSET ?'
    ).all(perPage, offset) as Record<string, unknown>[];
    return { items: rows.map(rowToAlertLog), total: totalRow.cnt };
  },

  /** 未读告警数量 */
  countUnread(): number {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) as cnt FROM cpu_limit_alert_logs WHERE read = 0').get() as { cnt: number };
    return row.cnt;
  },

  /** 标记所有告警为已读 */
  markAllRead(): void {
    const db = getDb();
    db.prepare('UPDATE cpu_limit_alert_logs SET read = 1 WHERE read = 0').run();
  },
};
