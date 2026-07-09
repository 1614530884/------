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
  const [threshold, setThreshold] = useState(80);
  // 区间模式低位
  const [thresholdLow, setThresholdLow] = useState(20);
  const [actionLow, setActionLow] = useState<MonitorAction>('enable');
  // 高位
  const [action, setAction] = useState<MonitorAction>('disable');
  const [interval, setInterval_] = useState(300);
  const [cooldown, setCooldown] = useState(600);
  const [triggerCount, setTriggerCount] = useState(1);
  const [nodeSearch, setNodeSearch] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      if (rule) {
        setName(rule.name);
        setNodeIds(rule.nodeIds);
        setMetric(rule.metric);
        setOperator(rule.operator || 'above');
        setThreshold(rule.threshold);
        setAction(rule.action);
        setThresholdLow(rule.thresholdLow ?? 20);
        setActionLow(rule.actionLow ?? 'enable');
        setInterval_(rule.interval);
        setCooldown(rule.cooldown);
        setTriggerCount(rule.triggerCount || 1);
      } else {
        setName('');
        setNodeIds([...selectedNodeIds]);
        setMetric('cpu');
        setOperator('above');
        setThreshold(80);
        setAction('disable');
        setThresholdLow(20);
        setActionLow('enable');
        setInterval_(300);
        setCooldown(600);
        setTriggerCount(1);
      }
      setNodeSearch('');
    }
  }, [open, rule, selectedNodeIds]);

  const handleSave = async () => {
    setError('');
    if (!name.trim()) { setError('请输入规则名称'); return; }
    if (nodeIds.length === 0) { setError('请选择至少一个节点'); return; }
    if (operator === 'range') {
      if (threshold <= thresholdLow) { setError('高位阈值必须大于低位阈值'); return; }
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
            threshold,
            action,
            ...(operator === 'range' ? { thresholdLow, actionLow } : {}),
            interval,
            cooldown,
            triggerCount,
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
      <DialogContent className="bg-[#1a1d27] border-gray-800 text-white max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '编辑规则' : '添加规则'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 规则名称 */}
          <div>
            <Label className="text-gray-300 text-xs">规则名称</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如: CPU过高自动禁用"
              className="mt-1 bg-[#0f1117] border-gray-700 text-white"
            />
          </div>

          {/* 目标节点 */}
          <div>
            <Label className="text-gray-300 text-xs">目标节点 ({nodeIds.length}个已选)</Label>
            <div className="mt-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <Input
                value={nodeSearch}
                onChange={e => setNodeSearch(e.target.value)}
                placeholder="搜索节点..."
                className="pl-8 bg-[#0f1117] border-gray-700 text-white text-xs"
              />
            </div>
            <div className="mt-1.5 border border-gray-800 rounded-lg max-h-40 overflow-y-auto bg-[#0f1117]">
              {filteredNodes.length === 0 ? (
                <div className="p-2 text-xs text-gray-500 text-center">无匹配节点</div>
              ) : filteredNodes.map(n => (
                <label key={n.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800/50 cursor-pointer text-xs">
                  <Checkbox
                    checked={nodeIds.includes(n.id)}
                    onCheckedChange={() => toggleNode(n.id)}
                  />
                  <span className="text-gray-200">{n.name}</span>
                  <span className="text-gray-500 ml-auto font-mono">{n.ip}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 监控指标 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-300 text-xs">监控指标</Label>
              <select
                value={metric}
                onChange={e => setMetric(e.target.value as MonitorMetric)}
                className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
              >
                {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-gray-300 text-xs">比较模式</Label>
              <select
                value={operator}
                onChange={e => setOperator(e.target.value as MonitorOperator)}
                className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
              >
                {OPERATOR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* 模式描述 */}
          {isRangeMode && OPERATOR_OPTIONS.find(o => o.value === operator)?.desc && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-md px-3 py-2 text-[11px] text-purple-300">
              {OPERATOR_OPTIONS.find(o => o.value === operator)?.desc}
            </div>
          )}

          {/* 条件配置 - 根据模式动态显示 */}
          {isRangeMode ? (
            /* ====== 区间模式 ====== */
            <div className="border border-gray-800 rounded-lg p-3 space-y-3 bg-[#0f1117]/50">
              <div className="text-xs font-medium text-orange-400 flex items-center gap-1.5">
                <span>高位条件</span>
                <span className="font-normal text-gray-500">(指标超过此值时触发)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-[11px]">高位阈值 (%)</Label>
                  <Input
                    type="number" min={1} max={100}
                    value={threshold}
                    onChange={e => setThreshold(Number(e.target.value))}
                    className="mt-1 bg-[#0f1117] border-gray-700 text-white text-xs"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-[11px]">高位动作</Label>
                  <select
                    value={action}
                    onChange={e => setAction(e.target.value as MonitorAction)}
                    className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
                  >
                    {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="h-px bg-gray-800" />

              <div className="text-xs font-medium text-cyan-400 flex items-center gap-1.5">
                <span>低位条件</span>
                <span className="font-normal text-gray-500">(指标低于此值时触发)</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-gray-400 text-[11px]">低位阈值 (%)</Label>
                  <Input
                    type="number" min={0} max={99}
                    value={thresholdLow}
                    onChange={e => setThresholdLow(Number(e.target.value))}
                    className="mt-1 bg-[#0f1117] border-gray-700 text-white text-xs"
                  />
                </div>
                <div>
                  <Label className="text-gray-400 text-[11px]">低位动作</Label>
                  <select
                    value={actionLow}
                    onChange={e => setActionLow(e.target.value as MonitorAction)}
                    className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
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
                <Label className="text-gray-300 text-xs">比较条件</Label>
                <select
                  value={operator}
                  onChange={e => setOperator(e.target.value as MonitorOperator)}
                  className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
                >
                  {OPERATOR_OPTIONS.filter(o => o.value !== 'range').map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-gray-300 text-xs">阈值 (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={e => setThreshold(Number(e.target.value))}
                  className="mt-1 bg-[#0f1117] border-gray-700 text-white"
                />
              </div>
            </div>
          )}

          {!isRangeMode && (
            <div>
              <Label className="text-gray-300 text-xs">触发动作</Label>
              <select
                value={action}
                onChange={e => setAction(e.target.value as MonitorAction)}
                className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
              >
                {ACTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* 间隔、触发次数、冷却 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-gray-300 text-xs">检查间隔</Label>
              <select
                value={interval}
                onChange={e => setInterval_(Number(e.target.value))}
                className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
              >
                {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-gray-300 text-xs">触发次数</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={triggerCount}
                onChange={e => setTriggerCount(Math.max(1, Number(e.target.value)))}
                className="mt-1 bg-[#0f1117] border-gray-700 text-white"
              />
              <span className="text-[10px] text-gray-500 mt-0.5 block">连续满足后执行</span>
            </div>
            <div>
              <Label className="text-gray-300 text-xs">冷却时间</Label>
              <select
                value={cooldown}
                onChange={e => setCooldown(Number(e.target.value))}
                className="mt-1 w-full bg-[#0f1117] border border-gray-700 rounded-md px-2 py-1.5 text-xs text-white"
              >
                {COOLDOWN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-gray-700 text-gray-300">
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white">
            {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            {isEdit ? '保存' : '添加'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
