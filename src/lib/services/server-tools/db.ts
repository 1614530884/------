/**
 * 服务器管理工具 - SQLite 数据库层
 *
 * 使用 better-sqlite3 单例，自动建表（CREATE TABLE IF NOT EXISTS）
 * 数据库文件位于项目根目录 server-tools.db
 */
import Database from 'better-sqlite3';
import { join } from 'path';

const DB_PATH = join(process.cwd(), 'server-tools.db');

// 使用 globalThis 确保单例跨模块实例共享（同 serverToolsService）
const globalForDb = globalThis as unknown as {
  __serverToolsDb?: Database.Database;
};

/**
 * 获取数据库单例（首次调用时初始化并建表）
 */
export function getDb(): Database.Database {
  if (globalForDb.__serverToolsDb) return globalForDb.__serverToolsDb;

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // 并发读 + 写不阻塞
  db.pragma('foreign_keys = ON');

  initSchema(db);
  globalForDb.__serverToolsDb = db;
  return db;
}

/**
 * 初始化表结构（幂等）
 */
function initSchema(db: Database.Database): void {
  db.exec(`
    -- 服务器连接记录
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 22,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      last_connected_at TEXT,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_connections_owner ON connections(owner);

    -- 任务
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      params TEXT,
      progress INTEGER DEFAULT 0,
      error TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_connection ON tasks(connection_id);

    -- 任务日志
    CREATE TABLE IF NOT EXISTS task_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      msg TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_task_seq ON task_logs(task_id, seq);

    -- 宝塔面板信息
    CREATE TABLE IF NOT EXISTS bt_panels (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      url TEXT,
      inner_url TEXT,
      username TEXT,
      password_enc TEXT,
      panel_port INTEGER,
      captured_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bt_owner ON bt_panels(owner);
    CREATE INDEX IF NOT EXISTS idx_bt_connection ON bt_panels(connection_id);

    -- 脚本库
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      params TEXT,
      builtin INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scripts_owner ON scripts(owner);
    CREATE INDEX IF NOT EXISTS idx_scripts_category ON scripts(category);

    -- 清理规则
    CREATE TABLE IF NOT EXISTS cleanup_rules (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      scope TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      retain_days INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cleanup_owner ON cleanup_rules(owner);

    -- 智能带宽规则（双阈值模型：threshold_up/threshold_down）
    CREATE TABLE IF NOT EXISTS bandwidth_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      node_ids TEXT NOT NULL,
      threshold_up BIGINT,
      threshold_down BIGINT,
      top_n INTEGER NOT NULL DEFAULT 5,
      limit_mode TEXT NOT NULL,
      limit_value INTEGER NOT NULL,
      continuous_enabled INTEGER DEFAULT 0,
      continuous_window_min INTEGER,
      continuous_percent INTEGER,
      duration_min INTEGER NOT NULL,
      reduce_percent INTEGER NOT NULL,
      interval INTEGER NOT NULL DEFAULT 60,
      cooldown INTEGER NOT NULL DEFAULT 300,
      trigger_count INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bw_rules_enabled ON bandwidth_rules(enabled);

    -- 智能带宽管理日志
    CREATE TABLE IF NOT EXISTS bandwidth_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      metric_value BIGINT,
      top_n INTEGER,
      affected_count INTEGER,
      details TEXT,
      result TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_bw_logs_ts ON bandwidth_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_logs_rule ON bandwidth_logs(rule_id);
    CREATE INDEX IF NOT EXISTS idx_bw_logs_node ON bandwidth_logs(node_id);

    -- 带宽告警配置（单行配置，id 固定为 'default'）
    CREATE TABLE IF NOT EXISTS bandwidth_alert_config (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      window_min INTEGER NOT NULL DEFAULT 60,
      instance_threshold INTEGER NOT NULL DEFAULT 3,
      node_threshold INTEGER NOT NULL DEFAULT 5
    );

    -- 带宽告警记录
    CREATE TABLE IF NOT EXISTS bandwidth_alert_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      cloud_id INTEGER,
      cloud_name TEXT,
      trigger_count INTEGER NOT NULL,
      threshold INTEGER NOT NULL,
      window_min INTEGER NOT NULL,
      read INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_bw_alerts_ts ON bandwidth_alert_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_alerts_read ON bandwidth_alert_logs(read);

    -- 限速事件记录（每次限速成功后写入，用于统计时间窗口内次数）
    CREATE TABLE IF NOT EXISTS bandwidth_limit_events (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      cloud_id INTEGER NOT NULL,
      cloud_name TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bw_events_ts ON bandwidth_limit_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_events_node ON bandwidth_limit_events(node_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_bw_events_cloud ON bandwidth_limit_events(cloud_id, ts DESC);

    -- CPU 限制规则（节点指标超阈值时，对 Top N 实例实施 CPU 限制）
    CREATE TABLE IF NOT EXISTS cpu_limit_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      node_ids TEXT NOT NULL,
      metric TEXT NOT NULL,                 -- cpu | memory | disk
      threshold REAL NOT NULL,              -- 节点指标触发上限
      top_n INTEGER NOT NULL DEFAULT 5,     -- 限制的实例数量
      cpu_limit_percent INTEGER NOT NULL,   -- CPU 限制百分比(1-100)
      duration_min INTEGER NOT NULL,        -- 限制持续时间(分钟)
      interval INTEGER NOT NULL DEFAULT 60,
      cooldown INTEGER NOT NULL DEFAULT 300,
      trigger_count INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cpu_rules_enabled ON cpu_limit_rules(enabled);

    -- CPU 限制活跃事件（用于到期自动解除）
    CREATE TABLE IF NOT EXISTS cpu_limit_events (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      cloud_id INTEGER NOT NULL,
      cloud_name TEXT NOT NULL,
      cpu_limit_percent INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      expire_time INTEGER NOT NULL,
      status TEXT NOT NULL,                 -- active | released | failed
      released_at INTEGER,
      release_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cpu_events_status ON cpu_limit_events(status);
    CREATE INDEX IF NOT EXISTS idx_cpu_events_expire ON cpu_limit_events(expire_time);
    CREATE INDEX IF NOT EXISTS idx_cpu_events_cloud ON cpu_limit_events(cloud_id, status);
    -- 复合索引：支持节点并发限制上限统计（rule_id + node_id + status='active'）
    CREATE INDEX IF NOT EXISTS idx_cpu_events_rule_node_status ON cpu_limit_events(rule_id, node_id, status);
    -- 复合索引：支持实例在窗口内被限制次数统计（cloud_id + start_time），用于惩罚机制
    CREATE INDEX IF NOT EXISTS idx_cpu_events_cloud_start ON cpu_limit_events(cloud_id, start_time);
    -- 复合索引：支持节点在窗口内被限制次数统计（node_id + start_time），用于告警判断
    CREATE INDEX IF NOT EXISTS idx_cpu_events_node_start ON cpu_limit_events(node_id, start_time);

    -- CPU 限制操作日志
    CREATE TABLE IF NOT EXISTS cpu_limit_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      event_type TEXT NOT NULL,             -- limit_trigger | limit_execute | limit_release | limit_skip
      metric_value REAL,
      threshold REAL,
      top_n INTEGER,
      affected_count INTEGER,
      details TEXT,                         -- JSON: 实例列表、CPU 使用率等
      result TEXT NOT NULL,                 -- success | failed | skipped
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cpu_logs_ts ON cpu_limit_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_cpu_logs_rule ON cpu_limit_logs(rule_id);

    -- CPU 限制告警配置（单行配置，id 固定为 'default'）
    CREATE TABLE IF NOT EXISTS cpu_limit_alert_config (
      id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      window_min INTEGER NOT NULL DEFAULT 60,
      instance_threshold INTEGER NOT NULL DEFAULT 3,
      node_threshold INTEGER NOT NULL DEFAULT 5
    );

    -- CPU 限制告警记录
    CREATE TABLE IF NOT EXISTS cpu_limit_alert_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,                 -- instance | node
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      cloud_id INTEGER,
      cloud_name TEXT,
      trigger_count INTEGER NOT NULL,
      threshold INTEGER NOT NULL,
      window_min INTEGER NOT NULL,
      read INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cpu_alerts_ts ON cpu_limit_alert_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_cpu_alerts_read ON cpu_limit_alert_logs(read);
  `);

  // 增量迁移：bandwidth_rules 添加 threshold_up / threshold_down 列（旧表可能没有）
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN threshold_up BIGINT'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN threshold_down BIGINT'); } catch { /* 列已存在 */ }
  // 迁移旧数据：metric=bandwidth_up → threshold_up，metric=bandwidth_down → threshold_down
  try {
    db.exec(`UPDATE bandwidth_rules SET threshold_up = threshold WHERE metric = 'bandwidth_up' AND threshold_up IS NULL`);
    db.exec(`UPDATE bandwidth_rules SET threshold_down = threshold WHERE metric = 'bandwidth_down' AND threshold_down IS NULL`);
  } catch { /* 旧列不存在，跳过迁移 */ }

  // 重建表：删除废弃的 metric/threshold 列（SQLite 不支持 ALTER 修改列约束，用重建表方式）
  // 仅当旧表存在 metric 或 threshold 列时执行，新表/已迁移表不触发
  const legacyCols = db.prepare(
    `SELECT COUNT(*) as cnt FROM pragma_table_info('bandwidth_rules') WHERE name IN ('metric', 'threshold')`
  ).get() as { cnt: number };
  if (legacyCols.cnt > 0) {
    const rebuildRulesTable = db.transaction(() => {
      db.exec(`
        CREATE TABLE bandwidth_rules_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          node_ids TEXT NOT NULL,
          threshold_up BIGINT,
          threshold_down BIGINT,
          top_n INTEGER NOT NULL DEFAULT 5,
          limit_mode TEXT NOT NULL,
          limit_value INTEGER NOT NULL,
          continuous_enabled INTEGER DEFAULT 0,
          continuous_window_min INTEGER,
          continuous_percent INTEGER,
          duration_min INTEGER NOT NULL,
          reduce_percent INTEGER NOT NULL,
          interval INTEGER NOT NULL DEFAULT 60,
          cooldown INTEGER NOT NULL DEFAULT 300,
          trigger_count INTEGER NOT NULL DEFAULT 1,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL
        );
        INSERT INTO bandwidth_rules_new (
          id, name, node_ids, threshold_up, threshold_down, top_n, limit_mode, limit_value,
          continuous_enabled, continuous_window_min, continuous_percent,
          duration_min, reduce_percent, interval, cooldown, trigger_count, enabled, created_at
        )
        SELECT
          id, name, node_ids, threshold_up, threshold_down, top_n, limit_mode, limit_value,
          continuous_enabled, continuous_window_min, continuous_percent,
          duration_min, reduce_percent, interval, cooldown, trigger_count, enabled, created_at
        FROM bandwidth_rules;
        DROP TABLE bandwidth_rules;
        ALTER TABLE bandwidth_rules_new RENAME TO bandwidth_rules;
        CREATE INDEX IF NOT EXISTS idx_bw_rules_enabled ON bandwidth_rules(enabled);
      `);
    });
    rebuildRulesTable();
  }

  // 增量迁移：bandwidth_logs 添加 metric_value_up / metric_value_down 列
  try { db.exec('ALTER TABLE bandwidth_logs ADD COLUMN metric_value_up BIGINT'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_logs ADD COLUMN metric_value_down BIGINT'); } catch { /* 列已存在 */ }

  // 增量迁移：cpu_limit_rules 添加节点实例上限 + 惩罚机制字段
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN max_instances_per_window INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN limit_window_min INTEGER NOT NULL DEFAULT 60'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_enabled INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_window_min INTEGER NOT NULL DEFAULT 60'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_threshold INTEGER NOT NULL DEFAULT 2'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_mode TEXT NOT NULL DEFAULT \'multiply\''); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_value INTEGER NOT NULL DEFAULT 2'); } catch { /* 列已存在 */ }
  // 增量迁移：cpu_limit_rules 新增 CPU 限制值惩罚字段（进一步降低 CPU 限制百分比）
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_cpu_limit_mode TEXT NOT NULL DEFAULT \'multiply\''); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN penalty_cpu_limit_value INTEGER NOT NULL DEFAULT 2'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN min_cpu_limit_percent INTEGER NOT NULL DEFAULT 5'); } catch { /* 列已存在 */ }

  // 增量迁移：cpu_limit_rules 新增 max_active_instances（节点并发限制上限，统计当前活跃实例数）
  // 语义修正：旧字段 max_instances_per_window 统计时间窗口内累计事件数（含已解除），新字段统计当前活跃实例数
  try {
    db.exec('ALTER TABLE cpu_limit_rules ADD COLUMN max_active_instances INTEGER NOT NULL DEFAULT 0');
    // 从旧字段迁移数据（保留用户已配置的值）
    db.exec('UPDATE cpu_limit_rules SET max_active_instances = max_instances_per_window WHERE max_active_instances = 0 AND max_instances_per_window > 0');
  } catch { /* 列已存在 */ }

  // 增量迁移：bandwidth_rules 添加惩罚机制字段（时间翻倍 + 带宽降低比例翻倍，带最低下限保护）
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_enabled INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_window_min INTEGER NOT NULL DEFAULT 60'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_threshold INTEGER NOT NULL DEFAULT 2'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_mode TEXT NOT NULL DEFAULT \'multiply\''); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_value INTEGER NOT NULL DEFAULT 2'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN min_bandwidth_percent INTEGER NOT NULL DEFAULT 10'); } catch { /* 列已存在 */ }
  // 增量迁移：bandwidth_rules 新增带宽降低比例惩罚字段（独立于时间惩罚，避免带宽翻倍太激进）
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_bw_mode TEXT NOT NULL DEFAULT \'add_extra\''); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN penalty_bw_value INTEGER NOT NULL DEFAULT 10'); } catch { /* 列已存在 */ }
  // 增量迁移：min_bandwidth_percent → min_bandwidth_mbps（最低带宽保留改为 Mbps 绝对值，更直观）
  try { db.exec('ALTER TABLE bandwidth_rules ADD COLUMN min_bandwidth_mbps INTEGER NOT NULL DEFAULT 10'); } catch { /* 列已存在 */ }

  // 增量迁移：bandwidth_limit_events 扩展为完整事件结构（支持直接调控 + 到期自动恢复）
  // 旧表仅用于告警统计（8字段），改造后需跟踪活跃限制、到期恢复、原始带宽记录
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN status TEXT NOT NULL DEFAULT \'active\''); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN start_time INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN expire_time INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN original_in_bw INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN original_out_bw INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN new_in_bw INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN new_out_bw INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN limit_direction TEXT'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN actual_duration_min INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN penalized INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN release_retry_count INTEGER NOT NULL DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN released_at INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE bandwidth_limit_events ADD COLUMN release_error TEXT'); } catch { /* 列已存在 */ }
  // 旧记录（expire_time=0）标记为 released，避免 release-scheduler 立即拾取后尝试恢复（无原始带宽可恢复）
  db.exec('UPDATE bandwidth_limit_events SET status = \'released\' WHERE expire_time = 0 AND status = \'active\'');
  // 新增索引：按状态+到期时间查询（release-scheduler 使用）
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_bw_events_release ON bandwidth_limit_events(status, expire_time)'); } catch { /* 索引已存在 */ }

  // 增量迁移：cpu_limit_events 添加惩罚记录 + 解除重试字段
  try { db.exec('ALTER TABLE cpu_limit_events ADD COLUMN actual_duration_min INTEGER'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_events ADD COLUMN penalized INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }
  try { db.exec('ALTER TABLE cpu_limit_events ADD COLUMN release_retry_count INTEGER DEFAULT 0'); } catch { /* 列已存在 */ }

  db.exec(`
    -- 现有节点监控日志（迁移自 node-monitor-logs.json）
    CREATE TABLE IF NOT EXISTS monitor_logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      rule_id TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      node_id INTEGER NOT NULL,
      node_name TEXT NOT NULL,
      metric TEXT NOT NULL,
      metric_value REAL,
      operator TEXT,
      threshold REAL,
      threshold_low REAL,
      action TEXT,
      trigger_count INTEGER,
      consecutive_hits INTEGER,
      trigger_side TEXT,
      action_result TEXT NOT NULL,
      action_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_logs_ts ON monitor_logs(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_monitor_logs_rule ON monitor_logs(rule_id);
  `);

  // 增量迁移：为已存在的 scripts 表补 sort_order 列
  runMigrations(db);
}

/**
 * 增量迁移（只加列，不破坏现有数据）
 */
function runMigrations(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(scripts)').all() as { name: string }[];
  const hasSortOrder = columns.some(c => c.name === 'sort_order');
  if (!hasSortOrder) {
    db.exec('ALTER TABLE scripts ADD COLUMN sort_order INTEGER DEFAULT 0');
  }
}

/**
 * 关闭数据库连接（用于优雅关闭）
 */
export function closeDb(): void {
  if (globalForDb.__serverToolsDb) {
    try {
      globalForDb.__serverToolsDb.close();
    } catch {
      // ignore
    }
    globalForDb.__serverToolsDb = undefined;
  }
}
