'use client';

/**
 * 服务器管理工具 - 详情页
 *
 * 三栏布局：
 * - 中间：SSH 终端
 * - 左侧（移动端折叠为顶部 Sheet）：连接信息 + 快捷命令
 * - 右侧（移动端折叠为底部 Sheet）：任务面板 + 宝塔信息
 */
import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Server, Loader2,
  HardDrive, Shield, ChevronLeft, ChevronRight, Activity, RefreshCw, Folder, Code2,
} from 'lucide-react';
import ErrorBoundary from '@/components/error-boundary';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/services/server-tools/api-client';
import type { SshTerminalHandle } from '@/components/server-tools/ssh-terminal';
import type { ServerStats } from '@/components/server-tools/system-stats-bar';

const SshTerminal = lazy(() => import('@/components/server-tools/ssh-terminal'));
const TaskPanel = lazy(() => import('@/components/server-tools/task-panel'));
const DiskMountDialog = lazy(() => import('@/components/server-tools/disk-mount-dialog'));
const BtInstallDialog = lazy(() => import('@/components/server-tools/bt-install-dialog'));
const BtInfoCard = lazy(() => import('@/components/server-tools/bt-info-card'));
const FileManager = lazy(() => import('@/components/server-tools/file-manager'));
const ScriptPicker = lazy(() => import('@/components/server-tools/script-picker'));
const SystemStatsBar = lazy(() => import('@/components/server-tools/system-stats-bar'));

interface ServerConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  description?: string;
}

interface DiskDetectResult {
  unmountedDisks: Array<{ name: string; size: string; fstype: string; transport?: string }>;
  rootDisk?: string;
}

export default function ServerToolsDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTaskId = searchParams.get('task') ?? undefined;
  const [conn, setConn] = useState<ServerConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [terminalStatus, setTerminalStatus] = useState('idle');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'none' | 'left' | 'right'>('none');
  const [showMountDialog, setShowMountDialog] = useState(false);
  const [showBtInstallDialog, setShowBtInstallDialog] = useState(false);
  const [diskDetectResult, setDiskDetectResult] = useState<DiskDetectResult | null>(null);
  const [btInfoRefresh, setBtInfoRefresh] = useState(0);
  const [showFileManager, setShowFileManager] = useState(false);
  const [showScriptPicker, setShowScriptPicker] = useState(false);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [serverStats, setServerStats] = useState<ServerStats | null>(null);
  const terminalHandleRef = useRef<SshTerminalHandle | null>(null);

  const fetchConn = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<ServerConnection>(`/api/server-tools/connections/${params.id}`);
      if (result.ok && result.data) {
        setConn(result.data);
      } else if (result.status !== 401) {
        toast.error(result.message || '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    fetchConn();
  }, [fetchConn]);

  // 标记该连接的所有任务为"已查看"（列表页据此隐藏已完成任务提示条）
  useEffect(() => {
    if (!params.id) return;
    try {
      const raw = localStorage.getItem('st_seen_tasks');
      const seen = raw ? JSON.parse(raw) : {};
      seen[params.id] = new Date().toISOString();
      localStorage.setItem('st_seen_tasks', JSON.stringify(seen));
    } catch { /* ignore */ }
  }, [params.id]);

  const sendToTerminal = (type: string, payload?: unknown) => {
    terminalHandleRef.current?.send(type, payload);
  };

  // 稳定引用：避免 DiskMountDialog 的 useEffect 因 onDetectDisks 每次渲染新引用而无限触发检测
  const handleDetectDisks = useCallback(() => {
    terminalHandleRef.current?.send('check_datadisk');
  }, []);

  // 快捷命令
  const quickCommands: Array<{ label: string; cmd: string; icon: typeof Activity; color: string }> = [
    { label: '系统信息', cmd: 'uname -a && uptime && free -h && df -h\n', icon: Activity, color: 'text-info' },
    { label: '查看进程', cmd: 'ps aux --sort=-%cpu | head -20\n', icon: Activity, color: 'text-success' },
    { label: '网络监听', cmd: 'ss -tlnp\n', icon: Activity, color: 'text-primary' },
    { label: '最近登录', cmd: 'last -n 10\n', icon: Activity, color: 'text-warning' },
  ];

  const sendCommand = (cmd: string) => {
    terminalHandleRef.current?.write(cmd);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  if (!conn) {
    return (
      <div className="min-h-screen bg-card flex flex-col items-center justify-center text-muted-foreground">
        <Server className="w-12 h-12 mb-3 opacity-30" />
        <p className="mb-3">服务器记录不存在或无权访问</p>
        <Button onClick={() => router.push('/server-tools')} variant="outline" size="sm" className="border-border text-foreground hover:bg-accent">
          返回列表
        </Button>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* 顶部导航 */}
      <div className="shrink-0 bg-background px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => router.push('/server-tools')} className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                <Server className="w-4 h-4 text-success" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{conn.name}</div>
                <div className="text-xs text-muted-foreground truncate">{conn.host}:{conn.port} · @{conn.username}</div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 移动端面板切换 */}
            <button
              onClick={() => setMobilePanel(mobilePanel === 'left' ? 'none' : 'left')}
              className="md:hidden text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            >
              <HardDrive className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setMobilePanel(mobilePanel === 'right' ? 'none' : 'right')}
              className="md:hidden text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
            >
              <Activity className="w-3.5 h-3.5" />
            </button>
            {/* 文件管理切换 */}
            <button
              onClick={() => setShowFileManager(s => !s)}
              className={`flex items-center gap-1 text-xs border rounded px-2 py-1 ${
                showFileManager
                  ? 'text-success border-success/40 bg-success/10'
                  : 'text-muted-foreground hover:text-foreground border-border'
              }`}
              title="文件管理"
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">文件</span>
            </button>
            <div className="hidden sm:flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${
                terminalStatus === 'connected' ? 'bg-success' :
                terminalStatus === 'connecting' || terminalStatus === 'creating_shell' ? 'bg-warning animate-pulse' :
                terminalStatus === 'error' ? 'bg-destructive' : 'bg-muted-foreground'
              }`} />
              <span className="text-muted-foreground">{terminalStatus}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 主体三栏 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左栏：快捷命令 */}
        {mobilePanel === 'left' && (
          <div className="md:hidden fixed inset-0 z-20 bg-black/50" onClick={() => setMobilePanel('none')} />
        )}
        <aside className={`
          ${mobilePanel === 'left' ? 'fixed left-0 top-12 bottom-0 z-30 w-72 bg-card border-r border-border' : 'hidden'}
          md:${leftCollapsed ? 'hidden' : 'flex'} md:flex-col md:w-64 md:shrink-0 md:border-r md:border-border md:bg-card md:relative
          flex flex-col overflow-y-auto
        `}>
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">快捷命令</h3>
            <button onClick={() => setLeftCollapsed(true)} className="hidden md:block text-muted-foreground hover:text-foreground">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* 一键功能 */}
          <div className="p-3 space-y-2">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">一键功能</div>
            <button
              onClick={() => setShowMountDialog(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground bg-muted hover:bg-accent/50 rounded border border-border"
            >
              <HardDrive className="w-3.5 h-3.5 text-info" />
              挂载数据盘
            </button>
            <button
              onClick={() => setShowBtInstallDialog(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground bg-muted hover:bg-accent/50 rounded border border-border"
            >
              <Shield className="w-3.5 h-3.5 text-success" />
              安装宝塔
            </button>
            <button
              onClick={() => setShowScriptPicker(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground bg-muted hover:bg-accent/50 rounded border border-border"
            >
              <Code2 className="w-3.5 h-3.5 text-primary" />
              运行脚本
            </button>
          </div>

          {/* 实时资源监控（侧栏垂直布局） */}
          <div className="p-3 border-t border-border">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">实时监控</div>
            <Suspense fallback={null}>
              <SystemStatsBar
                connected={terminalStatus === 'connected'}
                onRequestStats={() => sendToTerminal('get_stats')}
                stats={serverStats}
                variant="vertical"
              />
            </Suspense>
          </div>

          {/* 快捷命令 */}
          <div className="p-3 space-y-1.5">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">常用命令</div>
            {quickCommands.map(cmd => {
              const Icon = cmd.icon;
              return (
                <button
                  key={cmd.label}
                  onClick={() => sendCommand(cmd.cmd)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent rounded"
                >
                  <Icon className={`w-3.5 h-3.5 ${cmd.color}`} />
                  {cmd.label}
                </button>
              );
            })}
          </div>

          {/* 连接信息 */}
          <div className="p-3 mt-auto border-t border-border">
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">连接信息</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>主机</span><span className="text-foreground">{conn.host}</span></div>
              <div className="flex justify-between"><span>端口</span><span className="text-foreground">{conn.port}</span></div>
              <div className="flex justify-between"><span>用户</span><span className="text-foreground">{conn.username}</span></div>
              {conn.description && <div className="pt-1 text-muted-foreground">{conn.description}</div>}
            </div>
          </div>
        </aside>

        {/* 中间：终端 + 文件管理器 */}
        <main className="flex-1 flex flex-col overflow-hidden relative">
          {leftCollapsed && (
            <button
              onClick={() => setLeftCollapsed(false)}
              className="absolute left-2 top-2 z-10 p-1.5 bg-muted hover:bg-accent text-foreground rounded border border-border"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          {rightCollapsed && (
            <button
              onClick={() => setRightCollapsed(false)}
              className="absolute right-2 top-2 z-10 p-1.5 bg-muted hover:bg-accent text-foreground rounded border border-border"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
          <div className={showFileManager ? 'flex-1 min-h-0 h-[60%]' : 'flex-1 min-h-0'}>
            <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载终端...</div>}>
              <SshTerminal
                ref={terminalHandleRef}
                connectionId={conn.id}
                host={conn.host}
                port={conn.port}
                username={conn.username}
                password={conn.password}
                onStatusChange={setTerminalStatus}
                onStats={(stats) => setServerStats(stats as ServerStats)}
                onDataDisk={(result) => setDiskDetectResult(result as DiskDetectResult)}
              />
            </Suspense>
          </div>
          {showFileManager && (
            <div className="h-[40%] min-h-[200px] border-t border-border flex flex-col">
              <ErrorBoundary fallbackTitle="文件管理加载出错">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载文件管理...</div>}>
                  <FileManager connectionId={conn.id} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </main>

        {/* 右栏：任务面板（P3 阶段实现） */}
        {mobilePanel === 'right' && (
          <div className="md:hidden fixed inset-0 z-20 bg-black/50" onClick={() => setMobilePanel('none')} />
        )}
        <aside className={`
          ${mobilePanel === 'right' ? 'fixed right-0 top-12 bottom-0 z-30 w-[88vw] max-w-sm bg-card border-l border-border' : 'hidden'}
          md:${rightCollapsed ? 'hidden' : 'flex'} md:flex-col md:w-72 md:shrink-0 md:border-l md:border-border md:bg-card md:relative
          flex flex-col overflow-y-auto
        `}>
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">任务 & 宝塔</h3>
            <button onClick={() => setRightCollapsed(true)} className="hidden md:block text-muted-foreground hover:text-foreground">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 p-3 min-h-0 flex flex-col">
            <Suspense fallback={<div className="flex items-center justify-center text-xs text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-1" />加载...</div>}>
              <TaskPanel connectionId={conn.id} refreshTrigger={taskRefresh} initialTaskId={initialTaskId} />
            </Suspense>
            <div className="mt-3 pt-3 border-t border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-muted-foreground uppercase tracking-wider">宝塔信息</div>
                <button
                  onClick={() => setBtInfoRefresh(r => r + 1)}
                  className="text-muted-foreground hover:text-foreground"
                  title="刷新"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <Suspense fallback={<div className="text-[11px] text-muted-foreground">加载中...</div>}>
                <BtInfoCard connectionId={conn.id} refreshTrigger={btInfoRefresh} />
              </Suspense>
            </div>
          </div>
        </aside>
      </div>

      {/* 弹窗 */}
      <Suspense fallback={null}>
        <DiskMountDialog
          open={showMountDialog}
          onClose={() => setShowMountDialog(false)}
          connectionId={conn.id}
          onDetectDisks={handleDetectDisks}
          detectResult={diskDetectResult}
        />
      </Suspense>
      <Suspense fallback={null}>
        <BtInstallDialog
          open={showBtInstallDialog}
          onClose={() => setShowBtInstallDialog(false)}
          connectionId={conn.id}
          onTaskCreated={() => setBtInfoRefresh(r => r + 1)}
        />
      </Suspense>
      <Suspense fallback={null}>
        <ScriptPicker
          open={showScriptPicker}
          onOpenChange={setShowScriptPicker}
          connectionId={conn.id}
          onTaskCreated={() => setTaskRefresh(r => r + 1)}
          onRunInTerminal={(cmd) => terminalHandleRef.current?.write(cmd)}
        />
      </Suspense>
    </div>
  );
}
