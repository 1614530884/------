'use client';

import { useState, useEffect, useCallback } from 'react';
import type { CpuLimitAlertLog } from '@/lib/services/cpu-limit-manager';

const ALERT_POLL_INTERVAL = 60_000; // 60秒轮询

interface ListUnreadResp {
  success?: boolean;
  data?: {
    items: CpuLimitAlertLog[];
    unreadCount: number;
  };
}

/**
 * CPU 限制告警通知 Hook（仅管理员使用）
 * 通过轮询 /api/cpu-limit?action=listUnreadAlerts 获取未读告警
 * 返回未读列表 + 未读总数 + 手动刷新/标记已读方法
 */
export function useCpuLimitAlerts(enabled: boolean): {
  alerts: CpuLimitAlertLog[];
  unreadCount: number;
  refresh: () => void;
  markAllRead: () => Promise<void>;
} {
  const [alerts, setAlerts] = useState<CpuLimitAlertLog[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const fetchAlerts = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch('/api/cpu-limit?action=listUnreadAlerts&limit=20');
      if (!res.ok) return;
      const data = (await res.json()) as ListUnreadResp;
      if (data.success && data.data) {
        setAlerts(data.data.items);
        setUnreadCount(data.data.unreadCount);
      }
    } catch {
      /* ignore */
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setAlerts([]);
      setUnreadCount(0);
      return;
    }
    void fetchAlerts();
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void fetchAlerts();
    };
    const timer = setInterval(tick, ALERT_POLL_INTERVAL);
    const onVisible = () => {
      if (typeof document === 'undefined' || document.hidden) return;
      void fetchAlerts();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, fetchAlerts, refreshTick]);

  const markAllRead = useCallback(async () => {
    if (!enabled) return;
    try {
      await fetch('/api/cpu-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'markAllAlertsRead' }),
      });
      setAlerts([]);
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const refresh = useCallback(() => {
    setRefreshTick(t => t + 1);
  }, []);

  return { alerts, unreadCount, refresh, markAllRead };
}
