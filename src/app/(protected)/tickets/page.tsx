'use client';

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Ticket as TicketIcon, Loader2, RefreshCw, Search, X,
  ChevronLeft, ChevronRight, AlertCircle, Inbox,
} from 'lucide-react';
import { loadAuth, handleAuthExpired } from '@/lib/auth-client';
import { PageHeader } from '@/components/layout/page-header';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type StatusCategory, type TicketStatus,
  CATEGORY_LABELS, CATEGORY_VALUES,
  mapCategoryToStatusIds,
  getCachedStatusList, setCachedStatusList,
} from '@/lib/ticket-status';

interface TicketListItem {
  id: number;
  tid: string;
  uid: number;
  title: string;
  status: string;
  last_reply_time: string;
  flag_admin: string;
  department_name: string;
  user_name: string;
  format_time: string;
  create_time?: string;
  priority?: string;
}

function parseDate(val: string | number | undefined): Date | null {
  if (!val || val === '0' || val === '-') return null;
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(String(val).replace(/-/g, '/'));
  return isNaN(d.getTime()) ? null : d;
}

function formatTime(val: string | number | undefined): string {
  const d = parseDate(val);
  return d ? d.toLocaleString('zh-CN') : (val ? String(val) : '-');
}

function TicketsListContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategory = (searchParams.get('status') as StatusCategory) || 'pending';

  const [tickets, setTickets] = useState<TicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<StatusCategory>(
    CATEGORY_VALUES.includes(initialCategory) ? initialCategory : 'pending'
  );
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [total, setTotal] = useState(0);
  const [maxPage, setMaxPage] = useState(1);
  const [statusList, setStatusList] = useState<TicketStatus[]>([]);
  const [statusListLoading, setStatusListLoading] = useState(false);

  const callIdcApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const auth = loadAuth();
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: auth?.token || '', cookie: auth?.cookie || '', ...params }),
    });
    const data = await response.json();
    if (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录') {
      await handleAuthExpired();
      return { success: false, message: '登录已过期' };
    }
    return data;
  }, []);

  const fetchStatusList = useCallback(async (force = false): Promise<TicketStatus[]> => {
    if (!force) {
      const cached = getCachedStatusList();
      if (cached && cached.length > 0) {
        setStatusList(cached);
        return cached;
      }
    }
    setStatusListLoading(true);
    try {
      const res = await callIdcApi('ticketStatusList');
      const list = Array.isArray(res.data) ? res.data as TicketStatus[] : [];
      if (list.length > 0) {
        setCachedStatusList(list);
        setStatusList(list);
      }
      return list;
    } catch {
      return [];
    } finally {
      setStatusListLoading(false);
    }
  }, [callIdcApi]);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, unknown> = {
        page: currentPage,
        limit: perPage,
      };
      if (activeTab !== 'all') {
        const ids = mapCategoryToStatusIds(activeTab, statusList);
        if (ids.length > 0) {
          params.status = ids;
        } else {
          params.status = activeTab;
        }
      }
      if (searchKeyword.trim()) {
        params.content = searchKeyword.trim();
      }
      const res = await callIdcApi('ticketList', params);
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '获取工单列表失败'));
        setTickets([]);
        setTotal(0);
        setMaxPage(1);
      } else {
        const data = res.data as Record<string, unknown> | undefined;
        const list = Array.isArray(data?.list) ? data!.list as TicketListItem[] : [];
        setTickets(list);
        setTotal(Number(data?.sum) || list.length);
        setMaxPage(Number(data?.max_page) || Math.ceil((Number(data?.sum) || list.length) / perPage) || 1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '网络请求失败';
      setError(msg);
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [callIdcApi, currentPage, perPage, activeTab, searchKeyword, statusList]);

  useEffect(() => {
    void fetchStatusList();
  }, [fetchStatusList]);

  useEffect(() => {
    if (statusList.length === 0 && !statusListLoading) return;
    void fetchTickets();
  }, [fetchTickets, statusList.length, statusListLoading]);

  const handleTabChange = (tab: StatusCategory) => {
    setActiveTab(tab);
    setCurrentPage(1);
    const params = new URLSearchParams(searchParams);
    if (tab === 'all') {
      params.delete('status');
    } else {
      params.set('status', tab);
    }
    router.replace(`/tickets${params.toString() ? `?${params.toString()}` : ''}`);
  };

  const handleSearch = () => {
    setSearchKeyword(searchInput);
    setCurrentPage(1);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchKeyword('');
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    void fetchStatusList(true);
    void fetchTickets();
  };

  const handlePerPageChange = (val: string) => {
    setPerPage(Number(val));
    setCurrentPage(1);
  };

  const tabCounts = useMemo(() => {
    const counts: Record<StatusCategory, number> = { pending: 0, replied: 0, waiting: 0, closed: 0, all: 0 };
    counts.all = total;
    return counts;
  }, [total]);

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <PageHeader
        title="工单管理"
        titleIcon={TicketIcon}
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: '搜索工单标题/内容...',
        }}
        actions={
          <>
            <button
              onClick={handleSearch}
              className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              搜索
            </button>
            {(searchKeyword || searchInput) && (
              <button
                onClick={handleClearSearch}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                清除
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </>
        }
        meta={<span className="text-xs">共 {total} 条</span>}
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 space-y-3">
        {/* 分类筛选栏 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1 bg-muted rounded-lg p-1 overflow-x-auto max-w-full">
            {CATEGORY_VALUES.map((cat) => (
              <button
                key={cat}
                onClick={() => handleTabChange(cat)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === cat
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {CATEGORY_LABELS[cat]}
                {cat === activeTab && tabCounts[cat] > 0 && (
                  <span className="text-xs text-muted-foreground">({tabCounts[cat]})</span>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">每页</label>
            <select
              value={String(perPage)}
              onChange={(e) => handlePerPageChange(e.target.value)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
            <span className="text-xs text-muted-foreground">条</span>
          </div>
        </div>

        {/* 移动端搜索按钮 */}
        <div className="sm:hidden">
          <button
            onClick={handleSearch}
            className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium"
          >
            <Search className="w-4 h-4" />
            搜索
          </button>
        </div>

        {/* 内容区 */}
        {error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
            >
              <RefreshCw className="w-4 h-4" />
              重试
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <Skeleton className="w-12 h-4" />
                <Skeleton className="flex-1 h-4" />
                <Skeleton className="w-20 h-4" />
                <Skeleton className="w-24 h-4" />
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Inbox className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchKeyword ? `没有找到与"${searchKeyword}"相关的工单` : '暂无工单'}
            </p>
          </div>
        ) : (
          <>
            {/* 桌面端表格 */}
            <div className="hidden md:block rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">工单号</th>
                    <th className="px-3 py-2.5 font-medium">标题</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">提交人</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">部门</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">状态</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">提交时间</th>
                    <th className="px-3 py-2.5 font-medium whitespace-nowrap">上次回复</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {tickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-accent/50 transition-colors group">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="text-primary hover:underline font-medium"
                        >
                          #{ticket.tid || ticket.id}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 min-w-0">
                        <Link
                          href={`/tickets/${ticket.id}`}
                          className="block max-w-xs truncate text-foreground hover:text-primary transition-colors"
                          title={ticket.title}
                        >
                          {ticket.title || '-'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {ticket.user_name || '-'}
                        {ticket.flag_admin && (
                          <span className="ml-1 text-xs text-orange-500" title={`标记: ${ticket.flag_admin}`}>●</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                        {ticket.department_name || '-'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <TicketStatusBadge status={ticket.status} statusList={statusList} />
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                        {formatTime(ticket.create_time)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">
                        {ticket.format_time || formatTime(ticket.last_reply_time)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 移动端卡片 */}
            <div className="md:hidden space-y-2">
              {tickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}`}
                  className="block rounded-lg border border-border bg-card p-3 active:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-primary font-medium text-sm">#{ticket.tid || ticket.id}</span>
                    <TicketStatusBadge status={ticket.status} statusList={statusList} />
                  </div>
                  <p className="text-sm text-foreground mb-2 line-clamp-2">{ticket.title || '-'}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground gap-2">
                    <span className="truncate">{ticket.user_name || '-'} · {ticket.department_name || '-'}</span>
                    <span className="whitespace-nowrap">{ticket.format_time || formatTime(ticket.last_reply_time)}</span>
                  </div>
                </Link>
              ))}
            </div>

            {/* 分页 */}
            <div className="flex items-center justify-between gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                第 {currentPage} / {maxPage} 页，共 {total} 条
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1 || loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  上一页
                </button>
                <span className="text-sm text-muted-foreground px-2">{currentPage}</span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(maxPage, p + 1))}
                  disabled={currentPage >= maxPage || loading}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  下一页
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function TicketsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <TicketsListContent />
    </Suspense>
  );
}
