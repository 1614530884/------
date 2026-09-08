'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import type { CpuLimitLog } from '@/lib/services/cpu-limit-manager';

interface CpuLimitLogViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  rule_create: '创建规则',
  rule_update: '更新规则',
  rule_delete: '删除规则',
  limit_trigger: '触发限制',
  limit_execute: '执行结果',
  limit_release: '解除限制',
  limit_skip: '跳过',
};

const RESULT_COLOR: Record<string, string> = {
  success: 'bg-success hover:bg-success/90 text-success-foreground',
  failed: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground',
  skipped: 'bg-muted hover:bg-muted/80 text-muted-foreground',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDetails(details?: string): string {
  if (!details) return '-';
  try {
    const parsed = JSON.parse(details);
    if (parsed.instances && Array.isArray(parsed.instances)) {
      const lines = parsed.instances.map((inst: Record<string, unknown>) => {
        const limited = inst.limited ? '✓' : '✗';
        const cpuUsage = typeof inst.cpuUsage === 'number' ? `${inst.cpuUsage.toFixed(1)}%` : '?';
        const err = inst.error ? ` [${inst.error}]` : '';
        // 惩罚信息：触发惩罚时展示时长和限制值变化
        const penalty = inst.penalized
          ? ` 惩罚:${inst.actualDurationMin}分`
          : '';
        return `  ${limited} ${inst.cloudName}(#${inst.cloudId}) CPU:${cpuUsage} → ${inst.cpuLimitAfter}%${err}${penalty}`;
      });
      return lines.join('\n');
    }
    if (parsed.cloudId !== undefined) {
      return `${parsed.cloudName}(#${parsed.cloudId}) → CPU ${parsed.cpuLimitPercent}%`;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return details;
  }
}

export function CpuLimitLogViewerDialog({ open, onOpenChange }: CpuLimitLogViewerDialogProps) {
  const [logs, setLogs] = useState<CpuLimitLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(50);
  const [loading, setLoading] = useState(false);
  const [resultFilter, setResultFilter] = useState<string>('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'listLogs',
        page: String(page),
        perPage: String(perPage),
      });
      if (resultFilter) params.set('result', resultFilter);
      const res = await fetch(`/api/cpu-limit?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.logs);
        setTotal(data.data.total);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page, perPage, resultFilter]);

  useEffect(() => {
    if (open) fetchLogs();
  }, [open, fetchLogs]);

  const totalPages = Math.ceil(total / perPage) || 1;

  const handleClearLogs = async () => {
    if (!confirm(`确认清空全部 CPU 限制日志（共 ${total} 条）？此操作不可恢复。`)) return;
    const res = await fetch('/api/cpu-limit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clearLogs' }),
    });
    const data = await res.json();
    if (data.success) {
      setPage(1);
      fetchLogs();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center justify-between">
            <span>CPU 限制操作日志</span>
            <Button size="sm" variant="outline" onClick={handleClearLogs}
              className="border-border text-destructive hover:bg-destructive/10 h-7 text-xs">
              <Trash2 className="w-3 h-3 mr-1" />清空
            </Button>
          </DialogTitle>
        </DialogHeader>

        {/* 筛选 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-muted-foreground">结果：</span>
          {['', 'success', 'failed', 'skipped'].map(r => (
            <button
              key={r || 'all'}
              onClick={() => { setResultFilter(r); setPage(1); }}
              className={`px-2 py-1 rounded text-[11px] border ${
                resultFilter === r
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground'
              }`}
            >
              {r === '' ? '全部' : r === 'success' ? '成功' : r === 'failed' ? '失败' : '跳过'}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">共 {total} 条</span>
        </div>

        {/* 日志列表 */}
        <div className="flex-1 overflow-y-auto border border-border rounded-md bg-background">
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />加载中...
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">暂无日志</div>
          ) : (
            <div className="divide-y divide-border">
              {logs.map(log => (
                <div key={log.id} className="p-2.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-muted-foreground whitespace-nowrap">{formatTime(log.ts)}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {EVENT_TYPE_LABEL[log.eventType] || log.eventType}
                    </Badge>
                    <Badge className={`text-[10px] ${RESULT_COLOR[log.result] || ''}`}>
                      {log.result === 'success' ? '成功' : log.result === 'failed' ? '失败' : '跳过'}
                    </Badge>
                    <span className="text-foreground truncate">{log.ruleName}</span>
                    <span className="text-muted-foreground whitespace-nowrap">节点: {log.nodeName}</span>
                  </div>
                  {(log.metricValue !== undefined || log.threshold !== undefined) && (
                    <div className="mt-1 text-muted-foreground">
                      指标值: <span className="text-foreground">{log.metricValue?.toFixed(1) ?? '-'}</span>
                      {' / '}阈值: <span className="text-foreground">{log.threshold?.toFixed(1) ?? '-'}</span>
                      {log.topN !== undefined && <> · Top {log.topN}</>}
                      {log.affectedCount !== undefined && <> · 限制 {log.affectedCount} 台</>}
                    </div>
                  )}
                  {log.error && (
                    <div className="mt-1 text-destructive">错误: {log.error}</div>
                  )}
                  {log.details && (
                    <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap break-all bg-muted/30 p-1.5 rounded">
                      {formatDetails(log.details)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        <div className="flex items-center justify-between flex-shrink-0 pt-2">
          <span className="text-xs text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="border-border text-foreground h-7 w-7 p-0">
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="border-border text-foreground h-7 w-7 p-0">
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
