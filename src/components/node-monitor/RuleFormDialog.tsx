'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search } from 'lucide-react';
import type { MonitorRule, MonitorMetric, MonitorOperator, MonitorAction } from '@/lib/services/node-monitor-types';

interface RuleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: MonitorRule;
  nodes: Array<{ id: number; name: string; ip: string }>;
  selectedNodeIds: Set<number>;
  onSaved: () => void;
}

const METRIC_OPTIONS: { value: MonitorMetric; label: string }[] = [
  { value: 'cpu', label: 'CPU使用率' },
  { value: 'memory', label: '内存使用率' },
  { value: 'disk', label: '磁盘占用率' },
];

// 单条件：above/below；区间：range
const OPERATOR_OPTIONS: { value: MonitorOperator; label: string; desc?: string }[] = [
  { value: 'above', label: '高于' },
  { value: 'below', label: '低于' },
  { value: 'range', label: '区间控制', desc: '高于X时执行A，低于Y时执行B（一次查询，双向判断）' },
];

const ACTION_OPTIONS: { value: MonitorAction; label: string }[] = [
  { value: 'disable', label: '禁用节点' },
  { value: 'enable', label: '启用节点' },
];

const INTERVAL_OPTIONS = [
  { value: 60, label: '1分钟' },
  { value: 120, label: '2分钟' },
  { value: 300, label: '5分钟' },
  { value: 600, label: '10分钟' },
  { value: 1800, label: '30分钟' },
];

const COOLDOWN_OPTIONS = [
  { value: 60, label: '1分钟' },
  { value: 300, label: '5分钟' },
  { value: 600, label: '10分钟' },
  { value: 1800, label: '30分钟' },
];

export function RuleFormDialog({ open, onOpenChange, rule, nodes, selectedNodeIds, onSaved }: RuleFormDialogProps) {
  const isEdit = !!rule;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [nodeIds, setNodeIds] = useState<number[]>([]);
  const [metric, setMetric] = useState<MonitorMetric>('cpu');
  const [operator, setOperator] = useState<MonitorOperator>('above');
  // 数值输入用 string 存储，允许自由删除/清空/编辑，保存时再 Number() 转换
  const [threshold, setThreshold] = useState('80');
  // 区间模式低位
  const [thresholdLow, setThresholdLow] = useState('20');
  const [actionLow, setActionLow] = useState<MonitorAction>('enable');
  // 高位
  const [action, setAction] = useState<MonitorAction>('disable');
  const [interval, setInterval_] = useState(300);
  const [cooldown, setCooldown] = useState(600);
  const [triggerCount, setTriggerCount] = useState('1');
  const [nodeSearch, setNodeSearch] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      if (rule) {
        setName(rule.name);
        setNodeIds(rule.nodeIds);
        setMetric(rule.metric);
        setOperator(rule.operator || 'above');
        setThreshold(String(rule.threshold));
        setAction(rule.action);
        setThresholdLow(String(rule.thresholdLow ?? 20));
        setActionLow(rule.actionLow ?? 'enable');
        setInterval_(rule.interval);
        setCooldown(rule.cooldown);
        setTriggerCount(String(rule.triggerCount || 1));
      } else {
        setName('');
        setNodeIds([...selectedNodeIds]);
        setMetric('cpu');
        setOperator('above');
        setThreshold('80');
        setAction('disable');
        setThresholdLow('20');
        setActionLow('enable');
        setInterval_(300);
        setCooldown(600);
        setTriggerCount('1');
      }
      setNodeSearch('');
    }
  }, [open, rule, selectedNodeIds]);

  const handleSave = async () => {
    setError('');
    if (!name.trim()) { setError('请输入规则名称'); return; }
    if (nodeIds.length === 0) { setError('请选择至少一个节点'); return; }
    // string -> number 转换并校验
    const thresholdNum = Number(threshold);
    const thresholdLowNum = Number(thresholdLow);
    const triggerCountNum = Number(triggerCount);
    if (!threshold.trim() || isNaN(thresholdNum) || thresholdNum < 0 || thresholdNum > 100) {
      setError('阈值必须在0-100之间'); return;
    }
    if (!triggerCount.trim() || isNaN(triggerCountNum) || triggerCountNum < 1) {
      setError('触发次数必须≥1'); return;
    }
    if (operator === 'range') {
      if (!thresholdLow.trim() || isNaN(thresholdLowNum) || thresholdLowNum < 0 || thresholdLowNum > 99) {
        setError('低位阈值必须在0-99之间'); return;
      }
      if (thresholdNum <= thresholdLowNum) { setError('高位阈值必须大于低位阈值'); return; }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/node-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveRule',
          rule: {
            id: rule?.id || '',
            name: name.trim(),
            nodeIds,
            metric,
            operator,
            threshold: thresholdNum,
            action,
            ...(operator === 'range' ? { thresholdLow: thresholdLowNum, actionLow } : {}),
            interval,
            cooldown,
            triggerCount: triggerCountNum,
            enabled: rule?.enabled ?? true,
            createdAt: rule?.createdAt || 0,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved();
        onOpenChange(false);
      } else {
        setError(data.message || '保存失败');
      }
    } catch {
      setError('请求失败');
    }
    setSaving(false);
  };

  const toggleNode = (nid: number) => {
    setNodeIds(prev => prev.includes(nid) ? prev.filter(id => id !== nid) : [...prev, nid]);
  };

  const filteredNodes = nodes.filter(n =>
    !nodeSearch || n.name.toLowerCase().includes(nodeSearch.toLowerCase()) || n.ip.includes(nodeSearch)
  );

  const isRangeMode = operator === 'range';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑规则' : '添加规则'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 规则名称 */}
          <div>
            <Label className="text-foreground/80 text-xs">规则名称</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: CPU过高自动禁用"
              className="mt-1 bg-input border-border text-foreground"
            />
          </div>

          {/* 目标节点 */}
          <div>
            <Label className="text-foreground/80 text-xs">目标节点 ({nodeIds.length}个已选)</Label>
            <div className="mt-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                value={nodeSearch}
                onChange={e => setNodeSearch(e.target.value)}
                placeholder="搜索节点..."
                className="pl-8 bg-input border-border text-foreground text-xs"
              />
            </div>
            <div className="mt-1.5 border border-border rounded-lg max-h-40 overflow-y-auto bg-input">
              {filteredNodes.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground text-center">无匹配节点</div>
              ) : filteredNodes.map(n => (
                <label key={n.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 cursor-pointer text-xs">
                  <Checkbox
                    checked={nodeIds.includes(n.id)}
                    onCheckedChange={() => toggleNode(n.id)}
                  />
                  <span className="text-foreground">{n.name}</span>
                  <span className="text-muted-foreground ml-auto font-mono">{n.ip}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 监控指标 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-foreground/80 text-xs">监控指标</Label>
              <select
                value={metric}
                onChange={e => setMetric(e.target.value as MonitorMetric)}
                className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
              >
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-foreground/80 text-xs">比较模式</Label>
              <select
                value={operator}
                onChange={e => setOperator(e.target.value as MonitorOperator)}
                className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
              >
                {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 模式描述 */}
          {isRangeMode && OPERATOR_OPTIONS.find(o => o.value === operator)?.desc && (
            <div className="bg-primary/10 border border-primary/30 rounded-md px-3 py-2 text-[11px] text-primary">
              {OPERATOR_OPTIONS.find(o => o.value === operator)?.desc}
            </div>
          )}

          {/* 条件配置 - 根据模式动态显示 */}
          {isRangeMode ? (
            /* ====== 区间模式 ====== */
            <div className="border border-border rounded-lg p-3 space-y-3 bg-input/50">
              <div className="text-xs font-medium text-primary flex items-center gap-1.5">
                <span>高位条件</span>
                <span className="font-normal text-muted-foreground">(指标超过此值时触发)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-muted-foreground text-[11px]">高位阈值 (%)</Label>
                  <Input
                    type="number" min={1} max={100}
                    value={threshold}
                    onChange={e => setThreshold(e.target.value)}
                    className="mt-1 bg-input border-border text-foreground text-xs"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground text-[11px]">高位动作</Label>
                  <select
                    value={action}
                    onChange={e => setAction(e.target.value as MonitorAction)}
                    className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
                  >
                    {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="h-px bg-muted" />

              <div className="text-xs font-medium text-info flex items-center gap-1.5">
                <span>低位条件</span>
                <span className="font-normal text-muted-foreground">(指标低于此值时触发)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-muted-foreground text-[11px]">低位阈值 (%)</Label>
                  <Input
                    type="number" min={0} max={99}
                    value={thresholdLow}
                    onChange={e => setThresholdLow(e.target.value)}
                    className="mt-1 bg-input border-border text-foreground text-xs"
                  />
                </div>
                <div>
                  <Label className="text-muted-foreground text-[11px]">低位动作</Label>
                  <select
                    value={actionLow}
                    onChange={e => setActionLow(e.target.value as MonitorAction)}
                    className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
                  >
                    {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ) : (
            /* ====== 单条件模式 ====== */
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-foreground/80 text-xs">比较条件</Label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value as MonitorOperator)}
                  className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
                >
                  {OPERATOR_OPTIONS.filter(o => o.value !== 'range').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-foreground/80 text-xs">阈值 (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  className="mt-1 bg-input border-border text-foreground"
                />
              </div>
            </div>
          )}

          {!isRangeMode && (
            <div>
              <Label className="text-foreground/80 text-xs">触发动作</Label>
              <select
                value={action}
                onChange={e => setAction(e.target.value as MonitorAction)}
                className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
              >
                {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* 间隔、触发次数、冷却 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-foreground/80 text-xs">检查间隔</Label>
              <select
                value={interval}
                onChange={e => setInterval_(Number(e.target.value))}
                className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
              >
                {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-foreground/80 text-xs">触发次数</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={triggerCount}
                onChange={e => setTriggerCount(e.target.value)}
                className="mt-1 bg-input border-border text-foreground"
              />
              <span className="text-[10px] text-muted-foreground mt-0.5 block">连续满足后执行</span>
            </div>
            <div>
              <Label className="text-foreground/80 text-xs">冷却时间</Label>
              <select
                value={cooldown}
                onChange={e => setCooldown(Number(e.target.value))}
                className="mt-1 w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs text-foreground"
              >
                {COOLDOWN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="text-xs text-destructive">{error}</div>}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border text-foreground/80">
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isEdit ? '保存' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
