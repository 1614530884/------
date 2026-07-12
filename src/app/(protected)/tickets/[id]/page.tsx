'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, AlertCircle, Ticket as TicketIcon,
  RefreshCw, XCircle, ArrowRightCircle,
  Server, User, Building2, Flag, MessageSquare, Inbox, Search,
  Copy, Check,
} from 'lucide-react';
import { loadAuth, handleAuthExpired, getLoginUser } from '@/lib/auth-client';
import { PageHeader } from '@/components/layout/page-header';
import { TicketStatusBadge } from '@/components/tickets/ticket-status-badge';
import { TicketConversation, type TicketMessage } from '@/components/tickets/ticket-conversation';
import { TicketReplyBox } from '@/components/tickets/ticket-reply-box';
import { TicketTransferDialog } from '@/components/tickets/ticket-transfer-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  type TicketStatus, type TicketDepartment,
  findClosedStatusId,
  getCachedStatusList, setCachedStatusList,
  getCachedDeptList, setCachedDeptList,
} from '@/lib/ticket-status';

interface TicketHostInfo {
  id: number;
  domain?: string;
  productname?: string;
  domainstatus?: string | { name?: string; color?: string };
  status_color?: string;
  nextduedate?: number | string;
  billingcycle?: string;
  amount?: string;
  firstpaymentamount?: string;
  username?: string;
  type?: string;
}

interface TicketInfo {
  dptid: number;
  dpt_name: string;
  title: string;
  status: string;
  cc: string;
  uid: number;
  flag: number;
  priority: string;
  hostid?: number;
  host?: TicketHostInfo[];
}

interface TicketUser {
  id?: number;
  user_email?: string;
  user_login?: string;
  user_nickname?: string;
  mobile?: string;
  qq?: string;
}

interface CustomField {
  id: number;
  fieldname: string;
  fieldtype: string;
  description: string;
  fieldoptions: string;
  required: number;
  value: string;
}

interface RelatedHost {
  id: number;
  name?: string;
  status?: string | { name?: string; color?: string };
  domainstatus?: string | { name?: string; color?: string };
  productname?: string;
  domain?: string;
  nextduedate?: number | string;
  billingcycle?: string;
  amount?: string;
  status_color?: string;
}

function parseDate(val: unknown): Date | null {
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

const PRIORITY_LABEL_MAP: Record<string, string> = {
  low: '低',
  medium: '中',
  high: '高',
  urgent: '紧急',
  '紧急': '紧急',
  '高': '高',
  '中': '中',
  '低': '低',
};

function priorityLabel(priority: string): string {
  const key = String(priority || '').trim().toLowerCase();
  return PRIORITY_LABEL_MAP[key] || PRIORITY_LABEL_MAP[String(priority || '').trim()] || String(priority || '');
}

function formatTime(val: unknown): string {
  const d = parseDate(val);
  return d ? d.toLocaleString('zh-CN') : (val ? String(val) : '-');
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center w-5 h-5 rounded text-muted-foreground hover:text-primary hover:bg-accent transition-colors shrink-0"
      aria-label="复制"
      title={copied ? '已复制' : '复制'}
    >
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function getHostStatusName(host: RelatedHost): string {
  const ds = host.domainstatus;
  if (ds) {
    if (typeof ds === 'object') {
      if (ds.name) return String(ds.name);
    } else {
      return String(ds);
    }
  }
  const st = host.status;
  if (st) {
    if (typeof st === 'object') {
      if (st.name) return String(st.name);
    } else {
      return String(st);
    }
  }
  return '';
}

function mapStatusToClass(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('active') || name.includes('已激活') || name.includes('正常') || name.includes('运行')) {
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  }
  if (lower.includes('suspend') || name.includes('暂停')) {
    return 'bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (lower.includes('terminat') || lower.includes('delet') || name.includes('删除') || name.includes('终止')) {
    return 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400';
  }
  if (lower.includes('pend') || name.includes('待开通') || name.includes('开通中')) {
    return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  }
  if (lower.includes('fail') || name.includes('失败')) {
    return 'bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (lower.includes('frac') || name.includes('破裂') || name.includes('欠费')) {
    return 'bg-red-500/15 text-red-600 dark:text-red-400';
  }
  if (lower.includes('cancel') || name.includes('取消')) {
    return 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400';
  }
  return 'bg-muted text-muted-foreground';
}

export default function TicketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ticketId = Number(params?.id);

  const [ticket, setTicket] = useState<TicketInfo | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusList, setStatusList] = useState<TicketStatus[]>([]);
  const [deptList, setDeptList] = useState<TicketDepartment[]>([]);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [relatedHosts, setRelatedHosts] = useState<RelatedHost[]>([]);
  const [hostDetails, setHostDetails] = useState<Record<number, { ip: string; hostname: string }>>({});
  const [hostDetailsLoading, setHostDetailsLoading] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string>('');
  const [ticketUser, setTicketUser] = useState<TicketUser | null>(null);
  const [adminUsernames, setAdminUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const isAdminUser = adminUsernames.trim()
    ? adminUsernames.split(',').map((s) => s.trim()).filter(Boolean).includes(adminUsername)
    : false;

  useEffect(() => {
    fetch('/api/config')
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, unknown>) => {
        if (data.adminUsernames) setAdminUsernames(data.adminUsernames as string);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loginUser = getLoginUser();
    if (loginUser) setAdminUsername(loginUser);
  }, []);

  const callIdcApi = useCallback(async (action: string, paramsObj: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const auth = loadAuth();
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: auth?.token || '', cookie: auth?.cookie || '', ...paramsObj }),
    });
    const data = await response.json();
    if (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录') {
      await handleAuthExpired();
      return { success: false, message: '登录已过期' };
    }
    return data;
  }, []);

  const fetchStatusAndDepts = useCallback(async () => {
    const cachedStatus = getCachedStatusList();
    if (cachedStatus && cachedStatus.length > 0) {
      setStatusList(cachedStatus);
    } else {
      try {
        const res = await callIdcApi('ticketStatusList');
        const list = Array.isArray(res.data) ? res.data as TicketStatus[] : [];
        if (list.length > 0) {
          setCachedStatusList(list);
          setStatusList(list);
        }
      } catch { /* ignore */ }
    }

    const cachedDept = getCachedDeptList();
    if (cachedDept && cachedDept.length > 0) {
      setDeptList(cachedDept);
    } else {
      try {
        const res = await callIdcApi('ticketDepartmentList');
        const list = Array.isArray(res.data) ? res.data as TicketDepartment[] : [];
        if (list.length > 0) {
          setCachedDeptList(list);
          setDeptList(list);
        }
      } catch { /* ignore */ }
    }
  }, [callIdcApi]);

  const fetchDetail = useCallback(async () => {
    if (!ticketId || isNaN(ticketId)) {
      setError('无效的工单ID');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await callIdcApi('ticketDetail', { id: ticketId });
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '获取工单详情失败'));
        setTicket(null);
        setMessages([]);
        return;
      }
      const data = res.data as Record<string, unknown> | undefined;
      const ticketRaw = (data?.ticket ?? data?.ticket_data ?? data ?? {}) as Record<string, unknown>;
      const ticketData = ticketRaw as unknown as TicketInfo;
      const listData = Array.isArray(data?.list) ? data!.list as TicketMessage[] :
                       Array.isArray(ticketRaw?.list) ? ticketRaw.list as TicketMessage[] : [];
      const fieldsData = Array.isArray(data?.customfields) ? data!.customfields as CustomField[] :
                         Array.isArray(ticketRaw?.customfields) ? ticketRaw.customfields as CustomField[] : [];
      setTicket(ticketData);
      setMessages(listData);
      setCustomFields(fieldsData);

      if (Array.isArray(ticketData.host) && ticketData.host.length > 0) {
        setRelatedHosts(ticketData.host.map((h) => ({
          id: h.id,
          productname: h.productname,
          domain: h.domain,
          domainstatus: h.domainstatus,
          status: h.domainstatus,
          nextduedate: h.nextduedate,
          billingcycle: h.billingcycle,
          amount: h.amount,
          status_color: h.status_color,
        })));
      } else {
        setRelatedHosts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取详情失败');
    } finally {
      setLoading(false);
    }
  }, [callIdcApi, ticketId]);

  useEffect(() => {
    void fetchStatusAndDepts();
    void fetchDetail();
  }, [fetchStatusAndDepts, fetchDetail]);

  const fetchTicketUser = useCallback(async (uid: number, username?: string) => {
    if (!uid || uid <= 0) return;
    try {
      let foundUser: Record<string, unknown> | null = null;

      // 优先用 username 作为 keyword 搜索（1次请求，快速）
      if (username) {
        const res = await callIdcApi('searchUser', { keyword: username });
        const resData = res.data as Record<string, unknown> | undefined;
        const list = (Array.isArray(resData?.list) ? resData!.list :
                      Array.isArray(res?.list) ? res.list : []) as Record<string, unknown>[];
        if (Array.isArray(list)) {
          foundUser = list.find((u) => Number(u.id) === uid) || null;
        }
      }

      // Fallback: UID 二分搜索
      if (!foundUser) {
        const pageSize = 50;
        let lowPage = 1;
        let highPage = Math.ceil(uid / pageSize) + 2;
        const visitedPages = new Set<number>();
        let maxAttempts = 15;

        while (maxAttempts-- > 0 && lowPage <= highPage) {
          const page = maxAttempts === 14 ? Math.ceil(uid / pageSize) : Math.floor((lowPage + highPage) / 2);
          if (visitedPages.has(page)) { lowPage = page + 1; continue; }
          visitedPages.add(page);

          const res = await callIdcApi('searchUser', {
            keyword: '',
            searchParams: { page, limit: pageSize, order: 'id', sort: 'ASC' },
          });
          const resData = res.data as Record<string, unknown> | undefined;
          const list = (Array.isArray(resData?.list) ? resData!.list :
                        Array.isArray(res?.list) ? res.list : []) as Record<string, unknown>[];
          if (!Array.isArray(list) || list.length === 0) {
            highPage = page - 1;
            continue;
          }

          const matched = list.find((u) => Number(u.id) === uid);
          if (matched) { foundUser = matched; break; }

          const minId = Math.min(...list.map((u) => Number(u.id)));
          const maxId = Math.max(...list.map((u) => Number(u.id)));
          if (uid < minId) {
            highPage = page - 1;
          } else if (uid > maxId) {
            lowPage = page + 1;
          } else {
            break;
          }
        }
      }

      if (foundUser) {
        const qq = String(foundUser.qq || '').trim();
        const userInfo: TicketUser = {
          id: Number(foundUser.id),
          user_login: String(foundUser.username || ''),
          user_email: String(foundUser.email || ''),
          mobile: String(foundUser.phonenumber || foundUser.phone || ''),
          qq,
        };
        setTicketUser(userInfo);
        if (qq) {
          setUserAvatar(`https://q.qlogo.cn/headimg_dl?dst_uin=${encodeURIComponent(qq)}&spec=640&img_type=jpg`);
        } else {
          setUserAvatar('');
        }
      } else {
        setTicketUser(null);
        setUserAvatar('');
      }
    } catch {
      setTicketUser(null);
      setUserAvatar('');
    }
  }, [callIdcApi]);

  useEffect(() => {
    if (ticket?.uid && ticket.uid > 0) {
      const username = ticket.host?.[0]?.username;
      void fetchTicketUser(ticket.uid, username);
    }
  }, [ticket?.uid, ticket?.host, fetchTicketUser]);

  const fetchHostDetails = useCallback(async () => {
    if (!ticket?.host || ticket.host.length === 0 || !ticket.uid) return;
    setHostDetailsLoading(true);
    try {
      const results: Record<number, { ip: string; hostname: string }> = {};
      await Promise.all(ticket.host.map(async (h) => {
        try {
          const res = await callIdcApi('getServiceDetail', { uid: ticket.uid, hostid: h.id });
          // getServiceDetail 返回 { success: true, data: hostData }，res.data 就是 hostData
          const hostData = (res.success !== false && res.data) ? res.data as Record<string, unknown> : null;
          if (hostData) {
            const ip = String(hostData.dedicatedip || '');
            const assignedIps = Array.isArray(hostData.assignedips) ? hostData.assignedips : [];
            const serverIp = ip || (assignedIps.length > 0 ? String(assignedIps[0]) : '');
            results[h.id] = {
              ip: serverIp,
              hostname: String(hostData.domain || h.domain || ''),
            };
          }
        } catch { /* ignore individual errors */ }
      }));
      setHostDetails(results);
    } catch {
      /* ignore */
    } finally {
      setHostDetailsLoading(false);
    }
  }, [callIdcApi, ticket]);

  useEffect(() => {
    if (relatedHosts.length > 0 && Object.keys(hostDetails).length === 0) {
      void fetchHostDetails();
    }
  }, [relatedHosts.length, hostDetails, fetchHostDetails]);

  const handleReplySent = useCallback(() => {
    void fetchDetail();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ticket-updated'));
    }
  }, [fetchDetail]);

  const handleClose = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const closedId = findClosedStatusId(statusList);
      const res = await callIdcApi('ticketClose', {
        id: [ticketId],
        status: closedId || 'Closed',
      });
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '关闭工单失败'));
        return;
      }
      setCloseDialogOpen(false);
      void fetchDetail();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('ticket-updated'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '关闭工单失败');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTransferred = useCallback(() => {
    void fetchDetail();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ticket-updated'));
    }
  }, [fetchDetail]);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <PageHeader title="工单详情" titleIcon={TicketIcon} />
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 space-y-3">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <PageHeader title="工单详情" titleIcon={TicketIcon} />
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3">
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <div className="flex gap-2">
              <button
                onClick={() => router.push('/tickets')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                <ArrowLeft className="w-4 h-4" />
                返回列表
              </button>
              <button
                onClick={() => void fetchDetail()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent"
              >
                <RefreshCw className="w-4 h-4" />
                重试
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)]">
        <PageHeader title="工单详情" titleIcon={TicketIcon} />
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Inbox className="w-10 h-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">未找到工单</p>
          <Link href="/tickets" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
            <ArrowLeft className="w-4 h-4" />
            返回列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-3.5rem)] flex flex-col">
      <PageHeader
        title={`#${ticketId} ${ticket.title || '工单详情'}`}
        titleIcon={TicketIcon}
        actions={
          <>
            <Link
              href="/tickets"
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              返回
            </Link>
            <button
              onClick={() => void fetchDetail()}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              刷新
            </button>
            {isAdminUser && (
              <>
                <button
                  onClick={() => setTransferDialogOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
                >
                  <ArrowRightCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">移交</span>
                </button>
                <button
                  onClick={() => setCloseDialogOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-destructive text-destructive-foreground px-3 py-1.5 text-sm hover:bg-destructive/90 hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">关闭</span>
                </button>
              </>
            )}
          </>
        }
      />

      <div className="flex-1 max-w-7xl mx-auto w-full px-3 sm:px-4 py-3 lg:min-h-0 lg:overflow-hidden">
        <div className="flex flex-col lg:flex-row gap-3 lg:h-full">
          {/* 主区域 */}
          <div className="flex-1 min-w-0 flex flex-col lg:min-h-0">
            {/* 工单信息卡 */}
            <div className="rounded-lg border border-border bg-card p-3 mb-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="text-base font-semibold text-foreground break-words flex-1 min-w-0">
                  {ticket.title || '无标题'}
                </h2>
                <TicketStatusBadge status={ticket.status} statusList={statusList} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">UID: {ticket.uid || '-'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Building2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{ticket.dpt_name || '-'}</span>
                </div>
                {ticket.priority && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Flag className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">优先级: {priorityLabel(ticket.priority)}</span>
                  </div>
                )}
                {ticket.flag && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Flag className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">处理人ID: {ticket.flag}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 对话区域 */}
            <div className="flex-1 rounded-lg border border-border bg-card overflow-hidden flex flex-col lg:min-h-0 min-h-[300px]">
              <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-muted/30 shrink-0">
                <MessageSquare className="w-4 h-4 text-primary" />
                <span className="text-sm font-medium">沟通记录</span>
                <span className="text-xs text-muted-foreground">({messages.length})</span>
              </div>
              <div className="flex-1 overflow-y-auto px-3 max-h-[50vh] lg:max-h-none lg:min-h-0">
                <TicketConversation messages={messages} userAvatar={userAvatar} />
              </div>
              <TicketReplyBox
                ticketId={ticketId}
                onReplySent={handleReplySent}
                callApi={callIdcApi}
              />
            </div>
          </div>

          {/* 右侧侧栏 */}
          <div className="lg:w-72 shrink-0 space-y-3 lg:overflow-y-auto lg:min-h-0">
            {/* 关联产品卡片（默认自动加载） */}
            {relatedHosts.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Server className="w-4 h-4 text-primary" />
                  关联产品
                  <span className="text-xs text-muted-foreground font-normal">({relatedHosts.length})</span>
                </h3>
                <div className="space-y-2.5">
                  {relatedHosts.map((host) => {
                    const detail = hostDetails[host.id];
                    const statusName = getHostStatusName(host);
                    const statusClass = mapStatusToClass(statusName);
                    return (
                      <div key={host.id} className="rounded-md border border-border/60 p-2 text-xs">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <div className="font-medium text-foreground truncate flex-1 min-w-0">
                            {host.productname || `产品#${host.id}`}
                          </div>
                          {statusName && (
                            <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${statusClass}`}>
                              {statusName}
                            </span>
                          )}
                        </div>
                        <div className="text-muted-foreground mb-1.5">ID: {host.id}</div>

                        {/* 主机名 + IP - 异步加载，水平排列 */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          {hostDetailsLoading && !detail && (
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              加载中...
                            </span>
                          )}
                          {detail && (detail.hostname || detail.ip) && (
                            <>
                              {detail.hostname && (
                                <span className="inline-flex items-center gap-0.5 min-w-0">
                                  <span className="text-muted-foreground shrink-0">主机名:</span>
                                  <span className="text-foreground truncate max-w-[140px]" title={detail.hostname}>
                                    {detail.hostname}
                                  </span>
                                  <CopyButton text={detail.hostname} />
                                </span>
                              )}
                              {detail.ip && (
                                <span className="inline-flex items-center gap-0.5 min-w-0">
                                  <span className="text-muted-foreground shrink-0">·IP:</span>
                                  <span className="text-foreground font-mono">{detail.ip}</span>
                                  <CopyButton text={detail.ip} />
                                </span>
                              )}
                            </>
                          )}
                          {!hostDetailsLoading && !detail && (
                            <span className="text-muted-foreground text-[10px]">详情获取失败</span>
                          )}
                        </div>

                        {host.nextduedate && (
                          <div className="text-muted-foreground mb-1.5">
                            到期: {formatTime(host.nextduedate)}
                          </div>
                        )}

                        {detail?.hostname && (
                          <a
                            href={`/user-instances?q=${encodeURIComponent(detail.hostname)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Search className="w-3 h-3" />
                            查看实例
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 用户信息独立卡片 */}
            {ticketUser && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <User className="w-4 h-4 text-primary" />
                  用户信息
                </h3>
                <div className="flex items-center gap-2 mb-1.5">
                  {userAvatar ? (
                    <img
                      src={userAvatar}
                      alt={ticketUser.user_login || ''}
                      className="w-9 h-9 rounded-full object-cover border border-border shrink-0"
                      referrerPolicy="no-referrer"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center border border-border shrink-0">
                      <User className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {ticketUser.user_login || `UID:${ticket.uid}`}
                    </div>
                    {ticketUser.qq && (
                      <div className="text-xs text-muted-foreground truncate">QQ: {ticketUser.qq}</div>
                    )}
                  </div>
                </div>
                {ticketUser.user_email && (
                  <div className="text-xs text-muted-foreground truncate" title={ticketUser.user_email}>
                    邮箱: {ticketUser.user_email}
                  </div>
                )}
                {ticketUser.mobile && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    手机: {ticketUser.mobile}
                  </div>
                )}
                <a
                  href={`/?q=${encodeURIComponent(ticketUser.mobile || ticketUser.user_email || '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Search className="w-3 h-3" />
                  查看用户
                </a>
              </div>
            )}

            {/* 自定义字段卡片 */}
            {customFields.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-3">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <TicketIcon className="w-4 h-4 text-primary" />
                  自定义字段
                </h3>
                <dl className="space-y-2 text-xs">
                  {customFields.map((field) => (
                    <div key={field.id}>
                      <dt className="text-muted-foreground mb-0.5">{field.fieldname}</dt>
                      <dd className="text-foreground break-words">{field.value || '-'}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 关闭确认对话框 */}
      <AlertDialog open={closeDialogOpen} onOpenChange={setCloseDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认关闭工单 #{ticketId}？</AlertDialogTitle>
            <AlertDialogDescription>
              关闭后用户将无法继续回复此工单。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionLoading}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleClose();
              }}
              disabled={actionLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {actionLoading && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              确认关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 移交对话框 */}
      <TicketTransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        ticketId={ticketId}
        departments={deptList}
        callApi={callIdcApi}
        onTransferred={handleTransferred}
      />
    </div>
  );
}
