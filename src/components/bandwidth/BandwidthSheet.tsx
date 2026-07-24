'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, FileText, Gauge, Trash2, Pencil, Play } from 'lucide-react';
import { toast } from 'sonner';
import type { BandwidthRule, BandwidthServiceStatus } from '@/lib/services/bandwidth-manager';
import { BandwidthRuleFormDialog } from './BandwidthRuleFormDialog';
import { BandwidthLogViewerDialog } from './BandwidthLogViewerDialog';

interface BandwidthSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
}

/** bps 转 Mbps 显示（自动选择单位） */
function formatBandwidth(bps: number): string {
  const mbps = bps / 1_000_000;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
  return `${(bps / 1000).toFixed(0)} Kbps`;
}

export function BandwidthSheet({ open, onOpenChange, nodes, selectedNodeIds }: BandwidthSheetProps) {
  const [rules, setRules] = useState<BandwidthRule[]>([]);
  const [status, setStatus] = useState<BandwidthServiceStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<BandwidthRule | undefined>();
  const [logViewerOpen, setLogViewerOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, statusRes] = await Promise.all([
        fetch('/api/bandwidth?action=listRules'),
        fetch('/api/bandwidth?action=status'),
      ]);
      const rulesData = await rulesRes.json();
      const statusData = await statusRes.json();
      if (rulesData.success) setRules(rulesData.data);
      if (statusData.success) setStatus(statusData.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    const res = await fetch('/api/bandwidth', {
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
    const res = await fetch('/api/bandwidth', {
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
    const res = await fetch('/api/bandwidth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manualCheck' }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
      toast.success('已触发检查');
      fetchData();
    } else {
      toast.error(data.message || '触发检查失败');
    }
    setLoading(false);
  };

  const handleToggleService = async () => {
    setLoading(true);
    const action = status?.running ? 'stopService' : 'startService';
    const res = await fetch('/api/bandwidth', {
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

  const getRuleDesc = (rule: BandwidthRule): string => {
    // 构建触发条件描述（支持双阈值）
    const conditions: string[] = [];
    if (rule.thresholdUp) conditions.push(`上行>${formatBandwidth(rule.thresholdUp)}`);
    if (rule.thresholdDown) conditions.push(`下行>${formatBandwidth(rule.thresholdDown)}`);
    const condDesc = conditions.join(' 且 ');
    const limitDesc = rule.limitMode === 'percent'
      ? `限速至原带宽${100 - rule.reducePercent}%`
      : `限速至${rule.limitValue}Mbps`;
    const continuousDesc = rule.continuousEnabled
      ? ` | 持续监控: 近${rule.continuousWindowMin}分钟超${rule.continuousPercent}%`
      : '';
    return `当${condDesc} → 对Top${rule.topN}实例${limitDesc}，持续${rule.durationMin}分钟${continuousDesc}`;
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
      <SheetContent className="w-full sm:max-w-lg bg-card border-border text-foreground overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-foreground">
            <Gauge className="w-5 h-5 text-primary" />
            智能带宽管理
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
              <div className="mt-2 text-xs text-muted-foreground">
                检查间隔: {Math.round(status.checkIntervalMs / 1000)}秒 | 活跃规则: {status.activeRuleCount}条 | 执行中任务: {status.activeTasks}个
              </div>
            )}
            {status?.running && status.activeRuleCount === 0 && (
              <div className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                提示: 当前无启用的规则，服务将空转。请先添加并启用至少一条规则才能触发限速。
              </div>
            )}
          </div>

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
          </div>

          {/* 规则列表 */}
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">暂无带宽管理规则</div>
          ) : (
            <div className="space-y-2">
              {rules.map(rule => (
                <div key={rule.id} className="bg-card rounded-lg p-3 border border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground truncate">{rule.name}</span>
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
        <BandwidthRuleFormDialog
          open={ruleFormOpen}
          onOpenChange={setRuleFormOpen}
          rule={editingRule}
          nodes={nodes}
          selectedNodeIds={selectedNodeIds}
          onSaved={fetchData}
        />

        {/* 日志查看 */}
        <BandwidthLogViewerDialog
          open={logViewerOpen}
          onOpenChange={setLogViewerOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
