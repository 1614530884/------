'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, FileText, Cpu, Trash2, Pencil, Play, Clock, Activity, Unlock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { CpuLimitRule, CpuLimitServiceStatus, CpuLimitEvent } from '@/lib/services/cpu-limit-manager';
import { CpuLimitRuleFormDialog } from './CpuLimitRuleFormDialog';
import { CpuLimitLogViewerDialog } from './CpuLimitLogViewerDialog';
import { CpuLimitAlertConfigCard } from './CpuLimitAlertConfigCard';
import { CpuLimitAlertHistoryDialog } from './CpuLimitAlertHistoryDialog';

interface CpuLimitSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
}

const METRIC_LABEL: Record<string, string> = {
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
};

function formatRemaining(expireTime: number): string {
  const remainSec = Math.max(0, Math.floor((expireTime - Date.now()) / 1000));
  if (remainSec <= 0) return '即将解除';
  const min = Math.floor(remainSec / 60);
  const sec = remainSec % 60;
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}时${m}分`;
  }
  return `${min}分${sec}秒`;
}

export function CpuLimitSheet({ open, onOpenChange, nodes, selectedNodeIds }: CpuLimitSheetProps) {
  const [rules, setRules] = useState<CpuLimitRule[]>([]);
  const [status, setStatus] = useState<CpuLimitServiceStatus | null>(null);
  const [activeEvents, setActiveEvents] = useState<CpuLimitEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CpuLimitRule | undefined>();
  const [logViewerOpen, setLogViewerOpen] = useState(false);
  const [alertHistoryOpen, setAlertHistoryOpen] = useState(false);
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, statusRes, activeRes] = await Promise.all([
        fetch('/api/cpu-limit?action=listRules'),
        fetch('/api/cpu-limit?action=status'),
        fetch('/api/cpu-limit?action=listActive'),
      ]);
      const rulesData = await rulesRes.json();
      const statusData = await statusRes.json();
      const activeData = await activeRes.json();
      if (rulesData.success) setRules(rulesData.data);
      if (statusData.success) setStatus(statusData.data);
      if (activeData.success) setActiveEvents(activeData.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  // 活跃事件列表实时刷新剩余时间（每 10 秒）
  useEffect(() => {
    if (!open || activeEvents.length === 0) return;
    const timer = setInterval(fetchData, 10 * 1000);
    return () => clearInterval(timer);
  }, [open, activeEvents.length, fetchData]);

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    const res = await fetch('/api/cpu-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleRule', ruleId, enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      setRules(prev => prev.map(r => r.id === ruleId ? { ...r, enabled } : r));
      fetchData();
    } else {
      toast.error(data.message || '操作失败');
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('确认删除此规则？')) return;
    const res = await fetch('/api/cpu-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteRule', ruleId }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      setRules(prev => prev.filter(r => r.id !== ruleId));
      fetchData();
    } else {
      toast.error(data.message || '删除失败');
    }
  };

  const handleManualCheck = async () => {
    setLoading(true);
    const res = await fetch('/api/cpu-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manualCheck' }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      toast.success('已触发检查');
      setTimeout(fetchData, 1000);
    } else {
      toast.error(data.message || '触发检查失败');
    }
    setLoading(false);
  };

  const handleToggleService = async () => {
    setLoading(true);
    const action = status?.running ? 'stopService' : 'startService';
    const res = await fetch('/api/cpu-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      setTimeout(fetchData, 300);
    } else {
      toast.error(data.message || '操作失败');
    }
    setLoading(false);
  };

  const handleManualRelease = async (eventId: string, cloudName: string) => {
    if (!confirm(`确认手动解除 ${cloudName} 的 CPU 限制？`)) return;
    setReleasingId(eventId);
    try {
      const res = await fetch('/api/cpu-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'manualRelease', eventId }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        toast.success(`已解除 ${cloudName} 的 CPU 限制`);
        fetchData();
      } else {
        toast.error(data.message || '解除失败');
      }
    } catch {
      toast.error('请求失败');
    }
    setReleasingId(null);
  };

  const getRuleDesc = (rule: CpuLimitRule): string => {
    // 惩罚描述：启用惩罚时展示时间和 CPU 限制值惩罚（含最低下限）
    const penaltyDesc = rule.penaltyEnabled
      ? ` | 惩罚: 窗口${rule.penaltyWindowMin}分钟达${rule.penaltyThreshold}次后`
        + (rule.penaltyMode === 'multiply' ? `时长×${rule.penaltyValue}` : `时长+${rule.penaltyValue}分`)
        + `, CPU限制${rule.penaltyCpuLimitMode === 'multiply' ? `÷${rule.penaltyCpuLimitValue}` : `-${rule.penaltyCpuLimitValue}%`}`
        + `, 保底${rule.minCpuLimitPercent}%`
      : '';
    return `当${METRIC_LABEL[rule.metric]}>${rule.threshold}% → 对Top${rule.topN}实例CPU限制为${rule.cpuLimitPercent}%，持续${rule.durationMin}分钟后自动解除${penaltyDesc}`;
  };

  const getNodeNames = (nodeIds: number[]): string => {
    const names = nodeIds
      .map(id => nodes.find(n => n.id === id)?.name)
      .filter(Boolean) as string[];
    if (names.length <= 2) return names.join(', ');
    return `${names[0]}等${names.length}个节点`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg bg-card border-border text-foreground overflow-y-auto overflow-x-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-foreground">
            <Cpu className="w-5 h-5 text-primary" />
            CPU 限制管理
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 服务状态 */}
          <div className="bg-card rounded-lg p-3 border border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-foreground/80">监控服务</span>
                {status?.running ? (
                  <Badge className="bg-success hover:bg-success/90 text-success-foreground text-[10px] border-none">
                    {status.isChecking ? '检查中' : '运行中'}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">已停止</Badge>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={handleToggleService} disabled={loading}
                className="border-border text-foreground/80 h-7 text-xs">
                {status?.running ? '停止' : '启动'}
              </Button>
            </div>
            {status?.running && (
              <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                <div>检查间隔: {Math.round(status.checkIntervalMs / 1000)}秒 | 活跃规则: {status.activeRuleCount}条 | 执行中任务: {status.activeTasks}个</div>
                <div className="flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  <span>当前活跃限制: <span className="text-foreground font-medium">{status.activeEventCount}</span> 个实例</span>
                  {status.releaseSchedulerRunning && <span className="text-success">· 自动解除调度器运行中</span>}
                </div>
              </div>
            )}
            {status?.running && status.activeRuleCount === 0 && (
              <div className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                提示: 当前无启用的规则，服务将空转。请先添加并启用至少一条规则。
              </div>
            )}
          </div>

          {/* 活跃限制事件 */}
          {activeEvents.length > 0 && (
            <div className="bg-card rounded-lg p-3 border border-border">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-4 h-4 text-warning" />
                <span className="text-sm font-medium text-foreground">活跃 CPU 限制 ({activeEvents.length})</span>
              </div>
              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {activeEvents.map(evt => {
                  const retryCount = evt.releaseRetryCount ?? 0;
                  const isRetrying = retryCount > 0;
                  return (
                    <div key={evt.id} className="text-xs bg-background/50 rounded p-2 border border-border/50">
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <span className="text-foreground truncate flex items-center gap-1.5 min-w-0" title={evt.cloudName}>
                          <span className="truncate">{evt.cloudName}</span>
                          <span className="text-muted-foreground shrink-0">#{evt.cloudId}</span>
                          {evt.penalized && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-warning/40 text-warning shrink-0">
                              惩罚
                            </Badge>
                          )}
                          {isRetrying && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-destructive/40 text-destructive shrink-0" title="自动解除失败，正在重试">
                              重试{retryCount}
                            </Badge>
                          )}
                        </span>
                        <span className={`font-medium whitespace-nowrap shrink-0 ${isRetrying ? 'text-destructive' : 'text-warning'}`}>
                          {isRetrying ? '解除中' : `剩余 ${formatRemaining(evt.expireTime)}`}
                        </span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center justify-between gap-2 min-w-0">
                        <span className="truncate min-w-0">
                          限制 {evt.cpuLimitPercent}%
                          {evt.actualDurationMin && evt.actualDurationMin !== undefined ? ` · 时长 ${evt.actualDurationMin}分` : ''}
                          {' · '}{evt.nodeName} · {evt.ruleName}
                        </span>
                        <button
                          onClick={() => handleManualRelease(evt.id, evt.cloudName)}
                          disabled={releasingId === evt.id}
                          className="shrink-0 text-primary hover:text-primary/80 disabled:opacity-50 inline-flex items-center gap-0.5"
                          title="手动解除"
                        >
                          {releasingId === evt.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Unlock className="w-3 h-3" />
                          )}
                          解除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => { setEditingRule(undefined); setRuleFormOpen(true); }}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              <Plus className="w-4 h-4 mr-1" />添加规则
            </Button>
            <Button size="sm" onClick={handleManualCheck} disabled={loading}
              className="bg-info hover:bg-info/90 text-info-foreground">
              <Play className="w-4 h-4 mr-1" />手动检查
            </Button>
            <Button size="sm" onClick={() => setLogViewerOpen(true)}
              className="bg-info hover:bg-info/90 text-info-foreground">
              <FileText className="w-4 h-4 mr-1" />操作日志
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAlertHistoryOpen(true)}
              className="border-border text-foreground/80">
              <AlertTriangle className="w-4 h-4 mr-1" />告警历史
            </Button>
          </div>

          {/* 告警配置 */}
          <CpuLimitAlertConfigCard />

          {/* 规则列表 */}
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无 CPU 限制规则</div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="bg-card rounded-lg p-3 border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-foreground truncate min-w-0">{rule.name}</span>
                        <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                          {rule.enabled ? '启用' : '禁用'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {getRuleDesc(rule)}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        目标节点: {getNodeNames(rule.nodeIds)} | 触发: {rule.triggerCount}次 | 间隔: {rule.interval}s | 冷却: {rule.cooldown}s
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleToggleRule(rule.id, !rule.enabled)}
                        className={`p-1.5 rounded hover:bg-accent text-xs font-medium ${rule.enabled ? 'text-success' : 'text-muted-foreground'}`}
                        title={rule.enabled ? '点击禁用' : '点击启用'}
                      >
                        {rule.enabled ? '已启用' : '已禁用'}
                      </button>
                      <button
                        onClick={() => { setEditingRule(rule); setRuleFormOpen(true); }}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                        title="编辑"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 规则表单 */}
        <CpuLimitRuleFormDialog
          open={ruleFormOpen}
          onOpenChange={setRuleFormOpen}
          rule={editingRule}
          nodes={nodes}
          selectedNodeIds={selectedNodeIds}
          onSaved={fetchData}
        />

        {/* 日志查看 */}
        <CpuLimitLogViewerDialog
          open={logViewerOpen}
          onOpenChange={setLogViewerOpen}
        />

        {/* 告警历史 */}
        <CpuLimitAlertHistoryDialog
          open={alertHistoryOpen}
          onOpenChange={setAlertHistoryOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
