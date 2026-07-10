'use client';

/**
 * 服务器管理工具 - 清理规则页面
 *
 * 功能：
 * - 三类清理规则（任务/连接/宝塔信息）的开关与保留天数配置
 * - 立即清理按钮
 * - 显示上次清理结果
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Trash2, Loader2, Activity, Server, Shield,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import MobileSidebar from '@/components/mobile-sidebar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/services/server-tools/api-client';

interface CleanupRule {
  id: string;
  scope: 'tasks' | 'connections' | 'bt_panels';
  enabled: boolean;
  retainDays: number;
}

interface ScopeConfig {
  key: 'tasks' | 'connections' | 'bt_panels';
  label: string;
  description: string;
  icon: typeof Activity;
  color: string;
}

const SCOPE_CONFIGS: ScopeConfig[] = [
  {
    key: 'tasks',
    label: '任务记录',
    description: '已结束的任务（成功/失败/取消/中断）超过保留天数后自动删除，同时清理关联日志',
    icon: Activity,
    color: 'text-blue-400 bg-blue-900/20',
  },
  {
    key: 'connections',
    label: '已保存服务器列表',
    description: '超过保留天数的服务器连接记录将被彻底删除（包括已删除和未删除的）',
    icon: Server,
    color: 'text-emerald-400 bg-emerald-900/20',
  },
  {
    key: 'bt_panels',
    label: '宝塔信息',
    description: '超过保留天数的宝塔面板信息将被彻底删除（包括已删除和未删除的）',
    icon: Shield,
    color: 'text-amber-400 bg-amber-900/20',
  },
];

export default function CleanupPage() {
  const router = useRouter();
  const [rules, setRules] = useState<CleanupRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [confirmPurgeConnections, setConfirmPurgeConnections] = useState(false);
  const [purgingConnections, setPurgingConnections] = useState(false);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<CleanupRule[]>('/api/server-tools/cleanup');
      if (result.ok && result.data) {
        setRules(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // 把 rules 按 scope 索引
  const getRule = (scope: string): CleanupRule | undefined => rules.find(r => r.scope === scope);

  const handleToggle = async (scope: 'tasks' | 'connections' | 'bt_panels', enabled: boolean) => {
    const existing = getRule(scope);
    const retainDays = existing?.retainDays ?? 30;
    setSaving(scope);
    try {
      const result = await apiFetch<CleanupRule>('/api/server-tools/cleanup', {
        method: 'PATCH',
        body: JSON.stringify({ scope, enabled, retainDays }),
      });
      if (result.ok) {
        await fetchRules();
        toast.success(enabled ? '已启用' : '已禁用');
      } else if (result.status !== 401) {
        toast.error(result.message || '操作失败');
      }
    } finally {
      setSaving(null);
    }
  };

  const handleRetainDaysChange = async (scope: 'tasks' | 'connections' | 'bt_panels', retainDays: number) => {
    if (retainDays < 1 || retainDays > 365) return;
    const existing = getRule(scope);
    if (existing && existing.retainDays === retainDays) return;
    setSaving(scope);
    try {
      const result = await apiFetch<CleanupRule>('/api/server-tools/cleanup', {
        method: 'PATCH',
        body: JSON.stringify({ scope, enabled: existing?.enabled ?? false, retainDays }),
      });
      if (result.ok) {
        await fetchRules();
      } else if (result.status !== 401) {
        toast.error(result.message || '保存失败');
      }
    } finally {
      setSaving(null);
    }
  };

  const handleCleanup = async () => {
    setCleaning(true);
    try {
      const result = await apiFetch<Array<{ scope: string; deleted: number }>>('/api/server-tools/cleanup', { method: 'POST' });
      if (result.ok && result.data) {
        const totalDeleted = result.data.reduce((sum, r) => sum + r.deleted, 0);
        toast.success(`清理完成，共删除 ${totalDeleted} 条记录`);
        setConfirmCleanup(false);
      } else if (result.status !== 401) {
        toast.error(result.message || '清理失败');
      }
    } finally {
      setCleaning(false);
    }
  };

  const handlePurgeConnections = async () => {
    setPurgingConnections(true);
    try {
      const result = await apiFetch<{ scope: string; deleted: number }>('/api/server-tools/cleanup?scope=connections', { method: 'DELETE' });
      if (result.ok && result.data) {
        toast.success(`已彻底清除 ${result.data.deleted} 条服务器连接记录`);
        setConfirmPurgeConnections(false);
      } else if (result.status !== 401) {
        toast.error(result.message || '清除失败');
      }
    } finally {
      setPurgingConnections(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1d27] text-gray-100">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-10 bg-[#1a1d27] border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MobileSidebar currentPath="/server-tools/cleanup" variant="subpage" />
            <button onClick={() => router.push('/server-tools')} className="text-gray-400 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-orange-900/30 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4 text-orange-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">清理规则</div>
                <div className="text-xs text-gray-500 truncate">自动清理过期数据</div>
              </div>
            </div>
          </div>
          <Button
            onClick={() => setConfirmCleanup(true)}
            size="sm"
            variant="outline"
            className="border-orange-700 text-orange-400 hover:bg-orange-900/20 shrink-0"
            disabled={loading || cleaning}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">立即清理</span>
            <span className="sm:hidden">清理</span>
          </Button>
        </div>
      </div>

      {/* 主体 */}
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {/* 说明 */}
        <div className="p-3 bg-blue-900/10 border border-blue-800/30 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-xs text-gray-400 leading-relaxed">
            清理调度器每 <span className="text-blue-400">6 小时</span> 自动执行一次，按各规则的保留天数删除过期数据。
            已结束的任务、已软删除的连接和宝塔信息会按配置自动清理。运行中的任务不受影响。
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
          </div>
        ) : (
          SCOPE_CONFIGS.map(config => {
            const rule = getRule(config.key);
            const Icon = config.icon;
            return (
              <div key={config.key} className="bg-[#222632] border border-gray-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-100">{config.label}</div>
                      <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">{config.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {saving === config.key && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
                    <Switch
                      checked={rule?.enabled ?? false}
                      onCheckedChange={(checked) => handleToggle(config.key, checked)}
                      disabled={saving === config.key}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-gray-800">
                  <Label className="text-xs text-gray-400 shrink-0">保留天数</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={rule?.retainDays ?? 30}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10);
                      if (!isNaN(v)) handleRetainDaysChange(config.key, v);
                    }}
                    disabled={saving === config.key}
                    className="w-24 bg-[#1a1d27] border-gray-700 text-gray-100 text-sm h-8"
                  />
                  <span className="text-xs text-gray-500">天</span>
                  {rule?.enabled && (
                    <span className="ml-auto text-[10px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> 已启用
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}

        {/* 提示 */}
        <div className="text-xs text-gray-600 text-center pt-4">
          清理操作不可撤销，请谨慎配置保留天数
        </div>

        {/* 危险操作：一键清除全部已保存服务器列表 */}
        <div className="mt-6 p-4 bg-red-950/20 border border-red-900/40 rounded-lg">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-red-900/30">
                <AlertTriangle className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-red-300">一键清除全部已保存服务器列表</div>
                <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                  立即彻底删除所有已保存的服务器连接记录（不受保留天数限制）。此操作不可撤销，请谨慎操作。
                </div>
              </div>
            </div>
            <Button
              onClick={() => setConfirmPurgeConnections(true)}
              size="sm"
              variant="outline"
              className="border-red-800 text-red-400 hover:bg-red-900/20 shrink-0"
              disabled={purgingConnections}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">立即清除</span>
              <span className="sm:hidden">清除</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 立即清理确认 */}
      <AlertDialog open={confirmCleanup} onOpenChange={setConfirmCleanup}>
        <AlertDialogContent className="bg-[#1a1d27] border-gray-800 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-100">确认立即清理</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              将按当前已启用的规则立即执行清理，删除所有过期数据。此操作不可撤销，确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCleanup}
              disabled={cleaning}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {cleaning ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              确认清理
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 一键清除全部服务器列表确认 */}
      <AlertDialog open={confirmPurgeConnections} onOpenChange={setConfirmPurgeConnections}>
        <AlertDialogContent className="bg-[#1a1d27] border-gray-800 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400">确认清除全部已保存服务器列表</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              此操作将立即彻底删除所有已保存的服务器连接记录，不受保留天数限制，且不可撤销。确定继续吗？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurgeConnections}
              disabled={purgingConnections}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {purgingConnections ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
              确认清除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
