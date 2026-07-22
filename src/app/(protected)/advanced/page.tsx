'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  RefreshCw, Power, PowerOff, RotateCcw,
  Monitor, Server, Globe, HardDrive, Wifi,
  Loader2, CheckCircle, XCircle, AlertCircle,
  Zap, ScreenShare, KeyRound, Shield, Activity,
  Plus, Edit3, Save, Eye, EyeOff, Copy, Check, Trash2,
  Network, BarChart3, Settings, X, CalendarIcon, Clock,
  ListChecks, ChevronUp, ChevronDown, CheckCircle2, Search, User, Download
} from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { loadAuth, saveAuth, getLoginUser } from '@/lib/auth-client';

// Tab定义
const TABS = [
  { key: 'overview', label: '概览', icon: Monitor },
  { key: 'power', label: '电源操作', icon: Power },
  { key: 'config', label: '配置修改', icon: Settings },
  { key: 'disk', label: '磁盘管理', icon: HardDrive },
  { key: 'ip', label: 'IP管理', icon: Network },
  { key: 'security', label: '安全组', icon: Shield },
  { key: 'network', label: '网络', icon: Wifi },
  { key: 'traffic', label: '流量统计', icon: BarChart3 },
  { key: 'monitor', label: '监控图表', icon: Activity },
  { key: 'vnc', label: 'VNC控制台', icon: ScreenShare },
] as const;

type TabKey = typeof TABS[number]['key'];

function AdvancedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hostid = searchParams.get('hostid') || '';
  const uidParam = searchParams.get('uid') || '';

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [cloudId, setCloudId] = useState<number | null>(null);
  const [idcHostid, setIdcHostid] = useState<number | null>(null); // 财务系统hostid（用于provisionSync等）
  const [cloudDetail, setCloudDetail] = useState<Record<string, any> | null>(null);
  const [cloudStatus, setCloudStatus] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  // 提示消息自动消失（info类型3秒，success/error 4秒）
  useEffect(() => {
    if (!msg || msg.type === 'info') return;
    const timer = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(timer);
  }, [msg]);

  // 财务同步结果弹窗（成功/失败需手动关闭，确保用户了解同步状态）
  const [syncResultModal, setSyncResultModal] = useState<{
    status: 'success' | 'fail';
    operation: string;   // 触发同步的操作名（中文，如"重装系统"）
    detail: string;      // 同步结果详情
  } | null>(null);
  const [disks, setDisks] = useState<Array<Record<string, any>>>([]);
  const [ipv4List, setIpv4List] = useState<Array<Record<string, any>>>([]);
  const [ipv6List, setIpv6List] = useState<Array<Record<string, any>>>([]);
  const [trafficData, setTrafficData] = useState<Record<string, any> | null>(null);
  const [trafficLoading, setTrafficLoading] = useState(false);
  const [trafficError, setTrafficError] = useState<string>('');
  const [trafficPeriods, setTrafficPeriods] = useState<Record<string, { gb_flow: number; flow: number; in_gb: number; out_gb: number }>>({});
  const [monitorData, setMonitorData] = useState<Record<string, any> | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const monitorCacheRef = useRef<Record<string, { data: Record<string, any>; ts: number }>>({});
  const [kvmid, setKvmid] = useState<string>(''); // 魔方云KVM实例标识符，用于监控API
  // Ping 状态
  const [pingMap, setPingMap] = useState<Record<string, { loading: boolean; result: { reachable: boolean; avgLatency: number | null; error?: string } | null }>>({});
  const handlePing = useCallback(async (key: string, ip: string) => {
    if (!ip || ip === '-') return;
    setPingMap(prev => ({ ...prev, [key]: { loading: true, result: null } }));
    try {
      const res = await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: ip }) });
      const data = await res.json();
      setPingMap(prev => ({ ...prev, [key]: { loading: false, result: { reachable: data.reachable, avgLatency: data.avgLatency, error: data.error } } }));
    } catch {
      setPingMap(prev => ({ ...prev, [key]: { loading: false, result: { reachable: false, avgLatency: null, error: '请求失败' } } }));
    }
  }, []);
  const [imageList, setImageList] = useState<Array<Record<string, any>>>([]);
  const [imageGroups, setImageGroups] = useState<Array<Record<string, any>>>([]);

  // 监控类型与时间范围
  const [monitorType, setMonitorType] = useState<string>('cpu');
  const [monitorRange, setMonitorRange] = useState<string>('7d');
  const [monitorNic, setMonitorNic] = useState<string>('');   // 选中的网卡索引(0,1,...)
  const [monitorDisk, setMonitorDisk] = useState<string>(''); // 选中的磁盘dev名称
  const [customStartTime, setCustomStartTime] = useState<string>('');
  const [customEndTime, setCustomEndTime] = useState<string>('');
  const [dataTimeStart, setDataTimeStart] = useState<number>(0);
  const [dataTimeEnd, setDataTimeEnd] = useState<number>(0);
  const [fullDataTimeStart, setFullDataTimeStart] = useState<number>(0);
  const [fullDataTimeEnd, setFullDataTimeEnd] = useState<number>(0);

  // 配置修改表单（内存以GB为单位显示和编辑，提交时转回MB）
  const [configForm, setConfigForm] = useState<Record<string, any>>({});
  const [configSaving, setConfigSaving] = useState(false);

  // 重装系统表单
  const [showReinstallDialog, setShowReinstallDialog] = useState(false);
  const [reinstallForm, setReinstallForm] = useState({ image_group: 0, image_id: 0, password: '', port: 22, format_data_disk: false, custom_disk_size: 0 });
  const [reinstallDiskSize, setReinstallDiskSize] = useState(false);

  // 带宽临时修改
  const [bwTempMode, setBwTempMode] = useState(false);
  const [bwTempExpireTime, setBwTempExpireTime] = useState('');
  const [bwTempExpireTimeDisplay, setBwTempExpireTimeDisplay] = useState<string>('');

  // 重置密码表单
  const [showResetPwdDialog, setShowResetPwdDialog] = useState(false);
  const [resetPwdValue, setResetPwdValue] = useState('');

  // 添加IP表单
  const [showAddIpDialog, setShowAddIpDialog] = useState(false);
  const [selectedFreeIps, setSelectedFreeIps] = useState<Set<number>>(new Set());
  const [expandedIpSegments, setExpandedIpSegments] = useState<Set<number>>(new Set());

  // IP多选
  const [selectedIps, setSelectedIps] = useState<Set<number>>(new Set());

  // 添加磁盘表单
  const [showAddDiskDialog, setShowAddDiskDialog] = useState(false);
  const [addDiskForm, setAddDiskForm] = useState({ size: 10, store: 0, driver: 'virtio' });
  const [diskStores, setDiskStores] = useState<Array<Record<string, any>>>([]);

  // 密码可见性
  const [passwordVisible, setPasswordVisible] = useState(false);

  // 任务与日志系统 - 直接从魔方云API获取
  const [mfyTasks, setMfyTasks] = useState<Array<{
    id: number; type: string; type_desc: string; status: number;
    status_label: string; create_time: string; start_time: string;
    end_time: string; progress: number; msg: string; hostid: number; hostname: string;
  }>>([]);
  const [mfyLogs, setMfyLogs] = useState<Array<{
    id: number; des: string; create_time: string; username: string; ip: string;
  }>>([]);
  const [showTaskPanel, setShowTaskPanel] = useState(false);
  const [taskLogLoading, setTaskLogLoading] = useState(false);
  const [taskLogTab, setTaskLogTab] = useState<'tasks' | 'logs'>('tasks');
  const [hasRunningTask, setHasRunningTask] = useState(false);
  // 操作成功后标记需要同步，等后台任务全部完成时触发 provisionSync
  const pendingProvisionSync = useRef(false);
  const prevHasRunningTask = useRef(false);
  const idcHostidRef = useRef<number | null>(null);
  const cloudIdRef = useRef<number | null>(null);
  // 已处理过的已完成任务ID集合，防止重复触发刷新/同步
  const handledTaskIds = useRef<Set<number>>(new Set());
  // 是否已完成首次任务列表加载（首次加载时只记录已完成任务ID，不触发刷新）
  const initialTaskLoadDone = useRef(false);

  // 删除磁盘确认弹窗
  const [deleteDiskTarget, setDeleteDiskTarget] = useState<{ id: number; name: string } | null>(null);
  // 电源操作确认弹窗
  const [powerConfirm, setPowerConfirm] = useState<{ action: string; name: string } | null>(null);
  const [resizeDiskTarget, setResizeDiskTarget] = useState<{ id: number; name: string; currentSize: number } | null>(null);
  const [resizeDiskValue, setResizeDiskValue] = useState(0);

  // 安全组
  const [securityGroups, setSecurityGroups] = useState<Array<Record<string, any>>>([]);
  const [currentSecurityGroup, setCurrentSecurityGroup] = useState<Record<string, any> | null>(null);
  const [securityRules, setSecurityRules] = useState<Array<Record<string, any>>>([]);
  const [showSecurityGroupDialog, setShowSecurityGroupDialog] = useState(false);
  const [showSecurityRuleDialog, setShowSecurityRuleDialog] = useState(false);
  const [securityRuleForm, setSecurityRuleForm] = useState({ direction: 'in', protocol: 'tcp', port: '', ip: '', description: '' });
  const [securityLoading, setSecurityLoading] = useState(false);

  // 实时数据（CPU/内存/带宽/磁盘IO）
  const [realData, setRealData] = useState<Record<string, any> | null>(null);
  const [realDataLoading, setRealDataLoading] = useState(false);

  // 网络
  const [vpcNetworks, setVpcNetworks] = useState<Array<Record<string, any>>>([]);
  const [showNetworkSwitchDialog, setShowNetworkSwitchDialog] = useState(false);
  const [networkSwitchTarget, setNetworkSwitchTarget] = useState<'vpc' | 'normal'>('normal');

  // 全局搜索
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<{ hosts: Array<Record<string, any>>; users: Array<Record<string, any>> }>({ hosts: [], users: [] });
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('mfy_search_history') || '[]'); } catch { return []; }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 点击外部关闭搜索下拉
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(e.target as Node)) {
        setShowSearchDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [selectedVpcId, setSelectedVpcId] = useState<number>(0);
  const [vpcIpSegment, setVpcIpSegment] = useState('');

  // IP池
  const [freeIpList, setFreeIpList] = useState<Array<{ id: number; ip_name: string; ip: Array<{ id: number; ip: string }> }>>([]);
  const [freeIpLoading, setFreeIpLoading] = useState(false);

  const reloginInProgress = useRef(false);

  // 自动重新登录
  const autoRelogin = useCallback(async (): Promise<boolean> => {
    if (reloginInProgress.current) return false;
    reloginInProgress.current = true;
    try {
      const saved = loadAuth();
      if (!saved || !saved.username || !saved.password) return false;
      const testResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      const testData = await testResp.json();
      if (testData.captchaEnabled) return false;
      const newCookie = testData.cookie || '';
      const loginResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: saved.username, password: saved.password, cookie: newCookie }),
      });
      const loginData = await loginResp.json();
      if (loginData.success) {
        saveAuth({ token: loginData.token || 'authenticated', cookie: loginData.cookie || '', username: saved.username, password: saved.password });
        return true;
      }
      return false;
    } catch { return false; }
    finally { reloginInProgress.current = false; }
  }, []);

  // 调用IDC后台API
  const callIdcApi = useCallback(async (action: string, params: Record<string, unknown> = {}, retry = true): Promise<Record<string, any>> => {
    const auth = loadAuth();
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: auth?.token || '', cookie: auth?.cookie || '', ...params }),
    });
    const data = await response.json();
    if (retry && (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录')) {
      const relogined = await autoRelogin();
      if (relogined) {
        const freshAuth = loadAuth();
        const retryResp = await fetch('/api/idc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, token: freshAuth?.token || '', cookie: freshAuth?.cookie || '', ...params }),
        });
        return retryResp.json();
      }
      setMsg({ type: 'error', text: 'IDCSmart 后台登录已过期，请返回登录页重新登录' });
      return { success: false, message: '登录已过期，请重新登录' };
    }
    return data;
  }, [autoRelogin]);

  // 调用魔方云API
  const callMfyApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const loginUser = getLoginUser();
    const response = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: loginUser, ...params }),
    });
    return response.json();
  }, []);

  // 全局搜索函数
  const doGlobalSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) { setSearchResults({ hosts: [], users: [] }); return; }
    setSearchLoading(true);
    try {
      const res = await callMfyApi('globalSearch', { search: keyword.trim() });
      if (res.success && res.data) {
        const d = (res.data as Record<string, unknown>).data || res.data;
        setSearchResults({
          hosts: Array.isArray((d as Record<string, any>)?.host) ? (d as Record<string, any>).host : [],
          users: Array.isArray((d as Record<string, any>)?.user) ? (d as Record<string, any>).user : [],
        });
      }
    } catch { /* ignore */ }
    setSearchLoading(false);
  }, [callMfyApi]);

  // 保存搜索历史
  const saveSearchHistory = useCallback((keyword: string) => {
    if (!keyword.trim()) return;
    setSearchHistory(prev => {
      const next = [keyword, ...prev.filter(k => k !== keyword)].slice(0, 10);
      try { localStorage.setItem('mfy_search_history', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // 防抖自动搜索：停止输入1.5秒后自动触发
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchKeyword.trim()) {
      setSearchResults({ hosts: [], users: [] });
      return;
    }
    searchDebounceRef.current = setTimeout(() => {
      doGlobalSearch(searchKeyword);
      saveSearchHistory(searchKeyword.trim());
      setShowSearchDropdown(true);
    }, 500);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchKeyword, doGlobalSearch, saveSearchHistory]);

  // 从魔方云API获取任务列表和日志
  const fetchMfyTaskAndLog = useCallback(async (cid: number) => {
    setTaskLogLoading(true);
    try {
      const [taskRes, logRes] = await Promise.all([
        callMfyApi('taskList', { cloud: cid, per_page: 20, orderby: 'id', sort: 'desc' }),
        callMfyApi('cloudLog', { id: cid, per_page: 20 }),
      ]);
      if (taskRes.success && taskRes.data) {
        const taskData = (taskRes.data as Record<string, unknown>).data || taskRes.data;
        if (Array.isArray(taskData)) {
          const statusLabels = ['未开始', '执行中', '成功', '失败', '强制结束', '已取消'];
          const typeLabels: Record<string, string> = {
            'on': '开机', 'off': '关机', 'reboot': '重启',
            'hard_off': '硬关机', 'hard_reboot': '硬重启',
            'rebuild': '重建', 'reinstall': '重装',
            'crack': '重置密码', 'vnc': 'VNC',
            'mount': '挂载', 'unmount': '卸载',
            'resize': '扩容', 'add_disk': '添加磁盘',
            'delete_disk': '删除磁盘', 'add_ip': '添加IP',
            'delete_ip': '删除IP', 'bind_sg': '绑定安全组',
            'unbind_sg': '解绑安全组', 'modify_bw': '修改带宽',
            'snapshot': '快照', 'restore': '恢复',
            'migrate': '迁移', 'clone': '克隆',
          };
          setMfyTasks(taskData.map((t: Record<string, any>) => ({
            id: t.id,
            type: t.type || '',
            type_desc: t.type_desc || typeLabels[String(t.type)] || t.type || '',
            status: Number(t.status ?? 0),
            status_label: statusLabels[Number(t.status ?? 0)] || '未知',
            create_time: t.create_time || '',
            start_time: t.start_time || '',
            end_time: t.end_time || '',
            progress: Number(t.progress ?? 0),
            msg: t.msg || '',
            hostid: t.hostid || 0,
            hostname: t.hostname || '',
          })));
          const hasRunning = taskData.some((t: Record<string, any>) => Number(t.status ?? 0) === 1);
          setHasRunningTask(hasRunning);

          // 首次加载：只记录已完成任务ID，不触发刷新/同步
          if (!initialTaskLoadDone.current) {
            initialTaskLoadDone.current = true;
            for (const t of taskData) {
              if (Number(t.status ?? 0) >= 2) {
                handledTaskIds.current.add(Number(t.id));
              }
            }
            prevHasRunningTask.current = hasRunning;
          } else {
            // 非首次：检测新完成的任务（status>=2且未处理过）
            const newlyCompleted = taskData.filter((t: Record<string, any>) => {
              const tid = Number(t.id);
              const status = Number(t.status ?? 0);
              return status >= 2 && !handledTaskIds.current.has(tid);
            });

            if (newlyCompleted.length > 0) {
              const cid = cloudIdRef.current;
              // MFY API返回的type可能是英文(reinstall)或中文(重装)，需要同时兼容
              const needRefreshTypes = ['reinstall', 'crack', 'reinstal', '重装', '重置密码']; // 重装/重置密码完成后刷新实例信息
              const needSyncTypes = ['rebuild', 'reinstall', 'crack', 'add_ip', 'delete_ip', 'add_disk', 'resize', 'reinstal', '重建', '重装', '重置密码', '添加IP', '删除IP', '添加磁盘', '扩容']; // 需要provisionSync的操作

              let shouldRefresh = false;
              let shouldSync = false;
              // 记录触发同步的任务描述（取第一个需要同步的成功任务）
              let syncTaskDesc = '';

              for (const t of newlyCompleted) {
                handledTaskIds.current.add(Number(t.id));
                const taskType = String(t.type);
                const taskStatus = Number(t.status ?? 0);

                // 只处理成功的任务（status=2），失败/取消的不触发
                if (taskStatus === 2) {
                  if (needRefreshTypes.includes(taskType)) {
                    shouldRefresh = true;
                  }
                  if (needSyncTypes.includes(taskType)) {
                    shouldSync = true;
                    if (!syncTaskDesc) {
                      syncTaskDesc = String(t.type_desc || typeLabels[taskType] || taskType);
                    }
                  }
                }
              }

              // 重装/重置密码完成后延迟刷新实例信息（等魔方云数据更新）
              if (shouldRefresh && cid) {
                setTimeout(() => {
                  fetchCloudDetailRef.current(cid);
                  fetchCloudStatusRef.current(cid);
                  callMfyApi('realDataList', { ids: [cid] }).then(res => {
                    if (res.success && res.data) {
                      const realList: unknown[] = Array.isArray(res.data) ? res.data : (Array.isArray((res.data as Record<string, unknown>).data) ? (res.data as Record<string, unknown>).data as unknown[] : []);
                      if (realList.length > 0) {
                        setRealData(realList[0] as Record<string, any>);
                      }
                    }
                  }).catch(() => {});
                }, 2000);
              }

              // 特定任务完成 → 立即触发 provisionSync（不等待所有任务完成）
              // 同步结果通过弹窗反馈给用户（成功/失败需手动关闭）
              if (shouldSync || pendingProvisionSync.current) {
                pendingProvisionSync.current = false;
                const syncHostid = idcHostidRef.current;
                if (syncHostid) {
                  const opDesc = syncTaskDesc || '实例操作';
                  setMsg({ type: 'info', text: `「${opDesc}」已完成，正在同步财务信息...` });
                  callIdcApi('provisionSync', { hostid: syncHostid }).then(syncRes => {
                    setMsg(null);
                    const isSuccess = syncRes && (syncRes.status === 200 || syncRes.status === 1 || syncRes.msg === '请求成功' || syncRes.success === true);
                    setSyncResultModal({
                      status: isSuccess ? 'success' : 'fail',
                      operation: opDesc,
                      detail: isSuccess
                        ? `「${opDesc}」操作已完成，财务系统信息同步成功。`
                        : `「${opDesc}」操作已完成，但财务信息同步失败：${syncRes?.msg || '未知错误'}`,
                    });
                  }).catch(err => {
                    setMsg(null);
                    setSyncResultModal({
                      status: 'fail',
                      operation: opDesc,
                      detail: `「${opDesc}」操作已完成，但财务信息同步异常：${err instanceof Error ? err.message : String(err)}`,
                    });
                  });
                }
              }
            } else if (!hasRunning && pendingProvisionSync.current) {
              // 没有新完成的任务，但标记了需要同步（兜底逻辑）
              pendingProvisionSync.current = false;
              const syncHostid = idcHostidRef.current;
              if (syncHostid) {
                setMsg({ type: 'info', text: '正在同步财务信息...' });
                callIdcApi('provisionSync', { hostid: syncHostid }).then(syncRes => {
                  setMsg(null);
                  const isSuccess = syncRes && (syncRes.status === 200 || syncRes.status === 1 || syncRes.msg === '请求成功' || syncRes.success === true);
                  setSyncResultModal({
                    status: isSuccess ? 'success' : 'fail',
                    operation: '实例操作',
                    detail: isSuccess
                      ? '财务系统信息同步成功。'
                      : `财务信息同步失败：${syncRes?.msg || '未知错误'}`,
                  });
                }).catch(err => {
                  setMsg(null);
                  setSyncResultModal({
                    status: 'fail',
                    operation: '实例操作',
                    detail: `财务信息同步异常：${err instanceof Error ? err.message : String(err)}`,
                  });
                });
              }
            }
            prevHasRunningTask.current = hasRunning;
          }
        }
      }
      if (logRes.success && logRes.data) {
        const logData = (logRes.data as Record<string, unknown>).data || logRes.data;
        if (Array.isArray(logData)) {
          setMfyLogs(logData.map((item: Record<string, any>) => ({
            id: item.id,
            des: item.des || item.description || '',
            create_time: item.create_time || '',
            username: item.username || '',
            ip: String(item.ip || ''),
          })));
        }
      }
    } catch { /* ignore */ }
    finally { setTaskLogLoading(false); }
  }, [callMfyApi]);

  // 任务自动刷新：有执行中任务时每5秒刷新
  useEffect(() => {
    if (!cloudId || !hasRunningTask) return;
    const timer = setInterval(() => {
      fetchMfyTaskAndLog(cloudId);
    }, 5000);
    return () => clearInterval(timer);
  }, [cloudId, hasRunningTask, fetchMfyTaskAndLog]);

  // 获取产品的dcimid（魔方云实例ID）
  const fetchCloudId = useCallback(async (): Promise<number | null> => {
    if (!hostid || !uidParam) return null;
    try {
      const res = await callIdcApi('getServiceDetail', { hostid, uid: uidParam });
      if (res.success && res.data) {
        const dcimid = Number(res.data.dcimid || 0);
        if (dcimid > 0) return dcimid;
      }
    } catch { /* ignore */ }
    return null;
  }, [hostid, uidParam, callIdcApi]);

  // 通过主机名反查财务系统hostid
  const resolveIdcHostid = useCallback(async (cid: number) => {
    try {
      const detailRes = await callMfyApi('cloudDetail', { id: cid });
      if (!detailRes.success || !detailRes.data) return;
      const hostname = (detailRes.data as Record<string, any>).hostname;
      if (!hostname) return;
      const searchRes = await callIdcApi('searchHost', { hostname });
      if (!searchRes.data) return;
      const rawData = searchRes.data as Record<string, unknown>;
      let hostList: Record<string, any>[] = [];
      if (Array.isArray(rawData.list)) {
        hostList = rawData.list as Record<string, any>[];
      } else if (Array.isArray(rawData.data)) {
        hostList = rawData.data as Record<string, any>[];
      } else if (Array.isArray(rawData)) {
        hostList = rawData as Record<string, any>[];
      }
      if (hostList.length > 0 && hostList[0].id) {
        const foundId = Number(hostList[0].id);
        setIdcHostid(foundId);
        idcHostidRef.current = foundId;
      }
    } catch { /* ignore */ }
  }, [callMfyApi, callIdcApi]);

  // 获取云实例详情
  const fetchCloudDetail = useCallback(async (cid: number) => {
    const res = await callMfyApi('cloudDetail', { id: cid });
    if (res.success && res.data) {
      const data = (res.data as Record<string, unknown>).data || res.data;
      setCloudDetail(data as Record<string, any>);
      // 获取临时带宽状态
      if ((data as Record<string, any>)?.default_bw_group?.id) {
        callMfyApi('bwGroupList', { id: (data as Record<string, any>).default_bw_group.id }).then(res => {
          if (res.success && res.data) {
            const d = (res.data as Record<string, unknown>).data || res.data;
            const groupList = Array.isArray(d) ? d : [d];
            const currentGroup = groupList.find((g: Record<string, any>) => Number(g.id) === Number((data as Record<string, any>).default_bw_group.id));
            if (currentGroup?.temp_bw_expire_time) {
              setBwTempExpireTimeDisplay(String(currentGroup.temp_bw_expire_time));
              setBwTempMode(true);
            } else {
              setBwTempExpireTimeDisplay('');
              setBwTempMode(false);
            }
          }
        }).catch(() => {});
      }
      // 保存kvmid（用于监控API）
      const kid = (data as Record<string, any>)?.kvmid || '';
      if (kid) setKvmid(String(kid));
      // 提取磁盘信息
      const diskArr = (data as Record<string, any>)?.disk;
      if (Array.isArray(diskArr)) setDisks(diskArr);
      // 提取IP信息
      const ipArr = (data as Record<string, any>)?.ip;
      if (Array.isArray(ipArr)) setIpv4List(ipArr);
      // 初始化配置表单（memory API返回GB，保持原值；带宽从default_bw_group获取）
      setConfigForm({
        cpu: (data as Record<string, any>)?.cpu || 0,
        memory: Math.round(((data as Record<string, any>)?.memory || 0)),
        in_bw: (data as Record<string, any>)?.default_bw_group?.in_bw || (data as Record<string, any>)?.in_bw || 0,
        out_bw: (data as Record<string, any>)?.default_bw_group?.out_bw || (data as Record<string, any>)?.out_bw || 0,
      });
      return data;
    }
    return null;
  }, [callMfyApi]);

  // 获取云实例状态
  const fetchCloudStatus = useCallback(async (cid: number) => {
    const res = await callMfyApi('cloudStatus', { id: cid });
    if (res.success && res.data) {
      const data = (res.data as Record<string, unknown>).data || res.data;
      setCloudStatus(data as Record<string, any>);
    }
  }, [callMfyApi]);

  // 用ref保存函数引用，避免fetchMfyTaskAndLog闭包陷阱
  const fetchCloudDetailRef = useRef(fetchCloudDetail);
  fetchCloudDetailRef.current = fetchCloudDetail;
  const fetchCloudStatusRef = useRef(fetchCloudStatus);
  fetchCloudStatusRef.current = fetchCloudStatus;

  // 电源操作后自动轮询状态直到稳定（最多12次，每次5秒，总计约60秒）
  useEffect(() => {
    const status = cloudStatus?.status || cloudDetail?.status;
    if (!cloudId || !status) return;
    // 操作中的状态需要轮询
    const operatingStatuses = ['process', 'operating', 'task'];
    if (!operatingStatuses.includes(status)) return;
    let count = 0;
    const maxCount = 12;
    const timer = setInterval(() => {
      count++;
      if (count > maxCount) { clearInterval(timer); return; }
      fetchCloudStatus(cloudId);
      fetchCloudDetail(cloudId);
    }, 5000);
    return () => clearInterval(timer);
  }, [cloudId, cloudStatus?.status, cloudDetail?.status, fetchCloudStatus, fetchCloudDetail]);

  // 异步获取实时数据（CPU/内存/带宽/磁盘IO）
  useEffect(() => {
    if (!cloudId) return;
    setRealDataLoading(true);
    callMfyApi('realDataList', { ids: [cloudId] }).then(res => {
      if (res.success && res.data) {
        const realList: unknown[] = Array.isArray(res.data) ? res.data : (Array.isArray((res.data as Record<string, unknown>).data) ? (res.data as Record<string, unknown>).data as unknown[] : []);
        if (realList.length > 0) {
          setRealData(realList[0] as Record<string, any>);
        }
      }
    }).catch(() => { /* 实时数据获取失败不影响页面 */ }).finally(() => setRealDataLoading(false));
  }, [cloudId, callMfyApi]);

  // 获取IPv6信息
  const fetchIpv6 = useCallback(async (cid: number) => {
    const res = await callMfyApi('cloudIpv6', { id: cid });
    if (res.success && res.data) {
      const data = (res.data as Record<string, unknown>).data || res.data;
      if (Array.isArray(data)) setIpv6List(data);
      else if ((data as Record<string, any>)?.list) setIpv6List((data as Record<string, any>).list);
    }
  }, [callMfyApi]);

  // 获取流量数据（使用 flow + flow_data API）
  const fetchTraffic = useCallback(async (cid: number) => {
    setTrafficLoading(true);
    setTrafficError('');
    setTrafficData(null);
    try {
      const resetDay = cloudDetail?.reset_flow_day || 1;
      const now = new Date();
      const nowMs = now.getTime();

      // 时间范围（毫秒时间戳，flow_data API需要毫秒）
      const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const weekAgoMs = nowMs - 7 * 24 * 3600 * 1000;
      let monthStartMs: number;
      if (now.getDate() >= resetDay) {
        monthStartMs = new Date(now.getFullYear(), now.getMonth(), resetDay).getTime();
      } else {
        monthStartMs = new Date(now.getFullYear(), now.getMonth() - 1, resetDay).getTime();
      }
      const thirtyDaysAgoMs = nowMs - 30 * 24 * 3600 * 1000;

      // 并行获取：总流量 + 4个时间段的flow_data
      const [flowRes, todayFlowRes, weekFlowRes, monthFlowRes, cycleFlowRes] = await Promise.all([
        callMfyApi('cloudTraffic', { id: cid }),
        callMfyApi('cloudFlowData', { id: cid, start_time: todayStartMs, end_time: nowMs }),
        callMfyApi('cloudFlowData', { id: cid, start_time: weekAgoMs, end_time: nowMs }),
        callMfyApi('cloudFlowData', { id: cid, start_time: monthStartMs, end_time: nowMs }),
        callMfyApi('cloudFlowData', { id: cid, start_time: thirtyDaysAgoMs, end_time: nowMs }),
      ]);

      const periods: Record<string, { gb_flow: number; flow: number; in_gb: number; out_gb: number }> = {};

      // B → GB 转换
      const bToGb = (b: number) => b / (1024 * 1024 * 1024);

      // 从flow_data累加in/out
      const sumFlowData = (res: Record<string, unknown>): { inBytes: number; outBytes: number } => {
        if (!res.success || !res.data) return { inBytes: 0, outBytes: 0 };
        const d = (res.data as Record<string, unknown>).data || res.data;
        if (!Array.isArray(d)) return { inBytes: 0, outBytes: 0 };
        let inBytes = 0, outBytes = 0;
        for (const item of d) {
          const row = item as Record<string, any>;
          inBytes += Number(row.in || 0);
          outBytes += Number(row.out || 0);
        }
        return { inBytes, outBytes };
      };

      // 今日
      const todayFlow = sumFlowData(todayFlowRes);
      periods.today = {
        gb_flow: bToGb(todayFlow.inBytes + todayFlow.outBytes),
        flow: todayFlow.inBytes + todayFlow.outBytes,
        in_gb: bToGb(todayFlow.inBytes),
        out_gb: bToGb(todayFlow.outBytes),
      };

      // 最近7天
      const weekFlow = sumFlowData(weekFlowRes);
      periods.week = {
        gb_flow: bToGb(weekFlow.inBytes + weekFlow.outBytes),
        flow: weekFlow.inBytes + weekFlow.outBytes,
        in_gb: bToGb(weekFlow.inBytes),
        out_gb: bToGb(weekFlow.outBytes),
      };

      // 本月（重置周期）
      const monthFlow = sumFlowData(monthFlowRes);
      periods.month = {
        gb_flow: bToGb(monthFlow.inBytes + monthFlow.outBytes),
        flow: monthFlow.inBytes + monthFlow.outBytes,
        in_gb: bToGb(monthFlow.inBytes),
        out_gb: bToGb(monthFlow.outBytes),
      };

      // 30天
      const cycleFlow = sumFlowData(cycleFlowRes);
      periods.cycle = {
        gb_flow: bToGb(cycleFlow.inBytes + cycleFlow.outBytes),
        flow: cycleFlow.inBytes + cycleFlow.outBytes,
        in_gb: bToGb(cycleFlow.inBytes),
        out_gb: bToGb(cycleFlow.outBytes),
      };

      setTrafficPeriods(periods);

      // 总流量（flow API返回的gb_flow更准确）
      const totalUsedGb = flowRes.success && flowRes.data
        ? Number((flowRes.data as Record<string, any>).gb_flow || periods.month.gb_flow)
        : periods.month.gb_flow;

      const trafficQuota = Number(cloudDetail?.traffic_quota || 0);
      const trafficType = Number(cloudDetail?.traffic_type || 3);
      const leaveGb = Math.max(0, trafficQuota - totalUsedGb);

      // 月度趋势图表数据
      let flowDataArr: Array<Record<string, any>> = [];
      if (monthFlowRes.success && monthFlowRes.data) {
        const fd = (monthFlowRes.data as Record<string, unknown>).data || monthFlowRes.data;
        if (Array.isArray(fd)) flowDataArr = fd;
      }

      setTrafficData({
        used_traffic: totalUsedGb * 1024 * 1024 * 1024,
        total_traffic: trafficQuota * 1024 * 1024 * 1024,
        leave_traffic: leaveGb * 1024 * 1024 * 1024,
        used_gb: totalUsedGb,
        total_gb: trafficQuota,
        leave_gb: leaveGb,
        gb_flow: totalUsedGb,
        flow: periods.month.flow,
        reset_flow_day: resetDay,
        traffic_start_time: cloudDetail?.traffic_start_time || '',
        in_traffic_gb: periods.month.in_gb,
        out_traffic_gb: periods.month.out_gb,
        flow_data: flowDataArr,
        traffic_type: trafficType,
      });
    } catch (err) {
      setTrafficError(err instanceof Error ? err.message : '获取流量数据异常');
    } finally {
      setTrafficLoading(false);
    }
  }, [callMfyApi, cloudDetail]);

  // 获取监控数据（带缓存和加载状态）
  const fetchMonitor = useCallback(async (type?: string, range?: string, customSt?: number, customEt?: number) => {
    if (!kvmid) return;
    const now = Date.now();
    const monitorTypeVal = type || monitorType;
    const monitorRangeVal = range || monitorRange;
    const rangeMs: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    // 自定义时间范围优先
    let st: number;
    let et: number;
    if (customSt && customEt) {
      st = customSt;
      et = customEt;
    } else if (monitorRangeVal === 'all') {
      st = 0;
      et = now;
    } else {
      st = now - (rangeMs[monitorRangeVal] || 86400000);
      et = now;
    }
    // 前端类型映射到魔方云API类型：cpu和memory都请求kvm_info
    const apiTypeMap: Record<string, string> = {
      cpu: 'kvm_info', memory: 'kvm_info',
      net_adapter: 'net_adapter', disk_io: 'disk_io', disk_iops: 'disk_iops', pps: 'pps',
    };
    const apiType = apiTypeMap[monitorTypeVal] || monitorTypeVal;
    // 网卡类型：确定 kvm_ifname（默认取第一块网卡，即索引0）
    const nicIfname = (() => {
      if (monitorTypeVal !== 'net_adapter' && monitorTypeVal !== 'pps') return '';
      const nicIdx = monitorNic !== '' ? monitorNic : '0';
      return `${kvmid}.${nicIdx}`;
    })();
    // 磁盘类型：确定 dev_name（默认取系统盘，找不到则取第一块）
    const diskDevName = (() => {
      if (monitorTypeVal !== 'disk_io' && monitorTypeVal !== 'disk_iops') return '';
      if (monitorDisk !== '') return monitorDisk;
      if (disks.length > 0) {
        const sysDisk = disks.find(d => d.type === 'system' || d.disk_type === 'system');
        const target = sysDisk || disks[0];
        return target?.dev ? String(target.dev) : '';
      }
      return '';
    })();
    // 缓存key：类型+范围+时间窗口+实际传的网卡/磁盘参数（5分钟粒度）
    const cacheKey = `${apiType}_${monitorRangeVal}_${nicIfname || monitorNic}_${diskDevName || monitorDisk}_${Math.floor(st / 300000)}_${Math.floor(et / 300000)}`;
    const cached = monitorCacheRef.current[cacheKey];
    if (cached && (now - cached.ts) < 120000) { // 2分钟缓存
      setMonitorData(cached.data);
      return;
    }
    setMonitorLoading(true);
    const res = await callMfyApi('statistics', {
      kvm: kvmid,
      type: apiType,
      st,
      et,
      all_point: 1,
      point_interval: 1,
      ...(nicIfname ? { kvm_ifname: nicIfname } : {}),
      ...(diskDevName ? { dev_name: diskDevName } : {}),
    });
    if (res.success) {
      const mData = (res.data as Record<string, any>) || {};
      setMonitorData(mData);
      monitorCacheRef.current[cacheKey] = { data: mData, ts: now };
      // 从返回数据中提取时间范围
      const data = (res.data as Record<string, any>) || {};
      const chartArr = data?.data || data;
      if (Array.isArray(chartArr) && chartArr.length > 0) {
        const firstTs = chartArr[0]?.[0] || 0;
        const lastTs = chartArr[chartArr.length - 1]?.[0] || 0;
        if (firstTs > 0) {
          setFullDataTimeStart(prev => prev <= 0 ? firstTs : Math.min(prev, firstTs));
          setFullDataTimeEnd(prev => prev <= 0 ? lastTs : Math.max(prev, lastTs));
        }
      }
      // 非自定义时间范围时也设置可用范围
      if (monitorRangeVal !== 'custom' && st > 0) {
        setFullDataTimeStart(prev => prev <= 0 ? st : Math.min(prev, st));
        setFullDataTimeEnd(prev => prev <= 0 ? et : Math.max(prev, et));
      }
    }
    setMonitorLoading(false);
  }, [callMfyApi, kvmid, monitorType, monitorRange, monitorNic, monitorDisk, disks]);

  // disks 加载后，如果当前是磁盘监控类型且 monitorDisk 为空，重新请求以确保 dev_name 正确
  const prevDisksLenRef = useRef(0);
  useEffect(() => {
    if (disks.length > 0 && prevDisksLenRef.current === 0 && (monitorType === 'disk_io' || monitorType === 'disk_iops') && monitorDisk === '') {
      fetchMonitor();
    }
    prevDisksLenRef.current = disks.length;
  }, [disks, monitorType, monitorDisk, fetchMonitor]);

  // 稳定的监控数据时间范围回调（避免内联函数导致MonitorChart级联重渲染）
  const handleMonitorDataTimeRange = useCallback((start: number, end: number) => {
    setDataTimeStart(prev => prev === start ? prev : start);
    setDataTimeEnd(prev => prev === end ? prev : end);
    setFullDataTimeStart(prev => prev <= 0 ? start : Math.min(prev, start));
    setFullDataTimeEnd(prev => prev <= 0 ? end : Math.max(prev, end));
  }, []);

  // 获取镜像列表
  const fetchImages = useCallback(async () => {
    // 获取镜像分组
    const groupRes = await callMfyApi('imageGroupList', { per_page: 100 });
    if (groupRes.success && groupRes.data) {
      const data = (groupRes.data as Record<string, unknown>).data || groupRes.data;
      if (Array.isArray(data)) setImageGroups(data);
    }
    // 获取新镜像列表，传入area_id过滤当前节点已下载的镜像
    const params: Record<string, unknown> = { per_page: 200, status: 1 };
    if (cloudDetail?.area_id) params.area_id = cloudDetail.area_id;
    if (cloudDetail?.node_name) params.node_name = cloudDetail.node_name;
    const imgRes = await callMfyApi('imageNewList', params);
    if (imgRes.success && imgRes.data) {
      const data = (imgRes.data as Record<string, unknown>).data || imgRes.data;
      if (Array.isArray(data)) {
        // 过滤：只显示当前区域已下载的镜像（area中download_level为all或part）
        const currentAreaId = cloudDetail?.area_id;
        const filtered = data.filter((img: Record<string, any>) => {
          if (!currentAreaId || !img.area || !Array.isArray(img.area)) return true;
          return img.area.some((a: Record<string, any>) =>
            Number(a.id) === Number(currentAreaId) && (a.download_level === 'all' || a.download_level === 'part')
          );
        });
        setImageList(filtered);
        // 自动选中当前镜像
        const currentImageId = cloudDetail?.image_id || cloudDetail?.os_image_id || cloudDetail?.os || cloudDetail?.image;
        if (currentImageId) {
          const currentImg = filtered.find((img: Record<string, any>) => Number(img.id) === Number(currentImageId));
          if (currentImg) {
            setReinstallForm(prev => ({
              ...prev,
              image_id: Number(currentImg.id),
              image_group: currentImg.image_group_id || currentImg.group?.id || 0,
            }));
          }
        }
      }
    }
  }, [callMfyApi, cloudDetail]);

  // 获取安全组列表
  const fetchSecurityGroups = useCallback(async () => {
    const res = await callMfyApi('securityGroupList', {
      list_type: 'all',
      per_page: 100,
      type: cloudDetail?.type || 'host',
      user: cloudDetail?.user_id || undefined,  // 只获取当前用户的安全组
    });
    if (res.success && res.data) {
      const data = (res.data as Record<string, unknown>).data || res.data;
      if (Array.isArray(data)) setSecurityGroups(data);
    }
  }, [callMfyApi, cloudDetail]);

  // 获取当前安全组详情和规则
  const fetchSecurityDetail = useCallback(async (groupId: number) => {
    setSecurityLoading(true);
    try {
      const [detailRes, rulesRes] = await Promise.all([
        callMfyApi('securityGroupDetail', { id: groupId, get_all_rule: 1 }),
        callMfyApi('securityGroupRules', { id: groupId, per_page: 100 }),
      ]);
      if (detailRes.success && detailRes.data) {
        const d = (detailRes.data as Record<string, unknown>).data || detailRes.data;
        setCurrentSecurityGroup(d as Record<string, any>);
      }
      if (rulesRes.success && rulesRes.data) {
        const d = (rulesRes.data as Record<string, unknown>).data || rulesRes.data;
        if (Array.isArray(d)) setSecurityRules(d);
      }
    } finally {
      setSecurityLoading(false);
    }
  }, [callMfyApi]);

  // 绑定安全组
  const handleBindSecurityGroup = async (groupId: number) => {
    if (!cloudId) return;
    setActionLoading('securityBind');
    setMsg({ type: 'info', text: '正在绑定安全组...' });
    try {
      const res = await callMfyApi('securityGroupLink', { id: groupId, cloud: [cloudId], type: 1 });
      if (res.success) {
        setMsg({ type: 'success', text: '安全组绑定成功' });
        setShowSecurityGroupDialog(false);
        fetchCloudDetail(cloudId);
      } else {
        setMsg({ type: 'error', text: `绑定失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `绑定异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 解绑安全组
  const handleUnbindSecurityGroup = async () => {
    if (!cloudId) return;
    setActionLoading('securityUnbind');
    setMsg({ type: 'info', text: '正在解绑安全组...' });
    try {
      const res = await callMfyApi('securityGroupUnlink', { id: cloudId });
      if (res.success) {
        setMsg({ type: 'success', text: '安全组已解绑' });
        fetchCloudDetail(cloudId);
        setCurrentSecurityGroup(null);
        setSecurityRules([]);
      } else {
        setMsg({ type: 'error', text: `解绑失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `解绑异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 添加安全组规则
  const handleAddSecurityRule = async () => {
    if (!cloudId || !currentSecurityGroup) return;
    setActionLoading('securityRuleAdd');
    setMsg({ type: 'info', text: '正在添加规则...' });
    try {
      const res = await callMfyApi('securityGroupRuleCreate', {
        id: currentSecurityGroup.id,
        ...securityRuleForm,
      });
      if (res.success) {
        setMsg({ type: 'success', text: '规则添加成功' });
        setShowSecurityRuleDialog(false);
        fetchSecurityDetail(currentSecurityGroup.id);
      } else {
        setMsg({ type: 'error', text: `添加失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `添加异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 删除安全组规则
  const handleDeleteSecurityRule = async (ruleId: number) => {
    if (!currentSecurityGroup) return;
    setActionLoading(`securityRuleDelete_${ruleId}`);
    setMsg({ type: 'info', text: '正在删除规则...' });
    try {
      const res = await callMfyApi('securityGroupRuleDelete', { ruleId });
      if (res.success) {
        setMsg({ type: 'success', text: '规则删除成功' });
        fetchSecurityDetail(currentSecurityGroup.id);
      } else {
        setMsg({ type: 'error', text: `删除失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `删除异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 获取VPC网络列表
  const fetchVpcNetworks = useCallback(async () => {
    const res = await callMfyApi('vpcNetworkList', {
      user: cloudDetail?.user_id || undefined,
      node_id: cloudDetail?.node_id || undefined,
    });
    if (res.success && res.data) {
      const data = (res.data as Record<string, unknown>).data || res.data;
      if (Array.isArray(data)) setVpcNetworks(data);
    }
  }, [callMfyApi, cloudDetail]);

  // 切换网络模式
  const handleSwitchNetwork = async () => {
    if (!cloudId) return;
    setActionLoading('networkSwitch');
    setMsg({ type: 'info', text: '正在切换网络模式...' });
    try {
      const params: Record<string, unknown> = { id: cloudId };
      if (networkSwitchTarget === 'vpc') {
        if (selectedVpcId > 0) {
          params.vpc = selectedVpcId;
        } else if (vpcIpSegment) {
          params.vpc_ips = vpcIpSegment;
        }
      }
      // 切到经典网络不传vpc和vpc_ips
      const res = await callMfyApi('cloudNetworkType', params);
      if (res.success) {
        setMsg({ type: 'success', text: '网络模式切换请求已发送' });
        setShowNetworkSwitchDialog(false);
        fetchCloudDetail(cloudId);
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `切换失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      setMsg({ type: 'error', text: `切换异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 获取可用IP池
  const fetchFreeIps = useCallback(async () => {
    if (!cloudId) return;
    setFreeIpLoading(true);
    try {
      const res = await callMfyApi('ipFreeList', { hostid: cloudId });
      if (res.success && res.data) {
        const data = (res.data as Record<string, unknown>).data || res.data;
        if (Array.isArray(data)) {
          setFreeIpList(data);
          // 默认展开第一个IP段
          if (data.length > 0 && data[0].id) {
            setExpandedIpSegments(new Set([data[0].id]));
          }
        }
      }
    } finally {
      setFreeIpLoading(false);
    }
  }, [callMfyApi, cloudId]);

  // hostid变化时重新加载（全局搜索选择新主机时URL参数变化）
  const prevHostidRef = useRef('');
  useEffect(() => {
    if (!hostid || hostid === prevHostidRef.current) return;
    prevHostidRef.current = hostid;
    // 重置状态
    setCloudId(null);
    cloudIdRef.current = null;
    setCloudDetail(null);
    setCloudStatus(null);
    setMsg(null);
    // 重置已处理任务ID集合，避免切换主机后旧任务的ID影响
    handledTaskIds.current.clear();
    initialTaskLoadDone.current = false;
    (async () => {
      setIsLoading(true);
      try {
        const directId = /^\d+$/.test(hostid) ? Number(hostid) : 0;
        let cid: number | null = null;
        if (directId > 0 && !uidParam) {
          // 从实例列表跳转：hostid是MFY cloudId
          cid = directId;
        } else {
          // 从产品管理跳转：hostid是财务系统hostid
          setIdcHostid(Number(hostid));
          idcHostidRef.current = Number(hostid);
          cid = await fetchCloudId();
        }
        if (cid) {
          setCloudId(cid);
          cloudIdRef.current = cid;
          await fetchCloudDetail(cid);
          await fetchCloudStatus(cid);
          fetchMfyTaskAndLog(cid);
          // 异步反查财务系统hostid（从实例列表跳转时没有uidParam）
          if (!idcHostidRef.current) {
            resolveIdcHostid(cid);
          }
        } else {
          setMsg({ type: 'error', text: '未找到实例ID，该产品可能未对接云平台' });
        }
      } catch (err) {
        setMsg({ type: 'error', text: `初始化失败: ${err instanceof Error ? err.message : String(err)}` });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [hostid, uidParam, fetchCloudId, fetchCloudDetail, fetchCloudStatus, fetchMfyTaskAndLog]);

  // Tab切换时加载对应数据
  useEffect(() => {
    if (!cloudId) return;
    switch (activeTab) {
      case 'ip':
        break;
      case 'security':
        if (cloudDetail?.security) fetchSecurityDetail(Number(cloudDetail.security));
        break;
      case 'traffic':
        fetchTraffic(cloudId);
        break;
      case 'monitor':
        fetchMonitor();
        break;
      case 'vnc':
      case 'config':
        fetchImages();
        break;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, cloudId, kvmid, monitorType, monitorRange, monitorNic, monitorDisk]);

  // 执行电源操作
  const executePowerAction = async (action: string, name: string) => {
    if (!cloudId) return;
    // 一键重建：使用 PUT clouds/:id/rebuild API
    if (action === 'cloudRebuild') {
      setActionLoading('cloudRebuild');
      setMsg({ type: 'info', text: '正在一键重建...' });
      try {
        const res = await callMfyApi('cloudRebuild', { id: cloudId });
        if (res.success) {
          setMsg({ type: 'success', text: '一键重建请求已发送' });
          pendingProvisionSync.current = true;
          setTimeout(() => { fetchCloudStatus(cloudId); fetchCloudDetail(cloudId); fetchMfyTaskAndLog(cloudId); }, 3000);
        } else {
          setMsg({ type: 'error', text: `一键重建失败: ${res.msg || '未知错误'}` });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setMsg({ type: 'error', text: `一键重建异常: ${errMsg}` });
      } finally {
        setActionLoading(null);
      }
      return;
    }
    setActionLoading(action);
    setMsg({ type: 'info', text: `正在${name}...` });
    try {
      const res = await callMfyApi(action, { id: cloudId });
      if (res.success) {
        setMsg({ type: 'success', text: `${name}成功` });
        setTimeout(() => { fetchCloudStatus(cloudId); fetchCloudDetail(cloudId); fetchMfyTaskAndLog(cloudId); }, 3000);
      } else {
        setMsg({ type: 'error', text: `${name}失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `${name}异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // VNC - 通过后端API获取VNC页面URL并新窗口打开
  const handleVnc = async () => {
    if (!cloudId) return;
    setActionLoading('cloudVnc');
    setMsg({ type: 'info', text: '正在获取VNC控制台...' });
    try {
      const resp = await fetch('/api/vnc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostid: cloudId, _loginUser: getLoginUser() }),
      });
      const res = await resp.json();
      if (res.success && (res.url || res.vnc_url || res.console_url)) {
        const vncPageUrl = res.url || res.vnc_url || res.console_url;
        window.open(vncPageUrl, '_blank');
        setMsg({ type: 'success', text: 'VNC控制台已在新窗口打开' });
      } else {
        setMsg({ type: 'error', text: `获取VNC失败: ${res.message || res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `VNC异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 重装系统
  const handleReinstall = async () => {
    if (!cloudId || !reinstallForm.image_id) return;
    setActionLoading('cloudReinstall');
    setMsg({ type: 'info', text: '正在重装系统...' });
    try {
      const params: Record<string, unknown> = {
        id: cloudId,
        os: reinstallForm.image_id,
        password: reinstallForm.password || undefined,
        port: reinstallForm.port || undefined,
        format_data_disk: reinstallForm.format_data_disk ? 1 : 0,
      };
      // 系统盘大小处理：开关打开时传入，关闭时不传（不修改磁盘大小）
      if (reinstallDiskSize && reinstallForm.custom_disk_size > 0) {
        const diskSize = reinstallForm.custom_disk_size;
        const selectedImage = imageList.find((img: Record<string, any>) => Number(img.id) === Number(reinstallForm.image_id));
        const isWindows = /windows|win/i.test(selectedImage?.name || selectedImage?.filename || '');
        if (isWindows) {
          params.system_disk_size = [diskSize, diskSize];
        } else {
          params.system_disk_size = diskSize;
        }
      }
      const res = await callMfyApi('cloudReinstall', params);
      if (res.success) {
        setMsg({ type: 'success', text: '重装系统请求已发送' });
        setShowReinstallDialog(false);
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `重装失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `重装异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 重置密码
  const handleResetPassword = async () => {
    if (!cloudId || !resetPwdValue.trim()) return;
    setActionLoading('cloudResetPassword');
    setMsg({ type: 'info', text: '正在重置密码...' });
    try {
      const res = await callMfyApi('cloudResetPassword', { id: cloudId, password: resetPwdValue.trim() });
      if (res.success) {
        setMsg({ type: 'success', text: '密码重置成功' });
        setShowResetPwdDialog(false);
        setResetPwdValue('');
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `重置失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `重置异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 保存配置修改
  const handleSaveConfig = async () => {
    if (!cloudId) return;
    setConfigSaving(true);
    setMsg({ type: 'info', text: '正在保存配置...' });
    try {
      // memory在前端以GB显示，提交时需转为MB（API要求MB单位，最小128MB）
      const submitData = { ...configForm, memory: Math.max(128, Math.round(configForm.memory * 1024)) };
      const res = await callMfyApi('cloudUpdate', { id: cloudId, ...submitData });
      if (res.success) {
        setMsg({ type: 'success', text: '配置修改成功' });
        fetchCloudDetail(cloudId);
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `配置修改失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `配置修改异常: ${errMsg}` });
    } finally {
      setConfigSaving(false);
    }
  };

  // 修改带宽
  const handleSaveBw = async () => {
    if (!cloudId) return;
    setConfigSaving(true);
    setMsg({ type: 'info', text: '正在修改带宽...' });
    try {
      const params: Record<string, unknown> = {
        id: cloudId,
        in_bw: configForm.in_bw || 0,
        out_bw: configForm.out_bw || 0,
      };
      if (bwTempMode && bwTempExpireTime) {
        // 临时修改：传入失效时间，格式 Y-m-d H:i:s
        const d = new Date(bwTempExpireTime);
        const pad = (n: number) => n.toString().padStart(2, '0');
        params.temp_bw_expire_time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      }
      const res = await callMfyApi('cloudUpdateBw', params);
      if (res.success) {
        setMsg({ type: 'success', text: bwTempMode ? '临时带宽修改成功' : '带宽修改成功' });
        fetchCloudDetail(cloudId);
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `带宽修改失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `带宽修改异常: ${errMsg}` });
    } finally {
      setConfigSaving(false);
    }
  };

  // 添加IP（使用POST clouds/:id/floatip指定IP ID添加）
  const handleAddIp = async () => {
    if (!cloudId || selectedFreeIps.size === 0) return;
    setActionLoading('cloudAddFloatIp');
    setMsg({ type: 'info', text: `正在添加${selectedFreeIps.size}个IP...` });
    try {
      // POST clouds/:id/floatip：传入IP ID数组 + 限速组参数
      const ipIds = Array.from(selectedFreeIps);
      const params: Record<string, unknown> = {
        id: cloudId,
        ip: ipIds,
        ip_type: 'normal',
      };
      // 如果有当前限速组，加入已有组；否则创建新组
      if (cloudDetail?.default_bw_group?.id) {
        params.bw_group = cloudDetail.default_bw_group.id;
      } else {
        // 创建新限速组，使用当前带宽配置
        params.in_bw = cloudDetail?.in_bw || 0;
        params.out_bw = cloudDetail?.out_bw || 0;
      }
      const res = await callMfyApi('cloudAddFloatIp', params);
      if (res.success) {
        setMsg({ type: 'success', text: `成功添加${selectedFreeIps.size}个IP` });
        setShowAddIpDialog(false);
        setSelectedFreeIps(new Set());
        fetchCloudDetail(cloudId);
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `添加IP失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `添加IP异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 批量删除选中IP
  const handleDeleteSelectedIps = async () => {
    if (!cloudId || selectedIps.size === 0) return;
    setActionLoading('cloudIpDelete');
    setMsg({ type: 'info', text: `正在删除${selectedIps.size}个IP...` });
    try {
      // 使用IP ID删除（type=id是默认值，更可靠）
      const ipIds = Array.from(selectedIps).map(i => ipv4List[i]?.id).filter((id): id is number => typeof id === 'number' && id > 0);
      if (ipIds.length === 0) {
        setMsg({ type: 'error', text: '未找到有效的IP ID' });
        return;
      }
      const res = await callMfyApi('cloudIpDelete', { id: cloudId, ip: ipIds, type: 'id' });
      if (res.success) {
        setMsg({ type: 'success', text: `成功删除${ipIds.length}个IP` });
        setSelectedIps(new Set());
        fetchCloudDetail(cloudId);
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `删除IP失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `删除IP异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 随机密码生成
  const generateRandomPassword = (): string => {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const digits = '0123456789';
    const all = upper + lower + digits;
    const arr = [
      upper[Math.floor(Math.random() * upper.length)],
      lower[Math.floor(Math.random() * lower.length)],
      digits[Math.floor(Math.random() * digits.length)],
    ];
    for (let i = 3; i < 12; i++) {
      arr.push(all[Math.floor(Math.random() * all.length)]);
    }
    // Fisher-Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.join('');
  };

  // 获取磁盘存储列表（使用 disk_cleaner/stores API，过滤当前节点）
  const fetchDiskStores = useCallback(async () => {
    try {
      const res = await callMfyApi('diskStores', {});
      if (res.success && res.data) {
        let stores: unknown[] = [];
        const d = res.data;
        if (Array.isArray(d)) {
          stores = d;
        } else if (d && typeof d === 'object') {
          const obj = d as Record<string, unknown>;
          if (Array.isArray(obj.data)) stores = obj.data;
          else if (Array.isArray(obj.stores)) stores = obj.stores;
        }
        // 过滤当前节点的存储：用实例现有磁盘的store_id来确定当前节点可用的存储
        const instanceStoreIds = new Set<number>();
        if (cloudDetail?.disk && Array.isArray(cloudDetail.disk)) {
          cloudDetail.disk.forEach((d: Record<string, any>) => {
            if (d.store_id) instanceStoreIds.add(Number(d.store_id));
          });
        }
        if (instanceStoreIds.size > 0 && stores.length > 0) {
          // 只保留实例当前使用的存储（这些一定在当前节点上）
          stores = stores.filter((s: unknown) => {
            const store = s as Record<string, any>;
            return instanceStoreIds.has(Number(store.id));
          });
        }
        // 如果过滤后为空，尝试用node_id过滤
        if (stores.length === 0) {
          const currentNodeId = cloudDetail?.node_id;
          if (currentNodeId) {
            const allStores = (res.data as Record<string, unknown>)?.data
              ? (res.data as Record<string, unknown>).data as unknown[]
              : (Array.isArray(res.data) ? res.data : []);
            stores = allStores.filter((s: unknown) => {
              const store = s as Record<string, any>;
              return store.node_id === currentNodeId || store.node_id === Number(currentNodeId);
            });
          }
        }
        if (stores.length > 0) {
          setDiskStores(stores as Record<string, any>[]);
          const firstId = (stores[0] as Record<string, any>)?.id;
          if (firstId) {
            setAddDiskForm(prev => ({ ...prev, store: Number(firstId) }));
          }
        }
      }
    } catch { /* ignore */ }
  }, [callMfyApi, cloudDetail]);

  // 添加磁盘
  const handleAddDisk = async () => {
    if (!cloudId || addDiskForm.size < 1) return;
    if (!addDiskForm.store) {
      setMsg({ type: 'error', text: '请选择存储' });
      return;
    }
    setActionLoading('diskCreate');
    setMsg({ type: 'info', text: `正在添加${addDiskForm.size}G磁盘...` });
    try {
      const res = await callMfyApi('diskCreate', {
        id: cloudId,
        size: addDiskForm.size,
        store: addDiskForm.store,
        driver: addDiskForm.driver || undefined,
      });
      if (res.success) {
        setMsg({ type: 'success', text: '磁盘添加成功' });
        setShowAddDiskDialog(false);
        fetchCloudDetail(cloudId);
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `添加磁盘失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `添加磁盘异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 修改磁盘大小
  const handleResizeDisk = async (diskId: number, newSize: number) => {
    if (!cloudId) return;
    setActionLoading(`diskResize_${diskId}`);
    setMsg({ type: 'info', text: '正在修改磁盘大小...' });
    try {
      const res = await callMfyApi('diskUpdate', { diskId, size: newSize });
      if (res.success) {
        setMsg({ type: 'success', text: '磁盘大小修改成功' });
        fetchCloudDetail(cloudId);
        pendingProvisionSync.current = true;
        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
      } else {
        setMsg({ type: 'error', text: `修改失败: ${res.msg || '未知错误'}` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setMsg({ type: 'error', text: `修改异常: ${errMsg}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 格式化字节
  const formatBytes = (bytes: number | string): string => {
    const b = typeof bytes === 'string' ? Number(bytes) : bytes;
    if (isNaN(b) || b === 0) return '0 B';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    if (b < 1024 * 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
    return `${(b / 1024 / 1024 / 1024 / 1024).toFixed(1)} TB`;
  };

  // 格式化带宽(Mbps)
  const formatBw = (bw: number | string): string => {
    const b = typeof bw === 'string' ? Number(bw) : bw;
    if (isNaN(b) || b === 0) return '0 Mbps';
    return `${b} Mbps`;
  };

  // 格式化时间戳（支持秒级/毫秒级时间戳及日期字符串）
  const formatTime = (t: number | string): string => {
    if (!t) return '-';
    let d: Date;
    if (typeof t === 'number') {
      d = new Date(t > 1e12 ? t : t * 1000);
    } else {
      d = new Date(t);
    }
    if (isNaN(d.getTime())) return String(t);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // 电源状态显示
  const getPowerLabel = (status: string | undefined): { label: string; color: string } => {
    if (!status) return { label: '未知', color: 'text-muted-foreground' };
    switch (status) {
      case 'on': case 'running': return { label: '运行中', color: 'text-success' };
      case 'off': case 'stopped': return { label: '已关机', color: 'text-destructive' };
      case 'process': case 'operating': case 'task': return { label: '操作中', color: 'text-warning' };
      case 'suspend': return { label: '已暂停', color: 'text-warning' };
      default: return { label: status, color: 'text-muted-foreground' };
    }
  };

  const powerInfo = getPowerLabel(cloudStatus?.status || cloudDetail?.status);

  if (!hostid) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-warning" />
          <p>未指定产品ID</p>
          <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* 顶部导航 */}
      <div className="sticky top-14 z-30 bg-background px-3 sm:px-4 py-2.5">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-semibold flex items-center gap-2 shrink-0 text-foreground">
            <Shield className="w-5 h-5 text-primary" />
            <span className="hidden sm:inline">实例管理</span>
          </h1>
          {/* 全局搜索 */}
          <div className="relative flex-1 max-w-md ml-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchKeyword}
                onChange={e => setSearchKeyword(e.target.value)}
                onFocus={() => setShowSearchDropdown(true)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && searchKeyword.trim()) {
                    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
                    doGlobalSearch(searchKeyword);
                    saveSearchHistory(searchKeyword.trim());
                    setShowSearchDropdown(true);
                  }
                }}
                placeholder="全局搜索（用户/实例）..."
                className="w-full pl-9 pr-8 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-primary" />}
              {searchKeyword && !searchLoading && (
                <button onClick={() => { setSearchKeyword(''); setSearchResults({ hosts: [], users: [] }); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {/* 搜索下拉结果 */}
            {showSearchDropdown && (
              <div ref={searchDropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
                {/* 搜索历史 */}
                {searchHistory.length > 0 && !searchKeyword && (
                  <div className="p-3 border-b border-border">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-muted-foreground">搜索历史</span>
                      <button onClick={() => { setSearchHistory([]); try { localStorage.removeItem('mfy_search_history'); } catch {} }} className="text-xs text-muted-foreground hover:text-muted-foreground">清空</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {searchHistory.map((h, i) => (
                        <button key={i} onClick={() => { setSearchKeyword(h); doGlobalSearch(h); saveSearchHistory(h); }} className="px-2.5 py-1 bg-muted hover:bg-accent rounded-md text-xs text-foreground transition-colors">{h}</button>
                      ))}
                    </div>
                  </div>
                )}
                {/* 搜索结果 - 产品 */}
                {searchResults.hosts.length > 0 && (
                  <div className="p-3 border-b border-border">
                    <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><Server className="w-3 h-3" />产品</div>
                    {searchResults.hosts.map((host, i) => (
                      <button key={i} onClick={() => { setShowSearchDropdown(false); router.push(`/advanced?hostid=${host.id}`); }} className="w-full flex items-center gap-3 px-2 py-2 hover:bg-accent rounded-lg transition-colors text-left">
                        <Server className="w-4 h-4 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground truncate">{host.hostname || '-'}</div>
                          <div className="text-xs text-muted-foreground truncate">{host.mainip || '-'} · {host.node_name || '-'}{host.username ? ` · ${host.username}` : ''}</div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">ID:{host.id}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 搜索结果 - 用户 */}
                {searchResults.users.length > 0 && (
                  <div className="p-3">
                    <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1"><User className="w-3 h-3" />用户</div>
                    {searchResults.users.map((user, i) => (
                      <button key={i} onClick={() => { setShowSearchDropdown(false); const kw = searchKeyword.trim(); router.push(`/user-instances?userId=${user.id}&q=${encodeURIComponent(kw)}`); }} className="w-full flex items-center gap-3 px-2 py-2 hover:bg-accent rounded-lg transition-colors text-left">
                        <User className="w-4 h-4 text-info shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-foreground truncate">{user.username || '-'}</div>
                          <div className="text-xs text-muted-foreground truncate">{user.email || '-'}</div>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">UID:{user.id}</span>
                      </button>
                    ))}
                  </div>
                )}
                {/* 无结果 */}
                {searchKeyword && !searchLoading && searchResults.hosts.length === 0 && searchResults.users.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground text-sm">未找到相关结果</div>
                )}
                {/* 提示 */}
                {!searchKeyword && searchHistory.length === 0 && (
                  <div className="p-6 text-center text-muted-foreground text-sm">输入关键字后按回车搜索</div>
                )}
              </div>
            )}
          </div>
          <button
            onClick={async () => {
              if (cloudId) {
                setIsLoading(true);
                try {
                  await Promise.all([fetchCloudDetail(cloudId), fetchCloudStatus(cloudId)]);
                } finally {
                  setIsLoading(false);
                }
              }
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent hover:bg-accent/70 rounded-lg text-sm transition-colors disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">刷新</span>
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 pb-8 sm:py-6 sm:pb-12 space-y-4 sm:space-y-6">
        {/* 提示消息 - 顶部悬浮自动消失 */}
        {msg && (
          <div className={`fixed top-10 sm:top-12 left-0 right-0 z-50 flex justify-center px-3 pt-2 animate-[slideDown_0.3s_ease-out]`}>
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border shadow-lg max-w-lg w-full ${
              msg.type === 'success' ? 'bg-success/15 border-success/30 text-success backdrop-blur-md' :
              msg.type === 'error' ? 'bg-destructive/15 border-destructive/30 text-destructive backdrop-blur-md' :
              'bg-info/15 border-info/30 text-info backdrop-blur-md'
            }`}>
              {msg.type === 'success' && <CheckCircle className="w-5 h-5 shrink-0" />}
              {msg.type === 'error' && <XCircle className="w-5 h-5 shrink-0" />}
              {msg.type === 'info' && <Loader2 className="w-5 h-5 shrink-0 animate-spin" />}
              <span className="flex-1 text-sm">{msg.text}</span>
              <button onClick={() => setMsg(null)} className="text-muted-foreground hover:text-foreground shrink-0"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {isLoading && !cloudDetail ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">加载实例信息...</span>
          </div>
        ) : !cloudId ? (
          <div className="text-center py-20 text-muted-foreground">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-warning" />
            <p>未找到实例ID</p>
            <p className="text-sm mt-2">该产品可能未对接云平台</p>
          </div>
        ) : (
          <>
            {/* ===== 实例信息卡片（独立于tab，始终显示） ===== */}
            {cloudDetail && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-3 sm:px-4 py-2 border-b border-border flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-sm sm:text-base flex items-center gap-2 shrink-0">
                    <Server className="w-4 h-4 text-primary" />
                    实例信息
                  </h3>
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap justify-end">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      powerInfo.color === 'text-success' ? 'bg-success/15 text-success border border-success/30' :
                      powerInfo.color === 'text-destructive' ? 'bg-destructive/15 text-destructive border border-destructive/30' :
                      'bg-warning/15 text-warning border border-warning/30'
                    }`}>
                      {powerInfo.label}
                    </span>
                    <button
                      onClick={handleVnc}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-primary hover:text-primary hover:bg-primary/10 transition-colors"
                      title="VNC连接"
                    >
                      <ScreenShare className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">VNC</span>
                    </button>
                    {!/win/i.test(cloudDetail.os_name || cloudDetail.image_name || cloudDetail.os || '') && (
                      <button
                        onClick={async () => {
                          const ip = cloudDetail.mainip || cloudDetail.ip?.[0]?.ip || '';
                          const uname = cloudDetail.osuser || cloudDetail.username || 'root';
                          const pwd = cloudDetail.rootpassword || cloudDetail.password || '';
                          if (!ip) { setMsg({ type: 'error', text: '未找到主IP地址' }); return; }
                          if (!pwd) { setMsg({ type: 'error', text: '未获取到服务器密码' }); return; }
                          setMsg({ type: 'info', text: '正在建立 SSH 连接...' });
                          try {
                            const { quickConnectToServer } = await import('@/lib/services/server-tools/quick-connect');
                            const connId = await quickConnectToServer({ host: ip, username: uname, password: pwd, name: ip });
                            if (connId) {
                              window.open(`/server-tools/${connId}`, '_blank');
                              setMsg({ type: 'success', text: 'SSH 连接已在新窗口打开' });
                            } else {
                              setMsg({ type: 'error', text: '创建 SSH 连接失败，请到服务器工具手动添加' });
                            }
                          } catch {
                            setMsg({ type: 'error', text: '远程连接失败' });
                          }
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-info hover:text-info hover:bg-info/10 transition-colors"
                        title="远程连接"
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">远程连接</span>
                      </button>
                    )}
                    {/win/i.test(cloudDetail.os_name || cloudDetail.image_name || cloudDetail.os || '') && (
                      <button
                        onClick={async () => {
                          try {
                            const loginUser = getLoginUser();
                            const resp = await fetch('/api/mfy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'downloadRdp', id: cloudId, _loginUser: loginUser }) });
                            if (!resp.ok) { setMsg({ type: 'error', text: 'RDP下载失败' }); return; }
                            const blob = await resp.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url; a.download = `${cloudDetail.hostname || cloudId}.rdp`;
                            document.body.appendChild(a); a.click();
                            document.body.removeChild(a); URL.revokeObjectURL(url);
                          } catch { setMsg({ type: 'error', text: 'RDP下载失败' }); }
                        }}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-info hover:text-info hover:bg-info/10 transition-colors"
                        title="下载RDP"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">下载RDP</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const mainIp = cloudDetail.mainip || cloudDetail.ip?.[0]?.ip || '-';
                        const username = cloudDetail.osuser || cloudDetail.username || '-';
                        const password = cloudDetail.rootpassword || cloudDetail.password || '-';
                        const text = `主机IP: ${mainIp}\n用户名: ${username}\n密码: ${password}`;
                        navigator.clipboard.writeText(text).then(() => {
                          setMsg({ type: 'success', text: '实例信息已复制' });
                        }).catch(() => {
                          setMsg({ type: 'error', text: '复制失败' });
                        });
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      title="复制实例信息"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">复制信息</span>
                    </button>
                  </div>
                </div>
                <div className="px-3 sm:px-4 py-2.5 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-2">
                  <InfoItem label="实例ID" value={String(cloudDetail.id || cloudId)} />
                  <InfoItem label="kvmID" value={kvmid || '-'} />
                  <InfoItem label="主机名" value={cloudDetail.hostname || '-'} />
                  <InfoItem label="节点" value={cloudDetail.node_name || cloudDetail.area || '-'} />
                  <InfoItem label="创建时间" value={cloudDetail.create_time ? formatTime(cloudDetail.create_time) : '-'} />
                  <InfoItem label="CPU" value={`${cloudDetail.cpu || 0}核`} />
                  <InfoItem label="内存" value={formatBytes((cloudDetail.memory || 0) * 1024 * 1024 * 1024)} />
                  <InfoItem label="带宽" value={formatBw(cloudDetail?.default_bw_group?.in_bw || cloudDetail?.in_bw || 0)} />
                  <InfoItem label="操作系统" value={(cloudDetail.os_name || cloudDetail.image_name || '-').replace(/\.qcow2$/i, '')} />
                  <InfoItem label="客户账号" value={cloudDetail.username || '-'} />
                </div>
                {/* 连接信息：电脑一排4列，手机一人一排 */}
                <div className="px-3 sm:px-4 py-2.5 border-t border-border/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1"><Globe className="w-3 h-3" />主IP</span>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate" title={cloudDetail.mainip || cloudDetail.ip?.[0]?.ip || '-'}>{cloudDetail.mainip || cloudDetail.ip?.[0]?.ip || '-'}</span>
                      <CopyButton value={cloudDetail.mainip || cloudDetail.ip?.[0]?.ip || ''} />
                      {(cloudDetail.mainip || cloudDetail.ip?.[0]?.ip) && (() => { const _ip = cloudDetail.mainip || cloudDetail.ip?.[0]?.ip; return _ip && _ip !== '-' ? <button onClick={() => handlePing('main', _ip)} className="text-muted-foreground hover:text-success transition-colors shrink-0" title="Ping" disabled={pingMap['main']?.loading}>{pingMap['main']?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}</button> : null; })()}
                      {pingMap['main']?.result && <span className={`text-[10px] font-mono shrink-0 ${pingMap['main'].result?.reachable ? 'text-success' : 'text-destructive'}`}>{pingMap['main'].result?.reachable ? `${pingMap['main'].result?.avgLatency}ms` : (pingMap['main'].result?.error || '超时')}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1"><Network className="w-3 h-3" />端口</span>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{cloudDetail.port || '-'}</span>
                      <CopyButton value={String(cloudDetail.port || '-')} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1"><User className="w-3 h-3" />用户名</span>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">{cloudDetail.osuser || cloudDetail.username || '-'}</span>
                      <CopyButton value={cloudDetail.osuser || cloudDetail.username || ''} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                      <KeyRound className="w-3 h-3" />
                      密码
                    </span>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-sm font-medium truncate" title={passwordVisible ? (cloudDetail.rootpassword || cloudDetail.password || '-') : undefined}>
                        {passwordVisible ? (cloudDetail.rootpassword || cloudDetail.password || '-') : '••••••••'}
                      </span>
                      <button onClick={() => setPasswordVisible(v => !v)} className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0" title={passwordVisible ? '隐藏密码' : '显示密码'}>
                        {passwordVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <CopyButton value={cloudDetail.rootpassword || cloudDetail.password || ''} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab导航 */}
            <div className="bg-card dark:bg-accent rounded-xl border border-border shadow-sm overflow-x-auto">
              <div className="flex p-1 gap-1 min-w-max">
                {TABS.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                        isActive ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ===== 概览 ===== */}
            {activeTab === 'overview' && cloudDetail && (
              <div className="space-y-4">
                {/* 实时状态 */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-3 sm:px-4 py-2.5 border-b border-border flex items-center gap-2">
                    <Activity className="w-4 h-4 text-success" />
                    <span className="font-semibold text-sm flex items-center gap-2">
                      实时状态
                      {realDataLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    </span>
                  </div>
                  {realDataLoading && !realData ? (
                    <div className="flex items-center justify-center py-6 gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">加载实时数据...</span>
                    </div>
                  ) : realData ? (
                    <div className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                      {/* CPU */}
                      <div className="bg-background rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" />CPU</span>
                          <span className={`text-sm font-semibold ${Number(realData.cpu_usage) > 80 ? 'text-destructive' : Number(realData.cpu_usage) > 50 ? 'text-warning' : 'text-success'}`}>
                            {Number(realData.cpu_usage).toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-accent overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${Number(realData.cpu_usage) > 80 ? 'bg-destructive' : Number(realData.cpu_usage) > 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, Number(realData.cpu_usage))}%` }} />
                        </div>
                      </div>
                      {/* 内存 */}
                      <div className="bg-background rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><HardDrive className="w-3 h-3" />内存</span>
                          <span className={`text-sm font-semibold ${Number(realData.memory_usage) > 80 ? 'text-destructive' : Number(realData.memory_usage) > 50 ? 'text-warning' : 'text-success'}`}>
                            {(Number(realData.memory_usage) === -1 ? 0 : Number(realData.memory_usage)).toFixed(1)}%
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-accent overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${Number(realData.memory_usage) > 80 ? 'bg-destructive' : Number(realData.memory_usage) > 50 ? 'bg-warning' : 'bg-success'}`} style={{ width: `${Math.min(100, Number(realData.memory_usage) === -1 ? 0 : Number(realData.memory_usage))}%` }} />
                        </div>
                      </div>
                      {/* 入带宽 */}
                      <div className="bg-background rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Wifi className="w-3 h-3" />入带宽</span>
                          <span className="text-sm font-semibold text-info">{realData.current_in_bw || '-'}</span>
                        </div>
                      </div>
                      {/* 出带宽 */}
                      <div className="bg-background rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><Wifi className="w-3 h-3" />出带宽</span>
                          <span className="text-sm font-semibold text-primary">{realData.current_out_bw || '-'}</span>
                        </div>
                      </div>
                      {/* 磁盘IO */}
                      <div className="bg-background rounded-lg p-3 space-y-1.5 col-span-2 sm:col-span-1">
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><HardDrive className="w-3 h-3" />磁盘IO</span>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-success">读 {Number(realData.current_read_byte).toFixed(1)} MB/s</span>
                          <span className="text-primary">写 {Number(realData.current_write_byte).toFixed(1)} MB/s</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-sm text-muted-foreground">暂无实时数据</div>
                  )}
                </div>

                {/* IP列表 */}
                {ipv4List.length > 0 && (
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Globe className="w-4 h-4 text-primary" />
                        IP地址 ({ipv4List.length})
                        {ipv4List.length > 0 && (
                          <button
                            onClick={() => {
                              const allIps = ipv4List.map(ip => ip.ip || ip.ipaddress).filter(Boolean).join('\n');
                              navigator.clipboard.writeText(allIps);
                              setMsg({ type: 'success', text: `已复制 ${ipv4List.length} 个IP地址` });
                            }}
                            className="ml-auto px-2 py-0.5 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors flex items-center gap-1"
                          >
                            <Copy className="w-3 h-3" />
                            复制所有IP
                          </button>
                        )}
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="flex flex-wrap gap-2">
                        {ipv4List.map((ip, i) => {
                          const ipAddr = ip.ip || ip.ipaddress;
                          const pingKey = `ipv4-${i}`;
                          return (
                          <span key={i} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-mono ${
                            ip.is_main || ip.mainip ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-muted text-foreground'
                          }`}>
                            {ipAddr}
                            {(ip.is_main || ip.mainip) && <span className="text-xs opacity-60">(主)</span>}
                            <button onClick={() => handlePing(pingKey, ipAddr)} className="text-muted-foreground hover:text-success transition-colors" title="Ping" disabled={pingMap[pingKey]?.loading}>
                              {pingMap[pingKey]?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                            </button>
                            {pingMap[pingKey]?.result && <span className={`text-[10px] font-mono ${pingMap[pingKey].result?.reachable ? 'text-success' : 'text-destructive'}`}>{pingMap[pingKey].result?.reachable ? `${pingMap[pingKey].result?.avgLatency}ms` : (pingMap[pingKey].result?.error || '超时')}</span>}
                          </span>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 磁盘概览 */}
                {disks.length > 0 && (
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border">
                      <h3 className="font-semibold flex items-center gap-2 text-sm sm:text-base">
                        <HardDrive className="w-4 h-4 text-primary" />
                        磁盘 ({disks.length})
                      </h3>
                    </div>
                    <div className="p-2 sm:p-4 space-y-1.5 sm:space-y-2">
                      {disks.map((disk, i) => {
                        const isSystem = disk.type === 'system' || disk.disk_type === 'system' || i === 0;
                        const diskStatus = Number(disk.status ?? -1);
                        const isMounted = diskStatus === 1 || diskStatus === 2;
                        const mountLabel = diskStatus === 2 ? '挂载中' : (isMounted ? '已挂载' : '未挂载');
                        return (
                          <div key={disk.id || i} className="bg-background rounded-lg px-3 py-2 sm:px-4 sm:py-2.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                                <HardDrive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                <span className="text-xs sm:text-sm truncate">{disk.name || `磁盘${i + 1}`}</span>
                                <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded shrink-0 ${
                                  isSystem ? 'bg-primary/10 text-primary' : 'bg-info/15 text-info'
                                }`}>
                                  {isSystem ? '系统盘' : '数据盘'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                <span className="text-xs sm:text-sm text-muted-foreground">{formatBytes((disk.size || 0) * 1024 * 1024 * 1024)}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] sm:text-xs ${
                                  diskStatus === 2 ? 'bg-warning/15 text-warning' :
                                  isMounted ? 'bg-success/15 text-success' : 'bg-accent text-muted-foreground'
                                }`}>
                                  {mountLabel}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== 电源操作 ===== */}
            {activeTab === 'power' && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Power className="w-4 h-4 text-primary" />
                    电源操作
                  </h3>
                </div>
                <div className="p-4 space-y-6">
                  {/* 当前状态 */}
                  <div className="flex items-center gap-3 bg-background rounded-lg px-4 py-3">
                    <span className="text-sm text-muted-foreground">当前状态</span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      powerInfo.color === 'text-success' ? 'bg-success/15 text-success' :
                      powerInfo.color === 'text-destructive' ? 'bg-destructive/15 text-destructive' :
                      'bg-warning/15 text-warning'
                    }`}>
                      {powerInfo.label}
                    </span>
                  </div>

                  {/* 电源按钮 */}
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    <ActionButton icon={Power} label="开机" color="emerald" loading={actionLoading === 'cloudOn'} disabled={!!actionLoading || powerInfo.label === '运行中' || powerInfo.label === '操作中'} onClick={() => setPowerConfirm({ action: 'cloudOn', name: '开机' })} />
                    <ActionButton icon={PowerOff} label="关机" color="yellow" loading={actionLoading === 'cloudOff'} disabled={!!actionLoading || powerInfo.label === '已关机' || powerInfo.label === '操作中'} onClick={() => setPowerConfirm({ action: 'cloudOff', name: '关机' })} />
                    <ActionButton icon={RotateCcw} label="重启" color="blue" loading={actionLoading === 'cloudReboot'} disabled={!!actionLoading || powerInfo.label === '已关机' || powerInfo.label === '操作中'} onClick={() => setPowerConfirm({ action: 'cloudReboot', name: '重启' })} />
                    <ActionButton icon={Zap} label="硬关机" color="red" loading={actionLoading === 'cloudHardOff'} disabled={!!actionLoading || powerInfo.label === '已关机' || powerInfo.label === '操作中'} onClick={() => setPowerConfirm({ action: 'cloudHardOff', name: '硬关机' })} />
                    <ActionButton icon={Zap} label="硬重启" color="red" loading={actionLoading === 'cloudHardReboot'} disabled={!!actionLoading || powerInfo.label === '已关机' || powerInfo.label === '操作中'} onClick={() => setPowerConfirm({ action: 'cloudHardReboot', name: '硬重启' })} />
                  </div>

                  {/* VNC & 重装 & 重置密码 */}
                  <div className="border-t border-border pt-4">
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">控制台与系统</h4>
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      <ActionButton icon={ScreenShare} label="VNC控制台" color="purple" loading={actionLoading === 'cloudVnc'} disabled={!!actionLoading} onClick={handleVnc} />
                      <ActionButton icon={Monitor} label="重装系统" color="orange" loading={actionLoading === 'cloudReinstall'} disabled={!!actionLoading} onClick={() => {
                          const sysDisk = disks.find(d => d.type === 'system' || d.disk_type === 'system');
                          const currentDiskSize = sysDisk?.size ? parseInt(String(sysDisk.size), 10) : 0;
                          setReinstallForm(prev => ({ ...prev, password: '', format_data_disk: false, custom_disk_size: currentDiskSize }));
                          setReinstallDiskSize(false);
                          setShowReinstallDialog(true);
                          fetchImages();
                        }} />
                      <ActionButton icon={RotateCcw} label="一键重建" color="red" loading={actionLoading === 'cloudRebuild'} disabled={!!actionLoading} onClick={() => setPowerConfirm({ action: 'cloudRebuild', name: '一键重建' })} />
                      <ActionButton icon={KeyRound} label="重置密码" color="orange" loading={actionLoading === 'cloudResetPassword'} disabled={!!actionLoading} onClick={() => { setResetPwdValue(''); setShowResetPwdDialog(true); }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ===== 配置修改 ===== */}
            {activeTab === 'config' && (
              <div className="space-y-4">
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Settings className="w-4 h-4 text-primary" />
                      实例配置
                    </h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">CPU (核心数)</label>
                        <input type="number" min="1" value={configForm.cpu || ''} onChange={e => setConfigForm(p => ({ ...p, cpu: Number(e.target.value) }))}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">内存 (GB)</label>
                        <input type="number" min="1" step="1" value={configForm.memory || ''} onChange={e => setConfigForm(p => ({ ...p, memory: Number(e.target.value) }))}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                      </div>
                    </div>
                    <button onClick={handleSaveConfig} disabled={configSaving}
                      className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground disabled:bg-accent disabled:text-muted-foreground rounded-lg transition-colors text-sm font-medium flex items-center gap-2">
                      {configSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      保存CPU/内存配置
                    </button>
                  </div>
                </div>

                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-primary" />
                      带宽配置
                    </h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">入站带宽 (Mbps) <span className="text-muted-foreground">当前: {cloudDetail?.default_bw_group?.in_bw ?? configForm.in_bw ?? 0} Mbps</span></label>
                        <input type="number" min="0" value={configForm.in_bw ?? ''} onChange={e => { const v = e.target.value; setConfigForm(p => ({ ...p, in_bw: v === '' ? '' : Number(v) })); }}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-sm text-muted-foreground mb-1 block">出站带宽 (Mbps) <span className="text-muted-foreground">当前: {cloudDetail?.default_bw_group?.out_bw ?? configForm.out_bw ?? 0} Mbps</span></label>
                        <input type="number" min="0" value={configForm.out_bw ?? ''} onChange={e => { const v = e.target.value; setConfigForm(p => ({ ...p, out_bw: v === '' ? '' : Number(v) })); }}
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                      </div>
                    </div>
                    {/* 临时修改状态显示 */}
                    {bwTempExpireTimeDisplay && (
                      <div className="bg-warning/10 border border-warning/30 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-warning" />
                        <span className="text-sm text-warning">临时带宽生效中，到期时间: {bwTempExpireTimeDisplay}</span>
                      </div>
                    )}
                    {/* 临时修改开关 */}
                    <div className="flex items-center gap-3">
                      <div className={`flex items-center gap-2 ${bwTempExpireTimeDisplay ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        onClick={() => { if (!bwTempExpireTimeDisplay) setBwTempMode(v => !v); }}>
                        <div className={`relative w-10 h-5 rounded-full transition-colors ${bwTempMode ? 'bg-primary' : 'bg-accent'}`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card transition-transform ${bwTempMode ? 'translate-x-5' : ''}`} />
                        </div>
                        <span className="text-sm text-muted-foreground">临时修改</span>
                      </div>
                      {bwTempMode && !bwTempExpireTimeDisplay && (
                        <input type="datetime-local" value={bwTempExpireTime} onChange={e => setBwTempExpireTime(e.target.value)}
                          className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none min-w-[200px] [color-scheme:light] dark:[color-scheme:dark]" />
                      )}
                      {bwTempExpireTimeDisplay && (
                        <span className="text-xs text-muted-foreground">临时修改生效期间无法关闭</span>
                      )}
                    </div>
                    <button onClick={handleSaveBw} disabled={configSaving}
                      className="px-5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground disabled:bg-accent disabled:text-muted-foreground rounded-lg transition-colors text-sm font-medium flex items-center gap-2">
                      {configSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      保存带宽配置
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ===== 磁盘管理 ===== */}
            {activeTab === 'disk' && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-3 sm:px-4 py-2.5 sm:py-3 border-b border-border flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2 text-sm sm:text-base">
                    <HardDrive className="w-4 h-4 text-primary" />
                    磁盘管理 ({disks.length})
                  </h3>
                  <button onClick={() => { setAddDiskForm({ size: 10, store: 0, driver: 'virtio' }); fetchDiskStores(); setShowAddDiskDialog(true); }}
                    className="flex items-center gap-1 px-2.5 py-1.5 sm:px-3 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs sm:text-sm transition-colors">
                    <Plus className="w-3.5 h-3.5" />
                    添加
                  </button>
                </div>
                <div className="p-2 sm:p-4 space-y-2 sm:space-y-3">
                  {disks.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">暂无磁盘信息</p>
                  ) : disks.map((disk, i) => {
                    const isSystem = disk.type === 'system' || disk.disk_type === 'system' || i === 0;
                    const diskStatus = Number(disk.status ?? -1);
                    const isMounted = diskStatus === 1 || diskStatus === 2;
                    const mountLabel = diskStatus === 2 ? '挂载中' : (isMounted ? '已挂载' : '未挂载');
                    return (
                      <div key={disk.id || i} className="bg-background rounded-lg border border-border p-3 sm:p-4">
                        {/* 头部：名称+标签+大小 */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                            <HardDrive className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-sm font-medium truncate">{disk.name || `磁盘${i + 1}`}</span>
                            <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded shrink-0 ${
                              isSystem ? 'bg-primary/10 text-primary' : 'bg-info/15 text-info'
                            }`}>
                              {isSystem ? '系统盘' : '数据盘'}
                            </span>
                            <span className={`text-[10px] sm:text-xs px-1.5 py-0.5 rounded shrink-0 ${
                              diskStatus === 2 ? 'bg-warning/15 text-warning' :
                              isMounted ? 'bg-success/15 text-success' : 'bg-accent text-muted-foreground'
                            }`}>
                              {mountLabel}
                            </span>
                          </div>
                          <span className="text-sm sm:text-lg font-semibold text-primary shrink-0">{formatBytes((disk.size || 0) * 1024 * 1024 * 1024)}</span>
                        </div>
                        {/* 详情信息 */}
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:text-sm">
                          {disk.id && <div className="text-muted-foreground">ID: <span className="text-foreground">{disk.id}</span></div>}
                          {disk.dev && <div className="text-muted-foreground">设备: <span className="text-foreground">{disk.dev}</span></div>}
                          {disk.bus && <div className="text-muted-foreground">总线: <span className="text-foreground">{disk.bus}</span></div>}
                          {disk.mount_point && <div className="text-muted-foreground">挂载点: <span className="text-foreground">{disk.mount_point}</span></div>}
                          {disk.driver && <div className="text-muted-foreground">驱动: <span className="text-foreground">{disk.driver}</span></div>}
                        </div>
                        {/* 磁盘操作区 */}
                        <div className="mt-2 pt-2 sm:mt-3 sm:pt-3 border-t border-border flex flex-wrap items-center gap-1.5 sm:gap-2">
                          {isSystem ? (
                            <span className="text-[10px] sm:text-xs text-muted-foreground flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              系统盘不支持扩容
                            </span>
                          ) : (
                            <>
                              <button
                                onClick={() => { setResizeDiskTarget({ id: Number(disk.id), name: disk.name || `磁盘${i + 1}`, currentSize: Number(disk.size) || 10 }); setResizeDiskValue(Number(disk.size) || 10); }}
                                className="px-2 py-1 sm:px-3 sm:py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded text-xs sm:text-sm transition-colors flex items-center gap-1"
                              >
                                <Edit3 className="w-3 h-3" />
                                扩容
                              </button>
                              {isMounted ? (
                                <button
                                  onClick={() => {
                                    if (!cloudId || !disk.id) return;
                                    setActionLoading(`diskUnmount_${disk.id}`);
                                    setMsg({ type: 'info', text: '正在卸载磁盘...' });
                                    callMfyApi('diskUnmount', { id: cloudId, diskId: disk.id }).then(res => {
                                      if (res.success) {
                                        setMsg({ type: 'success', text: '磁盘卸载成功' });
                                        fetchCloudDetail(cloudId);
                                        setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000);
                                      } else {
                                        setMsg({ type: 'error', text: `卸载失败: ${res.msg || '未知错误'}` });
                                      }
                                    }).catch(err => {
                                      const errMsg = err instanceof Error ? err.message : String(err);
                                      setMsg({ type: 'error', text: `卸载异常: ${errMsg}` });
                                    }).finally(() => setActionLoading(null));
                                  }}
                                  disabled={!!actionLoading}
                                  className="px-2 py-1 sm:px-3 sm:py-1.5 bg-warning text-warning-foreground hover:bg-warning/90 disabled:bg-accent disabled:text-muted-foreground rounded text-xs sm:text-sm transition-colors flex items-center gap-1"
                                >
                                  {actionLoading === `diskUnmount_${disk.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDrive className="w-3 h-3" />}
                                  卸载
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    if (!disk.id) return;
                                    setActionLoading(`diskMount_${disk.id}`);
                                    setMsg({ type: 'info', text: '正在挂载磁盘...' });
                                    callMfyApi('diskMount', { diskId: disk.id }).then(res => {
                                      if (res.success) {
                                        setMsg({ type: 'success', text: '磁盘挂载成功' });
                                        if (cloudId) fetchCloudDetail(cloudId);
                                        setTimeout(() => { if (cloudId) fetchMfyTaskAndLog(cloudId); }, 3000);
                                      } else {
                                        setMsg({ type: 'error', text: `挂载失败: ${res.msg || '未知错误'}` });
                                      }
                                    }).catch(err => {
                                      const errMsg = err instanceof Error ? err.message : String(err);
                                      setMsg({ type: 'error', text: `挂载异常: ${errMsg}` });
                                    }).finally(() => setActionLoading(null));
                                  }}
                                  disabled={!!actionLoading}
                                  className="px-2 py-1 sm:px-3 sm:py-1.5 bg-success text-success-foreground hover:bg-success/90 disabled:bg-accent disabled:text-muted-foreground rounded text-xs sm:text-sm transition-colors flex items-center gap-1"
                                >
                                  {actionLoading === `diskMount_${disk.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <HardDrive className="w-3 h-3" />}
                                  挂载
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (!disk.id) return;
                                  setDeleteDiskTarget({ id: Number(disk.id), name: disk.name || `磁盘${i + 1}` });
                                }}
                                disabled={!!actionLoading}
                                className="px-2 py-1 sm:px-3 sm:py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-accent disabled:text-muted-foreground rounded text-xs sm:text-sm transition-colors flex items-center gap-1"
                              >
                                <Trash2 className="w-3 h-3" />
                                删除
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===== IP管理 ===== */}
            {activeTab === 'ip' && (
              <div className="space-y-4">
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-3 sm:px-4 py-3 border-b border-border">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold flex items-center gap-2 shrink-0">
                        <Globe className="w-4 h-4 text-primary" />
                        <span className="hidden sm:inline">IPv4地址</span>
                        <span className="sm:hidden">IP</span>
                        ({ipv4List.length})
                      </h3>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {ipv4List.length > 0 && (
                          <button
                            onClick={() => {
                              const allIps = ipv4List.map(ip => ip.ip || ip.ipaddress).filter(Boolean).join('\n');
                              navigator.clipboard.writeText(allIps);
                              setMsg({ type: 'success', text: `已复制 ${ipv4List.length} 个IP地址` });
                            }}
                            className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-accent hover:bg-accent rounded-lg text-xs sm:text-sm transition-colors text-foreground"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">复制所有IP</span>
                          </button>
                        )}
                        {selectedIps.size > 0 && (
                          <button onClick={handleDeleteSelectedIps} disabled={!!actionLoading}
                            className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-accent disabled:text-muted-foreground rounded-lg text-xs sm:text-sm transition-colors">
                            {actionLoading === 'cloudUpdateIp' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                            <span className="hidden sm:inline">删除选中</span> ({selectedIps.size})
                          </button>
                        )}
                        <button onClick={() => { setSelectedFreeIps(new Set()); fetchFreeIps(); setShowAddIpDialog(true); }}
                          className="flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs sm:text-sm transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">添加IP</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="p-4 sm:p-6 min-h-[50vh] sm:min-h-[60vh]">
                    {ipv4List.length === 0 ? (
                      <p className="text-muted-foreground text-center py-8">暂无IPv4地址</p>
                    ) : (
                      <div className="space-y-3">
                        {ipv4List.map((ip, i) => {
                          const isMain = ip.is_main || ip.mainip;
                          const isSelected = selectedIps.has(i);
                          const ipAddr = ip.ip || ip.ipaddress;
                          const pingKey = `ipm-${i}`;
                          return (
                            <div key={i} className={`flex items-center justify-between rounded-lg px-4 py-3 sm:px-5 sm:py-3.5 ${isSelected ? 'bg-destructive/10 border border-destructive/30' : 'bg-background border border-border/50'}`}>
                              <div className="flex items-center gap-3">
                                {!isMain && (
                                  <div onClick={() => {
                                      setSelectedIps(prev => {
                                        const next = new Set(prev);
                                        if (next.has(i)) next.delete(i); else next.add(i);
                                        return next;
                                      });
                                    }}
                                    className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center cursor-pointer transition-colors shrink-0 ${
                                      isSelected ? 'bg-destructive border-destructive' : 'border-border hover:border-border'
                                    }`}>
                                    {isSelected && <Check className="w-3 h-3 text-foreground" />}
                                  </div>
                                )}
                                <span className="font-mono text-sm sm:text-base">{ipAddr}</span>
                                {isMain && <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">主IP</span>}
                                <button onClick={() => handlePing(pingKey, ipAddr)} className="text-muted-foreground hover:text-success transition-colors" title="Ping" disabled={pingMap[pingKey]?.loading}>
                                  {pingMap[pingKey]?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Activity className="w-3.5 h-3.5" />}
                                </button>
                                {pingMap[pingKey]?.result && <span className={`text-[10px] font-mono ${pingMap[pingKey].result?.reachable ? 'text-success' : 'text-destructive'}`}>{pingMap[pingKey].result?.reachable ? `${pingMap[pingKey].result?.avgLatency}ms` : (pingMap[pingKey].result?.error || '超时')}</span>}
                              </div>
                              <div className="text-xs text-muted-foreground shrink-0">
                                {ip.subnet_mask && `/${ip.subnet_mask}`}
                                {ip.gateway && ` GW: ${ip.gateway}`}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ===== 安全组 ===== */}
            {activeTab === 'security' && (
              <div className="space-y-4">
                {/* 当前安全组 */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      安全组
                    </h3>
                    <div className="flex items-center gap-2">
                      {cloudDetail?.security && (
                        <button onClick={handleUnbindSecurityGroup} disabled={!!actionLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:bg-accent disabled:text-muted-foreground rounded-lg text-sm transition-colors">
                          解绑当前安全组
                        </button>
                      )}
                      <button onClick={() => { fetchSecurityGroups(); setShowSecurityGroupDialog(true); }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm transition-colors">
                        <Plus className="w-4 h-4" />
                        绑定安全组
                      </button>
                    </div>
                  </div>
                  <div className="p-4">
                    {cloudDetail?.security ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 bg-background rounded-lg px-4 py-3">
                          <Shield className="w-5 h-5 text-primary" />
                          <div className="flex-1">
                            <div className="text-sm font-medium">{cloudDetail.security_name || `安全组 #${cloudDetail.security}`}</div>
                            <div className="text-xs text-muted-foreground">ID: {cloudDetail.security}</div>
                          </div>
                          <button onClick={() => fetchSecurityDetail(Number(cloudDetail.security))}
                            className="px-3 py-1.5 bg-accent hover:bg-accent rounded text-sm transition-colors">
                            查看规则
                          </button>
                        </div>
                        {/* 安全组规则列表 */}
                        {securityLoading ? (
                          <div className="flex items-center justify-center py-4 text-muted-foreground">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />加载规则...
                          </div>
                        ) : securityRules.length > 0 ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">规则列表 ({securityRules.length})</span>
                              <button onClick={() => { setSecurityRuleForm({ direction: 'in', protocol: 'tcp', port: '', ip: '', description: '' }); setShowSecurityRuleDialog(true); }}
                                className="text-xs text-primary hover:text-primary">+ 添加规则</button>
                            </div>
                            {securityRules.map(rule => (
                              <div key={rule.id} className="flex items-center gap-3 bg-background rounded-lg px-4 py-2.5">
                                <span className={`text-xs px-2 py-0.5 rounded ${rule.direction === 'in' ? 'bg-info/15 text-info' : 'bg-primary/15 text-primary'}`}>
                                  {rule.direction === 'in' ? '入' : '出'}
                                </span>
                                <span className="text-sm text-foreground">{rule.protocol?.toUpperCase()}</span>
                                <span className="text-sm text-foreground font-mono">{rule.port || '-'}</span>
                                <span className="text-sm text-muted-foreground font-mono">{rule.ip || '-'}</span>
                                {rule.description && <span className="text-xs text-muted-foreground truncate flex-1" title={rule.description}>{rule.description}</span>}
                                <button onClick={() => handleDeleteSecurityRule(rule.id)} disabled={!!actionLoading}
                                  className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : currentSecurityGroup ? (
                          <div className="text-center py-4 text-muted-foreground text-sm">
                            暂无规则
                            <button onClick={() => { setSecurityRuleForm({ direction: 'in', protocol: 'tcp', port: '', ip: '', description: '' }); setShowSecurityRuleDialog(true); }}
                              className="ml-2 text-primary hover:text-primary">添加规则</button>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <Shield className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                        <p>未绑定安全组</p>
                        <button onClick={() => { fetchSecurityGroups(); setShowSecurityGroupDialog(true); }}
                          className="mt-3 text-primary hover:text-primary text-sm">绑定安全组</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ===== 网络 ===== */}
            {activeTab === 'network' && (
              <div className="space-y-4">
                {/* 当前网络模式 */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Wifi className="w-4 h-4 text-primary" />
                      网络模式
                    </h3>
                  </div>
                  <div className="p-4 space-y-4">
                    <div className="flex items-center gap-4 bg-background rounded-lg px-4 py-3">
                      <div className={`w-3 h-3 rounded-full ${cloudDetail?.network_type === 'vpc' ? 'bg-primary/10' : 'bg-success'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium">
                          {cloudDetail?.network_type === 'vpc' ? 'VPC网络' : '经典网络'}
                        </div>
                        {cloudDetail?.network_type === 'vpc' && cloudDetail?.vpc_name && (
                          <div className="text-xs text-muted-foreground mt-0.5">VPC: {cloudDetail.vpc_name}</div>
                        )}
                        {cloudDetail?.network_type === 'vpc' && (() => {
                          // 从 network 数组提取内网IP
                          const isPrivateIp = (addr: string) => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(addr);
                          const networkArr = Array.isArray(cloudDetail?.network) ? cloudDetail.network : [];
                          const innerIps: string[] = [];
                          for (const net of networkArr) {
                            const n = net as Record<string, any>;
                            if (!n || typeof n !== 'object') continue;
                            // bridge=ovs-int 直接取 ipaddress
                            if (n.bridge === 'ovs-int' && n.ipaddress) {
                              if (typeof n.ipaddress === 'string') {
                                innerIps.push(n.ipaddress);
                              } else if (Array.isArray(n.ipaddress)) {
                                for (const item of n.ipaddress) {
                                  const addr = typeof item === 'object' ? item?.ipaddress : item;
                                  if (addr) innerIps.push(String(addr));
                                }
                              }
                            }
                            // bridge=ovs-ext 时从 ipaddress 数组中检测私有IP
                            if (n.bridge === 'ovs-ext' && Array.isArray(n.ipaddress)) {
                              for (const item of n.ipaddress) {
                                const addr = typeof item === 'object' ? item?.ipaddress : item;
                                if (addr && isPrivateIp(String(addr))) {
                                  innerIps.push(String(addr));
                                }
                              }
                            }
                            // network 中有 private_ip 字段
                            if (n.private_ip && typeof n.private_ip === 'string') {
                              innerIps.push(n.private_ip);
                            }
                          }
                          const uniqueIps = [...new Set(innerIps)];
                          return uniqueIps.length > 0 ? <div className="text-xs text-info mt-0.5 font-mono truncate">内网IP: {uniqueIps.join(', ')}</div> : null;
                        })()}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        cloudDetail?.network_type === 'vpc'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-success/15 text-success'
                      }`}>
                        {cloudDetail?.network_type === 'vpc' ? 'VPC' : '经典'}
                      </span>
                    </div>

                    {/* 切换按钮 */}
                    <div className="flex gap-3">
                      {cloudDetail?.network_type !== 'normal' && (
                        <button onClick={() => { setNetworkSwitchTarget('normal'); setShowNetworkSwitchDialog(true); }}
                          className="flex-1 px-4 py-2 bg-success text-success-foreground hover:bg-success/90 rounded-lg text-sm transition-colors">
                          切换到经典网络
                        </button>
                      )}
                      {cloudDetail?.network_type !== 'vpc' && (
                        <button onClick={() => { setNetworkSwitchTarget('vpc'); fetchVpcNetworks(); setSelectedVpcId(0); setVpcIpSegment(''); setShowNetworkSwitchDialog(true); }}
                          className="flex-1 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm transition-colors">
                          切换到VPC网络
                        </button>
                      )}
                      {cloudDetail?.network_type === 'vpc' && (
                        <button onClick={() => { setNetworkSwitchTarget('vpc'); fetchVpcNetworks(); setSelectedVpcId(0); setVpcIpSegment(''); setShowNetworkSwitchDialog(true); }}
                          className="flex-1 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm transition-colors">
                          切换到其他VPC
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* 带宽信息 */}
                {cloudDetail?.default_bw_group && (
                  <div className="bg-card rounded-xl border border-border overflow-hidden">
                    <div className="px-4 py-3 border-b border-border">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Activity className="w-4 h-4 text-primary" />
                        带宽信息
                      </h3>
                    </div>
                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-background rounded-lg p-3 border border-border">
                          <div className="text-xs text-muted-foreground mb-1">入站带宽</div>
                          <div className="text-lg font-semibold text-foreground">{cloudDetail.default_bw_group.in_bw || 0} Mbps</div>
                        </div>
                        <div className="bg-background rounded-lg p-3 border border-border">
                          <div className="text-xs text-muted-foreground mb-1">出站带宽</div>
                          <div className="text-lg font-semibold text-foreground">{cloudDetail.default_bw_group.out_bw || 0} Mbps</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== 流量统计 ===== */}
            {activeTab === 'traffic' && (
              <div className="space-y-4">
                {/* 流量配额概览 */}
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 border-b border-border">
                    <h3 className="font-semibold flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-primary" />
                      流量统计
                      {trafficData?.traffic_type && (
                        <span className="text-xs font-normal text-muted-foreground ml-auto">
                          统计方向: {({1: '入站', 2: '出站', 3: '总计'} as Record<number, string>)[trafficData.traffic_type] || '总计'}
                        </span>
                      )}
                    </h3>
                  </div>
                  <div className="p-4">
                    {trafficLoading ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mr-2" />
                        加载流量数据...
                      </div>
                    ) : trafficError ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-3">
                        <p className="text-destructive text-sm">{trafficError}</p>
                        <button onClick={() => cloudId && fetchTraffic(cloudId)} className="text-xs text-primary hover:text-primary underline">重试</button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* 多维度流量卡片 */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          {/* 今日 */}
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="text-xs text-muted-foreground mb-1">今日流量</div>
                            <div className="text-lg font-semibold text-foreground">{(trafficPeriods.today?.gb_flow || 0).toFixed(4)} GB</div>
                            <div className="flex gap-3 mt-1.5">
                              <span className="text-xs text-success">↓入 {(trafficPeriods.today?.in_gb || 0).toFixed(4)}</span>
                              <span className="text-xs text-primary">↑出 {(trafficPeriods.today?.out_gb || 0).toFixed(4)}</span>
                            </div>
                            {trafficPeriods.today?.gb_flow > 0 && trafficData?.total_gb > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">{((trafficPeriods.today.gb_flow / (trafficData?.total_gb || 1)) * 100).toFixed(2)}%</div>
                            )}
                          </div>
                          {/* 最近7天 */}
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="text-xs text-muted-foreground mb-1">最近7天</div>
                            <div className="text-lg font-semibold text-foreground">{(trafficPeriods.week?.gb_flow || 0).toFixed(4)} GB</div>
                            <div className="flex gap-3 mt-1.5">
                              <span className="text-xs text-success">↓入 {(trafficPeriods.week?.in_gb || 0).toFixed(4)}</span>
                              <span className="text-xs text-primary">↑出 {(trafficPeriods.week?.out_gb || 0).toFixed(4)}</span>
                            </div>
                            {trafficPeriods.week?.gb_flow > 0 && trafficData?.total_gb > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">{((trafficPeriods.week.gb_flow / (trafficData?.total_gb || 1)) * 100).toFixed(2)}%</div>
                            )}
                          </div>
                          {/* 本月 */}
                          <div className="bg-background rounded-lg p-3 border border-primary/50">
                            <div className="text-xs text-muted-foreground mb-1">本月流量</div>
                            <div className="text-lg font-semibold text-primary">{(trafficPeriods.month?.gb_flow || 0).toFixed(4)} GB</div>
                            <div className="flex gap-3 mt-1.5">
                              <span className="text-xs text-success">↓入 {(trafficPeriods.month?.in_gb || 0).toFixed(4)}</span>
                              <span className="text-xs text-primary">↑出 {(trafficPeriods.month?.out_gb || 0).toFixed(4)}</span>
                            </div>
                            {trafficPeriods.month?.gb_flow > 0 && trafficData?.total_gb > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">{((trafficPeriods.month.gb_flow / (trafficData?.total_gb || 1)) * 100).toFixed(2)}%</div>
                            )}
                          </div>
                          {/* 重置周期(30天) */}
                          <div className="bg-background rounded-lg p-3 border border-border">
                            <div className="text-xs text-muted-foreground mb-1">重置周期</div>
                            <div className="text-lg font-semibold text-foreground">{(trafficPeriods.cycle?.gb_flow || 0).toFixed(4)} GB</div>
                            <div className="flex gap-3 mt-1.5">
                              <span className="text-xs text-success">↓入 {(trafficPeriods.cycle?.in_gb || 0).toFixed(4)}</span>
                              <span className="text-xs text-primary">↑出 {(trafficPeriods.cycle?.out_gb || 0).toFixed(4)}</span>
                            </div>
                            {trafficPeriods.cycle?.gb_flow > 0 && trafficData?.total_gb > 0 && (
                              <div className="text-xs text-muted-foreground mt-1">{((trafficPeriods.cycle.gb_flow / (trafficData?.total_gb || 1)) * 100).toFixed(2)}%</div>
                            )}
                          </div>
                        </div>

                        {/* 流量使用进度条 */}
                        {trafficData && trafficData.total_gb > 0 && (
                          <div className="bg-background rounded-lg p-4 border border-border">
                            <div className="flex justify-between text-sm mb-2">
                              <span className="text-muted-foreground">流量配额使用</span>
                              <span className="text-foreground">{trafficData.used_gb?.toFixed(4)} GB / {trafficData.total_gb} GB</span>
                            </div>
                            <div className="h-4 bg-accent rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  (trafficData.used_gb / trafficData.total_gb) > 0.9 ? 'bg-destructive' :
                                  (trafficData.used_gb / trafficData.total_gb) > 0.7 ? 'bg-warning' : 'bg-primary/10'
                                }`}
                                style={{ width: `${Math.min((trafficData.used_gb / trafficData.total_gb) * 100, 100)}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
                              <span>已用 {((trafficData.used_gb / trafficData.total_gb) * 100).toFixed(1)}%</span>
                              <span>剩余 {trafficData.leave_gb?.toFixed(4)} GB</span>
                              <span>重置日: 每月{trafficData.reset_flow_day || 1}日</span>
                            </div>
                          </div>
                        )}

                        {/* 入站/出站详细对比 */}
                        {trafficData && (trafficData.in_traffic_gb > 0 || trafficData.out_traffic_gb > 0) && (
                          <div className="bg-background rounded-lg p-4 border border-border">
                            <div className="text-xs text-muted-foreground mb-3">本月入站/出站对比</div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-2.5 h-2.5 rounded-full bg-success" />
                                  <span className="text-sm text-muted-foreground">入站流量</span>
                                </div>
                                <div className="text-xl font-semibold text-success">{trafficData.in_traffic_gb?.toFixed(4)} GB</div>
                                {trafficData.total_gb > 0 && (
                                  <div className="mt-1.5 h-2 bg-accent rounded-full overflow-hidden">
                                    <div className="h-full bg-success rounded-full" style={{ width: `${Math.min((trafficData.in_traffic_gb / trafficData.total_gb) * 100, 100)}%` }} />
                                  </div>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                                  <span className="text-sm text-muted-foreground">出站流量</span>
                                </div>
                                <div className="text-xl font-semibold text-primary">{trafficData.out_traffic_gb?.toFixed(4)} GB</div>
                                {trafficData.total_gb > 0 && (
                                  <div className="mt-1.5 h-2 bg-accent rounded-full overflow-hidden">
                                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min((trafficData.out_traffic_gb / trafficData.total_gb) * 100, 100)}%` }} />
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ===== 监控图表 ===== */}
            {activeTab === 'monitor' && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    监控图表
                  </h3>
                </div>
                <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
                  {/* 类型与时间范围选择 */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground shrink-0">类型</span>
                      {[
                        { key: 'cpu', label: 'CPU' },
                        { key: 'memory', label: '内存' },
                        { key: 'net_adapter', label: '网络' },
                        { key: 'disk_io', label: '磁盘IO' },
                        { key: 'disk_iops', label: 'IOPS' },
                        { key: 'pps', label: '包量' },
                      ].map(t => (
                        <button key={t.key} onClick={() => { setMonitorType(t.key); setMonitorNic(''); setMonitorDisk(''); }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            monitorType === t.key ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground shrink-0">范围</span>
                      {[
                        { key: 'all', label: '全部' },
                        { key: '1h', label: '1时' },
                        { key: '6h', label: '6时' },
                        { key: '24h', label: '1天' },
                        { key: '7d', label: '7天' },
                        { key: '30d', label: '30天' },
                        { key: 'custom', label: '自定义' },
                      ].map(r => (
                        <button key={r.key} onClick={() => {
                          setMonitorRange(r.key);
                        }}
                          className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                            monitorRange === r.key ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                          }`}>
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {/* 网卡选择 - 仅网络/包量类型显示 */}
                    {(monitorType === 'net_adapter' || monitorType === 'pps') && (() => {
                      // 按 mac 分组，每个唯一 mac 对应一个网卡
                      const nicMap = new Map<string, { mac: string; idx: number }>();
                      ipv4List.forEach((ip, idx) => {
                        const mac = ip.mac || '';
                        if (!nicMap.has(mac)) {
                          nicMap.set(mac, { mac, idx });
                        }
                      });
                      const nics = Array.from(nicMap.values());
                      if (nics.length <= 1) return null;
                      return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground shrink-0">网卡</span>
                        {nics.map((nic, i) => (
                          <button key={nic.idx}
                            onClick={() => { setMonitorNic(String(nic.idx)); }}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors font-mono ${
                              (monitorNic === '' ? i === 0 : monitorNic === String(nic.idx)) ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                            }`}>
                            {nic.mac || `网卡${i + 1}`}
                          </button>
                        ))}
                      </div>
                      );
                    })()}
                    {/* 磁盘选择 - 仅磁盘IO/IOPS类型显示 */}
                    {(monitorType === 'disk_io' || monitorType === 'disk_iops') && disks.length > 1 && (() => {
                      const defaultDiskDev = (() => {
                        const sysDisk = disks.find(d => d.type === 'system' || d.disk_type === 'system');
                        return (sysDisk || disks[0])?.dev || '';
                      })();
                      return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground shrink-0">磁盘</span>
                        {disks.map((disk, idx) => (
                          <button key={idx}
                            onClick={() => { setMonitorDisk(disk.dev || ''); }}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                              (monitorDisk === '' ? disk.dev === defaultDiskDev : monitorDisk === (disk.dev || '')) ? 'bg-primary/15 text-primary' : 'bg-background text-muted-foreground hover:text-foreground hover:bg-accent'
                            }`}>
                            {disk.name || disk.dev || `磁盘${idx + 1}`}
                          </button>
                        ))}
                      </div>
                      );
                    })()}
                  </div>

                  {/* 自定义时间范围 */}
                  {monitorRange === 'custom' && (
                    <div className="bg-background rounded-lg p-4 border border-border space-y-3">
                      {/* 数据可用范围提示 */}
                      {(() => {
                        // 计算实例创建时间作为最早可选日期
                        const createTime = cloudDetail?.create_time ? new Date(cloudDetail.create_time).getTime() : 0;
                        const earliestTime = fullDataTimeStart > 0 ? fullDataTimeStart : (createTime > 0 ? createTime : Date.now() - 90 * 86400000);
                        const latestTime = fullDataTimeEnd > 0 ? fullDataTimeEnd : Date.now();
                        return (
                        <div className="flex items-center gap-2 text-xs">
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-muted rounded-md">
                            <Activity className="w-3 h-3 text-primary" />
                            <span className="text-muted-foreground">可选范围:</span>
                            <span className="text-foreground font-medium tabular-nums">
                              {new Date(earliestTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="text-foreground font-medium tabular-nums">
                              {new Date(latestTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {fullDataTimeStart > 0 && fullDataTimeEnd > 0 && (
                          <button
                            onClick={() => {
                              const toLocalISOString = (d: Date) => {
                                const pad = (n: number) => n.toString().padStart(2, '0');
                                return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                              };
                              setCustomStartTime(toLocalISOString(new Date(fullDataTimeStart)));
                              setCustomEndTime(toLocalISOString(new Date(fullDataTimeEnd)));
                            }}
                            className="px-2 py-1 text-primary hover:text-primary hover:bg-primary/10 rounded-md transition-colors font-medium"
                          >
                            填入数据范围
                          </button>
                          )}
                        </div>
                        );
                      })()}
                      {/* 时间范围选择 */}
                      <div className="flex flex-wrap items-end gap-3">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="flex items-center gap-2 bg-card border border-border rounded-md px-3 py-1.5 text-sm text-foreground hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                            >
                              <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                              {customStartTime && customEndTime
                                ? <>
                                    <span className="tabular-nums">{new Date(customStartTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className="tabular-nums">{new Date(customEndTime).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                  </>
                                : <span className="text-muted-foreground">选择时间范围</span>
                              }
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0 bg-card border-border text-foreground [&_.rdp-month]:text-foreground [&_.rdp-weekday]:text-muted-foreground [&_.rdp-day]:text-foreground [&_.rdp-day_disabled]:text-muted-foreground [&_.rdp-day_disabled]:opacity-60 [&_.rdp-day_outside]:text-muted-foreground [&_.rdp-caption_label]:text-foreground [&_.rdp-button_previous]:text-foreground [&_.rdp-button_next]:text-foreground [&_[data-selected-single=true]]:bg-primary/10 [&_[data-selected-single=true]]:text-foreground [&_[data-range-start=true]]:bg-primary/10 [&_[data-range-start=true]]:text-foreground [&_[data-range-end=true]]:bg-primary/10 [&_[data-range-end=true]]:text-foreground [&_[data-range-middle=true]]:bg-primary/10 [&_[data-range-middle=true]]:text-primary [&_[aria-current=date]]:bg-primary/10 [&_[aria-current=date]_button]:text-primary [&_[aria-current=date]_button]:font-semibold" align="start">
                            <Calendar
                              mode="range"
                              numberOfMonths={2}
                              defaultMonth={(() => {
                                const ct = cloudDetail?.create_time ? new Date(cloudDetail.create_time).getTime() : 0;
                                const earliest = fullDataTimeStart > 0 ? fullDataTimeStart : (ct > 0 ? ct : Date.now() - 90 * 86400000);
                                return new Date(earliest);
                              })()}
                              startMonth={(() => {
                                const ct = cloudDetail?.create_time ? new Date(cloudDetail.create_time).getTime() : 0;
                                const earliest = fullDataTimeStart > 0 ? fullDataTimeStart : (ct > 0 ? ct : Date.now() - 90 * 86400000);
                                return new Date(earliest);
                              })()}
                              endMonth={new Date()}
                              selected={{
                                from: customStartTime ? new Date(customStartTime) : undefined,
                                to: customEndTime ? new Date(customEndTime) : undefined,
                              }}
                              onSelect={(range: { from?: Date; to?: Date } | undefined) => {
                                const pad = (n: number) => n.toString().padStart(2, '0');
                                if (range?.from) {
                                  const prevTime = customStartTime ? customStartTime.split('T')[1] : '00:00';
                                  setCustomStartTime(`${range.from.getFullYear()}-${pad(range.from.getMonth() + 1)}-${pad(range.from.getDate())}T${prevTime}`);
                                }
                                if (range?.to) {
                                  const prevTime = customEndTime ? customEndTime.split('T')[1] : '23:59';
                                  setCustomEndTime(`${range.to.getFullYear()}-${pad(range.to.getMonth() + 1)}-${pad(range.to.getDate())}T${prevTime}`);
                                }
                              }}
                              disabled={(d: Date) => {
                                const ct = cloudDetail?.create_time ? new Date(cloudDetail.create_time).getTime() : 0;
                                const earliest = fullDataTimeStart > 0 ? fullDataTimeStart : (ct > 0 ? ct : Date.now() - 90 * 86400000);
                                const latest = fullDataTimeEnd > 0 ? fullDataTimeEnd : Date.now();
                                const startDay = new Date(earliest); startDay.setHours(0, 0, 0, 0);
                                const endDay = new Date(latest); endDay.setHours(23, 59, 59, 999);
                                return d < startDay || d > endDay;
                              }}
                            />
                            {/* 时间微调 */}
                            <div className="flex items-center gap-3 px-3 pb-3 pt-1 border-t border-border mt-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">开始</span>
                                <div className="flex items-center bg-background border border-border rounded px-2 py-1 gap-1">
                                  <Clock className="w-3 h-3 text-muted-foreground" />
                                  <input type="time" value={customStartTime ? customStartTime.split('T')[1] || '00:00' : '00:00'}
                                    onChange={e => {
                                      const datePart = customStartTime ? customStartTime.split('T')[0] : new Date().toISOString().split('T')[0];
                                      setCustomStartTime(`${datePart}T${e.target.value}`);
                                    }}
                                    className="bg-transparent text-xs text-foreground focus:outline-none w-[65px] tabular-nums"
                                  />
                                </div>
                              </div>
                              <span className="text-muted-foreground text-xs">→</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">结束</span>
                                <div className="flex items-center bg-background border border-border rounded px-2 py-1 gap-1">
                                  <Clock className="w-3 h-3 text-muted-foreground" />
                                  <input type="time" value={customEndTime ? customEndTime.split('T')[1] || '23:59' : '23:59'}
                                    onChange={e => {
                                      const datePart = customEndTime ? customEndTime.split('T')[0] : new Date().toISOString().split('T')[0];
                                      setCustomEndTime(`${datePart}T${e.target.value}`);
                                    }}
                                    className="bg-transparent text-xs text-foreground focus:outline-none w-[65px] tabular-nums"
                                  />
                                </div>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <button
                          onClick={() => {
                            if (!customStartTime || !customEndTime) return;
                            const st = new Date(customStartTime).getTime();
                            const et = new Date(customEndTime).getTime();
                            if (st >= et) return;
                            fetchMonitor(undefined, 'custom', st, et);
                          }}
                          disabled={!customStartTime || !customEndTime}
                          className="px-4 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary disabled:bg-accent disabled:text-muted-foreground rounded-md text-sm font-medium transition-colors"
                        >
                          查询
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 监控图表 */}
                  {monitorLoading ? (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      加载监控数据...
                    </div>
                  ) : monitorData ? (
                    <MonitorChart data={monitorData} type={monitorType} totalMemoryGB={cloudDetail?.memory || 0}
                      onDataTimeRange={handleMonitorDataTimeRange} />
                  ) : (
                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                      暂无监控数据
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ===== VNC控制台 ===== */}
            {activeTab === 'vnc' && (
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                  <h3 className="font-semibold flex items-center gap-2">
                    <ScreenShare className="w-4 h-4 text-primary" />
                    VNC控制台
                  </h3>
                </div>
                <div className="p-4">
                  <div className="text-center py-8 space-y-4">
                    <ScreenShare className="w-16 h-16 mx-auto text-primary/50" />
                    <p className="text-muted-foreground">点击下方按钮打开VNC控制台</p>
                    <p className="text-xs text-muted-foreground">VNC将在新窗口中打开，使用noVNC通过WebSocket连接</p>
                    <p className="text-xs text-muted-foreground">支持：粘贴密码 / 剪切板 / Ctrl+Alt+Del</p>
                    <button
                      onClick={handleVnc}
                      disabled={actionLoading === 'cloudVnc'}
                      className="px-6 py-3 bg-primary/10 hover:bg-primary/20 text-primary disabled:bg-accent disabled:text-muted-foreground rounded-lg transition-colors font-medium flex items-center gap-2 mx-auto"
                    >
                      {actionLoading === 'cloudVnc' ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScreenShare className="w-5 h-5" />}
                      打开VNC控制台
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 重装系统弹窗 */}
      {showReinstallDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowReinstallDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Monitor className="w-5 h-5 text-primary" />
              重装系统
            </h3>
            <div className="space-y-4">
              {/* 镜像分组 */}
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">镜像分组</label>
                <select value={reinstallForm.image_group} onChange={e => {
	                    const newGroupId = Number(e.target.value);
	                    const group = imageGroups.find((g: Record<string, any>) => Number(g.id) === newGroupId);
	                    const groupName = (group?.name || group?.group_name || '').toLowerCase();
	                    const newPort = groupName.includes('windows') ? 3389 : 22;
	                    setReinstallForm(p => ({ ...p, image_group: newGroupId, image_id: 0, port: newPort }));
	                  }}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                  <option value={0}>请选择分组</option>
                  {imageGroups
                    .filter((g: Record<string, any>) => imageList.some((img: Record<string, any>) =>
                      img.image_group_id === g.id || img.group?.id === g.id))
                    .map((g: Record<string, any>) => (
                      <option key={g.id} value={g.id}>{g.name || g.group_name || `分组${g.id}`}</option>
                    ))}
                </select>
              </div>
              {/* 选择镜像 */}
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">选择镜像</label>
                <select value={reinstallForm.image_id} onChange={e => {
	                    const newImageId = Number(e.target.value);
	                    const selectedImg = imageList.find((img: Record<string, any>) => Number(img.id) === newImageId);
	                    let newPort = reinstallForm.port;
	                    if (selectedImg) {
	                      const groupId = selectedImg.image_group_id || selectedImg.group?.id;
	                      const group = imageGroups.find((g: Record<string, any>) => Number(g.id) === Number(groupId));
	                      const groupName = (group?.name || group?.group_name || '').toLowerCase();
	                      newPort = groupName.includes('windows') ? 3389 : 22;
	                    }
	                    setReinstallForm(p => ({ ...p, image_id: newImageId, port: newPort }));
	                  }}
	                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
	                  <option value={0}>请选择镜像</option>
                  {imageList
                    .filter((img: Record<string, any>) => {
                      if (!reinstallForm.image_group) return true;
                      return img.image_group_id === reinstallForm.image_group || img.group?.id === reinstallForm.image_group;
                    })
                    .map((img: Record<string, any>) => (
                      <option key={img.id} value={img.id}>{img.name || img.filename || `镜像${img.id}`}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">新密码</label>
                <div className="flex gap-2">
                  <input type="text" value={reinstallForm.password} onChange={e => setReinstallForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="留空则自动生成" className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                  <button type="button" onClick={() => setReinstallForm(p => ({ ...p, password: generateRandomPassword() }))}
                    className="px-3 py-2 bg-accent hover:bg-accent rounded-lg text-xs text-foreground transition-colors whitespace-nowrap">
                    随机生成
                  </button>
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">SSH端口</label>
                <input type="number" value={reinstallForm.port} onChange={e => setReinstallForm(p => ({ ...p, port: Number(e.target.value) }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              {/* 系统盘大小开关 */}
              <div>
                <label className="flex items-center gap-3 text-sm text-muted-foreground cursor-pointer">
                  <div className={`relative w-10 h-5 rounded-full transition-colors ${reinstallDiskSize ? 'bg-primary/10' : 'bg-accent'}`}
                    onClick={() => setReinstallDiskSize(v => !v)}>
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card transition-transform ${reinstallDiskSize ? 'translate-x-5' : ''}`} />
                  </div>
                  自定义系统盘大小
                </label>
                {reinstallDiskSize && (
                  <div className="mt-2 ml-[52px]">
                    <label className="text-xs text-muted-foreground mb-1 block">系统盘大小 (GB)</label>
                    <input type="number" min="10" step={1}
	                      value={reinstallForm.custom_disk_size || ''}
	                      onChange={e => {
	                        setReinstallForm(p => ({ ...p, custom_disk_size: Number(e.target.value) }));
	                      }}
	                      className="w-32 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none" />
	                    <p className="text-xs text-muted-foreground mt-1">重装后系统盘将调整为此大小，默认为当前系统盘大小</p>
                  </div>
                )}
              </div>
              {/* 格式化数据盘 */}
              <label className="flex items-center gap-3 text-sm text-muted-foreground cursor-pointer">
                <div className={`relative w-10 h-5 rounded-full transition-colors ${reinstallForm.format_data_disk ? 'bg-destructive' : 'bg-accent'}`}
                  onClick={() => setReinstallForm(p => ({ ...p, format_data_disk: !p.format_data_disk }))}>
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-card transition-transform ${reinstallForm.format_data_disk ? 'translate-x-5' : ''}`} />
                </div>
                <span>格式化数据盘</span>
                {reinstallForm.format_data_disk && <span className="text-xs text-destructive">将清除所有数据盘数据</span>}
              </label>
              {/* 数据盘大小提示 */}
              {disks.filter(d => d.type !== 'system' && d.disk_type !== 'system').length > 0 && (
                <p className="text-xs text-muted-foreground">如需修改数据盘大小，请在重装后通过磁盘管理操作</p>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowReinstallDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleReinstall} disabled={!reinstallForm.image_id || !!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors">
                确认重装
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重置密码弹窗 */}
      {showResetPwdDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowResetPwdDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              重置密码
            </h3>
            <div className="flex gap-2">
              <input type="text" value={resetPwdValue} onChange={e => setResetPwdValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleResetPassword(); }}
                placeholder="输入新密码" autoFocus
                className="flex-1 px-3 py-2 bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary text-sm" />
              <button type="button" onClick={() => setResetPwdValue(generateRandomPassword())}
                className="px-3 py-2 bg-accent hover:bg-accent rounded-lg text-xs text-foreground transition-colors whitespace-nowrap">
                随机生成
              </button>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowResetPwdDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleResetPassword} disabled={!resetPwdValue.trim()}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors">确认重置</button>
            </div>
          </div>
        </div>
      )}

      {/* 添加IP弹窗 */}
      {showAddIpDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowAddIpDialog(false); setSelectedFreeIps(new Set()); }}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-lg shadow-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              添加IP地址
              {selectedFreeIps.size > 0 && (
                <span className="text-sm font-normal text-primary ml-auto">已选 {selectedFreeIps.size} 个IP</span>
              )}
            </h3>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-2">
              {freeIpLoading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />加载IP池...
                </div>
              ) : freeIpList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Globe className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p>暂无可用IP</p>
                </div>
              ) : (
                freeIpList.map(segment => {
                  const isExpanded = expandedIpSegments.has(segment.id);
                  const segmentIps = segment.ip || [];
                  const segmentSelected = segmentIps.filter((ipItem: { id: number; ip: string }) => selectedFreeIps.has(ipItem.id)).length;
                  return (
                    <div key={segment.id} className="bg-background rounded-lg border border-border overflow-hidden">
                      <button
                        onClick={() => setExpandedIpSegments(prev => {
                          const next = new Set(prev);
                          if (next.has(segment.id)) next.delete(segment.id); else next.add(segment.id);
                          return next;
                        })}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          <span className="text-sm font-medium">{segment.ip_name || `IP段 #${segment.id}`}</span>
                          <span className="text-xs text-muted-foreground">({segmentIps.length}个可用)</span>
                        </div>
                        {segmentSelected > 0 && (
                          <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">已选{segmentSelected}</span>
                        )}
                      </button>
                      {isExpanded && segmentIps.length > 0 && (
                        <div className="border-t border-border p-2 space-y-1">
                          {segmentIps.map((ipItem: { id: number; ip: string }) => {
                            const isSelected = selectedFreeIps.has(ipItem.id);
                            return (
                              <label key={ipItem.id} className="flex items-center gap-3 px-2 py-1.5 hover:bg-accent rounded cursor-pointer"
                                onClick={() => {
                                  setSelectedFreeIps(prev => {
                                    const next = new Set(prev);
                                    if (next.has(ipItem.id)) next.delete(ipItem.id); else next.add(ipItem.id);
                                    return next;
                                  });
                                }}>
                                <div className={`w-4.5 h-4.5 rounded border-2 flex items-center justify-center transition-colors ${
                                  isSelected ? 'bg-primary/10 border-primary' : 'border-border hover:border-border'
                                }`} style={{ width: '18px', height: '18px', minWidth: '18px' }}>
                                  {isSelected && <Check className="w-3 h-3 text-foreground" />}
                                </div>
                                <span className="text-sm font-mono text-foreground">{ipItem.ip}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex justify-end gap-3 mt-4 pt-3 border-t border-border">
              <button onClick={() => { setShowAddIpDialog(false); setSelectedFreeIps(new Set()); }} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleAddIp} disabled={selectedFreeIps.size === 0 || !!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2">
                {actionLoading === 'cloudAddFloatIp' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                添加 {selectedFreeIps.size > 0 ? `${selectedFreeIps.size} 个IP` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加磁盘弹窗 */}
      {showAddDiskDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddDiskDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              添加磁盘
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">磁盘大小 (GB)</label>
                <input type="number" min="1" value={addDiskForm.size} onChange={e => setAddDiskForm(p => ({ ...p, size: Number(e.target.value) }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">存储</label>
                <select value={addDiskForm.store} onChange={e => setAddDiskForm(p => ({ ...p, store: Number(e.target.value) }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                  <option value={0}>请选择存储</option>
                  {diskStores.map((s: Record<string, any>) => (
                    <option key={s.id} value={s.id}>{s.show_name || s.name || s.store_name || `存储#${s.id}`}{s.type ? ` (${s.type})` : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">磁盘驱动</label>
                <select value={addDiskForm.driver} onChange={e => setAddDiskForm(p => ({ ...p, driver: e.target.value }))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                  <option value="virtio">VirtIO</option>
                  <option value="ide">IDE</option>
                  <option value="sata">SATA</option>
                  <option value="scsi">SCSI</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowAddDiskDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleAddDisk} disabled={addDiskForm.size < 1 || !addDiskForm.store || !!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors">确认添加</button>
            </div>
          </div>
        </div>
      )}

      {/* 删除磁盘确认弹窗 */}
      {deleteDiskTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setDeleteDiskTarget(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              确认删除磁盘
            </h3>
            <p className="text-sm text-foreground mb-2">
              确定要删除磁盘 <span className="text-foreground font-medium">「{deleteDiskTarget.name}」</span> 吗？
            </p>
            <p className="text-xs text-destructive">此操作不可撤销，磁盘数据将被永久删除。</p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setDeleteDiskTarget(null)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button
                onClick={async () => {
                  setActionLoading('diskDelete');
                  setMsg({ type: 'info', text: '正在删除磁盘...' });
                  try {
                    const res = await callMfyApi('diskDelete', { diskId: deleteDiskTarget.id });
                    if (res.success) {
                      setMsg({ type: 'success', text: '磁盘删除成功' });
                      if (cloudId) { fetchCloudDetail(cloudId); setTimeout(() => fetchMfyTaskAndLog(cloudId), 3000); }
                    } else {
                      setMsg({ type: 'error', text: `删除失败: ${res.msg || '未知错误'}` });
                    }
                  } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    setMsg({ type: 'error', text: `删除异常: ${errMsg}` });
                  } finally {
                    setActionLoading(null);
                    setDeleteDiskTarget(null);
                  }
                }}
                disabled={!!actionLoading}
                className="px-4 py-2 text-sm bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {actionLoading === 'diskDelete' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 电源操作确认弹窗 */}
      {powerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPowerConfirm(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-warning" />
              确认{powerConfirm.name}
            </h3>
            <p className="text-sm text-foreground mb-2">
              确定要执行 <span className="text-foreground font-medium">「{powerConfirm.name}」</span> 操作吗？
            </p>
            {(powerConfirm.action === 'cloudHardOff' || powerConfirm.action === 'cloudHardReboot') && (
              <p className="text-xs text-destructive">强制操作可能导致数据丢失，请确认已保存重要数据。</p>
            )}
            {(powerConfirm.action === 'cloudOff' || powerConfirm.action === 'cloudReboot') && (
              <p className="text-xs text-warning">建议先在系统内正常关机/重启，强制操作可能导致数据丢失。</p>
            )}
            {powerConfirm.action === 'cloudRebuild' && (
              <p className="text-xs text-destructive">一键重建将使用当前镜像重新安装系统，所有数据将被清除。</p>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setPowerConfirm(null)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button
                onClick={() => { executePowerAction(powerConfirm.action, powerConfirm.name); setPowerConfirm(null); }}
                disabled={!!actionLoading}
                className={`px-4 py-2 text-sm rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1 ${
                  powerConfirm.action === 'cloudHardOff' || powerConfirm.action === 'cloudHardReboot' || powerConfirm.action === 'cloudRebuild' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : 'bg-primary/10 text-primary hover:bg-primary/20'
                }`}
              >
                确认{powerConfirm.name}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 扩容磁盘弹窗 */}
      {resizeDiskTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setResizeDiskTarget(null)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Edit3 className="w-5 h-5 text-primary" />
              扩容磁盘
            </h3>
            <div className="space-y-3">
              <div className="bg-background rounded-lg p-3 border border-border">
                <div className="text-sm text-muted-foreground">磁盘名称</div>
                <div className="text-sm font-medium mt-0.5">{resizeDiskTarget.name}</div>
              </div>
              <div className="bg-background rounded-lg p-3 border border-border">
                <div className="text-sm text-muted-foreground">当前大小</div>
                <div className="text-sm font-medium mt-0.5">{resizeDiskTarget.currentSize} GB</div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">新大小 (GB)</label>
                <input type="number" min={resizeDiskTarget.currentSize + 1} step={1}
                  value={resizeDiskValue} onChange={e => setResizeDiskValue(Number(e.target.value))}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                <p className="text-xs text-muted-foreground mt-1">新大小必须大于当前大小 {resizeDiskTarget.currentSize} GB</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setResizeDiskTarget(null)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button
                onClick={() => { handleResizeDisk(resizeDiskTarget.id, resizeDiskValue); setResizeDiskTarget(null); }}
                disabled={resizeDiskValue <= resizeDiskTarget.currentSize || !!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                {actionLoading === `diskResize_${resizeDiskTarget.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                确认扩容
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 财务同步结果弹窗（成功/失败需手动关闭） */}
      {syncResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onClick={() => setSyncResultModal(null)}>
          <div
            className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${
                syncResultModal.status === 'success' ? 'bg-success/15' : 'bg-destructive/15'
              }`}>
                {syncResultModal.status === 'success'
                  ? <CheckCircle className="w-7 h-7 text-success" />
                  : <XCircle className="w-7 h-7 text-destructive" />}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`text-lg font-semibold ${
                  syncResultModal.status === 'success' ? 'text-success' : 'text-destructive'
                }`}>
                  {syncResultModal.status === 'success' ? '财务同步成功' : '财务同步失败'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  触发操作：{syncResultModal.operation}
                </p>
              </div>
              <button
                onClick={() => setSyncResultModal(null)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                aria-label="关闭"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className={`mt-4 rounded-lg p-3 border text-sm ${
              syncResultModal.status === 'success'
                ? 'bg-success/10 border-success/20 text-foreground/80'
                : 'bg-destructive/10 border-destructive/20 text-foreground/80'
            }`}>
              {syncResultModal.detail}
            </div>

            {syncResultModal.status === 'fail' && (
              <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>建议：财务信息同步失败，可稍后重试或检查财务系统后台数据是否一致。实例侧操作已完成，不影响云服务器运行。</span>
              </div>
            )}

            <div className="flex justify-end mt-5">
              <button
                onClick={() => setSyncResultModal(null)}
                className={`px-5 py-2 text-sm rounded-lg transition-colors ${
                  syncResultModal.status === 'success'
                    ? 'bg-success/15 text-success hover:bg-success/25'
                    : 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                }`}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 安全组绑定弹窗 */}
      {showSecurityGroupDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSecurityGroupDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-2xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              选择安全组
            </h3>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
              {securityGroups.length === 0 && (
                <p className="text-muted-foreground text-center py-2">暂无可用安全组，可点击下方按钮新建</p>
              )}
              {securityGroups.map(sg => (
                <button key={sg.id} onClick={() => handleBindSecurityGroup(sg.id)}
                  className="w-full flex items-center gap-3 bg-background hover:bg-accent rounded-lg px-4 py-3 transition-colors text-left">
                  <Shield className="w-5 h-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{sg.name}</div>
                    <div className="text-xs text-muted-foreground">{sg.rule_num || 0} 条规则 · {sg.cloud_num || 0} 个实例</div>
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mt-4 gap-2">
              <button
                onClick={async () => {
                  try {
                    setActionLoading('securityCreate');
                    setMsg({ type: 'info', text: '正在创建默认安全组...' });
                    const uid = cloudDetail?.user_id;
                    const res = await callMfyApi('securityGroupCreate', {
                      name: '默认安全组',
                      description: '自动创建的默认安全组',
                      uid,
                      hostid: cloudId,
                      type: 'host',
                      create_default_rule: 1,
                    });
                    if (res.success) {
                      setMsg({ type: 'success', text: '默认安全组创建并绑定成功' });
                      setShowSecurityGroupDialog(false);
                      fetchCloudDetail(cloudId!);
                    } else {
                      setMsg({ type: 'error', text: `创建失败: ${res.msg || '未知错误'}` });
                    }
                  } catch {
                    setMsg({ type: 'error', text: '创建安全组异常' });
                  }
                  setActionLoading(null);
                }}
                disabled={!!actionLoading}
                className="px-3 py-1.5 text-xs bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors"
              >
                {actionLoading === 'securityCreate' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> : <Plus className="w-3.5 h-3.5 inline mr-1" />}
                新建默认安全组
              </button>
              <button onClick={() => setShowSecurityGroupDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 安全组规则添加弹窗 */}
      {showSecurityRuleDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSecurityRuleDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-primary" />
              添加安全组规则
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">方向</label>
                  <select value={securityRuleForm.direction} onChange={e => setSecurityRuleForm(p => ({ ...p, direction: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                    <option value="in">入方向</option>
                    <option value="out">出方向</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">协议</label>
                  <select value={securityRuleForm.protocol} onChange={e => setSecurityRuleForm(p => ({ ...p, protocol: e.target.value }))}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                    {['all', 'tcp', 'udp', 'icmp', 'ssh', 'http', 'https', 'rdp', 'mysql', 'redis'].map(p => (
                      <option key={p} value={p}>{p.toUpperCase()}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">端口范围</label>
                <input type="text" value={securityRuleForm.port} onChange={e => setSecurityRuleForm(p => ({ ...p, port: e.target.value }))}
                  placeholder="如: 22 或 80-443" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">授权IP</label>
                <input type="text" value={securityRuleForm.ip} onChange={e => setSecurityRuleForm(p => ({ ...p, ip: e.target.value }))}
                  placeholder="如: 0.0.0.0/0 或 192.168.1.1" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">描述</label>
                <input type="text" value={securityRuleForm.description} onChange={e => setSecurityRuleForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="规则描述" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowSecurityRuleDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleAddSecurityRule} disabled={!!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors">添加</button>
            </div>
          </div>
        </div>
      )}

      {/* 网络切换弹窗 */}
      {showNetworkSwitchDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowNetworkSwitchDialog(false)}>
          <div className="bg-card border border-border rounded-xl p-6 w-[90vw] max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Wifi className="w-5 h-5 text-primary" />
              切换网络模式
            </h3>
            <div className="space-y-4">
              <div className="bg-background rounded-lg p-3 border border-border">
                <div className="text-sm text-muted-foreground">当前模式</div>
                <div className="text-sm font-medium mt-1">
                  {cloudDetail?.network_type === 'vpc' ? 'VPC网络' : '经典网络'}
                  {cloudDetail?.vpc_name && ` (${cloudDetail.vpc_name})`}
                </div>
              </div>
              <div className="bg-background rounded-lg p-3 border border-border">
                <div className="text-sm text-muted-foreground">目标模式</div>
                <div className="text-sm font-medium mt-1">
                  {networkSwitchTarget === 'vpc' ? 'VPC网络' : '经典网络'}
                </div>
              </div>

              {networkSwitchTarget === 'vpc' && (
                <div className="space-y-3">
                  {vpcNetworks.length > 0 && (
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">选择已有VPC网络</label>
                      <select value={selectedVpcId} onChange={e => { setSelectedVpcId(Number(e.target.value)); setVpcIpSegment(''); }}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none">
                        <option value={0}>新建VPC网络</option>
                        {vpcNetworks.map((vpc: Record<string, any>) => (
                          <option key={vpc.id} value={vpc.id}>{vpc.name} ({vpc.ips})</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {selectedVpcId === 0 && (
                    <div>
                      <label className="text-sm text-muted-foreground mb-1 block">VPC IP段</label>
                      <input type="text" value={vpcIpSegment} onChange={e => setVpcIpSegment(e.target.value)}
                        placeholder="如: 192.168.1.0/24"
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:border-primary focus:outline-none" />
                      <p className="text-xs text-muted-foreground mt-1">支持 192.168.0.0/16, 172.16.0.0/12, 10.0.0.0/8 的子网，掩码 /16-/28</p>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-warning/10 border border-warning/30 rounded-lg p-3">
                <p className="text-xs text-warning">切换网络模式将导致实例网络中断，请确认操作。</p>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setShowNetworkSwitchDialog(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">取消</button>
              <button onClick={handleSwitchNetwork} disabled={!!actionLoading}
                className="px-4 py-2 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2">
                {actionLoading === 'networkSwitch' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                确认切换
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 任务与日志浮动面板 */}
      {cloudId && (
        <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
          {/* 点击遮罩关闭 */}
          {showTaskPanel && (
            <div className="fixed inset-0 z-[-1]" onClick={() => setShowTaskPanel(false)} />
          )}
          {/* 展开的面板内容 */}
          {showTaskPanel && (
            <div className="bg-card border border-border rounded-xl shadow-2xl w-[90vw] max-w-md max-h-[70vh] flex flex-col overflow-hidden">
              {/* 面板头部 */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <ListChecks className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">任务与日志</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => cloudId && fetchMfyTaskAndLog(cloudId)}
                    disabled={taskLogLoading}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title="刷新"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${taskLogLoading ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={() => setShowTaskPanel(false)} className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* TAB栏 */}
              <div className="flex border-b border-border shrink-0">
                <button
                  onClick={() => setTaskLogTab('tasks')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors relative ${
                    taskLogTab === 'tasks' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  后台任务
                  {mfyTasks.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      taskLogTab === 'tasks' ? 'bg-primary/10 text-primary' : 'bg-accent text-muted-foreground'
                    }`}>
                      {mfyTasks.length}
                    </span>
                  )}
                  {taskLogTab === 'tasks' && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary/10 rounded-t" />}
                </button>
                <button
                  onClick={() => setTaskLogTab('logs')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors relative ${
                    taskLogTab === 'logs' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  操作日志
                  {mfyLogs.length > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                      taskLogTab === 'logs' ? 'bg-primary/10 text-primary' : 'bg-accent text-muted-foreground'
                    }`}>
                      {mfyLogs.length}
                    </span>
                  )}
                  {taskLogTab === 'logs' && <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-primary/10 rounded-t" />}
                </button>
              </div>

              {/* 内容区 */}
              <div className="flex-1 overflow-y-auto min-h-0">
                {/* 后台任务TAB */}
                {taskLogTab === 'tasks' && (
                  mfyTasks.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">暂无后台任务</div>
                  ) : (
                    mfyTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors border-b border-border/50 last:border-b-0">
                        {task.status === 1 && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                        {task.status === 2 && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
                        {(task.status === 3 || task.status === 4) && <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                        {task.status === 0 && <Clock className="w-4 h-4 text-muted-foreground shrink-0" />}
                        {task.status === 5 && <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <span className="text-sm flex-1 truncate">{task.type_desc || task.type}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                          task.status === 1 ? 'bg-primary/10 text-primary' :
                          task.status === 2 ? 'bg-success/15 text-success' :
                          task.status === 3 ? 'bg-destructive/15 text-destructive' :
                          'bg-accent text-muted-foreground'
                        }`}>
                          {task.status_label}
                        </span>
                        {task.progress > 0 && task.status === 1 && (
                          <span className="text-xs text-muted-foreground shrink-0">{task.progress}%</span>
                        )}
                        {task.create_time && (
                          <span className="text-[10px] text-muted-foreground shrink-0">{task.create_time}</span>
                        )}
                      </div>
                    ))
                  )
                )}

                {/* 操作日志TAB */}
                {taskLogTab === 'logs' && (
                  mfyLogs.length === 0 ? (
                    <div className="px-4 py-8 text-center text-muted-foreground text-sm">暂无操作日志</div>
                  ) : (
                    mfyLogs.map(log => (
                      <div key={log.id} className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors border-b border-border/50 last:border-b-0">
                        <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2">
                            <span className="text-sm break-all flex-1" title={log.des}>{log.des}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                              {log.create_time}
                            </span>
                          </div>
                          {log.username && (
                            <p className="text-xs text-muted-foreground mt-0.5">操作人: {log.username}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>
            </div>
          )}

          {/* 浮动切换按钮 */}
          <button
            onClick={() => {
              setShowTaskPanel(v => !v);
              if (!showTaskPanel && cloudId) fetchMfyTaskAndLog(cloudId);
            }}
            className="relative flex items-center justify-center w-11 h-11 bg-card border border-border rounded-full shadow-lg hover:bg-accent transition-colors"
            title="任务与日志"
          >
            {showTaskPanel ? (
              <ChevronDown className="w-5 h-5 text-foreground" />
            ) : (
              <ListChecks className="w-5 h-5 text-foreground" />
            )}
            {mfyTasks.filter(t => t.status === 1).length > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                {mfyTasks.filter(t => t.status === 1).length}
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdvancedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">加载中...</div>}>
      <AdvancedContent />
    </Suspense>
  );
}

// ===== 子组件 =====

function InfoItem({ icon: Icon, label, value }: { icon?: typeof Server; label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {Icon && <Icon className="w-3 h-3" />}
        {label}
      </div>
      <div className="text-sm font-medium truncate" title={value}>{value}</div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!value || value === '-') return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button onClick={handleCopy} className="p-1 text-muted-foreground hover:text-foreground transition-colors shrink-0" title="复制">
      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function InfoItemCopy({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {label}
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium truncate flex-1" title={value}>{value}</span>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, loading, disabled, onClick }: {
  icon: typeof Power; label: string; color: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-success hover:bg-success/90 text-success-foreground',
    yellow: 'bg-warning hover:bg-warning/90 text-warning-foreground',
    blue: 'bg-info hover:bg-info/90 text-info-foreground',
    orange: 'bg-primary hover:bg-primary/90 text-primary-foreground',
    red: 'bg-destructive hover:bg-destructive/90 text-destructive-foreground',
    cyan: 'bg-info hover:bg-info/90 text-info-foreground',
    purple: 'bg-accent2 hover:bg-accent2/90 text-accent2-foreground',
  };
  const disabledClass = 'bg-accent text-muted-foreground cursor-not-allowed';

  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`flex flex-col items-center gap-1 py-2 px-1.5 rounded-lg transition-colors text-xs font-medium ${
        disabled || loading ? disabledClass : colorMap[color] || colorMap['blue']
      }`}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {label}
    </button>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background rounded-lg p-3 border border-border">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className="text-sm font-semibold text-foreground truncate" title={value}>{value}</div>
    </div>
  );
}

// 监控图表组件 - 纯CSS实现折线图
function MonitorChart({ data, type, totalMemoryGB, onDataTimeRange }: {
  data: Record<string, any>; type: string; totalMemoryGB?: number;
  onDataTimeRange?: (start: number, end: number) => void;
}) {
  const chartData = data?.data || data;

  // 总内存（字节）- API返回的memory单位是GB
  const totalMemBytes = (totalMemoryGB || 0) * 1024 * 1024 * 1024;

  // 类型配置：seriesIndex指定从API返回数据中取第几个值
  // kvm_info格式: point[0]=时间戳, point[1]=CPU(%), point[2]=内存总量(B), point[3]=内存已用(B)
  const typeConfig: Record<string, { label: string; seriesIndex: number; unit: string; color: string }> = {
    'cpu': { label: 'CPU使用率', seriesIndex: 0, unit: '%', color: '#a855f7' },
    'memory_total': { label: '内存总量', seriesIndex: 1, unit: 'B', color: '#6b7280' },
    'memory_used': { label: '内存已用', seriesIndex: 2, unit: 'B', color: '#06b6d4' },
    'net_adapter_recv': { label: '接收', seriesIndex: 0, unit: 'B', color: '#22c55e' },
    'net_adapter_send': { label: '发送', seriesIndex: 1, unit: 'B', color: '#f97316' },
    'disk_io_read': { label: '读取', seriesIndex: 0, unit: 'B', color: '#3b82f6' },
    'disk_io_write': { label: '写入', seriesIndex: 1, unit: 'B', color: '#ef4444' },
    'disk_iops_read': { label: '读取IOPS', seriesIndex: 2, unit: 'IOPS', color: '#3b82f6' },
    'disk_iops_write': { label: '写入IOPS', seriesIndex: 3, unit: 'IOPS', color: '#ef4444' },
    'pps_recv': { label: '接收', seriesIndex: 0, unit: 'pps', color: '#22c55e' },
    'pps_send': { label: '发送', seriesIndex: 1, unit: 'pps', color: '#f97316' },
  };

  // 根据type确定要展示的系列
  const getSeriesForType = (t: string): Array<{ label: string; seriesIndex: number; unit: string; color: string }> => {
    if (t === 'cpu') return [typeConfig.cpu];
    if (t === 'memory') return [typeConfig.memory_total, typeConfig.memory_used];
    if (t === 'net_adapter') return [typeConfig.net_adapter_recv, typeConfig.net_adapter_send];
    if (t === 'disk_io') return [typeConfig.disk_io_read, typeConfig.disk_io_write];
    if (t === 'disk_iops') return [typeConfig.disk_iops_read, typeConfig.disk_iops_write];
    if (t === 'pps') return [typeConfig.pps_recv, typeConfig.pps_send];
    return [{ label: '值', seriesIndex: 0, unit: '', color: '#a855f7' }];
  };

  const series = getSeriesForType(type);
  const isMemoryType = type === 'memory';

  if (!Array.isArray(chartData) || chartData.length === 0) {
    return <p className="text-muted-foreground text-center py-8">暂无监控数据</p>;
  }

  // 提取时间序列和值
  const timestamps: number[] = [];
  const allSeriesValues: number[][] = []; // allSeriesValues[seriesIdx][pointIdx]

  chartData.forEach((point: Array<number>) => {
    if (!Array.isArray(point) || point.length < 2) return;
    timestamps.push(point[0]);
    series.forEach((s, sIdx) => {
      if (!allSeriesValues[sIdx]) allSeriesValues[sIdx] = [];
      const rawVal = point[s.seriesIndex + 1]; // point[0]是时间戳
      allSeriesValues[sIdx].push(typeof rawVal === 'number' && !isNaN(rawVal) ? rawVal : 0);
    });
  });

  if (timestamps.length === 0) {
    return <p className="text-muted-foreground text-center py-8">暂无监控数据</p>;
  }

  // 回调数据时间范围 - 使用useEffect避免渲染期间setState
  const timeStart = timestamps.length > 0 ? timestamps[0] : 0;
  const timeEnd = timestamps.length > 0 ? timestamps[timestamps.length - 1] : 0;
  useEffect(() => {
    if (onDataTimeRange && timeStart > 0 && timeEnd > 0) {
      onDataTimeRange(timeStart, timeEnd);
    }
  }, [onDataTimeRange, timeStart, timeEnd]);

  // 格式化值
  const formatValue = (val: number, unit: string): string => {
    if (unit === '%') return `${val.toFixed(1)}%`;
    if (unit === 'IOPS' || unit === 'pps') return Math.round(val).toLocaleString();
    if (Math.abs(val) >= 1073741824) return `${(val / 1073741824).toFixed(2)} GB`;
    if (Math.abs(val) >= 1048576) return `${(val / 1048576).toFixed(2)} MB`;
    if (Math.abs(val) >= 1024) return `${(val / 1024).toFixed(2)} KB`;
    return `${val.toFixed(0)} B`;
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // 采样
  const maxPoints = 80;
  const step = Math.max(1, Math.floor(timestamps.length / maxPoints));
  const sampledTs = timestamps.filter((_, i) => i % step === 0);
  const sampledVals = allSeriesValues.map(vals => vals.filter((_, i) => i % step === 0));

  // 统计
  const stats = series.map((s, idx) => {
    const vals = (sampledVals[idx] || []).filter(v => !isNaN(v) && v >= 0);
    const max = vals.length > 0 ? Math.max(...vals) : 0;
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const current = vals.length > 0 ? vals[vals.length - 1] : 0;
    return { ...s, max, avg, current };
  });

  // SVG尺寸
  const chartWidth = 600;
  const chartHeight = 200;
  const padding = { top: 15, right: 12, bottom: 30, left: 50 };
  const plotWidth = chartWidth - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;

  // 计算Y轴最大值
  const allVals = sampledVals.flat().filter(v => !isNaN(v) && v >= 0);
  const dataMaxVal = allVals.length > 0 ? allVals.reduce((max, v) => v > max ? v : max, 1) : 1;
  // CPU类型Y轴固定0-100%，其他类型顶部留10%余量避免数据被裁剪
  const maxVal = type === 'cpu' ? 100 : Math.ceil(dataMaxVal * 1.1);

  return (
    <div className="space-y-4">
      {/* 内存类型特殊统计：已用+总量+使用率 */}
      {isMemoryType && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-3">
          <div className="bg-background rounded-lg p-2.5 sm:p-3 border border-border">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-2 h-2 rounded-full bg-info" />
              <span className="text-[10px] sm:text-xs text-muted-foreground">已用内存</span>
            </div>
            <div className="text-sm sm:text-lg font-semibold text-foreground">{formatValue(stats[1]?.current || 0, 'B')}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              使用率: {stats[0]?.current > 0 ? ((stats[1]?.current || 0) / stats[0].current * 100).toFixed(1) : 0}%
            </div>
          </div>
          <div className="bg-background rounded-lg p-2.5 sm:p-3 border border-border">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-[10px] sm:text-xs text-muted-foreground">总内存</span>
            </div>
            <div className="text-sm sm:text-lg font-semibold text-foreground">{formatValue(stats[0]?.current || 0, 'B')}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              {totalMemoryGB} GB
            </div>
          </div>
          <div className="bg-background rounded-lg p-2.5 sm:p-3 border border-border col-span-2 sm:col-span-1">
            <div className="flex items-center gap-1.5 mb-1.5">
              <div className="w-2 h-2 rounded-full bg-warning" />
              <span className="text-[10px] sm:text-xs text-muted-foreground">峰值已用</span>
            </div>
            <div className="text-sm sm:text-lg font-semibold text-foreground">{formatValue(stats[1]?.max || 0, 'B')}</div>
            <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
              峰值率: {stats[0]?.current > 0 ? ((stats[1]?.max || 0) / stats[0].current * 100).toFixed(1) : 0}%
            </div>
          </div>
        </div>
      )}

      {/* 非内存类型的统计概览 */}
      {!isMemoryType && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3">
          {stats.map((s, idx) => (
            <div key={idx} className="bg-background rounded-lg p-2.5 sm:p-3 border border-border">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] sm:text-xs text-muted-foreground">{s.label}</span>
              </div>
              <div className="text-sm sm:text-lg font-semibold text-foreground">{formatValue(s.current, s.unit)}</div>
              <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                均: {formatValue(s.avg, s.unit)} | 峰: {formatValue(s.max, s.unit)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SVG折线图 - 带hover tooltip */}
      <div className="bg-background rounded-lg p-2 sm:p-4 border border-border overflow-x-auto">
        <MonitorSvgChart
          sampledTs={sampledTs}
          sampledVals={sampledVals}
          series={series}
          maxVal={maxVal}
          formatValue={formatValue}
          formatTime={formatTime}
          chartWidth={chartWidth}
          chartHeight={chartHeight}
          padding={padding}
          plotWidth={plotWidth}
          plotHeight={plotHeight}
          isMemoryType={isMemoryType}
          totalMemBytes={totalMemBytes}
          type={type}
        />
      </div>

      {/* 原始数据折叠 */}
      <details className="text-sm">
        <summary className="text-muted-foreground cursor-pointer hover:text-foreground">查看原始数据</summary>
        <pre className="mt-2 bg-background rounded-lg p-3 text-xs text-muted-foreground overflow-auto max-h-60">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

// 带tooltip和滚轮缩放的SVG折线图
function MonitorSvgChart({
  sampledTs, sampledVals, series, maxVal, formatValue, formatTime,
  chartWidth, chartHeight, padding, plotWidth, plotHeight,
  isMemoryType, totalMemBytes, type,
}: {
  sampledTs: number[];
  sampledVals: number[][];
  series: Array<{ label: string; unit: string; color: string }>;
  maxVal: number;
  formatValue: (v: number, u: string) => string;
  formatTime: (ts: number) => string;
  chartWidth: number;
  chartHeight: number;
  padding: { top: number; right: number; bottom: number; left: number };
  plotWidth: number;
  plotHeight: number;
  isMemoryType?: boolean;
  totalMemBytes?: number;
  type: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // 缩放范围：可见数据的起止索引
  const sampledTsLen = sampledTs.length;
  const [viewRange, setViewRange] = useState<[number, number]>([0, sampledTsLen - 1]);

  // 数据长度变化时重置缩放状态（用length而非数组引用避免每次render都触发）
  useEffect(() => {
    setViewRange([0, sampledTsLen - 1]);
  }, [sampledTsLen]);

  const totalLen = sampledTs.length;
  const startIdx = viewRange[0];
  const endIdx = viewRange[1];
  const visibleLen = endIdx - startIdx + 1;

  // 当前可见数据
  const visibleTs = sampledTs.slice(startIdx, endIdx + 1);
  const visibleVals = sampledVals.map(vals => vals.slice(startIdx, endIdx + 1));

  // 重新计算可见区域的坐标函数
  const getPointX = (i: number) => padding.left + (i / Math.max(visibleLen - 1, 1)) * plotWidth;
  const getPointY = (val: number) => padding.top + plotHeight * (1 - val / maxVal);

  const svgRef = useRef<SVGSVGElement>(null);

  // 滚轮缩放（原生事件，non-passive 以阻止页面滚动）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const scaleX = chartWidth / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      const plotX = mouseX - padding.left;
      const ratio = Math.max(0, Math.min(1, plotX / plotWidth));
      const mouseIdx = startIdx + Math.round(ratio * (visibleLen - 1));
      const zoomFactor = e.deltaY > 0 ? 1.3 : 0.7;
      const newLen = Math.max(5, Math.min(totalLen, Math.round(visibleLen * zoomFactor)));
      let newStart = Math.round(mouseIdx - (mouseIdx - startIdx) / visibleLen * newLen);
      let newEnd = newStart + newLen - 1;
      if (newStart < 0) { newStart = 0; newEnd = Math.min(totalLen - 1, newLen - 1); }
      if (newEnd >= totalLen) { newEnd = totalLen - 1; newStart = Math.max(0, totalLen - newLen); }
      setViewRange([newStart, newEnd]);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [startIdx, endIdx, visibleLen, totalLen, chartWidth, padding, plotWidth]);

  // 双击重置缩放
  const handleDoubleClick = () => setViewRange([0, totalLen - 1]);

  // 找到鼠标最近的点（RAF节流避免高频setState）
  const rafRef = useRef<number>(0);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const clientX = e.clientX;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = chartWidth / rect.width;
      const mouseX = (clientX - rect.left) * scaleX;
      const plotX = mouseX - padding.left;
      const ratio = Math.max(0, Math.min(1, plotX / plotWidth));
      const idx = Math.round(ratio * (visibleLen - 1));
      setHoverIdx(Math.max(0, Math.min(visibleLen - 1, idx)));
    });
  };

  const handleMouseLeave = () => setHoverIdx(null);

  // 缩放提示文字
  const isZoomed = startIdx > 0 || endIdx < totalLen - 1;
  const zoomLabel = isZoomed
    ? `${formatTime(visibleTs[0])} ~ ${formatTime(visibleTs[visibleTs.length - 1])} (双击重置)`
    : '滚轮缩放查看详情';

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: 'crosshair' }}
      >
        {/* 网格线 */}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
          <line key={ratio}
            x1={padding.left} y1={padding.top + plotHeight * (1 - ratio)}
            x2={padding.left + plotWidth} y2={padding.top + plotHeight * (1 - ratio)}
            stroke="#374151" strokeWidth="0.5" strokeDasharray="4,4"
          />
        ))}

        {/* 折线 */}
        {visibleVals.map((values, sIdx) => {
          const points = visibleTs.map((_, i) => {
            const x = getPointX(i);
            const val = typeof values[i] === 'number' && !isNaN(values[i]) ? values[i] : 0;
            const y = getPointY(val);
            return `${x},${y}`;
          }).join(' ');

          return (
            <polyline
              key={sIdx}
              points={points}
              fill="none"
              stroke={series[sIdx]?.color || '#a855f7'}
              strokeWidth="1.5"
              strokeLinejoin="miter"
            />
          );
        })}

        {/* 内存总容量参考线 */}
        {isMemoryType && totalMemBytes && totalMemBytes > 0 && (() => {
          const y = getPointY(totalMemBytes);
          return (
            <g>
              <line x1={padding.left} y1={y} x2={padding.left + plotWidth} y2={y}
                stroke="#ef4444" strokeWidth="1" strokeDasharray="6,3" />
              <text x={padding.left + plotWidth - 3} y={y - 4} textAnchor="end" fill="#ef4444" fontSize="9" fontWeight="500">
                总内存 {formatValue(totalMemBytes, 'B')}
              </text>
            </g>
          );
        })()}

        {/* hover竖线 + 数据点 + tooltip */}
        {hoverIdx !== null && hoverIdx < visibleLen && (
          <>
            {/* 竖线 */}
            <line
              x1={getPointX(hoverIdx)} y1={padding.top}
              x2={getPointX(hoverIdx)} y2={padding.top + plotHeight}
              stroke="#6b7280" strokeWidth="0.8" strokeDasharray="3,3"
            />
            {/* 数据点圆圈 */}
            {visibleVals.map((values, sIdx) => {
              const val = typeof values[hoverIdx] === 'number' && !isNaN(values[hoverIdx]) ? values[hoverIdx] : 0;
              return (
                <circle key={sIdx}
                  cx={getPointX(hoverIdx)} cy={getPointY(val)}
                  r="3.5" fill={series[sIdx]?.color || '#a855f7'}
                  stroke="#0f1117" strokeWidth="1.5"
                />
              );
            })}
            {/* tooltip框 */}
            {(() => {
              const tx = getPointX(hoverIdx);
              const memExtraLine = isMemoryType ? 1 : 0;
              const tooltipW = isMemoryType ? 170 : 145;
              const tooltipH = 18 + (series.length + memExtraLine) * 16 + 14;
              const tooltipX = tx + 8 + tooltipW > chartWidth - padding.right ? tx - tooltipW - 8 : tx + 8;
              const tooltipY = padding.top + 3;
              return (
                <g>
                  <rect x={tooltipX} y={tooltipY} width={tooltipW} height={tooltipH}
                    rx="5" fill="rgba(15,17,23,0.95)" stroke="#374151" strokeWidth="0.8" />
                  <text x={tooltipX + 8} y={tooltipY + 13} fill="#9CA3AF" fontSize="9" fontWeight="500">
                    {formatTime(visibleTs[hoverIdx])}
                  </text>
                  {series.map((s, sIdx) => {
                    const val = typeof visibleVals[sIdx]?.[hoverIdx] === 'number' && !isNaN(visibleVals[sIdx][hoverIdx])
                      ? visibleVals[sIdx][hoverIdx] : 0;
                    return (
                      <g key={sIdx}>
                        <circle cx={tooltipX + 12} cy={tooltipY + 28 + sIdx * 16} r="2.5" fill={s.color} />
                        <text x={tooltipX + 18} y={tooltipY + 31 + sIdx * 16} fill="#d1d5db" fontSize="9">
                          {s.label}: {formatValue(val, s.unit)}
                        </text>
                      </g>
                    );
                  })}
                  {/* 内存使用率 */}
                  {isMemoryType && (() => {
                    const totalVal = typeof visibleVals[0]?.[hoverIdx] === 'number' && !isNaN(visibleVals[0][hoverIdx])
                      ? visibleVals[0][hoverIdx] : 0;
                    const usedVal = typeof visibleVals[1]?.[hoverIdx] === 'number' && !isNaN(visibleVals[1][hoverIdx])
                      ? visibleVals[1][hoverIdx] : 0;
                    const pct = totalVal > 0 ? (usedVal / totalVal * 100).toFixed(1) : '0.0';
                    const yOff = tooltipY + 31 + series.length * 16;
                    return (
                      <text x={tooltipX + 12} y={yOff} fill="#ef4444" fontSize="9" fontWeight="500">
                        使用率: {pct}%
                      </text>
                    );
                  })()}
                </g>
              );
            })()}
          </>
        )}

        {/* Y轴标签 */}
        {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
          <text key={ratio}
            x={padding.left - 4} y={padding.top + plotHeight * (1 - ratio) + 3}
            textAnchor="end" fill="#9CA3AF" fontSize="9">
            {formatValue(maxVal * ratio, series[0]?.unit || '')}
          </text>
        ))}

        {/* X轴标签 */}
        {visibleTs.filter((_, i) => i % Math.max(1, Math.floor(visibleLen / 5)) === 0).map((ts, i) => {
          const idx = visibleTs.indexOf(ts);
          const x = getPointX(idx);
          return (
            <text key={i} x={x} y={chartHeight - 4} textAnchor="middle" fill="#9CA3AF" fontSize="9">
              {formatTime(ts)}
            </text>
          );
        })}
      </svg>
      {/* 缩放提示 */}
      <div className="text-center text-xs text-muted-foreground mt-1">{zoomLabel}</div>
    </div>
  );
}
