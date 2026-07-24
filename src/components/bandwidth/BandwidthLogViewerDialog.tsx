'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Trash2, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon, Filter } from 'lucide-react';
import type { BandwidthLog } from '@/lib/services/bandwidth-manager';

interface BandwidthLogViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'limit_trigger', label: '触发限速' },
  { value: 'limit_execute', label: '执行限速' },
  { value: 'limit_skip', label: '跳过限速' },
  { value: 'rule_create', label: '创建规则' },
  { value: 'rule_update', label: '修改规则' },
  { value: 'rule_delete', label: '删除规则' },
];

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部结果' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'skipped', label: '跳过' },
];

export function BandwidthLogViewerDialog({ open, onOpenChange }: BandwidthLogViewerDialogProps) {
  const [logs, setLogs] = useState<BandwidthLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterEventType, setFilterEventType] = useState<string>('all');
  const [filterResult, setFilterResult] = useState<string>('all');
  const perPage = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (filterEventType !== 'all') params.set('eventType', filterEventType);
      if (filterResult !== 'all') params.set('result', filterResult);
      const res = await fetch(`/api/bandwidth?action=listLogs&${params}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.items);
        setTotal(data.data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterEventType, filterResult]);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  const handleClear = async () => {
    await fetch('/api/bandwidth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clearLogs' }),
    });
    setLogs([]);
    setTotal(0);
    setPage(1);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const eventTypeLabel = (t: string): string => {
    const map: Record<string, string> = {
      rule_create: '创建规则', rule_update: '修改规则', rule_delete: '删除规则',
      limit_trigger: '触发限速', limit_execute: '执行限速', limit_release: '解除限速', limit_skip: '跳过限速',
    };
    return map[t] ?? t;
  };

  const eventTypeColor = (t: string): string => {
    if (t === 'limit_execute' || t === 'limit_release') return 'text-primary';
    if (t === 'limit_trigger') return 'text-info';
    if (t === 'limit_skip') return 'text-warning';
    if (t === 'rule_delete') return 'text-destructive';
    return 'text-muted-foreground';
  };

  const resultColor = (r: string): string => r === 'success' ? 'text-success' : r === 'failed' ? 'text-destructive' : 'text-warning';
  const resultLabel = (r: string): string => r === 'success' ? '成功' : r === 'failed' ? '失败' : '跳过';

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  const formatBandwidth = (mbps: number): string => {
    if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
    return `${mbps.toFixed(1)} Mbps`;
  };

  /** bps → Mbps/Gbps 显示 */
  const formatBps = (bps: number): string => formatBandwidth(bps / 1_000_000);

  /** 触发方向中文标签 */
  const triggerDirectionLabel = (d?: string): string => {
    if (d === 'up') return '上行触发';
    if (d === 'down') return '下行触发';
    if (d === 'both') return '双向触发';
    return '';
  };

  const directionLabel = (d?: string): string => {
    if (d === 'in') return '入站';
    if (d === 'out') return '出站';
    if (d === 'both') return '双向';
    return '';
  };

  const reasonLabel = (r: string): string => {
    const map: Record<string, string> = {
      top_n: '已限速',
      continuous_filtered: '持续监控过滤',
      already_limited: '已限速跳过',
      in_cooldown: '冷却中跳过',
      no_data: '无带宽数据',
    };
    return map[r] ?? r;
  };

  const reasonColor = (r: string): string => {
    if (r === 'top_n') return 'text-primary';
    if (r === 'in_cooldown' || r === 'continuous_filtered' || r === 'already_limited') return 'text-warning';
    if (r === 'error') return 'text-destructive';
    return 'text-muted-foreground';
  };

  const hasInstanceDetails = (log: BandwidthLog): boolean => {
    return !!(log.details?.instances && log.details.instances.length > 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3 pr-8 flex-wrap">
            <DialogTitle className="flex-shrink-0">带宽管理日志</DialogTitle>
            <Button size="sm" variant="outline" onClick={handleClear}
              className="border-border text-destructive hover:text-destructive/80 text-xs flex-shrink-0">
              <Trash2 className="w-3 h-3 mr-1" />清空
            </Button>
            <div className="flex items-center gap-1.5 ml-auto">
              <Filter className="w-3 h-3 text-muted-foreground" />
              <Select value={filterEventType} onValueChange={(v) => { setFilterEventType(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[110px] text-xs border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterResult} onValueChange={(v) => { setFilterResult(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[90px] text-xs border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">暂无日志</div>
          ) : (
            <div className="space-y-1.5">
              {logs.map(log => {
                const expanded = expandedIds.has(log.id);
                const hasDetails = hasInstanceDetails(log);
                const hasUp = log.metricValueUp !== undefined && log.metricValueUp > 0;
                const hasDown = log.metricValueDown !== undefined && log.metricValueDown > 0;
                return (
                  <div key={log.id} className="bg-card rounded-md p-2.5 text-xs border border-border/60">
                    {/* 第一行：时间 + 事件类型 + 结果 */}
                    <div
                      className={`flex items-center justify-between ${hasDetails ? 'cursor-pointer' : ''}`}
                      onClick={hasDetails ? () => toggleExpand(log.id) : undefined}
                    >
                      <div className="flex items-center gap-1.5">
                        {hasDetails && (
                          expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                 : <ChevronRightIcon className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className="text-muted-foreground font-mono">{formatTime(log.ts)}</span>
                        <span className={eventTypeColor(log.eventType)}>[{eventTypeLabel(log.eventType)}]</span>
                        <span className="text-primary">[{log.ruleName}]</span>
                      </div>
                      <span className={resultColor(log.result)}>{resultLabel(log.result)}</span>
                    </div>
                    {/* 第二行：节点 + 触发方向 + 带宽值/阈值 + 限速台数 */}
                    <div className="mt-1 ml-4 flex items-center gap-1.5 flex-wrap text-[10px]">
                      <span className="text-foreground/80">节点 <span className="text-foreground">{log.nodeName}</span></span>
                      {log.details?.triggerDirection && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-primary/40 text-primary">
                          {triggerDirectionLabel(log.details.triggerDirection)}
                        </Badge>
                      )}
                      {hasUp && (
                        <span className="text-info">
                          上行 {formatBps(log.metricValueUp!)}
                          {log.details?.thresholdUp !== undefined && (
                            <span className="text-muted-foreground">/阈值{formatBps(log.details.thresholdUp)}</span>
                          )}
                        </span>
                      )}
                      {hasDown && (
                        <span className="text-info">
                          下行 {formatBps(log.metricValueDown!)}
                          {log.details?.thresholdDown !== undefined && (
                            <span className="text-muted-foreground">/阈值{formatBps(log.details.thresholdDown)}</span>
                          )}
                        </span>
                      )}
                      {log.affectedCount !== undefined && log.affectedCount > 0 && (
                        <Badge className="bg-primary/20 text-primary text-[9px] border-none">限速{log.affectedCount}台</Badge>
                      )}
                    </div>
                    {log.error && (
                      <div className="mt-0.5 text-[10px] text-destructive/80 ml-4">{log.error}</div>
                    )}
                    {/* 展开后的实例详情 */}
                    {expanded && hasDetails && log.details?.instances && (
                      <div className="mt-2 ml-4 space-y-1.5 border-l border-border/40 pl-2">
                        {log.details.instances.map((inst, i) => (
                          <div key={i} className="text-[10px]">
                            {/* 实例行：名称 + 方向 + 状态 */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={inst.limited ? 'text-primary font-medium' : 'text-muted-foreground'}>
                                {inst.cloudName}(#{inst.cloudId})
                              </span>
                              {inst.limitDirection && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-border/60 text-muted-foreground">
                                  {directionLabel(inst.limitDirection)}
                                </Badge>
                              )}
                              <span className={reasonColor(inst.reason)}>
                                {inst.reason === 'error' ? `错误: ${inst.error ?? ''}` : reasonLabel(inst.reason)}
                              </span>
                            </div>
                            {/* 配置变化行：实时带宽 + 限速前后配置值 */}
                            <div className="mt-0.5 flex items-center gap-2 flex-wrap text-muted-foreground pl-2">
                              {inst.realtimeBwMbps > 0 && (
                                <span>实时: <span className="text-info">{formatBandwidth(inst.realtimeBwMbps)}</span></span>
                              )}
                              {inst.limited && inst.limitDirection === 'out' && inst.originalOutBw !== undefined && inst.newOutBw !== undefined && (
                                <span>出站配置: {inst.originalOutBw} → <span className="text-primary">{inst.newOutBw} Mbps</span></span>
                              )}
                              {inst.limited && inst.limitDirection === 'in' && inst.originalInBw !== undefined && inst.newInBw !== undefined && (
                                <span>入站配置: {inst.originalInBw} → <span className="text-primary">{inst.newInBw} Mbps</span></span>
                              )}
                              {inst.limited && inst.limitDirection === 'both' && inst.originalOutBw !== undefined && inst.newOutBw !== undefined && inst.originalInBw !== undefined && inst.newInBw !== undefined && (
                                <>
                                  <span>出: {inst.originalOutBw} → <span className="text-primary">{inst.newOutBw}</span></span>
                                  <span>入: {inst.originalInBw} → <span className="text-primary">{inst.newInBw}</span></span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {total > perPage && (
          <div className="flex items-center justify-between pt-3 border-t border-border mt-2 flex-shrink-0">
            <span className="text-xs text-muted-foreground">共{total}条</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="border-border text-foreground/80 h-7 w-7 p-0">
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <span className="text-xs text-muted-foreground">{page}/{totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="border-border text-foreground/80 h-7 w-7 p-0">
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
