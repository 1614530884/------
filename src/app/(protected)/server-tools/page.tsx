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
  ArrowLeft, TerminalSquare, Plus, Server, Activity,
  CheckCircle2, Shield, Loader2, Trash2, Pencil, RefreshCw, Code2,
  XCircle, PauseCircle, ClipboardList, ExternalLink,
} from 'lucide-react';
import MobileSidebar from '@/components/mobile-sidebar';
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
    <div className="min-h-screen bg-[#1a1d27] text-gray-100">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-10 bg-[#1a1d27] border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2">
          <MobileSidebar currentPath="/server-tools" variant="subpage" />
          <button onClick={() => router.push('/')} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors shrink-0 min-h-[44px] min-w-[44px]">
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline">首页</span>
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2 shrink-0">
            <TerminalSquare className="w-5 h-5 text-emerald-500" />
            <span className="hidden sm:inline">服务器工具</span>
          </h1>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => router.push('/server-tools/scripts')}
              title="脚本管理"
              className="flex items-center gap-1.5 text-xs sm:text-sm border border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 hover:text-white h-8 px-2 sm:px-3 rounded-md transition-colors shrink-0"
            >
              <Code2 className="w-4 h-4" />
              <span className="hidden md:inline">脚本</span>
            </button>
            <button
              onClick={() => router.push('/server-tools/cleanup')}
              title="清理规则"
              className="flex items-center gap-1.5 text-xs sm:text-sm border border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 hover:text-white h-8 px-2 sm:px-3 rounded-md transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
              <span className="hidden md:inline">清理</span>
            </button>
            <Button onClick={openAddDialog} size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">添加服务器</span>
            </Button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-3 py-4 sm:px-6 sm:py-6 space-y-6">
        {/* 统计卡 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={Server} label="服务器" value={stats.totalConnections} color="emerald" />
          <StatCard icon={Activity} label="运行中任务" value={stats.runningTasks} color="amber" />
          <StatCard icon={CheckCircle2} label="今日完成" value={stats.todayCompleted} color="blue" />
          <StatCard icon={Shield} label="已装宝塔" value={stats.totalBtPanels} color="purple" />
        </div>

        {/* 服务器列表 */}
        <div>
          <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-base font-semibold text-gray-200">服务器列表</h2>
              {stats.currentUser?.isAdmin && (
                <div className="flex items-center bg-gray-800/60 rounded-md p-0.5 border border-gray-700">
                  <button
                    onClick={() => toggleScope('mine')}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'mine' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    我的
                  </button>
                  <button
                    onClick={() => toggleScope('all')}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'all' ? 'bg-emerald-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
                  >
                    全部
                  </button>
                </div>
              )}
            </div>
            <button onClick={() => fetchConnections(scope)} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              加载中...
            </div>
          ) : connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500 border border-dashed border-gray-700 rounded-lg">
              <Server className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm mb-3">暂无服务器记录</p>
              <Button onClick={openAddDialog} variant="outline" size="sm" className="border-gray-700 text-gray-300 hover:bg-gray-800">
                <Plus className="w-4 h-4 mr-1" />
                添加第一台服务器
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {connections.map(conn => (
                <div
                  key={conn.id}
                  className="bg-[#222632] border border-gray-800 rounded-lg p-4 hover:border-emerald-700/50 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/server-tools/${conn.id}`)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <Server className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-gray-100 truncate">{conn.name}</div>
                        <div className="text-xs text-gray-500 truncate">{conn.host}:{conn.port}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => openEditDialog(conn)}
                        className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-gray-800 rounded"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteId(conn.id)}
                        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {conn.description && (
                    <p className="text-xs text-gray-500 mb-2 line-clamp-2">{conn.description}</p>
                  )}
                  {(tasksByConn.get(conn.id) ?? []).length > 0 && (
                    <div className="mb-2 space-y-1">
                      {(tasksByConn.get(conn.id) ?? []).map(t => {
                        const isRunning = t.isRunning;
                        const isBtSuccess = t.type === 'install_bt' && t.status === 'success' && !isRunning;
                        // 根据状态选择样式
                        let barClass = 'bg-blue-900/20 border-blue-800/50';
                        let iconClass = 'text-blue-400 animate-spin';
                        let textClass = 'text-blue-300';
                        let progressClass = 'text-blue-400';
                        let Icon = Loader2;
                        if (isRunning) {
                          barClass = 'bg-blue-900/20 border-blue-800/50 hover:border-blue-600 cursor-pointer';
                          iconClass = 'text-blue-400 animate-spin';
                          textClass = 'text-blue-300';
                          progressClass = 'text-blue-400';
                          Icon = Loader2;
                        } else if (t.status === 'success') {
                          barClass = isBtSuccess
                            ? 'bg-emerald-900/20 border-emerald-800/50 hover:border-emerald-600 cursor-pointer'
                            : 'bg-emerald-900/20 border-emerald-800/50 hover:border-emerald-600 cursor-pointer';
                          iconClass = 'text-emerald-400';
                          textClass = 'text-emerald-300';
                          progressClass = 'text-emerald-400';
                          Icon = isBtSuccess ? Shield : CheckCircle2;
                        } else if (t.status === 'failed') {
                          barClass = 'bg-red-900/20 border-red-800/50 hover:border-red-600 cursor-pointer';
                          iconClass = 'text-red-400';
                          textClass = 'text-red-300';
                          progressClass = 'text-red-400';
                          Icon = XCircle;
                        } else if (t.status === 'cancelled') {
                          barClass = 'bg-amber-900/20 border-amber-800/50 hover:border-amber-600 cursor-pointer';
                          iconClass = 'text-amber-400';
                          textClass = 'text-amber-300';
                          progressClass = 'text-amber-400';
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
                              <span className="shrink-0 text-emerald-400">点击查看面板信息</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate">@{conn.username}</span>
                      {scope === 'all' && (
                        <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-[10px] shrink-0" title={`添加者: ${conn.owner}`}>
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
        <DialogContent className="bg-[#222632] border-gray-700 text-gray-100 max-w-md">
          <DialogHeader>
            <DialogTitle>{editingConn ? '编辑服务器' : '添加服务器'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-gray-300">名称 *</Label>
              <Input value={formName} onChange={e => setFormName(e.target.value)} placeholder="例：客户A-Web服务器" className="bg-gray-800/50 border-gray-700" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Label className="text-gray-300">主机 *</Label>
                <Input value={formHost} onChange={e => setFormHost(e.target.value)} placeholder="IP 或域名" className="bg-gray-800/50 border-gray-700" />
              </div>
              <div>
                <Label className="text-gray-300">端口</Label>
                <Input value={formPort} onChange={e => setFormPort(e.target.value)} type="number" className="bg-gray-800/50 border-gray-700" />
              </div>
            </div>
            <div>
              <Label className="text-gray-300">用户名 *</Label>
              <Input value={formUsername} onChange={e => setFormUsername(e.target.value)} placeholder="root" className="bg-gray-800/50 border-gray-700" />
            </div>
            <div>
              <Label className="text-gray-300">
                密码 {editingConn && <span className="text-gray-500">（留空表示不修改）</span>} {!editingConn && '*'}
              </Label>
              <Input value={formPassword} onChange={e => setFormPassword(e.target.value)} type="password" placeholder="••••••••" className="bg-gray-800/50 border-gray-700" />
            </div>
            <div>
              <Label className="text-gray-300">备注</Label>
              <Textarea value={formDescription} onChange={e => setFormDescription(e.target.value)} placeholder="可选" rows={2} className="bg-gray-800/50 border-gray-700 resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)} className="border-gray-700 text-gray-300 hover:bg-gray-800">
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="bg-emerald-600 hover:bg-emerald-500 text-white">
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              {editingConn ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#222632] border-gray-700 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该服务器？</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              将删除该服务器的连接记录（密码等敏感信息），此操作不可恢复。关联的历史任务和宝塔信息会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-500 text-white">确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 宝塔面板信息弹窗 */}
      <Dialog open={btDialogConn !== null} onOpenChange={(open) => { if (!open) { setBtDialogConn(null); setBtPanels([]); } }}>
        <DialogContent className="bg-[#222632] border-gray-700 text-gray-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              宝塔面板信息
              {btDialogConn && <span className="text-xs text-gray-500 font-normal">· {btDialogConn.connName}</span>}
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            {btLoading ? (
              <div className="flex items-center justify-center py-6 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                加载中...
              </div>
            ) : btPanels.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">
                暂无宝塔面板信息
              </div>
            ) : (
              btPanels.map(panel => (
                <div key={panel.id} className="p-3 bg-gray-800/40 rounded border border-gray-700/50 text-xs space-y-1.5">
                  {panel.url && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 shrink-0 w-16">外网地址</span>
                      <span className="flex-1 truncate text-emerald-400" title={panel.url}>{panel.url}</span>
                      <a href={panel.url} target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-white shrink-0">
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                  {panel.innerUrl && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 shrink-0 w-16">内网地址</span>
                      <span className="flex-1 truncate text-blue-400" title={panel.innerUrl}>{panel.innerUrl}</span>
                    </div>
                  )}
                  {panel.username && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 shrink-0 w-16">面板账号</span>
                      <span className="flex-1 truncate text-gray-300">{panel.username}</span>
                    </div>
                  )}
                  {panel.password && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500 shrink-0 w-16">面板密码</span>
                      <span className="flex-1 truncate text-gray-300 font-mono">{panel.password}</span>
                    </div>
                  )}
                  <div className="pt-2 mt-2 border-t border-gray-700/50">
                    <button
                      onClick={() => handleCopyAllBt(panel)}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-emerald-700/40 hover:bg-emerald-700/70 text-emerald-300 rounded border border-emerald-700/50 w-full justify-center"
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
            <Button variant="outline" onClick={() => { setBtDialogConn(null); setBtPanels([]); }} className="border-gray-700 text-gray-300 hover:bg-gray-800">
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
    emerald: 'text-emerald-400 bg-emerald-900/20',
    amber: 'text-amber-400 bg-amber-900/20',
    blue: 'text-blue-400 bg-blue-900/20',
    purple: 'text-purple-400 bg-purple-900/20',
  };
  return (
    <div className="bg-[#222632] border border-gray-800 rounded-lg p-3 sm:p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${colorMap[color]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xl sm:text-2xl font-bold text-gray-100">{value}</div>
        <div className="text-xs text-gray-500 truncate">{label}</div>
      </div>
    </div>
  );
}
