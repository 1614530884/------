'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import {
  ShieldCheck, Loader2, RefreshCw, Search, X,
  ChevronLeft, ChevronRight, AlertCircle, Inbox,
  Check, XCircle, History, ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { loadAuth, handleAuthExpired } from '@/lib/auth-client';
import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CertificationStatusBadge } from '@/components/certification/certification-status-badge';
import { CertificationHistoryDialog, type CertLogItem, getRealName, getIdCard, getCertMethod, getDisplayName, getUserId } from '@/components/certification/certification-history-dialog';
import {
  type StatusCategory,
  CATEGORY_LABELS, CATEGORY_VALUES,
  mapCategoryToStatusId,
  getTypeLabel,
} from '@/lib/certification-status';

type CertListItem = CertLogItem;

type SortField = 'id' | 'create_time';
type SortOrder = 'ASC' | 'DESC';

function formatTime(val: unknown): string {
  if (!val || val === '0' || val === '-') return '-';
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? String(val) : d.toLocaleString('zh-CN');
  }
  return String(val);
}

function CertificationListContent() {
  const [list, setList] = useState<CertListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<StatusCategory>('all');
  const [certTypeFilter, setCertTypeFilter] = useState<number | 'all'>('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [maxPage, setMaxPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');

  // 审核操作状态
  const [approveTarget, setApproveTarget] = useState<CertListItem | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CertListItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 历史记录对话框
  const [historyRecordId, setHistoryRecordId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, unknown> = {
        page: currentPage,
        limit: perPage,
        order: sortField,
        sort: sortOrder,
      };
      const statusId = mapCategoryToStatusId(activeTab);
      if (statusId !== undefined) {
        params.status = statusId;
      }
      if (certTypeFilter !== 'all') {
        params.type = certTypeFilter;
      }
      if (searchKeyword.trim()) {
        params.keywords = searchKeyword.trim();
      }
      const res = await callIdcApi('certifiLogList', params);
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '获取实名认证列表失败'));
        setList([]);
        setTotal(0);
        setMaxPage(1);
      } else {
        const data = res.data;
        // 兼容多种数据结构：data.list / data.data / data（直接数组）
        const items: CertListItem[] = Array.isArray((data as Record<string, unknown>)?.list)
          ? ((data as Record<string, unknown>).list as CertListItem[])
          : Array.isArray((data as Record<string, unknown>)?.data)
            ? ((data as Record<string, unknown>).data as CertListItem[])
            : Array.isArray(data)
              ? (data as CertListItem[])
              : [];
        setList(items);
        // 兼容多种分页字段名
        const dataObj = (data as Record<string, unknown>) || {};
        const sum = Number(dataObj.sum) || Number(dataObj.total) || Number(dataObj.count) || items.length;
        setTotal(sum);
        const maxPageVal = Number(dataObj.max_page) || Number(dataObj.last_page) || Math.ceil(sum / perPage) || 1;
        setMaxPage(maxPageVal);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络请求失败');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [callIdcApi, currentPage, perPage, activeTab, certTypeFilter, searchKeyword, sortField, sortOrder]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleTabChange = (tab: StatusCategory) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  const handleCertTypeChange = (val: 'all' | number) => {
    setCertTypeFilter(val);
    setCurrentPage(1);
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
    void fetchList();
  };

  const handlePerPageChange = (val: string) => {
    setPerPage(Number(val));
    setCurrentPage(1);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'ASC' ? 'DESC' : 'ASC');
    } else {
      setSortField(field);
      setSortOrder('DESC');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />;
    return sortOrder === 'ASC' ? <ArrowUp className="w-3 h-3 text-primary" /> : <ArrowDown className="w-3 h-3 text-primary" />;
  };

  // 审核通过
  const handleApprove = async () => {
    if (!approveTarget) return;
    const target = approveTarget;
    setSubmitting(true);
    try {
      // type=3(个人转企业)时按企业(2)处理
      const apiType = target.type === 3 ? 2 : (target.type || 1);
      const res = await callIdcApi('certifiStatus', {
        uid: getUserId(target),
        type: apiType,
        status: 1,
      });
      if (res.success === false) {
        toast.error(String(res.msg || res.message || '审核通过失败'));
      } else {
        toast.success('已通过实名认证');
        setApproveTarget(null);
        void fetchList();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 审核驳回
  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast.error('请填写驳回原因');
      return;
    }
    const target = rejectTarget;
    setSubmitting(true);
    try {
      const apiType = target.type === 3 ? 2 : (target.type || 1);
      const res = await callIdcApi('certifiStatus', {
        uid: getUserId(target),
        type: apiType,
        status: 2,
        error: rejectReason.trim(),
      });
      if (res.success === false) {
        toast.error(String(res.msg || res.message || '驳回操作失败'));
      } else {
        toast.success('已驳回实名认证');
        setRejectTarget(null);
        setRejectReason('');
        void fetchList();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewHistory = (item: CertListItem) => {
    if (!item.id) {
      toast.error('该记录无ID，无法查看历史');
      return;
    }
    setHistoryRecordId(item.id);
    setHistoryOpen(true);
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <PageHeader
        title="实名认证"
        titleIcon={ShieldCheck}
        search={{
          value: searchInput,
          onChange: setSearchInput,
          placeholder: '搜索姓名/身份证号/公司名...',
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
        {/* 筛选栏 */}
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
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={String(certTypeFilter)}
              onChange={(e) => {
                const v = e.target.value;
                handleCertTypeChange(v === 'all' ? 'all' : Number(v));
              }}
              className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary"
            >
              <option value="all">全部类型</option>
              <option value="1">个人</option>
              <option value="2">企业</option>
              <option value="3">个人转企业</option>
            </select>
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
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Inbox className="w-12 h-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {searchKeyword ? `没有找到与"${searchKeyword}"相关的认证记录` : '暂无实名认证记录'}
            </p>
          </div>
        ) : (
          <>
            {/* 桌面端表格 */}
            <div className="hidden md:block rounded-lg border border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('id')}>
                        <span className="inline-flex items-center gap-1">ID {getSortIcon('id')}</span>
                      </th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">姓名</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">实名认证名称</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">身份证号码</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">认证方式</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">认证类型</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap">状态</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap max-w-[160px]">原因</th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => handleSort('create_time')}>
                        <span className="inline-flex items-center gap-1">提交时间 {getSortIcon('create_time')}</span>
                      </th>
                      <th className="px-3 py-2.5 font-medium whitespace-nowrap text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {list.map((item, idx) => (
                      <tr key={item.id || idx} className="hover:bg-accent/50 transition-colors">
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{item.id || '-'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{getRealName(item)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-foreground max-w-[140px] truncate" title={getDisplayName(item)}>
                          {getDisplayName(item)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground font-mono text-xs">{getIdCard(item)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{getCertMethod(item)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{getTypeLabel(item.type)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap"><CertificationStatusBadge status={item.status} /></td>
                        <td className="px-3 py-2.5 text-muted-foreground text-xs max-w-[160px] truncate" title={item.error || ''}>
                          {item.error || '-'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-xs">{formatTime(item.create_time)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-right">
                          <div className="inline-flex items-center gap-1">
                            {(item.status === 2 || item.status === 3) && (
                              <button
                                onClick={() => setApproveTarget(item)}
                                className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                                title="审核通过"
                              >
                                <Check className="w-3 h-3" />
                                通过
                              </button>
                            )}
                            {(item.status === 1 || item.status === 2 || item.status === 3) && (
                              <button
                                onClick={() => { setRejectTarget(item); setRejectReason(''); }}
                                className="inline-flex items-center gap-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-1 text-xs font-medium hover:bg-red-500/20 transition-colors"
                                title="审核驳回"
                              >
                                <XCircle className="w-3 h-3" />
                                驳回
                              </button>
                            )}
                            {(item.status === 1 || item.status === 2) && (
                              <button
                                onClick={() => handleViewHistory(item)}
                                className="inline-flex items-center gap-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-1 text-xs font-medium hover:bg-blue-500/20 transition-colors"
                                title="查看历史记录"
                              >
                                <History className="w-3 h-3" />
                                历史
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 移动端卡片 */}
            <div className="md:hidden space-y-2">
              {list.map((item, idx) => (
                <div key={item.id || idx} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-muted-foreground">#{item.id || '-'}</span>
                      <span className="text-sm font-medium text-foreground truncate">{getRealName(item)}</span>
                    </div>
                    <CertificationStatusBadge status={item.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                    <div className="text-muted-foreground">
                      认证名称: <span className="text-foreground">{getDisplayName(item)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      类型: <span className="text-foreground">{getTypeLabel(item.type)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      方式: <span className="text-foreground">{getCertMethod(item)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      身份证: <span className="text-foreground font-mono">{getIdCard(item)}</span>
                    </div>
                  </div>
                  {item.error && (
                    <div className="text-xs text-red-500 truncate" title={item.error}>
                      原因: {item.error}
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
                    <span className="text-xs text-muted-foreground">{formatTime(item.create_time)}</span>
                    <div className="inline-flex items-center gap-1">
                      {(item.status === 2 || item.status === 3) && (
                        <button
                          onClick={() => setApproveTarget(item)}
                          className="inline-flex items-center gap-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-1 text-xs font-medium"
                        >
                          <Check className="w-3 h-3" />
                          通过
                        </button>
                      )}
                      {(item.status === 1 || item.status === 2 || item.status === 3) && (
                        <button
                          onClick={() => { setRejectTarget(item); setRejectReason(''); }}
                          className="inline-flex items-center gap-0.5 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-1 text-xs font-medium"
                        >
                          <XCircle className="w-3 h-3" />
                          驳回
                        </button>
                      )}
                      {(item.status === 1 || item.status === 2) && (
                        <button
                          onClick={() => handleViewHistory(item)}
                          className="inline-flex items-center gap-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 px-2 py-1 text-xs font-medium"
                        >
                          <History className="w-3 h-3" />
                          历史
                        </button>
                      )}
                    </div>
                  </div>
                </div>
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

      {/* 审核通过确认对话框 */}
      <AlertDialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认审核通过</AlertDialogTitle>
            <AlertDialogDescription>
              确定通过 <span className="text-foreground font-medium">{approveTarget ? getRealName(approveTarget) : '-'}</span> 的实名认证吗？
              <br />
              用户ID: {approveTarget?.auth_user_id || '-'} · 认证类型: {getTypeLabel(approveTarget?.type)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleApprove();
              }}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
              确认通过
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 审核驳回对话框 */}
      <AlertDialog open={!!rejectTarget} onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认审核驳回</AlertDialogTitle>
            <AlertDialogDescription>
              确定驳回 <span className="text-foreground font-medium">{rejectTarget ? getRealName(rejectTarget) : '-'}</span> 的实名认证吗？
              <br />
              用户ID: {rejectTarget ? getUserId(rejectTarget) : '-'} · 认证类型: {getTypeLabel(rejectTarget?.type)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <label className="text-sm text-muted-foreground mb-1.5 block">驳回原因 <span className="text-destructive">*</span></label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="请输入驳回原因，将展示给用户..."
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors resize-none"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleReject();
              }}
              disabled={submitting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <XCircle className="w-4 h-4 mr-1" />}
              确认驳回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 历史记录对话框 */}
      <CertificationHistoryDialog
        recordId={historyRecordId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}

export default function CertificationPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <CertificationListContent />
    </Suspense>
  );
}
