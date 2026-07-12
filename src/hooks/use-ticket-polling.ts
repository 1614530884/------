'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { loadAuth } from '@/lib/auth-client';
import {
  type TicketStatus,
  mapCategoryToStatusIds,
  getCachedStatusList,
} from '@/lib/ticket-status';

const POLL_INTERVAL = 60_000;
const REFRESH_EVENT = 'ticket-updated';

async function fetchPendingCount(): Promise<number> {
  const auth = loadAuth();
  if (!auth?.cookie) return 0;

  const cachedStatusList = getCachedStatusList() || [];
  const body: Record<string, unknown> = {
    action: 'ticketList',
    token: auth.token || '',
    cookie: auth.cookie || '',
    limit: 1,
    page: 1,
  };

  if (cachedStatusList.length > 0) {
    const ids = mapCategoryToStatusIds('pending', cachedStatusList as TicketStatus[]);
    if (ids.length > 0) {
      body.status = ids;
    } else {
      body.status = 'pending';
    }
  } else {
    body.status = 'pending';
  }

  try {
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录') {
      return 0;
    }
    const sum = Number(data?.data?.sum);
    return isNaN(sum) ? 0 : sum;
  } catch {
    return 0;
  }
}

export function useTicketPolling(): { count: number; loading: boolean; refresh: () => void } {
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    const n = await fetchPendingCount();
    if (!cancelledRef.current) {
      setCount(n);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      await refresh();
    };

    void tick();
    const timer = setInterval(tick, POLL_INTERVAL);

    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const onTicketUpdated = () => void refresh();
    if (typeof window !== 'undefined') {
      window.addEventListener(REFRESH_EVENT, onTicketUpdated);
    }

    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener(REFRESH_EVENT, onTicketUpdated);
      }
    };
  }, [refresh]);

  return { count, loading, refresh };
}
