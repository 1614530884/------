'use client';

import { useState, useEffect, useCallback } from 'react';
import type { TaskStatus, TaskType } from '@/lib/services/server-tools/types';

const TASK_POLL_INTERVAL = 60_000;
const STORAGE_KEY = 'notif_lastReadTaskAt';

export interface TaskNotification {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  finishedAt: string;
  connectionId: string;
}

interface ApiTaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  type: TaskType;
  finishedAt?: string;
  connectionId: string;
}

export function useTaskNotifications(): {
  tasks: TaskNotification[];
  unreadCount: number;
  markAllRead: () => void;
  refresh: () => void;
} {
  const [tasks, setTasks] = useState<TaskNotification[]>([]);
  const [lastReadAt, setLastReadAt] = useState<string>('');
  const [refreshTick, setRefreshTick] = useState(0);

  // 初始化 lastReadAt：localStorage 优先，否则用当前时间避免历史任务全推
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setLastReadAt(stored || new Date().toISOString());
    } catch {
      setLastReadAt(new Date().toISOString());
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!lastReadAt) return;
    try {
      // onlyOwn=1 强制仅查询当前用户自己创建的任务通知（管理员也只看自己的）
      const url = `/api/server-tools/tasks?status=success,failed,cancelled,interrupted&finishedAfter=${encodeURIComponent(lastReadAt)}&limit=5&onlyOwn=1`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        const list: TaskNotification[] = (data.data as ApiTaskItem[])
          .filter((t) => t && t.finishedAt)
          .map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            type: t.type,
            finishedAt: t.finishedAt as string,
            connectionId: t.connectionId,
          }));
        setTasks(list);
      }
    } catch {
      /* ignore */
    }
  }, [lastReadAt]);

  useEffect(() => {
    if (!lastReadAt) return;
    void refresh();
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      await refresh();
    };
    const timer = setInterval(tick, TASK_POLL_INTERVAL);
    const onVisible = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, lastReadAt, refreshTick]);

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setLastReadAt(now);
    try {
      localStorage.setItem(STORAGE_KEY, now);
    } catch {
      /* ignore */
    }
    setTasks([]);
  }, []);

  // 暴露手动刷新方法（供下拉打开时调用）
  const manualRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  return { tasks, unreadCount: tasks.length, markAllRead, refresh: manualRefresh };
}
