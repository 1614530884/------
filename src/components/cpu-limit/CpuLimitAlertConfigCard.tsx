'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Save, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import type { CpuLimitAlertConfig } from '@/lib/services/cpu-limit-manager';

/**
 * CPU 限制告警配置卡片
 * 管理员在 CpuLimitSheet 中配置：时间窗口 + 实例阈值 + 节点阈值
 * 达阈值时右上角告警铃铛显示通知
 */
export function CpuLimitAlertConfigCard() {
  const [config, setConfig] = useState<CpuLimitAlertConfig>({
    enabled: false,
    windowMin: 60,
    instanceThreshold: 3,
    nodeThreshold: 5,
  });
  // 数值输入用 string 存储，允许自由删除/编辑
  const [windowMinStr, setWindowMinStr] = useState('60');
  const [instanceThresholdStr, setInstanceThresholdStr] = useState('3');
  const [nodeThresholdStr, setNodeThresholdStr] = useState('5');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cpu-limit?action=getAlertConfig');
      const data = await res.json();
      if (data.success && data.data) {
        const c = data.data as CpuLimitAlertConfig;
        setConfig(c);
        setWindowMinStr(String(c.windowMin));
        setInstanceThresholdStr(String(c.instanceThreshold));
        setNodeThresholdStr(String(c.nodeThreshold));
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async () => {
    const windowMin = Number(windowMinStr);
    const instanceThreshold = Number(instanceThresholdStr);
    const nodeThreshold = Number(nodeThresholdStr);
    if (!windowMinStr.trim() || isNaN(windowMin) || windowMin < 1) {
      toast.error('时间窗口必须≥1分钟'); return;
    }
    if (!instanceThresholdStr.trim() || isNaN(instanceThreshold) || instanceThreshold < 1) {
      toast.error('实例阈值必须≥1'); return;
    }
    if (!nodeThresholdStr.trim() || isNaN(nodeThreshold) || nodeThreshold < 1) {
      toast.error('节点阈值必须≥1'); return;
    }

    setSaving(true);
    try {
      const newConfig: CpuLimitAlertConfig = {
        enabled: config.enabled,
        windowMin,
        instanceThreshold,
        nodeThreshold,
      };
      const res = await fetch('/api/cpu-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveAlertConfig', config: newConfig }),
      });
      const data = await res.json();
      if (data.success) {
        setConfig(newConfig);
        toast.success('告警配置已保存');
      } else {
        toast.error(data.message || '保存失败');
      }
    } catch {
      toast.error('请求失败');
    }
    setSaving(false);
  };

  const handleToggleEnabled = async (enabled: boolean) => {
    const newConfig = { ...config, enabled };
    setConfig(newConfig);
    try {
      await fetch('/api/cpu-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveAlertConfig', config: newConfig }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="bg-card rounded-lg p-3 border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-warning" />
          <span className="text-sm font-medium text-foreground">限制告警通知</span>
        </div>
        <Switch checked={config.enabled} onCheckedChange={handleToggleEnabled} disabled={loading} />
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        统计窗口内实例/节点触发限制次数达阈值时，右上角铃铛通知管理员
      </p>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">时间窗口</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={windowMinStr}
              onChange={e => setWindowMinStr(e.target.value)}
              min={1}
              disabled={!config.enabled}
              className="bg-background border-border text-foreground h-8 text-xs"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">分</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">实例阈值</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={instanceThresholdStr}
              onChange={e => setInstanceThresholdStr(e.target.value)}
              min={1}
              disabled={!config.enabled}
              className="bg-background border-border text-foreground h-8 text-xs"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">次</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">节点阈值</Label>
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={nodeThresholdStr}
              onChange={e => setNodeThresholdStr(e.target.value)}
              min={1}
              disabled={!config.enabled}
              className="bg-background border-border text-foreground h-8 text-xs"
            />
            <span className="text-[10px] text-muted-foreground shrink-0">次</span>
          </div>
        </div>
      </div>

      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || !config.enabled}
        className="w-full h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        {saving ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
        保存告警配置
      </Button>
    </div>
  );
}
