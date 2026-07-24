'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Loader2, Search } from 'lucide-react';
import type { BandwidthRule, BandwidthLimitMode } from '@/lib/services/bandwidth-manager';

interface BandwidthRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: BandwidthRule;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
  onSaved: () => void;
}

const INTERVAL_OPTIONS = [
  { value: 60, label: '1分钟' },
  { value: 120, label: '2分钟' },
  { value: 300, label: '5分钟' },
  { value: 600, label: '10分钟' },
];

const COOLDOWN_OPTIONS = [
  { value: 60, label: '1分钟' },
  { value: 300, label: '5分钟' },
  { value: 600, label: '10分钟' },
  { value: 1800, label: '30分钟' },
];



export function BandwidthRuleFormDialog({ open, onOpenChange, rule, nodes, selectedNodeIds, onSaved }: BandwidthRuleFormDialogProps) {
  const isEdit = !!rule;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [nodeIds, setNodeIds] = useState<number[]>([]);
  // 双阈值：上行(出站)/下行(入站)，单位 Mbps；留空或 0 表示不监控该方向
  // 数值输入用 string 存储，允许用户自由删除/清空/编辑，保存时再 Number() 转换
  const [thresholdUpEnabled, setThresholdUpEnabled] = useState(true);
  const [thresholdUpMbps, setThresholdUpMbps] = useState('100');
  const [thresholdDownEnabled, setThresholdDownEnabled] = useState(false);
  const [thresholdDownMbps, setThresholdDownMbps] = useState('100');
  const [topN, setTopN] = useState('5');
  const [limitMode, setLimitMode] = useState<BandwidthLimitMode>('percent');
  const [reducePercent, setReducePercent] = useState('70');
  const [fixedLimitMbps, setFixedLimitMbps] = useState('10');
  const [continuousEnabled, setContinuousEnabled] = useState(false);
  const [continuousWindowMin, setContinuousWindowMin] = useState('120');
  const [continuousPercent, setContinuousPercent] = useState('80');
  const [durationMin, setDurationMin] = useState('30');
  const [interval, setIntervalVal] = useState(60);
  const [cooldown, setCooldown] = useState(300);
  const [triggerCount, setTriggerCount] = useState('1');
  const [nodeSearch, setNodeSearch] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      if (rule) {
        setName(rule.name);
        setNodeIds(rule.nodeIds);
        // 双阈值回填：bps → Mbps，未配置的方向关闭开关
        setThresholdUpEnabled(!!rule.thresholdUp && rule.thresholdUp > 0);
        setThresholdUpMbps(rule.thresholdUp ? String(Math.round(rule.thresholdUp / 1_000_000)) : '100');
        setThresholdDownEnabled(!!rule.thresholdDown && rule.thresholdDown > 0);
        setThresholdDownMbps(rule.thresholdDown ? String(Math.round(rule.thresholdDown / 1_000_000)) : '100');
        setTopN(String(rule.topN));
        setLimitMode(rule.limitMode);
        setReducePercent(String(rule.reducePercent || 70));
        setFixedLimitMbps(String(rule.limitValue));
        setContinuousEnabled(rule.continuousEnabled);
        setContinuousWindowMin(String(rule.continuousWindowMin ?? 120));
        setContinuousPercent(String(rule.continuousPercent ?? 80));
        setDurationMin(String(rule.durationMin));
        setIntervalVal(rule.interval);
        setCooldown(rule.cooldown);
        setTriggerCount(String(rule.triggerCount));
      } else {
        setName('');
        setNodeIds(selectedNodeIds.size > 0 ? [...selectedNodeIds] : []);
        // 默认仅启用上行阈值
        setThresholdUpEnabled(true);
        setThresholdUpMbps('100');
        setThresholdDownEnabled(false);
        setThresholdDownMbps('100');
        setTopN('5');
        setLimitMode('percent');
        setReducePercent('70');
        setFixedLimitMbps('10');
        setContinuousEnabled(false);
        setContinuousWindowMin('120');
        setContinuousPercent('80');
        setDurationMin('30');
        setIntervalVal(60);
        setCooldown(300);
        setTriggerCount('1');
      }
      setNodeSearch('');
    }
  }, [open, rule, selectedNodeIds]);

  const filteredNodes = nodes.filter(n => {
    const q = nodeSearch.toLowerCase();
    return !q || n.name.toLowerCase().includes(q) || String(n.ip).includes(q);
  });

  const handleToggleNode = (id: number, checked: boolean) => {
    setNodeIds(prev => checked ? [...prev, id] : prev.filter(n => n !== id));
  };

  const handleSelectAll = () => {
    setNodeIds(filteredNodes.map(n => n.id));
  };

  const handleClearNodes = () => {
    setNodeIds([]);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入规则名称'); return; }
    if (nodeIds.length === 0) { setError('请选择至少一个节点'); return; }
    // 至少启用一个方向的阈值
    if (!thresholdUpEnabled && !thresholdDownEnabled) {
      setError('至少需要启用上行或下行阈值之一'); return;
    }
    // string -> number 转换（输入框允许空字符串，转换后统一校验）
    const upMbps = Number(thresholdUpMbps);
    const downMbps = Number(thresholdDownMbps);
    const topNNum = Number(topN);
    const reducePercentNum = Number(reducePercent);
    const fixedLimitNum = Number(fixedLimitMbps);
    const continuousWindowNum = Number(continuousWindowMin);
    const continuousPercentNum = Number(continuousPercent);
    const triggerCountNum = Number(triggerCount);
    const durationMinNum = Number(durationMin);

    if (thresholdUpEnabled && (!thresholdUpMbps.trim() || isNaN(upMbps) || upMbps <= 0)) {
      setError('上行带宽阈值必须大于0'); return;
    }
    if (thresholdDownEnabled && (!thresholdDownMbps.trim() || isNaN(downMbps) || downMbps <= 0)) {
      setError('下行带宽阈值必须大于0'); return;
    }
    if (!topN.trim() || isNaN(topNNum) || topNNum < 1) { setError('限速实例数量必须≥1'); return; }
    if (limitMode === 'percent' && (isNaN(reducePercentNum) || reducePercentNum < 1 || reducePercentNum > 99)) {
      setError('带宽降低比例须在1-99之间'); return;
    }
    if (limitMode === 'fixed' && (isNaN(fixedLimitNum) || fixedLimitNum <= 0)) {
      setError('固定限速值必须大于0'); return;
    }
    if (continuousEnabled) {
      if (!continuousWindowMin.trim() || isNaN(continuousWindowNum) || continuousWindowNum < 1) { setError('持续监控时间窗口必须≥1分钟'); return; }
      if (isNaN(continuousPercentNum) || continuousPercentNum < 1 || continuousPercentNum > 100) { setError('持续监控带宽使用率须在1-100之间'); return; }
    }
    if (!triggerCount.trim() || isNaN(triggerCountNum) || triggerCountNum < 1) { setError('连续触发次数必须≥1'); return; }
    if (!durationMin.trim() || isNaN(durationMinNum) || durationMinNum < 1) {
      setError('限速持续时间必须≥1分钟'); return;
    }

    setSaving(true);
    try {
      const ruleData: Partial<BandwidthRule> = {
        name: name.trim(),
        nodeIds,
        // 仅启用方向才有值，未启用方向传 undefined
        thresholdUp: thresholdUpEnabled ? upMbps * 1_000_000 : undefined,
        thresholdDown: thresholdDownEnabled ? downMbps * 1_000_000 : undefined,
        topN: topNNum,
        limitMode,
        limitValue: limitMode === 'percent' ? 100 - reducePercentNum : fixedLimitNum,
        reducePercent: limitMode === 'percent' ? reducePercentNum : 0,
        continuousEnabled,
        continuousWindowMin: continuousEnabled ? continuousWindowNum : undefined,
        continuousPercent: continuousEnabled ? continuousPercentNum : undefined,
        durationMin: durationMinNum,
        interval,
        cooldown,
        triggerCount: triggerCountNum,
        enabled: true,
      };
      if (isEdit) ruleData.id = rule!.id;

      const res = await fetch('/api/bandwidth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveRule', rule: ruleData }),
      });
      const data = await res.json();
      if (data.success) {
        onOpenChange(false);
        onSaved();
      } else {
        setError(data.message || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{isEdit ? '编辑带宽规则' : '添加带宽规则'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 规则名称 */}
          <div className="space-y-1.5">
            <Label className="text-foreground">规则名称</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="如：高峰期带宽管控"
              className="bg-background border-border text-foreground" />
          </div>

          {/* 节点选择 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-foreground">目标节点 <span className="text-destructive">*</span></Label>
              <div className="flex gap-2 text-xs">
                <button onClick={handleSelectAll} className="text-primary hover:underline">全选</button>
                <button onClick={handleClearNodes} className="text-muted-foreground hover:underline">清空</button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={nodeSearch} onChange={e => setNodeSearch(e.target.value)}
                placeholder="搜索节点名称或IP..."
                className="bg-background border-border text-foreground pl-7 h-8 text-xs" />
            </div>
            <div className="border border-border rounded-md max-h-32 overflow-y-auto bg-background">
              {filteredNodes.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground text-center">无匹配节点</div>
              ) : (
                filteredNodes.map(n => (
                  <label key={n.id} className="flex items-center gap-2 p-1.5 hover:bg-accent cursor-pointer text-xs">
                    <Checkbox
                      checked={nodeIds.includes(n.id)}
                      onCheckedChange={(c) => handleToggleNode(n.id, c === true)}
                    />
                    <span className="text-foreground">{n.name}</span>
                    <span className="text-muted-foreground">{n.ip}</span>
                  </label>
                ))
              )}
            </div>
            {nodeIds.length > 0 && (
              <div className="text-[10px] text-primary">已选 {nodeIds.length} 个节点</div>
            )}
          </div>

          {/* 双阈值：上行 / 下行 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-foreground">带宽阈值</Label>
              <span className="text-[10px] text-muted-foreground">至少启用一个方向，可单独或同时配置</span>
            </div>
            {/* 上行 */}
            <div className={`flex items-center gap-2 p-2 rounded-md border ${thresholdUpEnabled ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/50'}`}>
              <Switch checked={thresholdUpEnabled} onCheckedChange={setThresholdUpEnabled} />
              <div className="flex-1 flex items-center gap-2">
                <Label className="text-xs text-foreground whitespace-nowrap w-16">上行(出站)</Label>
                <Input
                  type="number"
                  value={thresholdUpMbps}
                  onChange={e => setThresholdUpMbps(e.target.value)}
                  min={1}
                  disabled={!thresholdUpEnabled}
                  className="bg-background border-border text-foreground h-8 text-sm flex-1"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">Mbps</span>
              </div>
            </div>
            {/* 下行 */}
            <div className={`flex items-center gap-2 p-2 rounded-md border ${thresholdDownEnabled ? 'border-primary/50 bg-primary/5' : 'border-border bg-background/50'}`}>
              <Switch checked={thresholdDownEnabled} onCheckedChange={setThresholdDownEnabled} />
              <div className="flex-1 flex items-center gap-2">
                <Label className="text-xs text-foreground whitespace-nowrap w-16">下行(入站)</Label>
                <Input
                  type="number"
                  value={thresholdDownMbps}
                  onChange={e => setThresholdDownMbps(e.target.value)}
                  min={1}
                  disabled={!thresholdDownEnabled}
                  className="bg-background border-border text-foreground h-8 text-sm flex-1"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">Mbps</span>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              同时启用时：上下行各自超阈值则分别排序限速；若同一实例双方向均命中，将合并为一次双向限速请求
            </p>
          </div>

          {/* Top N + 限速持续时间 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground">限速实例数 (Top N)</Label>
              <Input type="number" value={topN} onChange={e => setTopN(e.target.value)}
                min={1} max={50} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground">限速持续时间</Label>
              <div className="flex items-center gap-2">
                <Input type="number" value={durationMin} onChange={e => setDurationMin(e.target.value)}
                  min={1} className="bg-background border-border text-foreground flex-1" />
                <span className="text-xs text-muted-foreground whitespace-nowrap">分钟 (≥1)</span>
              </div>
            </div>
          </div>

          {/* 限速模式 */}
          <div className="space-y-1.5">
            <Label className="text-foreground">限速模式</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setLimitMode('percent')}
                className={`flex-1 p-2 rounded-md border text-xs ${
                  limitMode === 'percent'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                按比例降低
              </button>
              <button
                onClick={() => setLimitMode('fixed')}
                className={`flex-1 p-2 rounded-md border text-xs ${
                  limitMode === 'fixed'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
              >
                固定带宽值
              </button>
            </div>
            {limitMode === 'percent' ? (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">带宽降低比例 (%) — 如 70 表示限至原带宽的 30%</Label>
                <Input type="number" value={reducePercent} onChange={e => setReducePercent(e.target.value)}
                  min={1} max={99} className="bg-background border-border text-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">固定限速值 (Mbps)</Label>
                <Input type="number" value={fixedLimitMbps} onChange={e => setFixedLimitMbps(e.target.value)}
                  min={1} className="bg-background border-border text-foreground" />
              </div>
            )}
          </div>

          {/* 持续监控 */}
          <div className="space-y-2 p-3 rounded-md border border-border bg-background/50">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-foreground">持续监控二次过滤</Label>
                <p className="text-[10px] text-muted-foreground mt-0.5">查实例带宽图表，仅对持续超带宽的实例限速，防误伤突发流量</p>
              </div>
              <Switch checked={continuousEnabled} onCheckedChange={setContinuousEnabled} />
            </div>
            {continuousEnabled && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">时间窗口 (分钟)</Label>
                  <Input type="number" value={continuousWindowMin} onChange={e => setContinuousWindowMin(e.target.value)}
                    min={1} className="bg-background border-border text-foreground h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">带宽使用率 (%)</Label>
                  <Input type="number" value={continuousPercent} onChange={e => setContinuousPercent(e.target.value)}
                    min={1} max={100} className="bg-background border-border text-foreground h-8 text-sm" />
                </div>
              </div>
            )}
          </div>

          {/* 调度参数 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">检查间隔</Label>
              <select value={interval} onChange={e => setIntervalVal(Number(e.target.value))}
                className="w-full h-9 rounded-md bg-background border border-border text-foreground px-2 text-xs">
                {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">冷却时间</Label>
              <select value={cooldown} onChange={e => setCooldown(Number(e.target.value))}
                className="w-full h-9 rounded-md bg-background border border-border text-foreground px-2 text-xs">
                {COOLDOWN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">连续触发</Label>
              <Input type="number" value={triggerCount} onChange={e => setTriggerCount(e.target.value)}
                min={1} max={10} className="bg-background border-border text-foreground h-9 text-xs" />
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter className="flex-shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}
            className="border-border text-foreground/80">取消</Button>
          <Button onClick={handleSave} disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isEdit ? '保存' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
