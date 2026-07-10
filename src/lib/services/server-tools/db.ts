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
