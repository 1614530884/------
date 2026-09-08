'use client';

import { useState, useCallback } from 'react';
import { AlertTriangle, Gauge, CheckCheck, Server as ServerIcon, History } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBandwidthAlerts } from '@/hooks/use-bandwidth-alerts';
import { BandwidthAlertHistoryDialog } from '@/components/bandwidth/BandwidthAlertHistoryDialog';
import type { BandwidthAlertLog } from '@/lib/services/bandwidth-manager';

interface BandwidthAlertNotificationProps {
  /** 仅管理员启用（在 navbar 中控制） */
  enabled: boolean;
}

function formatRelativeTime(ts: number): string {
  const diffSec = Math.round((Date.now() - ts) / 1000);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), 'minute');
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour');
  return rtf.format(-Math.floor(diffSec / 86400), 'day');
}

function AlertItem({ alert }: { alert: BandwidthAlertLog }) {
  const isNode = alert.level === 'node';
  const Icon = isNode ? ServerIcon : Gauge;
  const iconClass = isNode
    ? 'bg-destructive/10 text-destructive'
    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
  const levelLabel = isNode ? '节点级告警' : '实例级告警';
  const target = isNode
    ? `节点 ${alert.nodeName}`
    : `${alert.cloudName ?? '未知实例'}(#${alert.cloudId ?? '-'})`;

  return (
    <div className="w-full px-3 py-2.5 flex items-start gap-2.5 border-b border-border/50 last:border-b-0">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconClass}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-foreground truncate" title={target}>{target}</div>
        <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${iconClass}`}>
            {levelLabel}
          </span>
          <span>
            {alert.windowMin}分钟内已限速 <span className="text-destructive font-medium">{alert.triggerCount}</span>/{alert.threshold}次
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
          规则: {alert.ruleName} · 节点: {alert.nodeName} · {formatRelativeTime(alert.ts)}
        </div>
      </div>
      <span className="w-2 h-2 rounded-full bg-destructive shrink-0 mt-1.5" aria-hidden="true" />
    </div>
  );
}

export function BandwidthAlertNotification({ enabled }: BandwidthAlertNotificationProps) {
  const { alerts, unreadCount, markAllRead } = useBandwidthAlerts(enabled);
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleOpenChange = useCallback((o: boolean) => {
    setOpen(o);
    if (!o && unreadCount > 0) {
      void markAllRead();
    }
  }, [unreadCount, markAllRead]);

  const handleMarkAllRead = useCallback(() => {
    void markAllRead();
  }, [markAllRead]);

  // 非管理员或未启用告警时不渲染
  if (!enabled) return null;

  return (
    <>
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label={unreadCount > 0 ? `${unreadCount} 条带宽告警` : '带宽告警'}
          title={unreadCount > 0 ? `${unreadCount} 条带宽告警` : '带宽告警'}
        >
          <AlertTriangle className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[calc(100vw-1.5rem)] max-w-sm p-0"
      >
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">带宽告警</span>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 transition-colors"
            >
              <CheckCheck className="w-3 h-3" />
              全部已读
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无告警</div>
          ) : (
            alerts.map(alert => <AlertItem key={alert.id} alert={alert} />)
          )}
        </div>
        {/* 底部：查看历史 */}
        <div className="border-t border-border px-3 py-1.5">
          <button
            type="button"
            onClick={() => { setOpen(false); setHistoryOpen(true); }}
            className="w-full text-xs text-muted-foreground hover:text-foreground inline-flex items-center justify-center gap-1 transition-colors py-1"
          >
            <History className="w-3 h-3" />
            查看历史告警
          </button>
        </div>
      </PopoverContent>
    </Popover>

    <BandwidthAlertHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
    </>
  );
}
