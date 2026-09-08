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
import { Loader2, Search, Shield, AlertTriangle } from 'lucide-react';
import type { CpuLimitRule, CpuLimitMetric, CpuLimitPenaltyMode } from '@/lib/services/cpu-limit-manager';

interface CpuLimitRuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: CpuLimitRule;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
  onSaved: () => void;
}

const METRIC_OPTIONS: Array<{ value: CpuLimitMetric; label: string; desc: string }> = [
  { value: 'cpu', label: 'CPU 使用率', desc: '节点 CPU 使用百分比' },
  { value: 'memory', label: '内存使用率', desc: '节点内存使用百分比' },
  { value: 'disk', label: '磁盘使用率', desc: '节点磁盘使用百分比' },
];

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

export function CpuLimitRuleFormDialog({ open, onOpenChange, rule, nodes, selectedNodeIds, onSaved }: CpuLimitRuleFormDialogProps) {
  const isEdit = !!rule;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 输入框统一用 string 存储，允许自由删除/清空，保存时再转换校验
  const [name, setName] = useState('');
  const [nodeIds, setNodeIds] = useState<number[]>([]);
  const [metric, setMetric] = useState<CpuLimitMetric>('cpu');
  const [threshold, setThreshold] = useState('90');
  const [topN, setTopN] = useState('5');
  const [cpuLimitPercent, setCpuLimitPercent] = useState('50');
  const [durationMin, setDurationMin] = useState('30');
  const [interval, setIntervalVal] = useState(60);
  const [cooldown, setCooldown] = useState(300);
  const [triggerCount, setTriggerCount] = useState('1');
  const [nodeSearch, setNodeSearch] = useState('');

  // 节点并发限制上限
  const [maxActiveInstances, setMaxActiveInstances] = useState('0');

  // 惩罚机制
  const [penaltyEnabled, setPenaltyEnabled] = useState(false);
  const [penaltyWindowMin, setPenaltyWindowMin] = useState('60');
  const [penaltyThreshold, setPenaltyThreshold] = useState('2');
  const [penaltyMode, setPenaltyMode] = useState<CpuLimitPenaltyMode>('multiply');
  const [penaltyValue, setPenaltyValue] = useState('2');
  // CPU 限制值惩罚
  const [penaltyCpuLimitMode, setPenaltyCpuLimitMode] = useState<CpuLimitPenaltyMode>('multiply');
  const [penaltyCpuLimitValue, setPenaltyCpuLimitValue] = useState('2');
  const [minCpuLimitPercent, setMinCpuLimitPercent] = useState('5');

  useEffect(() => {
    if (open) {
      setError('');
      if (rule) {
        setName(rule.name);
        setNodeIds(rule.nodeIds);
        setMetric(rule.metric);
        setThreshold(String(rule.threshold));
        setTopN(String(rule.topN));
        setCpuLimitPercent(String(rule.cpuLimitPercent));
        setDurationMin(String(rule.durationMin));
        setIntervalVal(rule.interval);
        setCooldown(rule.cooldown);
        setTriggerCount(String(rule.triggerCount));
        setMaxActiveInstances(String(rule.maxActiveInstances ?? 0));
        setPenaltyEnabled(!!rule.penaltyEnabled);
        setPenaltyWindowMin(String(rule.penaltyWindowMin ?? 60));
        setPenaltyThreshold(String(rule.penaltyThreshold ?? 2));
        setPenaltyMode(rule.penaltyMode ?? 'multiply');
        setPenaltyValue(String(rule.penaltyValue ?? 2));
        setPenaltyCpuLimitMode(rule.penaltyCpuLimitMode ?? 'multiply');
        setPenaltyCpuLimitValue(String(rule.penaltyCpuLimitValue ?? 2));
        setMinCpuLimitPercent(String(rule.minCpuLimitPercent ?? 5));
      } else {
        setName('');
        setNodeIds(selectedNodeIds.size > 0 ? [...selectedNodeIds] : []);
        setMetric('cpu');
        setThreshold('90');
        setTopN('5');
        setCpuLimitPercent('50');
        setDurationMin('30');
        setIntervalVal(60);
        setCooldown(300);
        setTriggerCount('1');
        setMaxActiveInstances('0');
        setPenaltyEnabled(false);
        setPenaltyWindowMin('60');
        setPenaltyThreshold('2');
        setPenaltyMode('multiply');
        setPenaltyValue('2');
        setPenaltyCpuLimitMode('multiply');
        setPenaltyCpuLimitValue('2');
        setMinCpuLimitPercent('5');
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

  const handleSelectAll = () => setNodeIds(filteredNodes.map(n => n.id));
  const handleClearNodes = () => setNodeIds([]);

  const handleSave = async () => {
    if (!name.trim()) { setError('请输入规则名称'); return; }
    if (nodeIds.length === 0) { setError('请选择至少一个节点'); return; }

    const thresholdNum = Number(threshold);
    const topNNum = Number(topN);
    const cpuLimitNum = Number(cpuLimitPercent);
    const durationNum = Number(durationMin);
    const triggerCountNum = Number(triggerCount);

    if (!threshold.trim() || isNaN(thresholdNum) || thresholdNum <= 0 || thresholdNum > 100) {
      setError('节点指标阈值须在 1-100 之间'); return;
    }
    if (!topN.trim() || isNaN(topNNum) || topNNum < 1) { setError('限制实例数量必须≥1'); return; }
    if (!cpuLimitPercent.trim() || isNaN(cpuLimitNum) || cpuLimitNum < 1 || cpuLimitNum >= 100) {
      setError('CPU 限制百分比须在 1-99 之间（100 表示无限制）'); return;
    }
    if (!durationMin.trim() || isNaN(durationNum) || durationNum < 1) {
      setError('限制持续时间必须≥1分钟'); return;
    }
    if (!triggerCount.trim() || isNaN(triggerCountNum) || triggerCountNum < 1) {
      setError('连续触发次数必须≥1'); return;
    }

    // 节点并发限制上限校验
    const maxActiveNum = Number(maxActiveInstances);
    if (isNaN(maxActiveNum) || maxActiveNum < 0) {
      setError('节点并发限制上限必须≥0（0=不限制）'); return;
    }

    // 惩罚机制校验
    const penaltyWindowNum = Number(penaltyWindowMin);
    const penaltyThresholdNum = Number(penaltyThreshold);
    const penaltyValueNum = Number(penaltyValue);
    if (penaltyEnabled) {
      if (isNaN(penaltyWindowNum) || penaltyWindowNum < 1) {
        setError('惩罚统计窗口必须≥1分钟'); return;
      }
      if (isNaN(penaltyThresholdNum) || penaltyThresholdNum < 1) {
        setError('惩罚触发阈值必须≥1次'); return;
      }
      if (isNaN(penaltyValueNum) || penaltyValueNum < 1) {
        setError(penaltyMode === 'multiply' ? '惩罚倍数必须≥1' : '惩罚额外分钟数必须≥1'); return;
      }
      // CPU 限制值惩罚校验
      const penaltyCpuLimitValueNum = Number(penaltyCpuLimitValue);
      const minCpuLimitNum = Number(minCpuLimitPercent);
      if (isNaN(penaltyCpuLimitValueNum) || penaltyCpuLimitValueNum < 1) {
        setError(penaltyCpuLimitMode === 'multiply' ? 'CPU 限制惩罚除数必须≥1' : 'CPU 限制惩罚降低值必须≥1'); return;
      }
      if (isNaN(minCpuLimitNum) || minCpuLimitNum < 1 || minCpuLimitNum > 100) {
        setError('CPU 限制最低百分比须在 1-100 之间'); return;
      }
      if (penaltyCpuLimitMode === 'add_extra' && cpuLimitNum <= minCpuLimitNum) {
        setError(`基础 CPU 限制 ${cpuLimitNum}% 已低于或等于最低下限 ${minCpuLimitNum}%，无法惩罚`); return;
      }
    }

    setSaving(true);
    try {
      const ruleData: Partial<CpuLimitRule> = {
        name: name.trim(),
        nodeIds,
        metric,
        threshold: thresholdNum,
        topN: topNNum,
        cpuLimitPercent: cpuLimitNum,
        durationMin: durationNum,
        interval,
        cooldown,
        triggerCount: triggerCountNum,
        enabled: true,
        maxActiveInstances: maxActiveNum,
        penaltyEnabled,
        penaltyWindowMin: penaltyWindowNum,
        penaltyThreshold: penaltyThresholdNum,
        penaltyMode,
        penaltyValue: penaltyValueNum,
        // CPU 限制值惩罚
        penaltyCpuLimitMode,
        penaltyCpuLimitValue: Number(penaltyCpuLimitValue),
        minCpuLimitPercent: Number(minCpuLimitPercent),
      };
      if (isEdit) ruleData.id = rule!.id;

      const res = await fetch('/api/cpu-limit', {
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
          <DialogTitle>{isEdit ? '编辑 CPU 限制规则' : '添加 CPU 限制规则'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* 规则名称 */}
          <div className="space-y-1.5">
            <Label className="text-foreground">规则名称</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="如：节点 CPU 过载保护"
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

          {/* 监控指标 */}
          <div className="space-y-1.5">
            <Label className="text-foreground">监控指标</Label>
            <div className="grid grid-cols-3 gap-2">
              {METRIC_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMetric(opt.value)}
                  className={`p-2 rounded-md border text-xs text-center ${
                    metric === opt.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-[10px] mt-0.5 opacity-80">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 阈值 */}
          <div className="space-y-1.5">
            <Label className="text-foreground">节点指标上限阈值 (%)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" value={threshold} onChange={e => setThreshold(e.target.value)}
                min={1} max={100} className="bg-background border-border text-foreground flex-1" />
              <span className="text-xs text-muted-foreground whitespace-nowrap">% (节点指标超过此值则触发)</span>
            </div>
            <p className="text-[10px] text-muted-foreground">如 CPU 阈值 90 表示节点 CPU 使用率 &gt; 90% 时触发</p>
          </div>

          {/* Top N + CPU 限制百分比 + 持续时间 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">限制实例数 (Top N)</Label>
              <Input type="number" value={topN} onChange={e => setTopN(e.target.value)}
                min={1} max={50} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">CPU 限制 (%)</Label>
              <Input type="number" value={cpuLimitPercent} onChange={e => setCpuLimitPercent(e.target.value)}
                min={1} max={99} className="bg-background border-border text-foreground" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-foreground text-xs">持续时间 (分钟)</Label>
              <Input type="number" value={durationMin} onChange={e => setDurationMin(e.target.value)}
                min={1} className="bg-background border-border text-foreground" />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-2">
            对 Top N 实例设置 CPU 限制为 {cpuLimitPercent || '?'}%，持续 {durationMin || '?'} 分钟后自动解除（设为 100%）
          </p>

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

          {/* 节点并发限制上限 */}
          <div className="border border-border rounded-md p-3 space-y-2 bg-background/50">
            <div className="flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-foreground">节点并发限制上限</span>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              防止 CPU 持续超阈值时无限制限制实例：该规则对该节点<strong>当前正在限制</strong>的实例数上限。设为 0 表示不限制。
            </p>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">最大并发限制实例数</Label>
              <Input type="number" value={maxActiveInstances}
                onChange={e => setMaxActiveInstances(e.target.value)}
                min={0} placeholder="0=不限制"
                className="bg-background border-border text-foreground h-8 text-xs" />
            </div>
          </div>

          {/* 惩罚机制 */}
          <div className="border border-border rounded-md p-3 space-y-2 bg-background/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-warning" />
                <span className="text-xs font-medium text-foreground">惩罚机制</span>
              </div>
              <Switch checked={penaltyEnabled} onCheckedChange={setPenaltyEnabled} />
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              实例在统计窗口内被限制次数达阈值后，按规则递增限制时长，避免反复违规。
            </p>
            {penaltyEnabled && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">统计窗口（分钟）</Label>
                    <Input type="number" value={penaltyWindowMin}
                      onChange={e => setPenaltyWindowMin(e.target.value)}
                      min={1} className="bg-background border-border text-foreground h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">触发阈值（次）</Label>
                    <Input type="number" value={penaltyThreshold}
                      onChange={e => setPenaltyThreshold(e.target.value)}
                      min={1} className="bg-background border-border text-foreground h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">时长惩罚值</Label>
                  <Input type="number" value={penaltyValue}
                    onChange={e => setPenaltyValue(e.target.value)}
                    min={1} className="bg-background border-border text-foreground h-8 text-xs" />
                </div>
              </div>
              {/* 时长惩罚模式 */}
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">时长惩罚模式</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPenaltyMode('multiply')}
                    className={`p-2 rounded-md border text-xs text-left ${
                      penaltyMode === 'multiply'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">时长翻倍</div>
                    <div className="text-[10px] mt-0.5 opacity-80">
                      基础×倍数^超阈值次数
                    </div>
                  </button>
                  <button
                    onClick={() => setPenaltyMode('add_extra')}
                    className={`p-2 rounded-md border text-xs text-left ${
                      penaltyMode === 'add_extra'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">额外增加</div>
                    <div className="text-[10px] mt-0.5 opacity-80">
                      基础+额外分钟×超阈值次数
                    </div>
                  </button>
                </div>
              </div>

              {/* CPU 限制值惩罚 */}
              <div className="border-t border-border/50 pt-2 mt-2">
                <div className="text-[10px] font-medium text-foreground mb-1.5">CPU 限制值惩罚</div>
                <p className="text-[9px] text-muted-foreground mb-1.5">
                  惩罚时进一步降低 CPU 限制百分比（更严格），带最低下限保护防止实例卡死
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      {penaltyCpuLimitMode === 'multiply' ? '除数（每次降到 1/n）' : '每次降低值（%）'}
                    </Label>
                    <Input type="number" value={penaltyCpuLimitValue}
                      onChange={e => setPenaltyCpuLimitValue(e.target.value)}
                      min={1} className="bg-background border-border text-foreground h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      CPU 限制最低下限（%）<span className="text-destructive"> *</span>
                    </Label>
                    <Input type="number" value={minCpuLimitPercent}
                      onChange={e => setMinCpuLimitPercent(e.target.value)}
                      min={1} max={100}
                      className="bg-background border-border text-foreground h-8 text-xs" />
                    <p className="text-[9px] text-muted-foreground">惩罚后至少保留此 CPU 限制值</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPenaltyCpuLimitMode('multiply')}
                    className={`p-1.5 rounded-md border text-xs text-left ${
                      penaltyCpuLimitMode === 'multiply'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">每次降低到 1/n</div>
                    <div className="text-[10px] mt-0.5 opacity-80">
                      50%→25%→12.5%（n=2）
                    </div>
                  </button>
                  <button
                    onClick={() => setPenaltyCpuLimitMode('add_extra')}
                    className={`p-1.5 rounded-md border text-xs text-left ${
                      penaltyCpuLimitMode === 'add_extra'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    <div className="font-medium">每次降 n%</div>
                    <div className="text-[10px] mt-0.5 opacity-80">
                      50%→40%→30%（n=10）
                    </div>
                  </button>
                </div>
              </div>

              {/* 惩罚预览 */}
              <div className="bg-muted/30 rounded p-2 text-[10px] text-muted-foreground">
                {(() => {
                  const baseDur = Number(durationMin) || 0;
                  const baseCpu = Number(cpuLimitPercent) || 0;
                  const threshold = Number(penaltyThreshold) || 0;
                  const durVal = Number(penaltyValue) || 0;
                  const cpuVal = Number(penaltyCpuLimitValue) || 0;
                  const minCpu = Number(minCpuLimitPercent) || 5;
                  if (!baseDur || !threshold || !durVal || !cpuVal) return '请先填写基础时长、CPU 限制和惩罚参数';
                  const lines: string[] = [];
                  for (let i = 1; i <= 3; i++) {
                    if (i < threshold) {
                      lines.push(`第${i}次：${baseDur}分/CPU${baseCpu}%`);
                    } else {
                      const exceed = i - threshold + 1;
                      const dur = penaltyMode === 'multiply'
                        ? Math.min(Math.round(baseDur * Math.pow(durVal, exceed)), 1440)
                        : baseDur + durVal * exceed;
                      let cpu: number;
                      if (penaltyCpuLimitMode === 'multiply') {
                        cpu = baseCpu / Math.pow(cpuVal, exceed);
                      } else {
                        cpu = baseCpu - cpuVal * exceed;
                      }
                      cpu = Math.max(Math.round(cpu), minCpu);
                      lines.push(`第${i}次：${dur}分/CPU${cpu}%${i === threshold ? ' ← 惩罚开始' : ''}`);
                    }
                  }
                  return lines.join('  ·  ');
                })()}
              </div>
              </>
            )}
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
