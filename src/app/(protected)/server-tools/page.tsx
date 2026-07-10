'use client';

/**
 * 服务器管理工具 - 仪表盘
 *
 * 功能：
 * - 顶部统计卡（服务器数/运行中任务/今日完成/已装宝塔）
 * - 服务器列表（卡片式，响应式）
 * - 添加/编辑/删除服务器
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  TerminalSquare, Plus, Server, Activity,
  CheckCircle2, Shield, Loader2, Trash2, Pencil, RefreshCw, Code2,
  XCircle, PauseCircle, ClipboardList, ExternalLink,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/services/server-tools/api-client';
import TaskLogDialog from '@/components/server-tools/task-log-dialog';

interface ServerConnection {
  id: string;
  owner: string;
  name: string;
  host: string;
  port: number;
  username: string;
  description?: string;
  createdAt: string;
  lastConnectedAt?: string;
}

interface DashboardStats {
  totalConnections: number;
  runningTasks: number;
  todayCompleted: number;
  totalBtPanels: number;
  currentUser?: {
    username: string;
    isAdmin: boolean;
  };
}

interface RecentTask {
  id: string;
  connectionId: string;
  type: string;
  title: string;
  status: string;
  progress: number;
  finishedAt?: string;
  isRunning?: boolean;
}

interface BtPanelInfo {
  id: string;
  url?: string;
  innerUrl?: string;
  username?: string;
  password?: string;
  panelPort?: number;
}

type Scope = 'mine' | 'all';

// 读取 localStorage 中已查看任务的时间戳
function getSeenTimestamps(): Record<string, string> {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem('st_seen_tasks') : null;
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// 判断任务是否"未查看"（需要显示提示条）
function isTaskUnseen(task: RecentTask, seenMap: Record<string, string>): boolean {
  if (task.isRunning) return true; // 运行中始终显示
  if (!task.finishedAt) return true; // 无完成时间，当作未查看
  const seenTs = seenMap[task.connectionId];
  if (!seenTs) return true; // 该连接从未被查看过
  return new Date(task.finishedAt).getTime() > new Date(seenTs).getTime();
}

export default function ServerToolsPage() {
  const router = useRouter();
  const [connections, setConnections] = useState<ServerConnection[]>([]);
  const [stats, setStats] = useState<DashboardStats>({ totalConnections: 0, runningTasks: 0, todayCompleted: 0, totalBtPanels: 0 });
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);
  const [seenMap, setSeenMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingConn, setEditingConn] = useState<ServerConnection | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // BT 信息弹窗
  const [btDialogConn, setBtDialogConn] = useState<{ connId: string; connName: string } | null>(null);
  const [btPanels, setBtPanels] = useState<BtPanelInfo[]>([]);
  const [btLoading, setBtLoading] = useState(false);
  // 任务日志弹窗（点击任务条原地查看实时日志）
  const [logDialogTask, setLogDialogTask] = useState<RecentTask | null>(null);
  // 管理员可见切换：'mine' 仅自己的，'all' 全部用户（仅 admin 可用 all）
  const [scope, setScope] = useState<Scope>('mine');

  // 表单状态
  const [formName, setFormName] = useState('');
  const [formHost, setFormHost] = useState('');
  const [formPort, setFormPort] = useState('22');
  const [formUsername, setFormUsername] = useState('root');
  const [formPassword, setFormPassword] = useState('');
  const [formDescription, setFormDescription] = useState('');

  const fetchConnections = useCallback(async (s: Scope) => {
    setLoading(true);
    try {
      const url = `/api/server-tools/connections${s === 'all' ? '?scope=all' : ''}`;
      const result = await apiFetch<ServerConnection[]>(url);
      if (result.ok && result.data) {
        setConnections(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async (s: Scope) => {
    const url = `/api/server-tools/stats${s === 'all' ? '?scope=all' : ''}`;
    const result = await apiFetch<DashboardStats>(url);
    if (result.ok && result.data) {
      setStats(result.data);
    }
  }, []);

  const fetchRecentTasks = useCallback(async () => {
    const result = await apiFetch<RecentTask[]>('/api/server-tools/tasks?limit=100');
    if (result.ok && result.data) {
      setRecentTasks(result.data);
    }
    // 同步 seenMap
    setSeenMap(getSeenTimestamps());
  }, []);

  useEffect(() => {
    fetchConnections(scope);
    fetchStats(scope);
    fetchRecentTasks();
    // 每 5s 刷新任务状态
    const timer = setInterval(() => {
      fetchStats(scope);
      fetchRecentTasks();
    }, 5000);
    return () => clearInterval(timer);
  }, [scope, fetchConnections, fetchStats, fetchRecentTasks]);

  // 按连接分组需要显示的任务（运行中 + 未查看的已完成）
  const tasksByConn = new Map<string, RecentTask[]>();
  for (const t of recentTasks) {
    if (!isTaskUnseen(t, seenMap)) continue;
    if (!tasksByConn.has(t.connectionId)) tasksByConn.set(t.connectionId, []);
    tasksByConn.get(t.connectionId)!.push(t);
  }

  // 点击任务条：宝塔安装成功 → 弹出宝塔信息；其他 → 原地弹出实时日志
  const handleTaskClick = (task: RecentTask, connName: string) => {
    if (task.type === 'install_bt' && task.status === 'success' && !task.isRunning) {
      openBtDialog(task.connectionId, connName);
    } else {
      setLogDialogTask(task);
    }
  };

  // 打开宝塔信息弹窗
  const openBtDialog = async (connId: string, connName: string) => {
    setBtDialogConn({ connId, connName });
    setBtLoading(true);
    setBtPanels([]);
    try {
      const resp = await fetch(`/api/server-tools/bt-panels?connectionId=${encodeURIComponent(connId)}`);
      const data = await resp.json();
      if (data.success) {
        setBtPanels(data.data);
      }
    } catch { /* ignore */ }
    finally { setBtLoading(false); }
  };

  // 复制全部宝塔信息
  const handleCopyAllBt = (panel: BtPanelInfo) => {
    const lines: string[] = ['=== 宝塔面板信息 ==='];
    if (panel.url) lines.push(`外网面板地址: ${panel.url}`);
    if (panel.innerUrl) lines.push(`内网面板地址: ${panel.innerUrl}`);
    if (panel.username) lines.push(`面板账号: ${panel.username}`);
    if (panel.password) lines.push(`面板密码: ${panel.password}`);
    if (panel.panelPort) lines.push(`面板端口: ${panel.panelPort}`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast.success('已复制全部宝塔信息', { duration: 2000 });
    }).catch(() => {
      toast.error('复制失败，请手动复制');
    });
  };

  // 切换 scope（仅管理员可切换到 'all'）
  const toggleScope = (next: Scope) => {
    if (next === 'all' && !stats.currentUser?.isAdmin) return;
    setScope(next);
  };

  const openAddDialog = () => {
    setEditingConn(null);
    setFormName('');
    setFormHost('');
    setFormPort('22');
    setFormUsername('root');
    setFormPassword('');
    setFormDescription('');
    setShowAddDialog(true);
  };

  const openEditDialog = (conn: ServerConnection) => {
    setEditingConn(conn);
    setFormName(conn.name);
    setFormHost(conn.host);
    setFormPort(String(conn.port));
    setFormUsername(conn.username);
    setFormPassword(''); // 编辑时密码留空表示不修改
    setFormDescription(conn.description ?? '');
    setShowAddDialog(true);
  };

  const handleSubmit = async () => {
    if (!formName || !formHost || !formUsername) {
      toast.error('请填写名称、主机、用户名');
      return;
    }
    if (!editingConn && !formPassword) {
      toast.error('请填写密码');
      return;
    }
    setSubmitting(true);
    try {
      const isEdit = !!editingConn;
      const body: Record<string, unknown> = {
        name: formName,
        host: formHost,
        port: parseInt(formPort, 10) || 22,
        username: formUsername,
        description: formDescription || undefined,
      };
      if (!isEdit || formPassword) body.password = formPassword;

      const url = isEdit ? `/api/server-tools/connections/${editingConn!.id}` : '/api/server-tools/connections';
      const method = isEdit ? 'PATCH' : 'POST';
      const result = await apiFetch<ServerConnection>(url, {
        method,
        body: JSON.stringify(body),
      });
      if (result.ok) {
        toast.success(isEdit ? '更新成功' : '添加成功');
        setShowAddDialog(false);
        fetchConnections(scope);
        fetchStats(scope);
      } else if (result.status !== 401) {
        toast.error(result.message || '操作失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const result = await apiFetch(`/api/server-tools/connections/${deleteId}`, { method: 'DELETE' });
    if (result.ok) {
      toast.success('删除成功');
      setDeleteId(null);
      fetchConnections(scope);
      fetchStats(scope);
    } else if (result.status !== 401) {
      toast.error(result.message || '删除失败');
    }
  };

  return (
    <div className="min-h-screen">
      <PageHeader
        title="服务器工具"
        titleIcon={TerminalSquare}
        actions={
          <>
            <button
              onClick={() => router.push('/server-tools/scripts')}
              title="脚本管理"
              className="flex items-center gap-1.5 text-xs sm:text-sm border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground h-8 px-2 sm:px-3 rounded-md transition-colors shrink-0"
            >
              <Code2 className="w-4 h-4" />
              <span className="hidden md:inline">脚本</span>
            </button>
            <button
              onClick={() => router.push('/server-tools/cleanup')}
              title="清理规则"
              className="flex items-center gap-1.5 text-xs sm:text-sm border border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground h-8 px-2 sm:px-3 rounded-md transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline">清理</span>
            </button>
            <Button onClick={openAddDialog} size="sm" className="bg-success hover:bg-success/90 text-success-foreground">
              <Plus className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">添加服务器</span>
            </Button>
          </>
        }
      />

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-6">
        {/* 统计卡 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Server} label="服务器" value={stats.totalConnections} color="emerald" />
          <StatCard icon={Activity} label="运行中任务" value={stats.runningTasks} color="amber" />
          <StatCard icon={CheckCircle2} label="今日完成" value={stats.todayCompleted} color="emerald" />
          <StatCard icon={Shield} label="已装宝塔" value={stats.totalBtPanels} color="purple" />
        </div>

        {/* 服务器列表 */}
        <div>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold text-foreground">服务器列表</h2>
              {stats.currentUser?.isAdmin && (
                <div className="flex items-center bg-muted rounded-md p-0.5 border border-border">
                  <button
                    onClick={() => toggleScope('mine')}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'mine' ? 'bg-success text-success-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    我的
                  </button>
                  <button
                    onClick={() => toggleScope('all')}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'all' ? 'bg-success text-success-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    全部
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => fetchConnections(scope)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              加载中...
            </div>
          ) : connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border rounded-lg">
              <Server className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm mb-3">暂无服务器记录</p>
              <Button onClick={openAddDialog} variant="outline" size="sm" className="border-border text-foreground hover:bg-accent">
                <Plus className="w-4 h-4 mr-1" />
                添加第一台服务器
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {connections.map(conn => (
                <div
                  key={conn.id}
                  className="bg-card border border-border rounded-lg p-4 hover:border-success/30 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/server-tools/${conn.id}`)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                        <Server className="w-4 h-4 text-success" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">{conn.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{conn.host}:{conn.port}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openEditDialog(conn)}
                        className="p-1.5 text-muted-foreground hover:text-primary hover:bg-accent rounded"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteId(conn.id)}
                        className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-accent rounded"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {conn.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{conn.description}</p>
                  )}
                  {(tasksByConn.get(conn.id) ?? []).length > 0 && (
                    <div className="mb-2 space-y-1">
                      {(tasksByConn.get(conn.id) ?? []).map(t => {
                        const isRunning = t.isRunning;
                        const isBtSuccess = t.type === 'install_bt' && t.status === 'success' && !isRunning;
                        // 根据状态选择样式
                        let barClass = 'bg-primary/10 border-primary/30';
                        let iconClass = 'text-primary animate-spin';
                        let textClass = 'text-primary';
                        let progressClass = 'text-primary';
                        let Icon = Loader2;
                        if (isRunning) {
                          barClass = 'bg-primary/10 border-primary/30 hover:border-primary/50 cursor-pointer';
                          iconClass = 'text-primary animate-spin';
                          textClass = 'text-primary';
                          progressClass = 'text-primary';
                          Icon = Loader2;
                        } else if (t.status === 'success') {
                          barClass = isBtSuccess
                            ? 'bg-success/10 border-success/30 hover:border-success/50 cursor-pointer'
                            : 'bg-success/10 border-success/30 hover:border-success/50 cursor-pointer';
                          iconClass = 'text-success';
                          textClass = 'text-success/80';
                          progressClass = 'text-success';
                          Icon = isBtSuccess ? Shield : CheckCircle2;
                        } else if (t.status === 'failed') {
                          barClass = 'bg-destructive/10 border-destructive/30 hover:border-destructive/50 cursor-pointer';
                          iconClass = 'text-destructive';
                          textClass = 'text-destructive/80';
                          progressClass = 'text-destructive';
                          Icon = XCircle;
                        } else if (t.status === 'cancelled') {
                          barClass = 'bg-warning/10 border-warning/30 hover:border-warning/50 cursor-pointer';
                          iconClass = 'text-warning';
                          textClass = 'text-warning/80';
                          progressClass = 'text-warning';
                          Icon = PauseCircle;
                        }
                        return (
                          <div
                            key={t.id}
                            onClick={(e) => { e.stopPropagation(); handleTaskClick(t, conn.name); }}
                            className={`flex items-center gap-1.5 text-[10px] border rounded px-2 py-1 transition-colors ${barClass}`}
                          >
                            <Icon className={`w-2.5 h-2.5 ${iconClass} shrink-0`} />
                            <span className={`${textClass} truncate flex-1`} title={t.title}>{t.title}</span>
                            {isRunning && (
                              <span className={`${progressClass} shrink-0 font-mono`}>{t.progress}%</span>
                            )}
                            {isBtSuccess && (
                              <span className="shrink-0 text-success">点击查看面板信息</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">@{conn.username}</span>
                      {scope === 'all' && (
                        <span className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] shrink-0" title={`添加者: ${conn.owner}`}>
                          {conn.owner}
                        </span>
                      )}
                    </div>
                    {conn.lastConnectedAt && (
                      <span className="shrink-0">最近: {new Date(conn.lastConnectedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 添加/编辑弹窗 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle>{editingConn ? '编辑服务器' : '添加服务器'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-foreground">名称 *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="例：客户A-Web服务器" className="bg-muted border-border" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-foreground">主机 *</Label>
                <Input value={formHost} onChange={e => setFormHost(e.target.value)} placeholder="IP 或域名" className="bg-muted border-border" />
              </div>
              <div>
                <Label className="text-foreground">端口</Label>
                <Input value={formPort} onChange={e => setFormPort(e.target.value)} type="number" className="bg-muted border-border" />
              </div>
            </div>
            <div>
              <Label className="text-foreground">用户名 *</Label>
              <Input value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder="root" className="bg-muted border-border" />
            </div>
            <div>
              <Label className="text-foreground">
                密码 {editingConn && <span className="text-muted-foreground">（留空表示不修改）</span>} {!editingConn && '*'}
              </Label>
              <Input value={formPassword} onChange={e => setFormPassword(e.target.value)} type="password" placeholder="••••••••" className="bg-muted border-border" />
            </div>
            <div>
              <Label className="text-foreground">备注</Label>
              <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="可选" rows={2} className="bg-muted border-border resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-border text-foreground hover:bg-accent">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="bg-success hover:bg-success/90 text-success-foreground">
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editingConn ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-card border-border text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该服务器？</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              将删除该服务器的连接记录（密码等敏感信息），此操作不可恢复。关联的历史任务和宝塔信息会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border text-foreground hover:bg-accent">取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 宝塔面板信息弹窗 */}
      <Dialog open={btDialogConn !== null} onOpenChange={(open) => { if (!open) { setBtDialogConn(null); setBtPanels([]); } }}>
        <DialogContent className="bg-card border-border text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-success" />
              宝塔面板信息
              {btDialogConn && <span className="text-xs text-muted-foreground font-normal">· {btDialogConn.connName}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {btLoading ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                加载中...
              </div>
            ) : btPanels.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                暂无宝塔面板信息
              </div>
            ) : (
              btPanels.map(panel => (
                <div key={panel.id} className="p-3 bg-muted/40 rounded border border-border/50 text-xs space-y-1.5">
                  {panel.url && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0 w-16">外网地址</span>
                      <span className="flex-1 truncate text-success" title={panel.url}>{panel.url}</span>
                      <a href={panel.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  {panel.innerUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0 w-16">内网地址</span>
                      <span className="flex-1 truncate text-primary" title={panel.innerUrl}>{panel.innerUrl}</span>
                    </div>
                  )}
                  {panel.username && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0 w-16">面板账号</span>
                      <span className="flex-1 truncate text-foreground">{panel.username}</span>
                    </div>
                  )}
                  {panel.password && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground shrink-0 w-16">面板密码</span>
                      <span className="flex-1 truncate text-foreground font-mono">{panel.password}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-border/50">
                    <button
                      onClick={() => handleCopyAllBt(panel)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-success/15 hover:bg-success/25 text-success/80 rounded border border-success/30 w-full justify-center"
                    >
                      <ClipboardList className="w-3.5 h-3.5" />
                      一键复制全部信息
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBtDialogConn(null); setBtPanels([]); }} className="border-border text-foreground hover:bg-accent">
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 任务实时日志弹窗 */}
      <TaskLogDialog
        taskId={logDialogTask?.id ?? null}
        open={logDialogTask !== null}
        onOpenChange={(open) => { if (!open) setLogDialogTask(null); }}
        taskTitle={logDialogTask?.title}
        taskType={logDialogTask?.type}
        taskStatus={logDialogTask?.status as 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'interrupted' | undefined}
        taskProgress={logDialogTask?.progress}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Server; label: string; value: number; color: 'emerald' | 'amber' | 'blue' | 'purple' }) {
  const colorMap = {
    emerald: 'text-success bg-success/10',
    amber: 'text-warning bg-warning/10',
    blue: 'text-info bg-info/10',
    purple: 'text-accent2 bg-accent2/10',
  };
  return (
    <div className="bg-card border border-border rounded-lg p-3 sm:p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl sm:text-2xl font-bold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground truncate">{label}</div>
      </div>
    </div>
  );
}
