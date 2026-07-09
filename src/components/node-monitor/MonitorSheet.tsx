'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, FileText, Shield, Trash2, Pencil, Play } from 'lucide-react';
import type { MonitorRule, MonitorConfig, MonitorServiceStatus } from '@/lib/services/node-monitor-types';
import { RuleFormDialog } from './RuleFormDialog';
import { LogViewerDialog } from './LogViewerDialog';

interface MonitorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
}

export function MonitorSheet({ open, onOpenChange, nodes, selectedNodeIds }: MonitorSheetProps) {
  const [config, setConfig] = useState<MonitorConfig>({ globalEnabled: false, rules: [] });
  const [status, setStatus] = useState<MonitorServiceStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const [ruleFormOpen, setRuleFormOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<MonitorRule | undefined>();
  const [logViewerOpen, setLogViewerOpen] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [configRes, statusRes] = await Promise.all([
        fetch('/api/node-monitor?action=listRules'),
        fetch('/api/node-monitor?action=status'),
      ]);
      const configData = await configRes.json();
      const statusData = await statusRes.json();
      if (configData.success) setConfig(configData.data);
      if (statusData.success) setStatus(statusData.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open, fetchData]);

  const handleToggleGlobal = async (enabled: boolean) => {
    setLoading(true);
    await fetch('/api/node-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleGlobal', enabled }),
    });
    setConfig(prev => ({ ...prev, globalEnabled: enabled }));
    // 延迟刷新确保服务已重启
    setTimeout(fetchData, 300);
    setLoading(false);
  };

  const handleToggleRule = async (ruleId: string, enabled: boolean) => {
    await fetch('/api/node-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggleRule', ruleId, enabled }),
    });
    setConfig(prev => ({
      ...prev,
      rules: prev.rules.map(r => r.id === ruleId ? { ...r, enabled } : r),
    }));
    fetchData();
  };

  const handleDeleteRule = async (ruleId: string) => {
    await fetch('/api/node-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteRule', ruleId }),
    });
    setConfig(prev => ({ ...prev, rules: prev.rules.filter(r => r.id !== ruleId) }));
    fetchData();
  };

  const handleManualCheck = async () => {
    setLoading(true);
    await fetch('/api/node-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manualCheck' }),
    });
    fetchData();
    setLoading(false);
  };

  // 全局状态判定：以配置中的开关为准，服务运行状态为辅助
  const isGlobalActive = config.globalEnabled;
  const isServiceRunning = !!status?.running;

  const metricLabel = (m: string) => m === 'cpu' ? 'CPU' : m === 'memory' ? '内存' : '磁盘';
  const operatorLabel = (o: string) => o === 'above' ? '高于' : o === 'below' ? '低于' : '区间';
  const actionLabel = (a: string) => a === 'enable' ? '启用节点' : '禁用节点';

  const getRuleDesc = (rule: MonitorRule) => {
    if (rule.operator === 'range') {
      const highAction = actionLabel(rule.action);
      const lowAction = actionLabel(rule.actionLow ?? 'enable');
      return `当${metricLabel(rule.metric)}高于${rule.threshold}%时 → ${highAction}；低于${rule.thresholdLow ?? 0}%时 → ${lowAction}`;
    }
    return `当${metricLabel(rule.metric)}${operatorLabel(rule.operator)}${rule.threshold}%时 → ${actionLabel(rule.action)}`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg bg-[#1a1d27] border-gray-800 text-white overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-white">
            <Shield className="w-5 h-5 text-purple-400" />
            节点监控规则
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 全局开关 + 状态 */}
          <div className="bg-[#0f1117] rounded-lg p-3 border border-gray-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-300">全局监控</span>
                {/* 以 config.globalEnabled 为准，status.running 辅助判断 */}
                {isGlobalActive ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] border-none">
                    {isServiceRunning ? '运行中' : '启动中'}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">已停止</Badge>
                )}
              </div>
              <Switch
                checked={isGlobalActive}
                onCheckedChange={handleToggleGlobal}
                disabled={loading}
                className="[&_[data-state=checked]]:bg-emerald-500 [&_[data-state=checked]]:border-emerald-500"
              />
            </div>
            {isGlobalActive && status && (
              <div className="mt-2 text-xs text-gray-500">
                检查间隔: {Math.round(status.checkIntervalMs / 1000)}秒 | 活跃规则: {status.activeRuleCount}条
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={() => { setEditingRule(undefined); setRuleFormOpen(true); }}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Plus className="w-4 h-4 mr-1" />添加规则
            </Button>
            <Button size="sm" onClick={handleManualCheck} disabled={loading}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              <Play className="w-4 h-4 mr-1" />手动检查
            </Button>
            <Button size="sm" onClick={() => setLogViewerOpen(true)}
              className="bg-cyan-600 hover:bg-cyan-700 text-white">
              <FileText className="w-4 h-4 mr-1" />操作日志
            </Button>
          </div>

          {/* 规则列表 */}
          {config.rules.length === 0 ? (
            <div className="text-center py-8 text-gray-500 text-sm">暂无监控规则</div>
          ) : (
            <div className="space-y-2">
              {config.rules.map(rule => (
                <div key={rule.id} className="bg-[#0f1117] rounded-lg p-3 border border-gray-800">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{rule.name}</span>
                        <Badge variant={rule.enabled ? 'default' : 'secondary'} className="text-[10px] shrink-0">
                          {rule.enabled ? '启用' : '禁用'}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-gray-400">
                        {getRuleDesc(rule)}
                      </div>
                      <div className="mt-1 text-[10px] text-gray-500">
                        目标节点: {rule.nodeIds.length}个 | 触发次数: {rule.triggerCount || 1}次 | 间隔: {rule.interval}s | 冷却: {rule.cooldown}s
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(checked) => handleToggleRule(rule.id, checked)}
                      />
                      <button
                        onClick={() => { setEditingRule(rule); setRuleFormOpen(true); }}
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400"
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
        <RuleFormDialog
          open={ruleFormOpen}
          onOpenChange={setRuleFormOpen}
          rule={editingRule}
          nodes={nodes}
          selectedNodeIds={selectedNodeIds}
          onSaved={fetchData}
        />

        {/* 日志查看 */}
        <LogViewerDialog
          open={logViewerOpen}
          onOpenChange={setLogViewerOpen}
        />
      </SheetContent>
    </Sheet>
  );
}
