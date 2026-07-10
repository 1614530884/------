'use client';

/**
 * 任务日志查看弹窗
 *
 * 用于在服务器列表页点击任务条时，原地弹出显示任务的实时日志，
 * 无需跳转到详情页。
 *
 * 功能：
 * - 连接 /ws/tasks 订阅指定任务，实时接收日志
 * - 自动滚动到底部（用户向上滚动手动查看时不打断）
 * - 显示任务状态/进度
 * - 任务结束后自动断开 WS
 */
import { useEffect, useRef, useState } from 'react';
import {
  Loader2, X, Circle, CheckCircle2, XCircle, AlertTriangle, PauseCircle, ArrowDown,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted';
type LogLevel = 'info' | 'warn' | 'error' | 'success';

interface TaskLog {
  seq: number;
  ts: string;
  level: LogLevel;
  msg: string;
}

interface TaskLogDialogProps {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle?: string;
  taskType?: string;
  taskStatus?: TaskStatus;
  taskProgress?: number;
}

const STATUS_META: Record<TaskStatus, { label: string; color: string; icon: typeof Circle; spin?: boolean }> = {
  pending: { label: '等待', color: 'text-muted-foreground', icon: Circle },
  running: { label: '运行中', color: 'text-info', icon: Loader2, spin: true },
  success: { label: '成功', color: 'text-success', icon: CheckCircle2 },
  failed: { label: '失败', color: 'text-destructive', icon: XCircle },
  cancelled: { label: '已取消', color: 'text-warning', icon: PauseCircle },
  interrupted: { label: '已中断', color: 'text-warning', icon: AlertTriangle },
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: 'text-foreground/80',
  warn: 'text-warning',
  error: 'text-destructive',
  success: 'text-success',
};

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

export default function TaskLogDialog({
  taskId, open, onOpenChange,
  taskTitle, taskType, taskStatus, taskProgress,
}: TaskLogDialogProps) {
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus | undefined>(taskStatus);
  const [progress, setProgress] = useState<number | undefined>(taskProgress);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const manuallyClosedRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingLogsRef = useRef<TaskLog[]>([]);
  const flushScheduledRef = useRef(false);
  const seenSeqRef = useRef<Set<number>>(new Set());

  // 获取 WS Token
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // 同步外部传入的状态
  useEffect(() => {
    setStatus(taskStatus);
    setProgress(taskProgress);
  }, [taskStatus, taskProgress]);

  // 加载历史日志 + 连接 WS 订阅增量日志
  useEffect(() => {
    if (!open || !taskId || !token) return;

    setLogs([]);
    autoScrollRef.current = true;
    manuallyClosedRef.current = false;
    reconnectCountRef.current = 0;
    pendingLogsRef.current = [];
    flushScheduledRef.current = false;
    seenSeqRef.current = new Set();
    setShowJumpToBottom(false);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const loginUser = getLoginUser();

    const flushLogs = () => {
      flushScheduledRef.current = false;
      const pending = pendingLogsRef.current;
      if (pending.length === 0) return;
      pendingLogsRef.current = [];
      setLogs(prev => {
        const map = new Map(prev.map(l => [l.seq, l]));
        for (const l of pending) {
          if (!seenSeqRef.current.has(l.seq)) {
            seenSeqRef.current.add(l.seq);
            map.set(l.seq, l);
          }
        }
        return Array.from(map.values()).sort((a, b) => a.seq - b.seq);
      });
    };
    const scheduleFlush = () => {
      if (!flushScheduledRef.current) {
        flushScheduledRef.current = true;
        queueMicrotask(flushLogs);
      }
    };

    const connectWs = () => {
      if (manuallyClosedRef.current) return;
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/tasks?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectCountRef.current = 0;
        ws.send(JSON.stringify({ type: 'subscribe', taskId, loginUser }));
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
            if (p.taskId !== taskId) return;
            pendingLogsRef.current.push({ seq: p.seq, ts: p.ts, level: p.level, msg: p.msg });
            scheduleFlush();
            break;
          }
          case 'task_status': {
            const p = msg.payload as { id: string; status: TaskStatus; progress: number };
            setStatus(p.status);
            setProgress(p.progress);
            break;
          }
          case 'task_finished': {
            const p = msg.payload as { id: string; status: TaskStatus };
            setStatus(p.status);
            manuallyClosedRef.current = true;
            break;
          }
          case 'pong':
          case 'error':
            break;
        }
      };

      ws.onerror = () => { /* 由 onclose 处理重连 */ };

      ws.onclose = () => {
        if (pingTimerRef.current) {
          clearInterval(pingTimerRef.current);
          pingTimerRef.current = null;
        }
        if (!manuallyClosedRef.current && reconnectCountRef.current < 3) {
          reconnectCountRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            if (!manuallyClosedRef.current) connectWs();
          }, 2000);
        }
      };
    };

    // 1) 先加载历史日志（启动至今的全部日志，最多 5000 条）
    let historyCancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/api/server-tools/tasks/${taskId}/logs?limit=5000`);
        if (!resp.ok || historyCancelled) return;
        const data = await resp.json();
        const historyLogs: TaskLog[] = Array.isArray(data?.data) ? data.data : [];
        if (historyCancelled || historyLogs.length === 0) return;
        // 记录历史日志到 seenSeq，避免 WS 推送时重复
        for (const l of historyLogs) seenSeqRef.current.add(l.seq);
        setLogs(historyLogs);
      } catch {
        /* 历史日志加载失败，忽略，继续走 WS */
      }
    })();

    // 2) 立即建立 WS 接收增量日志（不等待历史日志加载完成，避免延迟）
    connectWs();

    return () => {
      historyCancelled = true;
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
          ws.send(JSON.stringify({ type: 'unsubscribe', taskId }));
        } catch { /* ignore */ }
        ws.close();
      }
      wsRef.current = null;
    };
  }, [open, taskId, token]);

  // 自动滚动到底部
  useEffect(() => {
    if (!autoScrollRef.current || !logContainerRef.current) return;
    requestAnimationFrame(() => {
      if (autoScrollRef.current && logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      }
    });
  }, [logs]);

  // 检测是否在底部
  const handleScroll = () => {
    const el = logContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
    setShowJumpToBottom(!atBottom && logs.length > 0);
  };

  const jumpToBottom = () => {
    autoScrollRef.current = true;
    if (logContainerRef.current) {
      logContainerRef.current.scrollTo({ top: logContainerRef.current.scrollHeight, behavior: 'smooth' });
    }
    setShowJumpToBottom(false);
  };

  const currentStatus = status ?? taskStatus ?? 'running';
  const meta = STATUS_META[currentStatus];
  const Icon = meta.icon;
  const isRunning = currentStatus === 'running';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-3xl w-[95vw] h-[80vh] flex flex-col p-0 gap-0">
        {/* 头部：任务标题 + 状态 */}
        <DialogHeader className="px-4 py-3 pr-12 border-b border-border shrink-0">
          <DialogTitle className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className={`w-4 h-4 ${meta.color} ${meta.spin ? 'animate-spin' : ''} shrink-0`} />
              <span className="truncate">{taskTitle || '任务日志'}</span>
              {taskType && (
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">({taskType})</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isRunning && progress !== undefined && (
                <span className="text-xs text-info font-mono">{progress}%</span>
              )}
              <span className={`text-xs ${meta.color}`}>{meta.label}</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* 日志区域 */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={logContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto bg-muted p-3 font-mono text-xs leading-relaxed"
          >
            {logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {isRunning ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" />等待日志输出...</>
                ) : (
                  <span>暂无日志</span>
                )}
              </div>
            ) : (
              logs.map(log => (
                <div key={log.seq} className="flex gap-2 py-0.5 hover:bg-accent/50">
                  <span className="text-muted-foreground shrink-0 select-none">
                    {log.ts ? new Date(log.ts).toLocaleTimeString('zh-CN', { hour12: false }) : ''}
                  </span>
                  <span className={`shrink-0 w-12 ${LEVEL_COLOR[log.level]}`}>
                    {log.level === 'success' ? '[OK]' : log.level === 'error' ? '[ERR]' : log.level === 'warn' ? '[WARN]' : '[INFO]'}
                  </span>
                  <span className={`break-all whitespace-pre-wrap ${LEVEL_COLOR[log.level]}`}>{log.msg}</span>
                </div>
              ))
            )}
          </div>

          {/* 跳转到底部按钮 */}
          {showJumpToBottom && (
            <button
              onClick={jumpToBottom}
              className="absolute bottom-2 right-2 p-1.5 bg-muted/90 hover:bg-accent text-info rounded-full border border-border shadow-lg transition-colors"
              title="跳转到最新日志"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 底部操作栏 */}
        <div className="px-4 py-2 border-t border-border shrink-0 flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{logs.length} 条日志</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="border-border text-foreground/80 hover:bg-muted"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            关闭
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
