'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RotateCcw, Loader2, Search, X, Server, Globe, AlertCircle, CheckCircle, RefreshCw, Trash2, Link2, CheckCircle2, XCircle, Copy, Check } from 'lucide-react';
import { loadAuth, getLoginUser } from '@/lib/auth-client';
import { PageHeader } from '@/components/layout/page-header';

interface RecycleInstance {
  id: number;
  hostname: string;
  mainip: string;
  status: string;
  cpu: number;
  memory: number;
  os: string;
  node_name: string;
  username: string;
  recycle_time: string;
  delete_time: string;
}

const PAGE_SIZE = 20;

// 兼容时间戳(秒/毫秒)和日期字符串(如 "2026-07-15 10:30:00")
function parseDate(val: string): Date | null {
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

// 常量映射（模块级，避免每次渲染重建）
const CYCLE_MAP: Record<string, string> = {
  monthly: '月付', quarterly: '季付', semiannually: '半年付',
  annually: '年付', biennially: '两年付', triennially: '三年付',
};
const DOMAIN_STATUS_MAP: Record<string, string> = {
  Active: '运行中', Suspended: '暂停', Deleted: '已删除', Terminated: '已终止',
  Pending: '待开通', Cancelled: '已取消', Fraud: '欺诈', 'Pending Transfer': '待转移',
};

function formatBillingCycle(cycle: string): string {
  return CYCLE_MAP[cycle] || cycle;
}
function formatDomainStatus(status: string): string {
  return DOMAIN_STATUS_MAP[status] || status;
}
function formatMemory(gb: number): string {
  if (gb <= 0) return '-';
  return `${gb}G`;
}
function formatTime(val: string): string {
  const d = parseDate(val);
  return d ? d.toLocaleString('zh-CN') : (val || '-');
}
function formatDaysUntil(val: string): { text: string; title: string } {
  const target = parseDate(val);
  if (!target) return { text: '-', title: '-' };
  const fullTime = target.toLocaleString('zh-CN');
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { text: '已过期', title: fullTime };
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  if (days >= 1) return { text: `${days}天后`, title: fullTime };
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 1) return { text: `${hours}小时后`, title: fullTime };
  return { text: `${totalMinutes}分钟后`, title: fullTime };
}

export default function RecycleBinPage() {
  const router = useRouter();
  const [allInstances, setAllInstances] = useState<RecycleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [restoringIds, setRestoringIds] = useState<Set<number>>(new Set());
  const [restoreMsg, setRestoreMsg] = useState<{ id: number; type: 'success' | 'error'; text: string } | null>(null);
  // 确认弹窗 + 进度弹窗
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    instance: RecycleInstance | null;
    searching: boolean;
    hostInfo: { hostid: number; uid: number; amount: number; billingcycle: string; productname: string; domainstatus: string; username: string } | null;
    userInfo: { username: string; phone: string; email: string; credit: number } | null;
    searchingUser: boolean;
    searchError: string;
    renewMethod: 'autoRecharge' | 'deductBalance';
  }>({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' });
  const [renewSteps, setRenewSteps] = useState<Array<{ id: string; name: string; status: 'processing' | 'completed' | 'failed'; message?: string }>>([]);
  const [isRenewProcessing, setIsRenewProcessing] = useState(false);

  const callMfyApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const loginUser = getLoginUser();
    const response = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: loginUser, ...params }),
    });
    return response.json();
  }, []);

  // 调用财务API
  const callIdcApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const auth = loadAuth();
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: auth?.token || '', cookie: auth?.cookie || '', ...params }),
    });
    const data = await response.json();
    // 检测 IDCSmart session 过期
    if (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录') {
      setError('IDCSmart 后台登录已过期，请返回登录页重新登录');
      return { success: false, message: '登录已过期，请重新登录' };
    }
    return data;
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 分页查询所有回收站实例（避免超过200条时漏掉）
      const perPage = 200;
      let allRawList: Array<Record<string, unknown>> = [];
      let page = 1;
      const maxPages = 50; // 安全上限：50页 × 200 = 10000条
      let fetchSuccess = true;
      let fetchError = '';
      while (page <= maxPages) {
        const res = await callMfyApi('cloudList', {
          status: ['recycle'],
          page,
          per_page: perPage,
          orderby: 'id',
          sort: 'desc',
        });
        if (!res.success || !res.data) {
          fetchSuccess = false;
          fetchError = String(res.msg || res.message || '获取回收站列表失败');
          break;
        }
        const outer = res.data as Record<string, unknown>;
        const listRaw = outer.data;
        const list: Array<Record<string, unknown>> = Array.isArray(listRaw) ? listRaw : [];
        allRawList = allRawList.concat(list);
        // 返回数据少于 perPage 说明是最后一页
        if (list.length < perPage) break;
        // 也检查 last_page 字段（Laravel 分页格式）
        const lp = Number(outer.last_page || 0);
        if (lp > 0 && page >= lp) break;
        page++;
      }

      if (fetchSuccess) {
        const mapped: RecycleInstance[] = allRawList.map((item) => {
          const area = item.area as Record<string, unknown> | undefined;
          const user = item.user as Record<string, unknown> | undefined;
          const ipArr = item.ip as Array<Record<string, unknown>> | undefined;
          return {
            id: Number(item.id) || 0,
            hostname: String(item.hostname || '-'),
            mainip: String(item.mainip || (Array.isArray(ipArr) && ipArr[0]?.ip) || '-'),
            status: String(item.status || ''),
            cpu: Number(item.cpu) || 0,
            memory: Number(item.memory) || 0,
            os: String(item.os || '-'),
            node_name: String(item.node_name || area?.name || '-'),
            username: String(user?.username || '-'),
            recycle_time: String(item.recycle_time || ''),
            delete_time: String(item.delete_time || ''),
          };
        });
        // 按 delete_time 降序：剩余天数多的在前，无效日期排到最后
        mapped.sort((a, b) => {
          const da = parseDate(a.delete_time);
          const db = parseDate(b.delete_time);
          if (!da && !db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return db.getTime() - da.getTime();
        });
        setAllInstances(mapped);
      } else {
        setError(fetchError);
        setAllInstances([]);
      }
    } catch (e) {
      setError('请求失败: ' + (e instanceof Error ? e.message : String(e)));
      setAllInstances([]);
    } finally {
      setLoading(false);
    }
  }, [callMfyApi]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 前端过滤：按主机名或IP匹配
  const filteredInstances = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return allInstances;
    return allInstances.filter((inst) =>
      inst.hostname.toLowerCase().includes(kw) ||
      inst.mainip.toLowerCase().includes(kw) ||
      String(inst.id).includes(kw) ||
      inst.username.toLowerCase().includes(kw)
    );
  }, [allInstances, searchKeyword]);

  // 前端分页
  const totalPages = Math.max(1, Math.ceil(filteredInstances.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pagedInstances = filteredInstances.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 竞态保护：连续点击多个实例恢复按钮时，只保留最后一次请求的结果
  const restoreReqIdRef = useRef(0);
  // 点击恢复按钮 → 打开确认弹窗 + 异步反查财务产品 + 获取用户信息
  const handleRestore = useCallback((inst: RecycleInstance) => {
    const reqId = ++restoreReqIdRef.current;
    setConfirmModal({ open: true, instance: inst, searching: true, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' });
    setRestoreMsg(null);
    // 异步反查财务产品
    (async () => {
      try {
        const searchRes = await callIdcApi('searchHost', { hostname: inst.hostname });
        if (reqId !== restoreReqIdRef.current) return; // 被后续请求取代
        let hostList: Record<string, any>[] = [];
        if (searchRes?.data) {
          const raw = searchRes.data;
          if (Array.isArray(raw.list)) hostList = raw.list;
          else if (Array.isArray(raw.data)) hostList = raw.data;
          else if (Array.isArray(raw)) hostList = raw;
        }
        if (hostList.length === 0) {
          setConfirmModal(prev => ({ ...prev, searching: false, searchError: '未找到关联的财务产品' }));
          return;
        }
        const host = hostList[0];
        // domainstatus 可能是对象 { name, color } 或字符串
        const rawStatus = host.domainstatus ?? host.status;
        const statusName = typeof rawStatus === 'object' && rawStatus !== null
          ? String((rawStatus as Record<string, unknown>).name || '未知')
          : typeof rawStatus === 'string' ? rawStatus : '-';
        const hostUsername = String(host.username || '');
        const hostUid = Number(host.uid || host.userid || 0);
        // host 数据可能直接包含用户联系信息（取决于后台版本）
        const hostEmail = String(host.email || '');
        const hostPhone = String(host.phonenumber || host.phone || '');
        const hostCredit = parseFloat(String(host.credit || '0')) || 0;

        setConfirmModal(prev => ({
          ...prev,
          searching: false,
          hostInfo: {
            hostid: Number(host.id),
            uid: hostUid,
            amount: parseFloat(String(host.amount || host.firstpaymentamount || '0').replace(/[^\d.]/g, '')) || 0,
            billingcycle: String(host.billingcycle || 'monthly'),
            productname: String(host.productname || host.name || '-'),
            domainstatus: statusName,
            username: hostUsername,
          },
        }));

        // 如果 host 数据已包含用户信息且有余额，直接使用
        if (hostUsername && hostCredit > 0) {
          setConfirmModal(prev => ({
            ...prev,
            userInfo: {
              username: hostUsername,
              phone: hostPhone,
              email: hostEmail,
              credit: hostCredit,
            },
          }));
          return;
        }

        // 异步获取用户信息（用户名/手机号/邮箱/余额）
        // 用 searchParams.username 精确搜索，避免 keyword 将纯数字用户名误判为 qq/phone
        if (hostUsername || hostUid) {
          setConfirmModal(prev => ({ ...prev, searchingUser: true }));
          try {
            // 优先用 username 精确搜索
            const userRes = hostUsername
              ? await callIdcApi('searchUser', { searchParams: { username: hostUsername, limit: 50 } })
              : await callIdcApi('searchUser', { searchParams: { id: hostUid, limit: 50 } });
            if (reqId !== restoreReqIdRef.current) return;
            const userList = (userRes?.data?.list || userRes?.list || []) as Array<Record<string, any>>;
            // 按 uid 精确匹配（避免同名用户）
            const matched = hostUid
              ? userList.find((u) => Number(u.id) === hostUid) || userList[0]
              : userList[0];
            if (matched) {
              setConfirmModal(prev => ({
                ...prev,
                searchingUser: false,
                userInfo: {
                  username: String(matched.username || hostUsername || ''),
                  phone: String(matched.phonenumber || matched.phone || hostPhone || ''),
                  email: String(matched.email || hostEmail || ''),
                  credit: parseFloat(String(matched.credit || '0')) || 0,
                },
              }));
            } else {
              // searchUser 没查到，退回使用 host 数据中的用户信息
              setConfirmModal(prev => ({
                ...prev,
                searchingUser: false,
                userInfo: hostUsername || hostPhone || hostEmail ? {
                  username: hostUsername,
                  phone: hostPhone,
                  email: hostEmail,
                  credit: hostCredit,
                } : null,
              }));
            }
          } catch {
            if (reqId !== restoreReqIdRef.current) return;
            // 查询失败，退回使用 host 数据中的用户信息
            setConfirmModal(prev => ({
              ...prev,
              searchingUser: false,
              userInfo: hostUsername || hostPhone || hostEmail ? {
                username: hostUsername,
                phone: hostPhone,
                email: hostEmail,
                credit: hostCredit,
              } : null,
            }));
          }
        }
      } catch (e) {
        if (reqId !== restoreReqIdRef.current) return;
        setConfirmModal(prev => ({ ...prev, searching: false, searchError: '反查失败: ' + (e instanceof Error ? e.message : String(e)) }));
      }
    })();
  }, [callIdcApi]);

  // 直接恢复（仅魔方云实例）
  const doRestoreOnly = useCallback(async () => {
    const inst = confirmModal.instance;
    if (!inst || isRenewProcessing) return;
    const instanceId = inst.id;
    setConfirmModal({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' });
    setRestoringIds(prev => new Set(prev).add(instanceId));
    setRestoreMsg(null);
    try {
      const res = await callMfyApi('restoreRecycleBin', { id: [instanceId] });
      if (res.success) {
        setAllInstances(prev => prev.filter(i => i.id !== instanceId));
        setRestoreMsg({ id: instanceId, type: 'success', text: `实例 ${inst.hostname} 已恢复（仅魔方云实例）` });
      } else {
        setRestoreMsg({ id: instanceId, type: 'error', text: String(res.msg || res.message || '恢复失败') });
      }
    } catch (e) {
      setRestoreMsg({ id: instanceId, type: 'error', text: '请求失败: ' + (e instanceof Error ? e.message : String(e)) });
    } finally {
      setRestoringIds(prev => {
        const next = new Set(prev);
        next.delete(instanceId);
        return next;
      });
    }
  }, [confirmModal.instance, callMfyApi, isRenewProcessing]);

  // 关联财务产品并续费：恢复 + 反查财务 + saveServiceInfo + provisionSync + 续费
  // renewMethod: 'autoRecharge' 自动充值余额后支付 | 'deductBalance' 直接用余额支付
  const doRestoreWithRenew = useCallback(async () => {
    const inst = confirmModal.instance;
    if (!inst || isRenewProcessing) return;
    const instanceId = inst.id;
    const hostname = inst.hostname;
    const renewMethod = confirmModal.renewMethod;
    const userInfo = confirmModal.userInfo;
    setConfirmModal({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' });
    setRenewSteps([]);
    setIsRenewProcessing(true);

    const steps: typeof renewSteps = [];
    const pushStep = (name: string) => {
      steps.push({ id: String(steps.length), name, status: 'processing' });
      setRenewSteps([...steps]);
      return steps.length - 1;
    };
    const updStep = (i: number, status: 'completed' | 'failed', message?: string) => {
      steps[i].status = status;
      if (message) steps[i].message = message;
      setRenewSteps([...steps]);
    };

    try {
      // 1. 恢复魔方云实例
      const i1 = pushStep(`恢复魔方云实例 (ID:${instanceId})`);
      const restoreRes = await callMfyApi('restoreRecycleBin', { id: [instanceId] });
      if (!restoreRes?.success) {
        updStep(i1, 'failed', String(restoreRes?.msg || restoreRes?.message || '恢复失败'));
        return;
      }
      updStep(i1, 'completed');

      // 2. 反查财务产品（复用弹窗已反查的 hostInfo）
      const i2 = pushStep(`反查财务产品 (主机名: ${hostname})`);
      const hostInfo = confirmModal.hostInfo;
      if (!hostInfo) {
        updStep(i2, 'failed', confirmModal.searchError || '未找到关联的财务产品');
        setRestoreMsg({ id: instanceId, type: 'error', text: `魔方云实例已恢复，但未找到主机名 ${hostname} 对应的财务产品，无法续费` });
        setAllInstances(prev => prev.filter(i => i.id !== instanceId));
        return;
      }
      const { hostid, uid, amount, billingcycle, productname: productName } = hostInfo;
      updStep(i2, 'completed', `财务产品ID: ${hostid}`);

      // 3. 更新财务产品状态 (Active + dcimid)
      const i3 = pushStep('更新财务产品状态 (Active) + dcimid');
      const saveRes = await callIdcApi('saveServiceInfo', {
        hostid,
        uid,
        updateFields: { domainstatus: 'Active', dcimid: String(instanceId) },
      });
      if (!saveRes?.success) {
        updStep(i3, 'failed', String(saveRes?.message || saveRes?.msg || '保存失败'));
        return;
      }
      updStep(i3, 'completed');

      // 4. 续费1周期
      const renewMethodLabel = renewMethod === 'autoRecharge' ? '自动充值余额' : '扣除余额续费';
      const i4 = pushStep(`续费 ${productName} (${billingcycle}) - ${renewMethodLabel}`);
      const renewRes = await callIdcApi('renewService', { hostid, billingcycles: billingcycle });
      if (!(renewRes?.status === 200)) {
        updStep(i4, 'failed', String(renewRes?.msg || '续费失败'));
        return;
      }
      const invId = renewRes.data?.invoice_id || renewRes.data?.invoiceid || renewRes.data?.id;
      const invIdStr = invId ? String(invId) : '';

      if (amount > 0 && invIdStr) {
        if (renewMethod === 'autoRecharge') {
          // 自动充值余额方式：先充值全额，再用余额支付账单
          try {
            await callIdcApi('addBalance', { uid, amount, type: 'recharge', description: `回收站恢复续费 - ${productName}` });
          } catch (e) { console.warn('充值余额失败:', e); }
          try {
            await callIdcApi('invoicePaid', { invoiceid: invId, uid });
          } catch (e) { console.warn('支付账单失败:', e); }
        } else {
          // 扣除余额续费方式：不充值，直接用现有余额支付
          // 前端余额信息仅作参考，实际扣款由后端处理，余额不足时后端返回错误
          try {
            const payRes = await callIdcApi('invoicePaid', { invoiceid: invId, uid });
            // apply_credit API 返回格式不标准（msg 可能是"支付完成"等），
            // 只有明确包含失败关键词时才判断为失败
            const failKeywords = ['失败', '错误', '不足', 'error', 'fail', '余额不够'];
            const payMsg = String(payRes?.msg || '');
            const isFail = payRes && payMsg && failKeywords.some(kw => payMsg.toLowerCase().includes(kw.toLowerCase()));
            if (isFail) {
              updStep(i4, 'failed', `支付失败：${payMsg}`);
              if (payMsg.includes('余额') || payMsg.includes('不足') || payMsg.includes('credit')) {
                const creditHint = userInfo ? `当前余额 ¥${userInfo.credit.toFixed(2)}` : '未能获取余额信息';
                setRestoreMsg({ id: instanceId, type: 'error', text: `${productName} 续费失败：余额不足（${creditHint}，需 ¥${amount.toFixed(2)}），请充值后重试` });
              } else {
                setRestoreMsg({ id: instanceId, type: 'error', text: `${productName} 续费失败：${payMsg}` });
              }
              return;
            }
          } catch (e) {
            const errMsg = e instanceof Error ? e.message : String(e);
            updStep(i4, 'failed', `支付异常：${errMsg}`);
            setRestoreMsg({ id: instanceId, type: 'error', text: `${productName} 续费失败：余额支付异常 - ${errMsg}` });
            return;
          }
        }
      }
      updStep(i4, 'completed', invIdStr ? `账单ID: ${invIdStr}` : '续费成功');

      // 5. 拉取状态（最后执行）
      const i5 = pushStep('拉取状态 (provisionSync)');
      const syncRes = await callIdcApi('provisionSync', { hostid });
      if (!(syncRes?.status === 200 || syncRes?.success === true || syncRes?.msg === '请求成功')) {
        updStep(i5, 'failed', String(syncRes?.msg || '拉取失败'));
        return;
      }
      updStep(i5, 'completed');

      setAllInstances(prev => prev.filter(i => i.id !== instanceId));
      setRestoreMsg({ id: instanceId, type: 'success', text: `${productName} 已恢复并续费成功（${renewMethodLabel}）` });
    } finally {
      setIsRenewProcessing(false);
    }
  }, [confirmModal.instance, confirmModal.hostInfo, confirmModal.searchError, confirmModal.renewMethod, confirmModal.userInfo, callMfyApi, callIdcApi, isRenewProcessing]);

  // 复制到剪贴板（timer ref 防泄漏）
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToClipboard = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedField(null), 1500);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="回收站"
        titleIcon={Trash2}
        search={{
          value: searchKeyword,
          onChange: (v) => { setSearchKeyword(v); setCurrentPage(1); },
          placeholder: '搜索主机名 / IP / ID / 用户名...',
        }}
        actions={
          <button
            onClick={fetchList}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent/80 rounded-lg text-sm transition-colors disabled:opacity-50 shrink-0 text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">刷新</span>
          </button>
        }
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4">
        {/* 恢复提示消息 */}
        {restoreMsg && (
          <div className={`flex items-start gap-2 px-4 py-3 rounded-lg border ${
            restoreMsg.type === 'success'
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-destructive/10 border-destructive/30 text-destructive'
          }`}>
            {restoreMsg.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
            <span className="text-sm flex-1">{restoreMsg.text}</span>
            <button onClick={() => setRestoreMsg(null)} className="text-current opacity-60 hover:opacity-100 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-info" />
            <span className="ml-3 text-muted-foreground">加载回收站实例...</span>
          </div>
        ) : error ? (
          <div className="text-center py-20">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-destructive" />
            <p className="text-destructive">{error}</p>
            <button onClick={fetchList} className="mt-4 px-4 py-2 bg-accent hover:bg-accent rounded-lg text-sm">
              重试
            </button>
          </div>
        ) : pagedInstances.length === 0 ? (
          <div className="text-center py-20">
            <Trash2 className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">{searchKeyword ? '未找到匹配的实例' : '回收站为空'}</p>
            <p className="text-muted-foreground text-xs mt-1">{searchKeyword ? '尝试更换关键词' : '没有处于回收站状态的实例'}</p>
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground px-1">
              共 {filteredInstances.length} 个实例{searchKeyword ? ` (搜索结果)` : ''}
              {filteredInstances.length > PAGE_SIZE && `，第 ${safePage}/${totalPages} 页`}
            </div>

            {/* 列表表头（桌面端） */}
            <div className="hidden md:grid grid-cols-[60px_170px_130px_110px_1fr_96px_140px_140px_68px] gap-2 px-2 py-2 text-xs text-muted-foreground border-b border-border">
              <span>ID</span>
              <span>主机名</span>
              <span>主IP</span>
              <span>用户名</span>
              <span>节点</span>
              <span>配置</span>
              <span>回收时间</span>
              <span>删除时间</span>
              <span className="text-right">操作</span>
            </div>

            {/* 列表行 */}
            <div className="space-y-1">
              {pagedInstances.map((inst) => {
                const isRestoring = restoringIds.has(inst.id);
                return (
                  <div key={inst.id}>
                    {/* 桌面端：grid 行 */}
                    <div className="hidden md:grid grid-cols-[60px_170px_130px_110px_1fr_96px_140px_140px_68px] gap-2 items-center px-2 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                      <span className="text-xs text-muted-foreground font-mono">#{inst.id}</span>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Server className="w-3.5 h-3.5 text-info shrink-0" />
                        <span className="text-sm text-foreground truncate" title={inst.hostname}>{inst.hostname}</span>
                      </div>
                      <span className="text-xs text-foreground font-mono truncate">{inst.mainip}</span>
                      <span className="text-xs text-foreground/80 truncate">{inst.username}</span>
                      <span className="text-xs text-foreground/80 truncate">{inst.node_name}</span>
                      <span className="text-xs text-foreground/80 whitespace-nowrap">{inst.cpu}核/{formatMemory(inst.memory)}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(inst.recycle_time)}</span>
                      {(() => { const d = formatDaysUntil(inst.delete_time); return (
                        <span className="text-xs whitespace-nowrap text-muted-foreground" title={`删除时间: ${d.title}`}>{d.text}</span>
                      ); })()}
                      <div className="flex justify-end">
                        <button
                          onClick={() => handleRestore(inst)}
                          disabled={isRestoring || isRenewProcessing}
                          className="flex items-center justify-center gap-1 px-2 py-1 bg-info text-info-foreground hover:bg-info/90 disabled:bg-accent disabled:text-muted-foreground rounded text-xs font-medium transition-colors whitespace-nowrap"
                        >
                          {isRestoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          {isRestoring ? '恢复中' : '恢复'}
                        </button>
                      </div>
                    </div>

                    {/* 移动端：紧凑卡片 */}
                    <div className="md:hidden p-3 bg-card rounded-xl border border-border space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <Server className="w-3.5 h-3.5 text-info shrink-0" />
                          <span className="text-sm text-foreground truncate" title={inst.hostname}>{inst.hostname}</span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">#{inst.id}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <span className="text-muted-foreground">IP: <span className="text-foreground font-mono">{inst.mainip}</span></span>
                        <span className="text-muted-foreground">用户: <span className="text-foreground/80">{inst.username}</span></span>
                        <span className="text-muted-foreground">节点: <span className="text-foreground/80">{inst.node_name}</span></span>
                        <span className="text-muted-foreground">配置: <span className="text-foreground/80">{inst.cpu}核 / {formatMemory(inst.memory)}</span></span>
                        <span className="text-muted-foreground">回收: <span className="text-muted-foreground">{formatTime(inst.recycle_time)}</span></span>
                        {(() => { const d = formatDaysUntil(inst.delete_time); return (
                          <span className="text-muted-foreground">删除: <span className="text-muted-foreground" title={d.title}>{d.text}</span></span>
                        ); })()}
                      </div>
                      <button
                        onClick={() => handleRestore(inst)}
                        disabled={isRestoring || isRenewProcessing}
                        className="w-full flex items-center justify-center gap-1 py-1.5 bg-info text-info-foreground hover:bg-info/90 disabled:bg-accent disabled:text-muted-foreground rounded text-xs font-medium transition-colors"
                      >
                        {isRestoring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        {isRestoring ? '恢复中...' : '恢复实例'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 分页 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-3 py-1.5 bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
                >
                  上一页
                </button>
                <span className="text-sm text-muted-foreground px-2">{safePage} / {totalPages}</span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-3 py-1.5 bg-muted hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
                >
                  下一页
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 恢复确认弹窗 */}
      {confirmModal.open && confirmModal.instance && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setConfirmModal({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' })}>
          <div className="bg-card border border-border rounded-xl p-4 sm:p-5 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-foreground text-base font-semibold flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-info" />
                恢复实例确认
              </h3>
              <button onClick={() => setConfirmModal({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' })} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 魔方云实例信息（紧凑：2行） */}
            <div className="bg-muted/40 rounded-lg p-2.5 text-xs space-y-1">
              <div className="text-muted-foreground mb-0.5">魔方云实例</div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground font-medium truncate flex items-center gap-1 min-w-0">
                  {confirmModal.instance.hostname}
                  <button onClick={() => copyToClipboard(confirmModal.instance!.hostname, 'hostname')} className="p-0.5 text-muted-foreground hover:text-info transition-colors shrink-0" title="复制主机名">
                    {copiedField === 'hostname' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
                <span className="text-muted-foreground shrink-0">#{confirmModal.instance.id}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-0.5 truncate">IP: <span className="text-foreground font-mono">{confirmModal.instance.mainip}</span>
                  <button onClick={() => copyToClipboard(confirmModal.instance!.mainip, 'mainip')} className="p-0.5 text-muted-foreground hover:text-info transition-colors shrink-0" title="复制IP">
                    {copiedField === 'mainip' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
                <span className="shrink-0">{confirmModal.instance.cpu}核/{formatMemory(confirmModal.instance.memory)}</span>
              </div>
              {(() => { const d = formatDaysUntil(confirmModal.instance.delete_time); return (
                <div className="flex justify-between text-muted-foreground"><span>剩余:</span><span className="text-primary" title={d.title}>{d.text}</span></div>
              ); })()}
            </div>

            {/* 财务产品信息（紧凑：2-3行） */}
            <div className="bg-muted/40 rounded-lg p-2.5 text-xs space-y-1">
              <div className="text-muted-foreground mb-0.5 flex items-center justify-between">
                <span>关联财务产品</span>
                {confirmModal.searching && <span className="flex items-center gap-1 text-info"><Loader2 className="w-3 h-3 animate-spin" />反查中</span>}
              </div>
              {confirmModal.searching ? (
                <div className="text-muted-foreground py-1">正在查询财务产品信息...</div>
              ) : confirmModal.hostInfo ? (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-foreground truncate">{confirmModal.hostInfo.productname}</span>
                    <span className="text-muted-foreground shrink-0">#{confirmModal.hostInfo.hostid}</span>
                  </div>
                  <div className="flex justify-between gap-2 text-muted-foreground">
                    <span>状态: <span className="text-foreground/80">{formatDomainStatus(confirmModal.hostInfo.domainstatus)}</span></span>
                    <span className="text-success font-medium">¥{confirmModal.hostInfo.amount.toFixed(2)}/{formatBillingCycle(confirmModal.hostInfo.billingcycle)}</span>
                  </div>
                </>
              ) : (
                <div className="text-warning py-0.5">{confirmModal.searchError || '未找到关联的财务产品'}</div>
              )}
            </div>

            {/* 用户信息（紧凑：2行） */}
            {confirmModal.hostInfo && (
              <div className="bg-muted/40 rounded-lg p-2.5 text-xs space-y-1">
                <div className="text-muted-foreground mb-0.5 flex items-center justify-between">
                  <span>用户信息</span>
                  {confirmModal.searchingUser && <span className="flex items-center gap-1 text-info"><Loader2 className="w-3 h-3 animate-spin" />查询中</span>}
                </div>
                {confirmModal.searchingUser ? (
                  <div className="text-muted-foreground py-0.5">正在查询用户信息...</div>
                ) : confirmModal.userInfo ? (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-foreground font-medium">{confirmModal.userInfo.username || '未知'}</span>
                      <span className={confirmModal.userInfo.credit >= confirmModal.hostInfo.amount ? 'text-success' : 'text-warning'}>
                        余额: ¥{confirmModal.userInfo.credit.toFixed(2)}
                      </span>
                    </div>
                    {(confirmModal.userInfo.phone || confirmModal.userInfo.email) && (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span className="truncate">{confirmModal.userInfo.phone || confirmModal.userInfo.email}</span>
                        <button onClick={() => copyToClipboard(confirmModal.userInfo!.phone || confirmModal.userInfo!.email, 'contact')} className="p-0.5 text-muted-foreground hover:text-info transition-colors shrink-0" title="复制联系方式">
                          {copiedField === 'contact' ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted-foreground py-0.5 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />未获取到用户信息（不影响扣余额续费）
                  </div>
                )}
              </div>
            )}

            {/* 续费方式选择（扣除余额在左，自动充值在右） */}
            {confirmModal.hostInfo && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, renewMethod: 'deductBalance' }))}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    confirmModal.renewMethod === 'deductBalance'
                      ? 'border-info bg-info/10'
                      : 'border-border hover:bg-muted/60'
                  }`}>
                  <div className="flex items-center gap-1.5">
                    <input type="radio" checked={confirmModal.renewMethod === 'deductBalance'} readOnly className="accent-info w-3 h-3" />
                    <span className="text-foreground text-sm font-medium">扣除余额</span>
                  </div>
                  <p className="text-xs mt-0.5">
                    {confirmModal.userInfo && confirmModal.userInfo.credit > 0
                      ? <span className={confirmModal.userInfo.credit >= confirmModal.hostInfo.amount ? 'text-success' : 'text-warning'}>
                          ¥{confirmModal.userInfo.credit.toFixed(2)} {confirmModal.userInfo.credit >= confirmModal.hostInfo.amount ? '≥' : '<'} ¥{confirmModal.hostInfo.amount.toFixed(2)}
                        </span>
                      : <span className="text-muted-foreground">直接用余额支付</span>}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmModal(prev => ({ ...prev, renewMethod: 'autoRecharge' }))}
                  className={`p-2 rounded-lg border text-left transition-colors ${
                    confirmModal.renewMethod === 'autoRecharge'
                      ? 'border-info bg-info/10'
                      : 'border-border hover:bg-muted/60'
                  }`}>
                  <div className="flex items-center gap-1.5">
                    <input type="radio" checked={confirmModal.renewMethod === 'autoRecharge'} readOnly className="accent-info w-3 h-3" />
                    <span className="text-foreground text-sm font-medium">自动充值</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">充值后支付，余额不变</p>
                </button>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <button
                onClick={doRestoreWithRenew}
                disabled={!confirmModal.hostInfo}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-info text-info-foreground hover:bg-info/90 disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                <Link2 className="w-4 h-4" />
                {confirmModal.renewMethod === 'autoRecharge' ? '关联财务产品并续费' : '扣除余额续费'}
              </button>
              <button
                onClick={doRestoreOnly}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-accent hover:bg-accent rounded-lg text-sm font-medium transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                仅恢复魔方云实例
              </button>
              <button
                onClick={() => setConfirmModal({ open: false, instance: null, searching: false, hostInfo: null, userInfo: null, searchingUser: false, searchError: '', renewMethod: 'autoRecharge' })}
                className="w-full py-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 恢复并续费进度弹窗 */}
      {isRenewProcessing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-card border border-border rounded-xl p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-foreground text-base font-semibold flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-info animate-spin" />
                恢复与续费进度
              </h3>
              <span className="text-sm text-muted-foreground">
                {renewSteps.length > 0 ? Math.round(renewSteps.filter(s => s.status === 'completed').length / renewSteps.length * 100) : 0}%
              </span>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {renewSteps.map((step) => (
                <div key={step.id} className="flex items-start gap-2.5">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    step.status === 'completed' ? 'bg-success/20 text-success' :
                    step.status === 'processing' ? 'bg-primary/20 text-primary' :
                    'bg-destructive/20 text-destructive'
                  }`}>
                    {step.status === 'completed' ? <CheckCircle2 className="w-3 h-3" /> :
                     step.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                     <XCircle className="w-3 h-3" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={`text-sm ${
                      step.status === 'completed' ? 'text-success' :
                      step.status === 'processing' ? 'text-primary' :
                      'text-destructive'
                    }`}>{step.name}</div>
                    {step.message && <div className="text-xs text-muted-foreground truncate mt-0.5">{step.message}</div>}
                  </div>
                </div>
              ))}
            </div>
            {!isRenewProcessing && renewSteps.length > 0 && (
              <div className="mt-4 flex justify-end">
                <button onClick={() => setRenewSteps([])} className="px-3 py-1.5 bg-accent hover:bg-accent rounded-lg text-sm text-foreground transition-colors">
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
