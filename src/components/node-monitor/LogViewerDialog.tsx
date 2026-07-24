'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Trash2, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import type { MonitorLog } from '@/lib/services/node-monitor-types';

interface LogViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const RESULT_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: '全部结果' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'skipped', label: '跳过' },
];

export function LogViewerDialog({ open, onOpenChange }: LogViewerDialogProps) {
  const [logs, setLogs] = useState<MonitorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterResult, setFilterResult] = useState<string>('all');
  const perPage = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (filterResult !== 'all') params.set('result', filterResult);
      const res = await fetch(`/api/node-monitor?action=listLogs&${params}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.items);
        setTotal(data.data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, filterResult]);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  const handleClear = async () => {
    await fetch('/api/node-monitor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clearLogs' }),
    });
    setLogs([]);
    setTotal(0);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const metricLabel = (m: string) => m === 'cpu' ? 'CPU' : m === 'memory' ? '内存' : '磁盘';
  const operatorLabel = (o: string) => o === 'above' ? '高于' : o === 'below' ? '低于' : '区间';
  const actionLabel = (a: string) => a === 'enable' ? '启用' : '禁用';
  const resultColor = (r: string) => r === 'success' ? 'text-success' : r === 'failed' ? 'text-destructive' : 'text-warning';
  const resultLabel = (r: string) => r === 'success' ? '成功' : r === 'failed' ? '失败' : '跳过';

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  // 区间模式日志描述
  const getSideLabel = (log: MonitorLog) => {
    if (log.operator !== 'range' || !log.triggerSide) return '';
    return log.triggerSide === 'high' ? '[高位]' : '[低位]';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3 pr-8 flex-wrap">
            <DialogTitle className="flex-shrink-0">操作日志</DialogTitle>
            <Button size="sm" variant="outline" onClick={handleClear}
              className="border-border text-destructive hover:text-destructive/80 text-xs flex-shrink-0">
              <Trash2 className="w-3 h-3 mr-1" />清空
            </Button>
            <div className="flex items-center gap-1.5 ml-auto">
              <Filter className="w-3 h-3 text-muted-foreground" />
              <Select value={filterResult} onValueChange={(v) => { setFilterResult(v); setPage(1); }}>
                <SelectTrigger className="h-7 w-[100px] text-xs border-border">
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
                const sideLabel = getSideLabel(log);
                const isHigh = log.triggerSide === 'high';
                const isSafeZone = log.operator === 'range' && !log.triggerSide && log.actionError?.includes('安全区间');
                return (
                  <div key={log.id} className="bg-card rounded-md p-2.5 text-xs border border-border/60">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground font-mono">{formatTime(log.timestamp)}</span>
                      <span className={resultColor(log.actionResult)}>{resultLabel(log.actionResult)}</span>
                    </div>
                    <div className="mt-1 text-foreground/80">
                      <span className="text-primary">[{log.ruleName}]</span>
                      {sideLabel && (
                        <span className={`ml-1 ${isHigh ? 'text-primary' : 'text-info'}`}>{sideLabel}</span>
                      )}
                      {' '}节点 <span className="text-foreground">{log.nodeName}</span>
                      {' '}{metricLabel(log.metric)}
                      {isSafeZone ? (
                        <>{' '}安全区间({log.thresholdLow ?? 0}%~{log.threshold}%)</>
                      ) : log.operator === 'range' ? (
                        sideLabel ? (
                          <>{' '}{isHigh ? `高于${log.threshold}%` : `低于${log.thresholdLow ?? 0}%`}</>
                        ) : (
                          <>{' '}区间 {`高于${log.threshold}%`} / {`低于${log.thresholdLow ?? 0}%`}</>
                        )
                      ) : (
                        <>{' '}{operatorLabel(log.operator)}{log.threshold}%</>
                      )}
                      {' '}当前{log.metricValue.toFixed(1)}%
                      {!isSafeZone && <>{' → '}{actionLabel(log.action)}</>}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      触发: {log.consecutiveHits ?? '-'}/{log.triggerCount || 1}次
                    </div>
                    {log.actionError && !isSafeZone && (
                      <div className="mt-0.5 text-[10px] text-destructive/80">{log.actionError}</div>
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
