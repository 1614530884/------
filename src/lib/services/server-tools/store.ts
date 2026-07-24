/**
 * 服务器管理工具 - 数据访问层
 *
 * 所有方法都接收 currentUser 参数，强制 owner 隔离：
 * - 普通用户只能操作自己的数据
 * - 管理员可查看全部（但修改/删除仍限自己的，避免误操作）
 *
 * 密码字段在 DB 中以密文存储（password_enc），出库时由本层解密为明文
 */
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { encrypt, decrypt } from '@/lib/crypto';
import type {
  CurrentUser,
  ServerConnection,
  ServerConnectionInput,
  ServerConnectionUpdate,
  ServerTask,
  ServerTaskInput,
  TaskLog,
  TaskLogInput,
  TaskStatus,
  BtPanelInfo,
  ScriptDef,
  ScriptDefInput,
  ScriptDefUpdate,
  ScriptReorderItem,
  ScriptParam,
  CleanupRule,
  CleanupScope,
  DashboardStats,
} from './types';

// ─── 内部行类型（DB 中的字段名是 snake_case） ──────────────
interface ConnectionRow {
  id: string;
  owner: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password_enc: string;
  description: string | null;
  created_at: string;
  last_connected_at: string | null;
  deleted_at: string | null;
}

interface TaskRow {
  id: string;
  owner: string;
  connection_id: string;
  type: string;
  status: string;
  title: string;
  params: string | null;
  progress: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

interface TaskLogRow {
  id: number;
  task_id: string;
  seq: number;
  ts: string;
  level: string;
  msg: string;
}

interface BtPanelRow {
  id: string;
  owner: string;
  connection_id: string;
  url: string | null;
  inner_url: string | null;
  username: string | null;
  password_enc: string | null;
  panel_port: number | null;
  captured_at: string;
  deleted_at: string | null;
}

interface ScriptRow {
  id: string;
  owner: string;
  name: string;
  category: string;
  description: string | null;
  content: string;
  params: string | null;
  builtin: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface CleanupRuleRow {
  id: string;
  owner: string;
  scope: string;
  enabled: number;
  retain_days: number;
}

// ─── 转换函数 ──────────────────────────────────────────────
function rowToConnection(row: ConnectionRow): ServerConnection {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    password: decrypt(row.password_enc),
    description: row.description ?? undefined,
    createdAt: row.created_at,
    lastConnectedAt: row.last_connected_at ?? undefined,
  };
}

function rowToTask(row: TaskRow): ServerTask {
  return {
    id: row.id,
    owner: row.owner,
    connectionId: row.connection_id,
    type: row.type as ServerTask['type'],
    status: row.status as TaskStatus,
    title: row.title,
    params: row.params ? JSON.parse(row.params) : {},
    progress: row.progress,
    error: row.error ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
  };
}

function rowToTaskLog(row: TaskLogRow): TaskLog {
  return {
    id: row.id,
    taskId: row.task_id,
    seq: row.seq,
    ts: row.ts,
    level: row.level as TaskLog['level'],
    msg: row.msg,
  };
}

function rowToBtPanel(row: BtPanelRow): BtPanelInfo {
  return {
    id: row.id,
    owner: row.owner,
    connectionId: row.connection_id,
    url: row.url ?? undefined,
    innerUrl: row.inner_url ?? undefined,
    username: row.username ?? undefined,
    password: row.password_enc ? decrypt(row.password_enc) : undefined,
    panelPort: row.panel_port ?? undefined,
    capturedAt: row.captured_at,
  };
}

function rowToScript(row: ScriptRow): ScriptDef {
  let params: ScriptParam[] = [];
  if (row.params) {
    try {
      const parsed = JSON.parse(row.params);
      if (Array.isArray(parsed)) params = parsed;
    } catch {
      // ignore
    }
  }
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    category: row.category as ScriptDef['category'],
    description: row.description ?? undefined,
    content: row.content,
    params,
    builtin: row.builtin === 1,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCleanupRule(row: CleanupRuleRow): CleanupRule {
  return {
    id: row.id,
    owner: row.owner,
    scope: row.scope as CleanupScope,
    enabled: row.enabled === 1,
    retainDays: row.retain_days,
  };
}

// ─── 服务器连接 ────────────────────────────────────────────
export const connectionStore = {
  /**
   * 列出当前用户可见的服务器连接
   * @param includeAll 管理员显式请求查看全部用户的数据（默认 false，管理员也只看自己的）
   */
  list(currentUser: CurrentUser, includeAll = false): ServerConnection[] {
    const db = getDb();
    const rows = (currentUser.isAdmin && includeAll)
      ? db.prepare('SELECT * FROM connections WHERE deleted_at IS NULL ORDER BY created_at DESC').all() as ConnectionRow[]
      : db.prepare('SELECT * FROM connections WHERE owner = ? AND deleted_at IS NULL ORDER BY created_at DESC').all(currentUser.username) as ConnectionRow[];
    return rows.map(rowToConnection);
  },

  getById(id: string, currentUser: CurrentUser): ServerConnection | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM connections WHERE id = ? AND deleted_at IS NULL').get(id) as ConnectionRow | undefined;
    if (!row) return null;
    if (!currentUser.isAdmin && row.owner !== currentUser.username) return null;
    return rowToConnection(row);
  },

  /**
   * 内部方法：获取连接（不校验 owner，仅供服务端任务执行器使用）
   */
  getByIdInternal(id: string): ServerConnection | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM connections WHERE id = ? AND deleted_at IS NULL').get(id) as ConnectionRow | undefined;
    return row ? rowToConnection(row) : null;
  },

  create(input: ServerConnectionInput, currentUser: CurrentUser): ServerConnection {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO connections (id, owner, name, host, port, username, password_enc, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, currentUser.username, input.name, input.host, input.port ?? 22, input.username, encrypt(input.password), input.description ?? null, now);
    return this.getById(id, currentUser)!;
  },

  update(id: string, update: ServerConnectionUpdate, currentUser: CurrentUser): ServerConnection | null {
    const existing = this.getById(id, currentUser);
    if (!existing) return null;
    if (!currentUser.isAdmin && existing.owner !== currentUser.username) return null;

    const db = getDb();
    const now = new Date().toISOString();
    const merged: ServerConnection = {
      ...existing,
      ...update,
      port: update.port ?? existing.port,
    };
    db.prepare(`
      UPDATE connections
      SET name = ?, host = ?, port = ?, username = ?, password_enc = ?, description = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.host,
      merged.port,
      merged.username,
      encrypt(merged.password),
      merged.description ?? null,
      id,
    );
    void now; // 占位，未来可加 updated_at 字段
    return this.getById(id, currentUser);
  },

  delete(id: string, currentUser: CurrentUser): boolean {
    const existing = this.getById(id, currentUser);
    if (!existing) return false;
    if (!currentUser.isAdmin && existing.owner !== currentUser.username) return false;
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE connections SET deleted_at = ? WHERE id = ?').run(now, id);
    return true;
  },

  updateLastConnectedAt(id: string): void {
    const db = getDb();
    db.prepare('UPDATE connections SET last_connected_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  },
};

// ─── 任务 ──────────────────────────────────────────────────
export const taskStore = {
  list(currentUser: CurrentUser, options?: {
    status?: TaskStatus;
    statusList?: TaskStatus[];
    connectionId?: string;
    limit?: number;
    finishedAfter?: string;
    /** 强制仅查询当前用户自己的任务（用于通知场景，管理员也只看自己的） */
    onlyOwn?: boolean;
  }): ServerTask[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    // 管理员默认可查看全部任务；onlyOwn=true 时强制只看自己的（通知场景）
    if (!currentUser.isAdmin || options?.onlyOwn) {
      conditions.push('owner = ?');
      params.push(currentUser.username);
    }
    if (options?.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options?.statusList && options.statusList.length > 0) {
      const placeholders = options.statusList.map(() => '?').join(',');
      conditions.push(`status IN (${placeholders})`);
      params.push(...options.statusList);
    }
    if (options?.connectionId) {
      conditions.push('connection_id = ?');
      params.push(options.connectionId);
    }
    if (options?.finishedAfter) {
      conditions.push('finished_at IS NOT NULL AND finished_at > ?');
      params.push(options.finishedAfter);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = options?.limit ?? 200;
    const sql = `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ${limit}`;
    const rows = db.prepare(sql).all(...params) as TaskRow[];
    return rows.map(rowToTask);
  },

  getById(id: string, currentUser: CurrentUser): ServerTask | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    if (!row) return null;
    if (!currentUser.isAdmin && row.owner !== currentUser.username) return null;
    return rowToTask(row);
  },

  getByIdInternal(id: string): ServerTask | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? rowToTask(row) : null;
  },

  create(input: ServerTaskInput, currentUser: CurrentUser): ServerTask {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    const owner = currentUser.username;
    db.prepare(`
      INSERT INTO tasks (id, owner, connection_id, type, status, title, params, progress, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, 0, ?)
    `).run(id, owner, input.connectionId, input.type, input.title, JSON.stringify(input.params ?? {}), now);
    return this.getById(id, currentUser)!;
  },

  updateStatus(id: string, status: TaskStatus, options?: { progress?: number; error?: string }): void {
    const db = getDb();
    const now = new Date().toISOString();
    if (status === 'running' && !options) {
      db.prepare('UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?').run(status, now, id);
    } else if (status === 'success' || status === 'failed' || status === 'cancelled' || status === 'interrupted') {
      db.prepare('UPDATE tasks SET status = ?, progress = ?, error = ?, finished_at = ? WHERE id = ?').run(
        status,
        options?.progress ?? (status === 'success' ? 100 : 0),
        options?.error ?? null,
        now,
        id,
      );
    } else if (options?.progress !== undefined) {
      db.prepare('UPDATE tasks SET status = ?, progress = ? WHERE id = ?').run(status, options.progress, id);
    } else {
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
    }
  },

  updateProgress(id: string, progress: number): void {
    const db = getDb();
    db.prepare('UPDATE tasks SET progress = ? WHERE id = ?').run(progress, id);
  },

  delete(id: string, currentUser: CurrentUser): boolean {
    const existing = this.getById(id, currentUser);
    if (!existing) return false;
    const db = getDb();
    db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    db.prepare('DELETE FROM task_logs WHERE task_id = ?').run(id);
    return true;
  },

  /**
   * 启动时把所有 running 任务标记为 interrupted（服务重启后）
   */
  markRunningAsInterrupted(): number {
    const db = getDb();
    const result = db.prepare("UPDATE tasks SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(new Date().toISOString());
    return result.changes;
  },
};

// ─── 任务日志 ──────────────────────────────────────────────
export const taskLogStore = {
  /**
   * 追加日志并返回新增的日志（包含 seq）
   */
  append(input: TaskLogInput): TaskLog {
    const db = getDb();
    // 获取当前任务最大 seq
    const row = db.prepare('SELECT MAX(seq) as max_seq FROM task_logs WHERE task_id = ?').get(input.taskId) as { max_seq: number | null } | undefined;
    const seq = (row?.max_seq ?? 0) + 1;
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO task_logs (task_id, seq, ts, level, msg)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.taskId, seq, now, input.level, input.msg);
    return {
      id: Number(result.lastInsertRowid),
      taskId: input.taskId,
      seq,
      ts: now,
      level: input.level,
      msg: input.msg,
    };
  },

  /**
   * 分页查询日志
   * @param afterSeq 返回 seq > afterSeq 的日志（用于增量加载）
   * @param limit 单次返回上限
   */
  list(taskId: string, currentUser: CurrentUser, options?: { afterSeq?: number; beforeSeq?: number; limit?: number }): TaskLog[] {
    // 先校验任务归属
    const task = taskStore.getById(taskId, currentUser);
    if (!task) return [];

    const db = getDb();
    const limit = Math.min(options?.limit ?? 500, 5000);
    let sql: string;
    let params: (string | number)[];
    if (options?.afterSeq !== undefined) {
      sql = 'SELECT * FROM task_logs WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?';
      params = [taskId, options.afterSeq, limit];
    } else if (options?.beforeSeq !== undefined) {
      sql = 'SELECT * FROM task_logs WHERE task_id = ? AND seq < ? ORDER BY seq DESC LIMIT ?';
      params = [taskId, options.beforeSeq, limit];
    } else {
      sql = 'SELECT * FROM task_logs WHERE task_id = ? ORDER BY seq ASC LIMIT ?';
      params = [taskId, limit];
    }
    const rows = db.prepare(sql).all(...params) as TaskLogRow[];
    const logs = rows.map(rowToTaskLog);
    // beforeSeq 模式返回的是倒序，需要反转
    if (options?.beforeSeq !== undefined) logs.reverse();
    return logs;
  },

  /**
   * 内部方法：获取任务最新日志（不校验 owner，仅供 WS 推送补齐历史用）
   */
  listInternal(taskId: string, afterSeq?: number, limit = 500): TaskLog[] {
    const db = getDb();
    const realLimit = Math.min(limit, 5000);
    if (afterSeq !== undefined) {
      const rows = db.prepare('SELECT * FROM task_logs WHERE task_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(taskId, afterSeq, realLimit) as TaskLogRow[];
      return rows.map(rowToTaskLog);
    }
    const rows = db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY seq ASC LIMIT ?').all(taskId, realLimit) as TaskLogRow[];
    return rows.map(rowToTaskLog);
  },
};

// ─── 宝塔面板信息 ──────────────────────────────────────────
export const btPanelStore = {
  list(currentUser: CurrentUser, options?: { connectionId?: string }): BtPanelInfo[] {
    const db = getDb();
    const conditions: string[] = ['deleted_at IS NULL'];
    const params: (string | number)[] = [];
    if (!currentUser.isAdmin) {
      conditions.push('owner = ?');
      params.push(currentUser.username);
    }
    if (options?.connectionId) {
      conditions.push('connection_id = ?');
      params.push(options.connectionId);
    }
    const sql = `SELECT * FROM bt_panels WHERE ${conditions.join(' AND ')} ORDER BY captured_at DESC`;
    const rows = db.prepare(sql).all(...params) as BtPanelRow[];
    return rows.map(rowToBtPanel);
  },

  getById(id: string, currentUser: CurrentUser): BtPanelInfo | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM bt_panels WHERE id = ? AND deleted_at IS NULL').get(id) as BtPanelRow | undefined;
    if (!row) return null;
    if (!currentUser.isAdmin && row.owner !== currentUser.username) return null;
    return rowToBtPanel(row);
  },

  create(input: Omit<BtPanelInfo, 'id' | 'capturedAt'>, currentUser: CurrentUser): BtPanelInfo {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO bt_panels (id, owner, connection_id, url, inner_url, username, password_enc, panel_port, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      currentUser.username,
      input.connectionId,
      input.url ?? null,
      input.innerUrl ?? null,
      input.username ?? null,
      input.password ? encrypt(input.password) : null,
      input.panelPort ?? null,
      now,
    );
    return this.getById(id, currentUser)!;
  },

  /**
   * 内部方法：任务执行器保存宝塔信息
   */
  createInternal(input: Omit<BtPanelInfo, 'id' | 'capturedAt'>): BtPanelInfo {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO bt_panels (id, owner, connection_id, url, inner_url, username, password_enc, panel_port, captured_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.owner,
      input.connectionId,
      input.url ?? null,
      input.innerUrl ?? null,
      input.username ?? null,
      input.password ? encrypt(input.password) : null,
      input.panelPort ?? null,
      now,
    );
    const row = db.prepare('SELECT * FROM bt_panels WHERE id = ?').get(id) as BtPanelRow;
    return rowToBtPanel(row);
  },

  delete(id: string, currentUser: CurrentUser): boolean {
    const existing = this.getById(id, currentUser);
    if (!existing) return false;
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare('UPDATE bt_panels SET deleted_at = ? WHERE id = ?').run(now, id);
    return true;
  },
};

// ─── 脚本 ──────────────────────────────────────────────────
export const scriptStore = {
  list(currentUser: CurrentUser, options?: { category?: string }): ScriptDef[] {
    const db = getDb();
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    if (!currentUser.isAdmin) {
      conditions.push('(owner = ? OR owner = ?)');
      params.push(currentUser.username, 'system');
    }
    if (options?.category) {
      conditions.push('category = ?');
      params.push(options.category);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM scripts ${where} ORDER BY sort_order ASC, created_at ASC`;
    const rows = db.prepare(sql).all(...params) as ScriptRow[];
    return rows.map(rowToScript);
  },

  getById(id: string, currentUser: CurrentUser): ScriptDef | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as ScriptRow | undefined;
    if (!row) return null;
    if (!currentUser.isAdmin && row.owner !== 'system' && row.owner !== currentUser.username) return null;
    return rowToScript(row);
  },

  /**
   * 内部方法：供 task-runner 使用（不校验 owner）
   */
  getByIdInternal(id: string): ScriptDef | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as ScriptRow | undefined;
    if (!row) return null;
    return rowToScript(row);
  },

  create(input: ScriptDefInput, currentUser: CurrentUser): ScriptDef {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();
    // 管理员可创建内置（共享、所有人可见、普通用户只读）
    const isBuiltin = input.builtin === true && currentUser.isAdmin;
    const owner = isBuiltin ? 'system' : currentUser.username;
    const builtinFlag = isBuiltin ? 1 : 0;
    db.prepare(`
      INSERT INTO scripts (id, owner, name, category, description, content, params, builtin, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, owner, input.name, input.category, input.description ?? null, input.content, JSON.stringify(input.params ?? []), builtinFlag, now, now);
    return this.getById(id, currentUser)!;
  },

  /**
   * 内部方法：seed 内置脚本
   * 按 name+category 去重：已存在则跳过，避免重启产生重复
   */
  createBuiltin(input: ScriptDefInput & { id?: string }): ScriptDef {
    const db = getDb();
    // 先查是否已存在同名同分类的内置脚本
    const existing = db.prepare(
      'SELECT id FROM scripts WHERE name = ? AND category = ? AND builtin = 1 LIMIT 1'
    ).get(input.name, input.category) as { id: string } | undefined;
    if (existing) {
      const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(existing.id) as ScriptRow;
      return rowToScript(row);
    }
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO scripts (id, owner, name, category, description, content, params, builtin, sort_order, created_at, updated_at)
      VALUES (?, 'system', ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(id, input.name, input.category, input.description ?? null, input.content, JSON.stringify(input.params ?? []), now, now);
    const row = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as ScriptRow;
    return rowToScript(row);
  },

  update(id: string, update: ScriptDefUpdate, currentUser: CurrentUser): ScriptDef | null {
    const existing = this.getById(id, currentUser);
    if (!existing) return null;
    // 权限：非管理员只能改自己的非内置脚本；管理员可改所有（含内置）
    if (!currentUser.isAdmin) {
      if (existing.builtin) return null;
      if (existing.owner !== currentUser.username) return null;
    }

    const db = getDb();
    const now = new Date().toISOString();
    const merged: ScriptDef = {
      ...existing,
      ...update,
      params: update.params ?? existing.params,
    };
    // 管理员可通过 update.builtin 切换内置状态（同步 owner）
    if (currentUser.isAdmin && update.builtin !== undefined) {
      merged.builtin = update.builtin;
      merged.owner = update.builtin ? 'system' : currentUser.username;
    }
    db.prepare(`
      UPDATE scripts
      SET name = ?, category = ?, description = ?, content = ?, params = ?, builtin = ?, owner = ?, updated_at = ?
      WHERE id = ?
    `).run(
      merged.name,
      merged.category,
      merged.description ?? null,
      merged.content,
      JSON.stringify(merged.params),
      merged.builtin ? 1 : 0,
      merged.owner,
      now,
      id,
    );
    return this.getById(id, currentUser);
  },

  delete(id: string, currentUser: CurrentUser): boolean {
    const existing = this.getById(id, currentUser);
    if (!existing) return false;
    // 权限：非管理员只能删自己的非内置脚本；管理员可删所有（含内置）
    if (!currentUser.isAdmin) {
      if (existing.builtin) return false;
      if (existing.owner !== currentUser.username) return false;
    }
    const db = getDb();
    db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
    return true;
  },

  /**
   * 批量更新排序（仅管理员）
   */
  reorder(items: ScriptReorderItem[], currentUser: CurrentUser): boolean {
    if (!currentUser.isAdmin) return false;
    const db = getDb();
    const stmt = db.prepare('UPDATE scripts SET sort_order = ? WHERE id = ?');
    const tx = db.transaction((rows: ScriptReorderItem[]) => {
      for (const item of rows) {
        stmt.run(item.sortOrder, item.id);
      }
    });
    tx(items);
    return true;
  },
};

// ─── 清理规则 ──────────────────────────────────────────────
export const cleanupRuleStore = {
  list(currentUser: CurrentUser): CleanupRule[] {
    const db = getDb();
    const rows = currentUser.isAdmin
      ? db.prepare('SELECT * FROM cleanup_rules ORDER BY scope').all() as CleanupRuleRow[]
      : db.prepare('SELECT * FROM cleanup_rules WHERE owner = ? ORDER BY scope').all(currentUser.username) as CleanupRuleRow[];
    return rows.map(rowToCleanupRule);
  },

  upsert(input: { scope: CleanupScope; enabled: boolean; retainDays: number }, currentUser: CurrentUser): CleanupRule {
    const db = getDb();
    // 查找该用户该 scope 的规则
    const existing = db.prepare('SELECT * FROM cleanup_rules WHERE owner = ? AND scope = ?').get(currentUser.username, input.scope) as CleanupRuleRow | undefined;
    const now = new Date().toISOString();
    if (existing) {
      db.prepare('UPDATE cleanup_rules SET enabled = ?, retain_days = ? WHERE id = ?').run(input.enabled ? 1 : 0, input.retainDays, existing.id);
      const row = db.prepare('SELECT * FROM cleanup_rules WHERE id = ?').get(existing.id) as CleanupRuleRow;
      return rowToCleanupRule(row);
    }
    const id = randomUUID();
    db.prepare('INSERT INTO cleanup_rules (id, owner, scope, enabled, retain_days) VALUES (?, ?, ?, ?, ?)').run(id, currentUser.username, input.scope, input.enabled ? 1 : 0, input.retainDays);
    void now;
    const row = db.prepare('SELECT * FROM cleanup_rules WHERE id = ?').get(id) as CleanupRuleRow;
    return rowToCleanupRule(row);
  },

  /**
   * 内部方法：列出所有启用规则（供调度器用）
   */
  listAllEnabled(): CleanupRule[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM cleanup_rules WHERE enabled = 1').all() as CleanupRuleRow[];
    return rows.map(rowToCleanupRule);
  },

  /**
   * 内部方法：执行清理（按 scope 和 retainDays 删除过期数据）
   */
  executeCleanup(scope: CleanupScope, retainDays: number): { deleted: number } {
    const db = getDb();
    const cutoff = new Date(Date.now() - retainDays * 24 * 60 * 60 * 1000).toISOString();
    let deleted = 0;
    if (scope === 'tasks') {
      // 删除超过保留天数的已结束任务（pending/running 保留）
      const result = db.prepare(`
        DELETE FROM tasks
        WHERE status IN ('success', 'failed', 'cancelled', 'interrupted')
          AND created_at < ?
      `).run(cutoff);
      deleted = result.changes;
      // 同时清理孤立的日志
      db.prepare(`
        DELETE FROM task_logs
        WHERE task_id NOT IN (SELECT id FROM tasks)
      `).run();
    } else if (scope === 'connections') {
      // 彻底删除超过保留天数的连接记录（包括已软删除和未软删除的）
      const result = db.prepare('DELETE FROM connections WHERE created_at < ?').run(cutoff);
      deleted = result.changes;
    } else if (scope === 'bt_panels') {
      // 彻底删除超过保留天数的宝塔信息（包括已软删除和未软删除的）
      const result = db.prepare('DELETE FROM bt_panels WHERE captured_at < ?').run(cutoff);
      deleted = result.changes;
    }
    return { deleted };
  },

  /**
   * 内部方法：彻底清除指定 scope 的全部数据（不限时间，忽略 retainDays）
   * 供手动"一键清除全部"使用
   */
  purgeAll(scope: CleanupScope): { deleted: number } {
    const db = getDb();
    let deleted = 0;
    if (scope === 'tasks') {
      const result = db.prepare("DELETE FROM tasks WHERE status IN ('success', 'failed', 'cancelled', 'interrupted')").run();
      deleted = result.changes;
      db.prepare('DELETE FROM task_logs WHERE task_id NOT IN (SELECT id FROM tasks)').run();
    } else if (scope === 'connections') {
      const result = db.prepare('DELETE FROM connections').run();
      deleted = result.changes;
    } else if (scope === 'bt_panels') {
      const result = db.prepare('DELETE FROM bt_panels').run();
      deleted = result.changes;
    }
    return { deleted };
  },
};

// ─── 仪表盘统计 ────────────────────────────────────────────
/**
 * 仪表盘统计
 * @param includeAll 管理员显式请求查看全部用户的数据（默认 false，管理员也只看自己的）
 */
export function getDashboardStats(currentUser: CurrentUser, includeAll = false): DashboardStats {
  const db = getDb();
  // 管理员且显式 includeAll 才看全部；否则只看自己的（与 connectionStore.list 行为一致）
  const viewAll = currentUser.isAdmin && includeAll;
  const ownerCondition = viewAll ? '' : 'WHERE owner = ?';
  const ownerParams = viewAll ? [] : [currentUser.username];

  const totalConnections = (db.prepare(`SELECT COUNT(*) as c FROM connections ${viewAll ? 'WHERE deleted_at IS NULL' : 'WHERE owner = ? AND deleted_at IS NULL'}`).get(...ownerParams) as { c: number }).c;
  const runningTasks = (db.prepare(`SELECT COUNT(*) as c FROM tasks ${viewAll ? 'WHERE status = ?' : 'WHERE owner = ? AND status = ?'}`).get(...(viewAll ? ['running'] : [currentUser.username, 'running'])) as { c: number }).c;

  // 今日完成的任务
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const todayCompleted = (db.prepare(`SELECT COUNT(*) as c FROM tasks ${viewAll ? 'WHERE status = ? AND finished_at >= ?' : 'WHERE owner = ? AND status = ? AND finished_at >= ?'}`).get(...(viewAll ? ['success', todayIso] : [currentUser.username, 'success', todayIso])) as { c: number }).c;

  const totalBtPanels = (db.prepare(`SELECT COUNT(*) as c FROM bt_panels ${viewAll ? 'WHERE deleted_at IS NULL' : 'WHERE owner = ? AND deleted_at IS NULL'}`).get(...ownerParams) as { c: number }).c;

  void ownerCondition;
  return {
    totalConnections,
    runningTasks,
    todayCompleted,
    totalBtPanels,
  };
}
