'use client';

/**
 * 任务面板组件
 *
 * 功能：
 * - 显示当前连接的任务列表（运行中 + 历史）
 * - 支持创建自定义命令任务
 * - 实时显示选中任务的日志（WebSocket 推送）
 * - 历史日志向上滚动分页加载（beforeSeq）
 * - 取消运行中的任务
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, X, Terminal, Plus, RefreshCw, Circle, CheckCircle2, XCircle, AlertTriangle, PauseCircle,
  ArrowDown,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

// ─── 类型 ─────────────────────────────────────────────────
type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';
type LogLevel = 'info' | 'warn' | 'error' | 'success';
type TaskType = 'mount_disk' | 'install_bt' | 'run_script' | 'custom_cmd';

interface ServerTask {
  id: string;
  owner: string;
  connectionId: string;
  type: TaskType;
  status: TaskStatus;
  title: string;
  params: Record<string, unknown>;
  progress: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  isRunning?: boolean;
}

interface TaskLog {
  id?: number;
  taskId: string;
  seq: number;
  ts: string;
  level: LogLevel;
  msg: string;
}

interface TaskPanelProps {
  connectionId: string;
  refreshTrigger?: number;
  /** 初始选中的任务 ID（从列表页跳转时自动选中并显示日志） */
  initialTaskId?: string;
}

// ─── 工具 ─────────────────────────────────────────────────
const STORAGE_KEY = 'idc_auth';
function getLoginUser(): string {
  try {
    const authStr = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (authStr) {
      const data = JSON.parse(authStr);
      if (data.username) {
        const KEY = 'idc-auth-enc-2026';
        const decoded = atob(data.username);
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
          result += String.fromCharCode(decoded.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
        }
        return result;
      }
    }
  } catch { /* ignore */ }
  return '';
}

const STATUS_META: Record<TaskStatus, { label: string; color: string; icon: typeof Circle }> = {
  pending: { label: '等待', color: 'text-gray-400', icon: Circle },
  running: { label: '运行中', color: 'text-blue-400', icon: Loader2 },
  success: { label: '成功', color: 'text-emerald-400', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-red-400', icon: XCircle },
  cancelled: { label: '已取消', color: 'text-amber-400', icon: PauseCircle },
  interrupted: { label: '已中断', color: 'text-amber-400', icon: AlertTriangle },
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-gray-300',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-emerald-400',
};

const TYPE_LABEL: Record<TaskType, string> = {
  mount_disk: '挂载数据盘',
  install_bt: '安装宝塔',
  run_script: '运行脚本',
  custom_cmd: '自定义命令',
};

// ─── 组件 ─────────────────────────────────────────────────
export default function TaskPanel({ connectionId, refreshTrigger, initialTaskId }: TaskPanelProps) {
  const [tasks, setTasks] = useState<ServerTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [cmdInput, setCmdInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ServerTask | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const firstLogSeqRef = useRef<number | null>(null);
  const lastLogSeqRef = useRef<number | null>(null);
  const autoScrollRef = useRef(true);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const manuallyClosedRef = useRef(false);
  // 批量日志缓冲：WS 一次性推送大量历史日志或高频实时日志时
  // 用 microtask 批量合并，避免每条日志触发一次 setLogs 导致 O(n²) 重渲染
  const pendingLogsRef = useRef<TaskLog[]>([]);
  const flushScheduledRef = useRef(false);

  // ─── 批量刷新日志：合并 pendingLogsRef 到 logs state ───
  // 用 microtask 调度，同一 tick 内多条日志只会触发一次 setLogs
  const scheduleFlushLogs = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      const pending = pendingLogsRef.current;
      pendingLogsRef.current = [];
      if (pending.length === 0) return;
      setLogs(prev => {
        // 去重 + 合并
        const existing = new Set(prev.map(l => l.seq));
        const filtered = pending.filter(l => !existing.has(l.seq));
        if (filtered.length === 0) return prev;
        const next = [...prev, ...filtered].sort((a, b) => a.seq - b.seq);
        firstLogSeqRef.current = next[0].seq;
        lastLogSeqRef.current = next[next.length - 1].seq;
        setHasMoreLogs(next[0].seq > 1);
        return next;
      });
    });
  }, []);

  // ─── 获取 WS Token ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/ws-token');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!cancelled && data.token) setToken(data.token);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ─── 拉取任务列表 ──────────────────────────────────────
  const fetchTasks = useCallback(async () => {
    setLoadingTasks(true);
    try {
      const resp = await fetch(`/api/server-tools/tasks?connectionId=${encodeURIComponent(connectionId)}`);
      const data = await resp.json();
      if (data.success) {
        setTasks(data.data);
      }
    } catch { /* ignore */ }
    finally { setLoadingTasks(false); }
  }, [connectionId]);

  useEffect(() => {
    fetchTasks();
    // 每 5s 刷新一次任务列表
    const timer = setInterval(fetchTasks, 5000);
    return () => clearInterval(timer);
  }, [fetchTasks]);

  // 外部触发立即刷新（如脚本任务创建后）
  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) {
      fetchTasks();
    }
  }, [refreshTrigger, fetchTasks]);

  // ─── 向上翻页加载更早日志（beforeSeq 分页） ────────────
  const fetchEarlierLogs = useCallback(async (taskId: string, beforeSeq: number) => {
    setLoadingLogs(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('beforeSeq', String(beforeSeq));
      const resp = await fetch(`/api/server-tools/tasks/${taskId}/logs?${params}`);
      const data = await resp.json();
      if (data.success) {
        const newLogs: TaskLog[] = data.data;
        if (newLogs.length === 0) {
          setHasMoreLogs(false);
          return;
        }
        setLogs(prev => {
          // 去重合并
          const existing = new Set(prev.map(l => l.seq));
          const filtered = newLogs.filter(l => !existing.has(l.seq));
          const next = [...filtered, ...prev].sort((a, b) => a.seq - b.seq);
          firstLogSeqRef.current = next[0].seq;
          return next;
        });
        setHasMoreLogs(newLogs.length >= 200);
      }
    } catch { /* ignore */ }
    finally { setLoadingLogs(false); }
  }, []);

  // ─── 选中任务 → 连接 WS（WS 推送历史 + 实时日志） ──────
  useEffect(() => {
    if (!selectedTaskId) {
      setLogs([]);
      return;
    }
    setLogs([]);
    firstLogSeqRef.current = null;
    lastLogSeqRef.current = null;
    autoScrollRef.current = true;
    manuallyClosedRef.current = false;
    reconnectCountRef.current = 0;
    prevLogCountRef.current = 0;
    pendingLogsRef.current = [];
    flushScheduledRef.current = false;
    setShowJumpToBottom(false);

    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const loginUser = getLoginUser();

    const connectWs = () => {
      if (manuallyClosedRef.current) return;
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/tasks?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectCountRef.current = 0;
        ws.send(JSON.stringify({ type: 'subscribe', taskId: selectedTaskId, loginUser }));
        pingTimerRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
          }
        }, 25000);
      };

      ws.onmessage = event => {
        let msg: { type: string; payload?: Record<string, unknown> };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        switch (msg.type) {
          case 'task_log': {
            const p = msg.payload as { taskId: string; seq: number; ts: string; level: LogLevel; msg: string };
            if (p.taskId !== selectedTaskId) return;
            // 放入批量缓冲，由 scheduleFlushLogs 在 microtask 中统一合并
            pendingLogsRef.current.push(p as TaskLog);
            scheduleFlushLogs();
            break;
          }
          case 'task_status': {
            const p = msg.payload as { id: string; status: TaskStatus; progress: number; error?: string };
            setTasks(prev => prev.map(t => t.id === p.id ? { ...t, status: p.status, progress: p.progress, error: p.error } : t));
            break;
          }
          case 'task_finished': {
            const p = msg.payload as { id: string; status: TaskStatus; btPanelId?: string };
            setTasks(prev => prev.map(t => t.id === p.id ? { ...t, status: p.status, isRunning: false } : t));
            if (p.status === 'success') {
              toast.success('任务完成');
            } else if (p.status === 'failed') {
              toast.error('任务失败');
            } else if (p.status === 'cancelled') {
              toast.warning('任务已取消');
            }
            // 任务结束后不再重连
            manuallyClosedRef.current = true;
            break;
          }
          case 'error': {
            const p = typeof msg.payload === 'string' ? msg.payload : JSON.stringify(msg.payload ?? '');
            toast.error(p);
            break;
          }
          case 'pong':
            break;
        }
      };

      ws.onerror = () => {
        // 不立即 toast，让 onclose 处理重连
      };

      ws.onclose = () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        // 自动重连（最多 3 次，间隔 2s）
        if (!manuallyClosedRef.current && reconnectCountRef.current < 3) {
          reconnectCountRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            if (!manuallyClosedRef.current) connectWs();
          }, 2000);
        }
      };
    };

    connectWs();

    return () => {
      manuallyClosedRef.current = true;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const ws = wsRef.current;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.send(JSON.stringify({ type: 'unsubscribe', taskId: selectedTaskId }));
        } catch { /* ignore */ }
        ws.close();
      }
    };
  }, [selectedTaskId, token]);

  // ─── 自动滚动到底部 ────────────────────────────────────
  // 策略：
  // - 单条新日志：smooth 平滑滚动
  // - 多条批量更新（如初始订阅推送、高频实时日志）：auto 即时滚动，避免动画堆积
  // - 用户手动向上滚动后：不自动滚动，保留查看历史能力
  // - 直接操作 scrollTop（比 scrollIntoView 更可靠，避免嵌套容器滚动混乱）
  const prevLogCountRef = useRef(0);
  useEffect(() => {
    if (!autoScrollRef.current || !logContainerRef.current) return;
    const delta = logs.length - prevLogCountRef.current;
    prevLogCountRef.current = logs.length;
    const behavior: ScrollBehavior = delta > 2 ? 'auto' : 'smooth';
    requestAnimationFrame(() => {
      if (autoScrollRef.current && logContainerRef.current) {
        logContainerRef.current.scrollTo({
          top: logContainerRef.current.scrollHeight,
          behavior,
        });
      }
    });
  }, [logs]);

  // ─── 日志滚动事件（检测顶部 → 加载更多；检测底部 → 启用自动滚动） ──
  const onLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    autoScrollRef.current = atBottom;
    setShowJumpToBottom(!atBottom && logs.length > 0);
    // 在顶部且还有更多
    if (el.scrollTop < 30 && hasMoreLogs && !loadingLogs && firstLogSeqRef.current !== null && selectedTaskId) {
      const prevHeight = el.scrollHeight;
      fetchEarlierLogs(selectedTaskId, firstLogSeqRef.current).then(() => {
        // 保持视觉位置
        requestAnimationFrame(() => {
          if (logContainerRef.current) {
            const newHeight = logContainerRef.current.scrollHeight;
            logContainerRef.current.scrollTop = newHeight - prevHeight;
          }
        });
      });
    }
  };

  // 手动跳转到底部
  const jumpToBottom = () => {
    autoScrollRef.current = true;
    setShowJumpToBottom(false);
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({
        top: logContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // ─── 创建任务 ──────────────────────────────────────────
  const handleCreate = async () => {
    const cmd = cmdInput.trim();
    if (!cmd) {
      toast.error('请输入命令');
      return;
    }
    setCreating(true);
    try {
      const loginUser = getLoginUser();
      const resp = await fetch('/api/server-tools/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          type: 'custom_cmd',
          title: cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd,
          params: { cmd },
          _loginUser: loginUser,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('任务已创建');
        setShowCreate(false);
        setCmdInput('');
        await fetchTasks();
        setSelectedTaskId(data.data.id);
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // ─── 取消任务（经确认对话框后执行） ───────────────────
  const handleCancel = async (taskId: string) => {
    setCancelling(true);
    try {
      const resp = await fetch(`/api/server-tools/tasks/${taskId}/cancel`, { method: 'POST' });
      const data = await resp.json();
      if (data.success) {
        // 后端已 abort + closeConnection，远程进程被强制终止
        toast.success('任务已停止，远程 SSH 连接已关闭', { duration: 2500 });
        await fetchTasks();
      } else {
        toast.error(data.message || '取消失败，任务可能已结束');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '取消失败');
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  };

  // ─── 删除任务 ──────────────────────────────────────────
  const handleDelete = async (taskId: string) => {
    if (!confirm('确定删除该任务及其日志？')) return;
    try {
      const resp = await fetch(`/api/server-tools/tasks/${taskId}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        toast.success('已删除');
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        await fetchTasks();
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const selectedTask = tasks.find(t => t.id === selectedTaskId);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider">任务</div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchTasks}
            disabled={loadingTasks}
            className="p-1 text-gray-500 hover:text-white"
            title="刷新"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingTasks ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(s => !s)}
            className="p-1 text-gray-500 hover:text-white"
            title="新建命令任务"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 创建表单 */}
      {showCreate && (
        <div className="mb-2 p-2 bg-gray-800/40 rounded border border-gray-700">
          <textarea
            value={cmdInput}
            onChange={e => setCmdInput(e.target.value)}
            placeholder="输入要执行的命令..."
            className="w-full h-16 text-xs bg-gray-900/60 border border-gray-700 rounded p-2 text-gray-200 resize-none focus:outline-none focus:border-emerald-500"
            autoFocus
          />
          <div className="flex justify-end gap-1 mt-1">
            <button
              onClick={() => { setShowCreate(false); setCmdInput(''); }}
              className="px-2 py-1 text-[11px] text-gray-400 hover:text-white"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-2 py-1 text-[11px] bg-emerald-700 hover:bg-emerald-600 text-white rounded flex items-center gap-1"
            >
              {creating && <Loader2 className="w-3 h-3 animate-spin" />}
              执行
            </button>
          </div>
        </div>
      )}

      {/* 任务列表 */}
      <div className="max-h-32 overflow-y-auto mb-2 space-y-1">
        {tasks.length === 0 && (
          <div className="text-[11px] text-gray-600 text-center py-3">暂无任务</div>
        )}
        {tasks.map(task => {
          const meta = STATUS_META[task.status];
          const Icon = meta.icon;
          const isSelected = task.id === selectedTaskId;
          return (
            <div
              key={task.id}
              onClick={() => setSelectedTaskId(isSelected ? null : task.id)}
              className={`p-1.5 rounded cursor-pointer border text-xs ${
                isSelected ? 'bg-emerald-900/30 border-emerald-700' : 'bg-gray-800/30 border-gray-800 hover:bg-gray-800/60'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Icon className={`w-3 h-3 ${meta.color} ${task.status === 'running' ? 'animate-spin' : ''}`} />
                <div className="flex-1 truncate text-gray-300">{task.title}</div>
                {task.isRunning && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setCancelTarget(task); }}
                    className="text-amber-500 hover:text-amber-400"
                    title="取消任务"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {!task.isRunning && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(task.id); }}
                    className="text-gray-600 hover:text-red-400"
                    title="删除"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-0.5 text-[10px] text-gray-500">
                <span>{TYPE_LABEL[task.type]}</span>
                <span>{meta.label} · {task.progress}%</span>
              </div>
              {task.status === 'running' && (
                <div className="h-0.5 bg-gray-700 rounded mt-1 overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${task.progress}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 日志区 */}
      <div className="flex-1 min-h-0 flex flex-col border-t border-gray-800 pt-2">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">
            {selectedTask ? '日志' : '选择任务查看日志'}
          </div>
          {selectedTask && (
            <div className="text-[10px] text-gray-600">{logs.length} 行</div>
          )}
        </div>

        {!selectedTask ? (
          <div className="flex-1 flex items-center justify-center text-[11px] text-gray-600">
            <Terminal className="w-4 h-4 mr-1 opacity-30" />
            点击上方任务查看日志
          </div>
        ) : (
          <div className="flex-1 min-h-0 relative">
            <div
              ref={logContainerRef}
              onScroll={onLogScroll}
              className="absolute inset-0 overflow-y-auto bg-black/40 rounded p-2 text-[11px] font-mono leading-relaxed"
            >
            {loadingLogs && logs.length === 0 ? (
              <div className="text-gray-500 flex items-center">
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
                加载中...
              </div>
            ) : logs.length === 0 ? (
              <div className="text-gray-600">暂无日志</div>
            ) : (
              <>
                {hasMoreLogs && (
                  <div className="text-center text-gray-600 py-1">
                    {loadingLogs ? '加载中...' : '↑ 向上滚动加载更多'}
                  </div>
                )}
                {logs.map(log => (
                  <div key={log.id} className="flex gap-1.5 hover:bg-white/5 px-0.5 rounded">
                    <span className="text-gray-600 shrink-0">{new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                    <span className={`shrink-0 ${LEVEL_COLOR[log.level]}`}>
                      {log.level === 'info' ? ' ' : `[${log.level.toUpperCase()}]`}
                    </span>
                    <span className={`whitespace-pre-wrap break-all ${LEVEL_COLOR[log.level]}`}>{log.msg}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </>
            )}
            </div>
            {/* 跳转到底部按钮 */}
            {showJumpToBottom && (
              <button
                onClick={jumpToBottom}
                className="absolute bottom-2 right-2 p-1.5 bg-zinc-800/90 hover:bg-zinc-700 text-blue-400 rounded-full border border-zinc-700 shadow-lg transition-colors"
                title="跳转到最新日志"
              >
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 取消任务确认对话框 */}
      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open && !cancelling) setCancelTarget(null); }}>
        <AlertDialogContent className="bg-[#222632] border-gray-700 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              确认取消任务
            </AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              取消后将<strong className="text-amber-400">立即关闭 SSH 连接</strong>并强制终止远程进程。
              <br />
              正在执行中的命令（如宝塔安装）将被中断，部分操作可能无法回滚。
              <br />
              <span className="text-gray-500">任务: {cancelTarget?.title}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling} className="bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700">
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              onClick={(e) => {
                e.preventDefault();
                if (cancelTarget) handleCancel(cancelTarget.id);
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {cancelling ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> 正在停止...</>
              ) : (
                '确认取消任务'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
