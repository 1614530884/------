import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { getDb } from '@/lib/services/server-tools/db';
import { MonitorConfig, MonitorLog } from './node-monitor-types';

const DATA_DIR = join(process.cwd());
const CONFIG_PATH = join(DATA_DIR, 'node-monitor-config.json');
const LOGS_PATH = join(DATA_DIR, 'node-monitor-logs.json');

const DEFAULT_CONFIG: MonitorConfig = {
  globalEnabled: false,
  rules: [],
};

// ─── 日志行类型（DB snake_case） ───────────────────────────
interface MonitorLogRow {
  id: string;
  ts: number;
  rule_id: string;
  rule_name: string;
  node_id: number;
  node_name: string;
  metric: string;
  metric_value: number;
  operator: string;
  threshold: number;
  threshold_low: number | null;
  action: string;
  trigger_count: number;
  consecutive_hits: number;
  trigger_side: string | null;
  action_result: string;
  action_error: string | null;
}

function rowToLog(row: MonitorLogRow): MonitorLog {
  return {
    id: row.id,
    timestamp: row.ts,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    nodeId: row.node_id,
    nodeName: row.node_name,
    metric: row.metric as MonitorLog['metric'],
    metricValue: row.metric_value,
    operator: row.operator as MonitorLog['operator'],
    threshold: row.threshold,
    thresholdLow: row.threshold_low ?? undefined,
    action: row.action as MonitorLog['action'],
    triggerCount: row.trigger_count,
    consecutiveHits: row.consecutive_hits,
    triggerSide: (row.trigger_side as 'high' | 'low' | null) ?? undefined,
    actionResult: row.action_result as MonitorLog['actionResult'],
    actionError: row.action_error ?? undefined,
  };
}

export function readConfig(): MonitorConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      globalEnabled: parsed.globalEnabled ?? false,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: MonitorConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/** 读取全部日志（按时间倒序，最多 1000 条，兼容旧接口） */
export function readLogs(): MonitorLog[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM monitor_logs ORDER BY ts DESC LIMIT 1000').all() as MonitorLogRow[];
  return rows.map(rowToLog);
}

/** 读取日志（支持按操作结果过滤，分页在 route 层处理） */
export function readLogsFiltered(options?: { result?: string }): MonitorLog[] {
  const db = getDb();
  if (options?.result) {
    const rows = db.prepare('SELECT * FROM monitor_logs WHERE action_result = ? ORDER BY ts DESC LIMIT 1000').all(options.result) as MonitorLogRow[];
    return rows.map(rowToLog);
  }
  return readLogs();
}

/** 追加日志到 SQLite（即时写入，不再需要延迟 flush） */
export function appendLog(log: MonitorLog): void {
  const db = getDb();
  const id = log.id || randomUUID();
  db.prepare(`
    INSERT INTO monitor_logs (
      id, ts, rule_id, rule_name, node_id, node_name, metric, metric_value,
      operator, threshold, threshold_low, action, trigger_count, consecutive_hits,
      trigger_side, action_result, action_error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, log.timestamp, log.ruleId, log.ruleName, log.nodeId, log.nodeName,
    log.metric, log.metricValue, log.operator, log.threshold, log.thresholdLow ?? null,
    log.action, log.triggerCount, log.consecutiveHits, log.triggerSide ?? null,
    log.actionResult, log.actionError ?? null,
  );
}

/** 清空日志 */
export function clearLogs(): void {
  const db = getDb();
  db.prepare('DELETE FROM monitor_logs').run();
}

/** 兼容旧接口：SQLite 即时写入，无需 flush */
export function flushLogs(): void {
  // no-op: SQLite 已即时持久化
}

/**
 * 启动时迁移旧 JSON 日志到 SQLite（仅执行一次）
 * 导入后将 node-monitor-logs.json 重命名为 .bak 避免重复导入
 */
export function migrateLogsFromJson(): number {
  if (!existsSync(LOGS_PATH)) return 0;
  try {
    const raw = readFileSync(LOGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const oldLogs: MonitorLog[] = Array.isArray(parsed) ? parsed : [];
    if (oldLogs.length === 0) {
      renameSync(LOGS_PATH, `${LOGS_PATH}.bak`);
      return 0;
    }

    const db = getDb();
    // 查询已存在的日志 ID，避免重复导入
    const existingIds = new Set(
      (db.prepare('SELECT id FROM monitor_logs').all() as { id: string }[]).map(r => r.id),
    );

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO monitor_logs (
        id, ts, rule_id, rule_name, node_id, node_name, metric, metric_value,
        operator, threshold, threshold_low, action, trigger_count, consecutive_hits,
        trigger_side, action_result, action_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let imported = 0;
    for (const log of oldLogs) {
      const id = log.id || randomUUID();
      if (existingIds.has(id)) continue;
      stmt.run(
        id, log.timestamp, log.ruleId, log.ruleName, log.nodeId, log.nodeName,
        log.metric, log.metricValue, log.operator, log.threshold, log.thresholdLow ?? null,
        log.action, log.triggerCount, log.consecutiveHits, log.triggerSide ?? null,
        log.actionResult, log.actionError ?? null,
      );
      imported++;
    }

    // 导入完成后重命名 JSON 文件为 .bak（保留作为备份，不删除）
    renameSync(LOGS_PATH, `${LOGS_PATH}.bak`);
    console.log(`[NodeMonitor] 已迁移 ${imported} 条旧日志到 SQLite，原文件备份为 .bak`);
    return imported;
  } catch (err) {
    console.error('[NodeMonitor] 日志迁移失败:', err);
    return 0;
  }
}
