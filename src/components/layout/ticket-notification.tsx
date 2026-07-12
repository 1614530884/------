'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Ticket as TicketIcon, Server as ServerIcon, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTicketPolling } from '@/hooks/use-ticket-polling';
import { useTaskNotifications, type TaskNotification } from '@/hooks/use-task-notifications';

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diffSec = Math.round((now - then) / 1000);
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  if (diffSec < 3600) return rtf.format(-Math.floor(diffSec / 60), 'minute');
  if (diffSec < 86400) return rtf.format(-Math.floor(diffSec / 3600), 'hour');
  return rtf.format(-Math.floor(diffSec / 86400), 'day');
}

function taskStatusLabel(status: TaskNotification['status']): string {
  switch (status) {
    case 'success': return '完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    case 'interrupted': return '已中断';
    default: return status;
  }
}

function taskStatusClass(status: TaskNotification['status']): string {
  return status === 'success'
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
    : 'bg-destructive/10 text-destructive';
}

export function TicketNotification() {
  const router = useRouter();
  const { count: ticketCount } = useTicketPolling();
  const { tasks, unreadCount: taskUnread, markAllRead } = useTaskNotifications();
  const [open, setOpen] = useState(false);

  const totalUnread = (ticketCount > 0 ? 1 : 0) + taskUnread;
  const latestTask = tasks[0];

  const handleOpenChange = useCallback((o: boolean) => {
    setOpen(o);
    if (!o && taskUnread > 0) {
      markAllRead();
    }
  }, [taskUnread, markAllRead]);

  const handleTicketClick = useCallback(() => {
    router.push('/tickets?status=pending');
    setOpen(false);
  }, [router]);

  const handleTaskClick = useCallback(() => {
    router.push('/server-tools');
    setOpen(false);
    markAllRead();
  }, [router, markAllRead]);

  const handleMarkAllRead = useCallback(() => {
    markAllRead();
  }, [markAllRead]);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          aria-label={totalUnread > 0 ? `${totalUnread} 条未读通知` : '通知'}
          title={totalUnread > 0 ? `${totalUnread} 条未读通知` : '通知'}
        >
          <Bell className="w-5 h-5" />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-card">
              {totalUnread > 99 ? '99+' : totalUnread}
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
          <span className="text-sm font-medium text-foreground">通知</span>
          {(ticketCount > 0 || taskUnread > 0) && (
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
          {ticketCount === 0 && !latestTask && (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无通知</div>
          )}

          {ticketCount > 0 && (
            <button
              type="button"
              onClick={handleTicketClick}
              className="w-full px-3 py-2.5 flex items-start gap-2.5 hover:bg-accent transition-colors text-left border-b border-border/50"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <TicketIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">
                  {ticketCount} 条待处理工单
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">点击查看工单列表</div>
              </div>
              <span className="w-2 h-2 rounded-full bg-destructive shrink-0 mt-1.5" aria-hidden="true" />
            </button>
          )}

          {latestTask && (
            <button
              type="button"
              onClick={handleTaskClick}
              className="w-full px-3 py-2.5 flex items-start gap-2.5 hover:bg-accent transition-colors text-left"
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${taskStatusClass(latestTask.status)}`}>
                <ServerIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-foreground truncate">{latestTask.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${taskStatusClass(latestTask.status)}`}>
                    {taskStatusLabel(latestTask.status)}
                  </span>
                  <span>{formatRelativeTime(latestTask.finishedAt)}</span>
                </div>
              </div>
              <span className="w-2 h-2 rounded-full bg-destructive shrink-0 mt-1.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
