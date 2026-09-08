'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle, Gauge, Server as ServerIcon } from 'lucide-react';
import type { BandwidthAlertLog } from '@/lib/services/bandwidth-manager';

interface BandwidthAlertHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function BandwidthAlertHistoryDialog({ open, onOpenChange }: BandwidthAlertHistoryDialogProps) {
  const [items, setItems] = useState<BandwidthAlertLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const perPage = 20;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/bandwidth?action=listAlerts&page=${page}&perPage=${perPage}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setItems(data.data.items || []);
          setTotal(Number(data.data.total) || 0);
        }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    if (open) void fetchLogs();
  }, [open, fetchLogs]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border text-foreground max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            带宽告警历史
            {total > 0 && <span className="text-xs font-normal text-muted-foreground">共 {total} 条</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">暂无告警记录</div>
          ) : (
            <div className="space-y-1.5">
              {items.map(alert => {
                const isNode = alert.level === 'node';
                const Icon = isNode ? ServerIcon : Gauge;
                const iconClass = isNode
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
                const target = isNode
                  ? `节点 ${alert.nodeName}`
                  : `${alert.cloudName ?? '未知实例'}(#${alert.cloudId ?? '-'})`;
                return (
                  <div key={alert.id} className="bg-card rounded-md p-2.5 text-xs border border-border/60">
                    <div className="flex items-start gap-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${iconClass}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className={`text-[9px] px-1 py-0 h-3.5 ${isNode ? 'border-destructive/40 text-destructive' : 'border-amber-500/40 text-amber-600 dark:text-amber-400'}`}>
                            {isNode ? '节点级' : '实例级'}
                          </Badge>
                          <span className="text-foreground font-medium truncate">{target}</span>
                          {!alert.read && (
                            <Badge className="bg-destructive text-destructive-foreground text-[9px] px-1 py-0 h-3.5 border-none">未读</Badge>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] text-muted-foreground flex items-center gap-1.5 flex-wrap">
                          <span>
                            {alert.windowMin}分钟内限速 <span className="text-destructive font-medium">{alert.triggerCount}</span>/{alert.threshold}次
                          </span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground truncate">
                          规则: {alert.ruleName} · 节点: {alert.nodeName}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">{formatTime(alert.ts)}</span>
                    </div>
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
