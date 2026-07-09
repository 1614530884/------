'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { MonitorLog } from '@/lib/services/node-monitor-types';

interface LogViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function LogViewerDialog({ open, onOpenChange }: LogViewerDialogProps) {
  const [logs, setLogs] = useState<MonitorLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const perPage = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/node-monitor?action=listLogs&page=${page}&perPage=${perPage}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.items);
        setTotal(data.data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page]);

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
  const resultColor = (r: string) => r === 'success' ? 'text-emerald-400' : r === 'failed' ? 'text-red-400' : 'text-yellow-400';
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
      <DialogContent className="bg-[#1a1d27] border-gray-800 text-white max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center gap-3 pr-8">
            <DialogTitle className="flex-shrink-0">操作日志</DialogTitle>
            <Button size="sm" variant="outline" onClick={handleClear}
              className="border-gray-700 text-red-400 hover:text-red-300 text-xs flex-shrink-0">
              <Trash2 className="w-3 h-3 mr-1" />清空
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">暂无日志</div>
          ) : (
            <div className="space-y-1.5">
              {logs.map(log => {
                const sideLabel = getSideLabel(log);
                const isHigh = log.triggerSide === 'high';
                const isSafeZone = log.operator === 'range' && !log.triggerSide && log.actionError?.includes('安全区间');
                return (
                  <div key={log.id} className="bg-[#0f1117] rounded-md p-2.5 text-xs border border-gray-800/60">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-400 font-mono">{formatTime(log.timestamp)}</span>
                      <span className={resultColor(log.actionResult)}>{resultLabel(log.actionResult)}</span>
                    </div>
                    <div className="mt-1 text-gray-300">
                      <span className="text-purple-400">[{log.ruleName}]</span>
                      {sideLabel && (
                        <span className={`ml-1 ${isHigh ? 'text-orange-400' : 'text-cyan-400'}`}>{sideLabel}</span>
                      )}
                      {' '}节点 <span className="text-white">{log.nodeName}</span>
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
                    <div className="mt-0.5 text-[10px] text-gray-500">
                      触发: {log.consecutiveHits ?? '-'}/{log.triggerCount || 1}次
                    </div>
                    {log.actionError && !isSafeZone && (
                      <div className="mt-0.5 text-[10px] text-red-400/80">{log.actionError}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {total > perPage && (
          <div className="flex items-center justify-between pt-3 border-t border-gray-800 mt-2 flex-shrink-0">
            <span className="text-xs text-gray-500">共{total}条</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="border-gray-700 text-gray-300 h-7 w-7 p-0">
                <ChevronLeft className="w-3 h-3" />
              </Button>
              <span className="text-xs text-gray-400">{page}/{totalPages}</span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="border-gray-700 text-gray-300 h-7 w-7 p-0">
                <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
