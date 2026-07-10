/**
 * 服务器管理工具 - 类型定义
 */

// ─── 当前用户（用于数据隔离） ─────────────────────────────
export interface CurrentUser {
  username: string;
  isAdmin: boolean;
}

// ─── 服务器连接 ────────────────────────────────────────────
export interface ServerConnection {
  id: string;
  owner: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string; // 明文（仅在内存中，从 DB 取出时解密）
  description?: string;
  createdAt: string;
  lastConnectedAt?: string;
}

export interface ServerConnectionInput {
  name: string;
  host: string;
  port?: number;
  username: string;
  password: string;
  description?: string;
}

export interface ServerConnectionUpdate {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  description?: string;
}

// ─── 任务 ──────────────────────────────────────────────────
export type TaskType = 'mount_disk' | 'install_bt' | 'run_script' | 'custom_cmd';
export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';

export interface ServerTask {
  id: string;
  owner: string;
  connectionId: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  params: Record<string, unknown>;
  progress: number; // 0-100
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
}

export interface ServerTaskInput {
  connectionId: string;
  type: TaskType;
  title: string;
  params?: Record<string, unknown>;
}

// ─── 任务日志 ──────────────────────────────────────────────
export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface TaskLog {
  id: number;
  taskId: string;
  seq: number;
  ts: string;
  level: LogLevel;
  msg: string;
}

export interface TaskLogInput {
  taskId: string;
  level: LogLevel;
  msg: string;
}

// ─── 宝塔面板信息 ──────────────────────────────────────────
export interface BtPanelInfo {
  id: string;
  owner: string;
  connectionId: string;
  url?: string;
  innerUrl?: string;
  username?: string;
  password?: string; // 明文（仅内存）
  panelPort?: number;
  capturedAt: string;
}

// ─── 脚本 ──────────────────────────────────────────────────
export type ScriptCategory = 'maintenance' | 'install' | 'inspect' | 'custom';

export interface ScriptParam {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  placeholder?: string;
}

export interface ScriptDef {
  id: string;
  owner: string; // 'system' 为内置
  name: string;
  category: ScriptCategory;
  description?: string;
  content: string; // 含 {{param}} 模板
  params: ScriptParam[];
  builtin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptDefInput {
  name: string;
  category: ScriptCategory;
  description?: string;
  content: string;
  params?: ScriptParam[];
  builtin?: boolean; // 仅管理员可设 true（共享内置，所有用户可见且普通用户只读）
}

export interface ScriptReorderItem {
  id: string;
  sortOrder: number;
}

export interface ScriptDefUpdate {
  name?: string;
  category?: ScriptCategory;
  description?: string;
  content?: string;
  params?: ScriptParam[];
  builtin?: boolean; // 仅管理员可改
}

// ─── 清理规则 ──────────────────────────────────────────────
export type CleanupScope = 'tasks' | 'connections' | 'bt_panels';

export interface CleanupRule {
  id: string;
  owner: string;
  scope: CleanupScope;
  enabled: boolean;
  retainDays: number;
}

// ─── WebSocket 消息协议 ────────────────────────────────────
// /ws/ssh
export type SshWsMessageIn =
  | { type: 'connect'; payload: { connectionId: string; host: string; port: number; username: string; password: string; cols?: number; rows?: number } }
  | { type: 'input'; payload: { data: string } }
  | { type: 'resize'; payload: { cols: number; rows: number } }
  | { type: 'check_datadisk'; payload: Record<string, never> }
  | { type: 'get_stats'; payload: null }
  | { type: 'ping' };

export type SshWsMessageOut =
  | { type: 'pong' }
  | { type: 'status'; payload: 'connecting' | 'creating_shell' | 'connected' | 'disconnected' }
  | { type: 'output'; payload: string }
  | { type: 'error'; payload: string }
  | { type: 'datadisk_result'; payload: { unmountedDisks: Array<{ name: string; size: string; fstype: string; transport?: string }>; rootDisk?: string } }
  | { type: 'stats'; payload: ServerStats | null };

export interface ServerStats {
  uptime: string;
  load: string;
  cpu: string;
  memory: string;
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    percent: string;
    mount: string;
  }>;
  network: { upload: string; download: string };
  /** 原始字节数（用于前端计算速率），可选 */
  rawNetwork?: { uploadBytes: number; downloadBytes: number };
}

// /ws/tasks
export type TasksWsMessageIn =
  | { type: 'subscribe'; taskId: string; loginUser: string }
  | { type: 'unsubscribe'; taskId: string }
  | { type: 'ping' };

export type TasksWsMessageOut =
  | { type: 'pong' }
  | { type: 'error'; payload: string }
  | { type: 'task_status'; payload: { id: string; status: TaskStatus; progress: number; error?: string } }
  | { type: 'task_log'; payload: { taskId: string; seq: number; ts: string; level: LogLevel; msg: string } }
  | { type: 'task_finished'; payload: { id: string; status: TaskStatus; btPanelId?: string } };

// ─── 仪表盘统计 ────────────────────────────────────────────
export interface DashboardStats {
  totalConnections: number;
  runningTasks: number;
  todayCompleted: number;
  totalBtPanels: number;
  /** 当前请求用户身份信息（由 stats API 附加返回，前端用于决定是否显示'我的/全部'切换） */
  currentUser?: {
    username: string;
    isAdmin: boolean;
  };
}
