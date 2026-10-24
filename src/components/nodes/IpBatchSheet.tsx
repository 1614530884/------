'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Globe, RefreshCw, Plus, Trash2, ChevronDown, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { getLoginUser } from '@/lib/auth-client';

interface IpBatchSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Array<{ id: number; name: string; ip: string }>;
  initialNodeIds: Set<number>;
}

interface InstanceItem {
  id: number;
  name: string;
  mainIp: string;
  ipCount: number;
}

interface SegmentItem {
  id: number;
  name: string;
  total: number;
  used: number;
  free: number;
}

interface BatchTask {
  id: number;
  running: boolean;
  current: string;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  logs: string[];
}

function extractData(raw: Record<string, unknown>): unknown {
  const data = raw.data as Record<string, unknown> | undefined;
  if (!data) return null;
  return (data.data ?? data) as unknown;
}

function pickList(raw: Record<string, unknown>): unknown[] {
  const inner = extractData(raw);
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') {
    const obj = inner as Record<string, unknown>;
    const list = obj.list ?? obj.items ?? obj.clouds;
    if (Array.isArray(list)) return list;
  }
  return [];
}

export function IpBatchSheet({ open, onOpenChange, nodes, initialNodeIds }: IpBatchSheetProps) {
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [instances, setInstances] = useState<InstanceItem[]>([]);
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<number>>(new Set());
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<number>>(new Set());

  // 分配模式
  const [fillMode, setFillMode] = useState<'fixed' | 'random'>('fixed');
  const [fixedCount, setFixedCount] = useState(1);
  const [minCount, setMinCount] = useState(1);
  const [maxCount, setMaxCount] = useState(2);

  // 删除模式
  const [keepMainIp, setKeepMainIp] = useState(true);
  const [dryRun, setDryRun] = useState(true);

  const [intervalSec, setIntervalSec] = useState(0);
  const [task, setTask] = useState<BatchTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [showInstances, setShowInstances] = useState(true);
  const [showLogs, setShowLogs] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  const callApi = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const res = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: getLoginUser(), ...params }),
    });
    return res.json() as Promise<Record<string, unknown>>;
  }, []);

  // 默认节点：优先使用打开面板时传入的节点
  useEffect(() => {
    if (!open) return;
    const first = Array.from(initialNodeIds)[0] ?? nodes[0]?.id ?? null;
    setNodeId(first);
  }, [open, initialNodeIds, nodes]);

  const loadNodeData = useCallback(async (nid: number) => {
    setLoading(true);
    setInstancesLoading(true);
    setInstances([]);
    setSegments([]);
    setSelectedInstanceIds(new Set());
    setSelectedSegmentIds(new Set());
    try {
      const [segRes, instRes] = await Promise.all([
        callApi('ipSegmentList', { node: nid, per_page: 100 }),
        callApi('cloudList', { node: nid, node_id: nid, page: 1, per_page: 100 }),
      ]);

      if (segRes.success) {
        const list = pickList(segRes).map((item) => {
          const s = item as Record<string, unknown>;
          const c = (s.count || {}) as Record<string, unknown>;
          return {
            id: Number(s.id) || 0,
            name: String(s.ip_name || s.ip_sengmen || '-'),
            total: Number(c.total) || 0,
            used: Number(c.used) || 0,
            free: Number(c.free) || 0,
          };
        }).filter((s) => s.id > 0);
        setSegments(list);
        // 默认选中第一个有剩余空间的 IP 段
        const firstFree = list.find((s) => s.free > 0) ?? list[0];
        if (firstFree) setSelectedSegmentIds(new Set([firstFree.id]));
      } else {
        toast.error(String(segRes.msg || segRes.message || '获取 IP 段失败'));
      }

      if (instRes.success) {
        // 文档字段：hostname（主机名）、mainip（主 IP）、ip_num（外网 IP 数量）、meta.total（总数）
        const list = pickList(instRes).map((item) => {
          const c = item as Record<string, unknown>;
          return {
            id: Number(c.id) || 0,
            name: String(c.hostname ?? c.name ?? '-'),
            mainIp: String(c.mainip ?? c.main_ip ?? ''),
            ipCount: Number(c.ip_num) || 0,
          };
        }).filter((i) => i.id > 0);
        setInstances(list);
        // meta 与 data 同级：{ success, data: { data: [...], meta: { total } } }
        const payload = instRes.data as Record<string, unknown> | undefined;
        const meta = (payload?.meta ?? (extractData(instRes) as Record<string, unknown> | null)?.meta ?? {}) as Record<string, unknown>;
        const total = Number(meta.total) || list.length;
        if (total > list.length) {
          toast.warning(`该节点共 ${total} 个实例，这里只展示前 ${list.length} 个；不勾选实例时将处理全部实例`);
        }
      } else {
        toast.error(String(instRes.msg || instRes.message || '获取实例列表失败'));
      }
    } catch {
      toast.error('加载节点数据失败');
    } finally {
      setLoading(false);
      setInstancesLoading(false);
    }
  }, [callApi]);

  useEffect(() => {
    if (open && nodeId) {
      void loadNodeData(nodeId);
    }
  }, [open, nodeId, loadNodeData]);

  // 任务进度轮询
  useEffect(() => {
    if (!task?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/mfy/ip-batch?taskId=${task.id}`);
        const data = await res.json();
        if (data.success && data.task) {
          setTask(data.task);
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => clearInterval(timer);
  }, [task?.id, task?.running]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [task?.logs.length]);

  const runTask = async (body: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/mfy/ip-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          _loginUser: getLoginUser(),
          nodeIds: [nodeId],
          intervalMs: intervalSec * 1000,
          ...body,
        }),
      });
      const data = await res.json();
      if (data.success && data.taskId) {
        setShowLogs(true);
        const statusRes = await fetch(`/api/mfy/ip-batch?taskId=${data.taskId}`);
        const statusData = await statusRes.json();
        if (statusData.success) setTask(statusData.task);
        toast.success('任务已提交，正在后台执行');
      } else {
        toast.error(data.message || '任务提交失败');
      }
    } catch {
      toast.error('任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFill = () => {
    if (!nodeId || selectedSegmentIds.size === 0) {
      toast.error('请选择 IP 段');
      return;
    }
    if (fillMode === 'fixed' && (fixedCount < 1 || fixedCount > 50)) {
      toast.error('每个实例的 IP 数量需为 1-50');
      return;
    }
    if (fillMode === 'random' && (minCount < 1 || maxCount > 50 || minCount > maxCount)) {
      toast.error('随机数量范围需为 1-50 且最小值不大于最大值');
      return;
    }
    const count = selectedInstanceIds.size > 0 ? selectedInstanceIds.size : instances.length;
    const desc = fillMode === 'fixed' ? `${fixedCount} 个` : `${minCount}-${maxCount} 个随机`;
    if (!confirm(`将为 ${count} 个实例各分配 ${desc} IP（沿用实例当前限速组），确定执行？`)) return;
    void runTask({
      action: 'fill',
      segmentIds: Array.from(selectedSegmentIds),
      instanceIds: selectedInstanceIds.size > 0 ? Array.from(selectedInstanceIds) : undefined,
      ipsPerInstance: fillMode === 'fixed' ? fixedCount : -1,
      minPerInstance: minCount,
      maxPerInstance: maxCount,
    });
  };

  const handleClear = () => {
    if (!nodeId) return;
    const count = selectedInstanceIds.size > 0 ? selectedInstanceIds.size : instances.length;
    const segDesc = selectedSegmentIds.size > 0
      ? `所选 ${selectedSegmentIds.size} 个 IP 段`
      : '全部 IP 段';
    if (!dryRun) {
      const hint = `将从 ${count} 个实例中删除${segDesc}内的 IP${keepMainIp ? '（保留主 IP）' : '（包含主 IP）'}，此操作不可撤销，确定执行？`;
      if (!confirm(hint)) return;
    }
    void runTask({
      action: 'clear',
      segmentIds: selectedSegmentIds.size > 0 ? Array.from(selectedSegmentIds) : undefined,
      instanceIds: selectedInstanceIds.size > 0 ? Array.from(selectedInstanceIds) : undefined,
      keepMainIps: keepMainIp,
      dryRun,
    });
  };

  const toggleInstance = (id: number) => {
    setSelectedInstanceIds((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSegment = (id: number) => {
    setSelectedSegmentIds((prev: Set<number>) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const currentTaskRunning = task?.running ?? false;
  const targetCount = selectedInstanceIds.size > 0 ? selectedInstanceIds.size : instances.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl bg-card border-border text-foreground overflow-y-auto overflow-x-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-foreground">
            <Globe className="w-5 h-5 text-primary" />
            批量 IP 管理
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* 节点选择 */}
          <div className="bg-card rounded-lg p-3 border border-border space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/80 shrink-0">节点</span>
              <select
                value={nodeId ?? ''}
                onChange={(e) => setNodeId(Number(e.target.value) || null)}
                disabled={currentTaskRunning}
                className="flex-1 bg-muted border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary min-h-[36px]"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>{n.name}（{n.ip}）</option>
                ))}
              </select>
              <Button size="sm" variant="outline" onClick={() => nodeId && loadNodeData(nodeId)}
                disabled={loading || currentTaskRunning} className="border-border h-9 text-xs">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              本节点实例 <span className="text-foreground font-medium">{instances.length}</span> 个
              {' · '}
              本次处理 <span className="text-primary font-medium">{targetCount}</span> 个
              {selectedInstanceIds.size === 0 && instances.length > 0 && '（未勾选实例=处理全部）'}
            </div>
          </div>

          {/* IP 段 */}
          <div className="bg-card rounded-lg p-3 border border-border space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">IP 段</span>
              <span className="text-xs text-muted-foreground">
                已选 {selectedSegmentIds.size} / {segments.length}
              </span>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />加载中...
              </div>
            ) : segments.length === 0 ? (
              <div className="text-xs text-muted-foreground py-1">该节点没有 IP 段信息</div>
            ) : (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {segments.map((seg) => (
                  <label key={seg.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent cursor-pointer">
                    <Checkbox
                      checked={selectedSegmentIds.has(seg.id)}
                      onCheckedChange={() => toggleSegment(seg.id)}
                      disabled={currentTaskRunning}
                    />
                    <span className="text-xs text-foreground/80 font-mono flex-1 truncate" title={seg.name}>{seg.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      空闲 <span className="text-success">{seg.free}</span> / {seg.total}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="text-[11px] text-muted-foreground">
              删除时未勾选 IP 段 = 处理该节点全部 IP 段
            </div>
          </div>

          {/* 实例列表 */}
          <div className="bg-card rounded-lg p-3 border border-border space-y-2">
            <button onClick={() => setShowInstances((v) => !v)} className="w-full flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">
                实例列表（最多展示 100 个）
              </span>
              <span className="flex items-center gap-2">
                {selectedInstanceIds.size > 0 && (
                  <Badge variant="secondary" className="text-[10px]">已选 {selectedInstanceIds.size}</Badge>
                )}
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${showInstances ? '' : '-rotate-90'}`} />
              </span>
            </button>
            {showInstances && (
              <>
                <div className="flex items-center gap-3 text-xs">
                  <button
                    onClick={() => setSelectedInstanceIds(new Set(instances.map((i) => i.id)))}
                    disabled={currentTaskRunning || instances.length === 0}
                    className="text-primary hover:underline disabled:opacity-40"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => setSelectedInstanceIds(new Set())}
                    disabled={currentTaskRunning || selectedInstanceIds.size === 0}
                    className="text-muted-foreground hover:underline disabled:opacity-40"
                  >
                    清空
                  </button>
                </div>
                {instancesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />加载实例...
                  </div>
                ) : instances.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-1">暂无实例数据</div>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
                    {instances.map((inst) => (
                      <label key={inst.id} className="flex items-center gap-2 px-1 py-1.5 rounded hover:bg-accent cursor-pointer">
                        <Checkbox
                          checked={selectedInstanceIds.has(inst.id)}
                          onCheckedChange={() => toggleInstance(inst.id)}
                          disabled={currentTaskRunning}
                        />
                        <span className="text-xs text-foreground/80 flex-1 truncate" title={inst.name}>{inst.name}</span>
                        <span className="text-[11px] text-muted-foreground font-mono shrink-0">{inst.mainIp || '-'}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0 w-12 text-right">IP {inst.ipCount}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* 分配 IP */}
          <div className="bg-card rounded-lg p-3 border border-border space-y-2">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-success" />
              <span className="text-sm font-medium text-foreground">批量分配 IP</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={fillMode === 'fixed'} onChange={() => setFillMode('fixed')} disabled={currentTaskRunning} />
                固定数量
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={fillMode === 'random'} onChange={() => setFillMode('random')} disabled={currentTaskRunning} />
                随机数量
              </label>
            </div>
            {fillMode === 'fixed' ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">每个实例分配</span>
                <input
                  type="number" min={1} max={50} value={fixedCount}
                  onChange={(e) => setFixedCount(Number(e.target.value) || 1)}
                  disabled={currentTaskRunning}
                  className="w-16 bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary"
                />
                <span className="text-muted-foreground">个 IP</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">每个实例随机</span>
                <input
                  type="number" min={1} max={50} value={minCount}
                  onChange={(e) => setMinCount(Number(e.target.value) || 1)}
                  disabled={currentTaskRunning}
                  className="w-16 bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary"
                />
                <span className="text-muted-foreground">~</span>
                <input
                  type="number" min={1} max={50} value={maxCount}
                  onChange={(e) => setMaxCount(Number(e.target.value) || 1)}
                  disabled={currentTaskRunning}
                  className="w-16 bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary"
                />
                <span className="text-muted-foreground">个 IP</span>
              </div>
            )}
            <Button
              size="sm" onClick={handleFill}
              disabled={submitting || currentTaskRunning || loading || selectedSegmentIds.size === 0}
              className="w-full h-8 text-xs"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
              开始分配
            </Button>
          </div>

          {/* 删除 IP */}
          <div className="bg-card rounded-lg p-3 border border-border space-y-2">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" />
              <span className="text-sm font-medium text-foreground">批量删除 IP</span>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={keepMainIp} onCheckedChange={(v) => setKeepMainIp(!!v)} disabled={currentTaskRunning} />
              保留主 IP（强烈建议）
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Checkbox checked={dryRun} onCheckedChange={(v) => setDryRun(!!v)} disabled={currentTaskRunning} />
              预检模式（只列出将被删除的 IP，不实际删除）
            </label>
            {!dryRun && (
              <div className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                实际删除后不可撤销，建议先用预检模式确认结果
              </div>
            )}
            <Button
              size="sm" variant={dryRun ? 'outline' : 'destructive'} onClick={handleClear}
              disabled={submitting || currentTaskRunning || loading || instances.length === 0}
              className="w-full h-8 text-xs"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Trash2 className="w-3.5 h-3.5 mr-1" />}
              {dryRun ? '开始预检' : '开始删除'}
            </Button>
          </div>

          {/* 执行间隔 */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">每个实例间隔</span>
            <select
              value={intervalSec}
              onChange={(e) => setIntervalSec(Number(e.target.value))}
              disabled={currentTaskRunning}
              className="bg-muted border border-border rounded px-2 py-1 text-foreground focus:outline-none"
            >
              <option value={0}>无</option>
              <option value={1}>1 秒</option>
              <option value={2}>2 秒</option>
              <option value={3}>3 秒</option>
              <option value={5}>5 秒</option>
            </select>
            <span className="text-muted-foreground">（接口限流时可适当增加）</span>
          </div>

          {/* 任务进度 */}
          {task && (
            <div className="bg-card rounded-lg p-3 border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground flex items-center gap-2">
                  {task.running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : <span className="w-2 h-2 rounded-full bg-success" />}
                  任务 #{task.id} {task.running ? '执行中' : '已结束'}
                </span>
                <button onClick={() => setShowLogs((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
                  {showLogs ? '收起日志' : '展开日志'}
                </button>
              </div>
              <div className="text-xs text-muted-foreground">
                进度 {task.processed}/{task.total || '-'}
                {' · '}成功 <span className="text-success">{task.succeeded}</span>
                {' · '}失败 <span className="text-destructive">{task.failed}</span>
                {task.current && <span className="ml-1">· {task.current}</span>}
              </div>
              <div className="h-1.5 bg-muted rounded overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${task.total > 0 ? Math.min(100, (task.processed / task.total) * 100) : 0}%` }}
                />
              </div>
              {showLogs && (
                <div ref={logRef} className="max-h-56 overflow-y-auto bg-background rounded p-2 text-[11px] font-mono space-y-0.5">
                  {task.logs.length === 0 ? (
                    <div className="text-muted-foreground">等待日志...</div>
                  ) : task.logs.map((line, i) => (
                    <div key={i} className={
                      line.includes('✗') || line.includes('终止') ? 'text-destructive'
                        : line.includes('✓') ? 'text-success'
                          : 'text-muted-foreground'
                    }>{line}</div>
                  ))}
                </div>
              )}
              {!task.running && (
                <Button size="sm" variant="outline" onClick={() => nodeId && loadNodeData(nodeId)}
                  className="w-full h-7 text-xs border-border">
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />刷新节点数据
                </Button>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
