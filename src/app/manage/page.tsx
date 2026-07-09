'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, RefreshCw, Power, PowerOff, RotateCcw,
  Pause, Play, Monitor, Server, Globe, Hash,
  Loader2, CheckCircle, XCircle, AlertCircle, ArrowUpCircle,
  ArrowUpDown, FileText, Edit3, Save, Cpu, MemoryStick, Wifi, HardDrive, X,
  Zap, ScreenShare, KeyRound, Shield
} from 'lucide-react';
import MobileSidebar from '@/components/mobile-sidebar';

const STORAGE_KEY = 'idc_auth';
const ENCRYPT_KEY = 'idc-auth-enc-2026';

function decryptAuth(encoded: string): string {
  try {
    const decoded = atob(encoded);
    let result = '';
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(decoded.charCodeAt(i) ^ ENCRYPT_KEY.charCodeAt(i % ENCRYPT_KEY.length));
    }
    return result;
  } catch {
    return '';
  }
}

interface ServerStatus {
  powerStatus: string;       // 电源状态: on/off
  cpuUsage: string;          // CPU使用率
  memUsage: string;          // 内存使用率
  diskUsage: string;         // 磁盘使用率
  bandwidthUsage: string;    // 带宽使用
  uptime: string;            // 运行时间
  osRunning: string;         // 运行中的系统
  [key: string]: unknown;    // 其他状态字段
}

interface ProductInfo {
  id: number;
  name: string;
  domain: string;
  ip: string;
  hostname: string;
  os: string;
  status: string;
  statusColor: string;
  billingcycle: string;
  amount: string;
  nextduedate: string;
  regdate: string;
  username: string;
  password: string;
  serverid: number;
  dedicatedip: string;
  osUrl: string;
  ram: string;
  cpu: string;
  bw: string;
  traffic: string;
  node: string;
  configMap: Record<string, string>;
  serverStatus: ServerStatus | null;
  [key: string]: unknown;
}

// 字段中文映射
const FIELD_LABELS: Record<string, string> = {
  id: '产品ID',
  uid: '用户ID',
  orderid: '订单ID',
  productid: '产品套餐ID',
  serverid: '服务器ID',
  regdate: '开通时间',
  domain: '主机标识',
  payment: '支付方式',
  last_settle: '上次结算',
  nextinvoicedate: '下次账单日',
  termination_date: '终止日期',
  completed_date: '完成日期',
  username: '用户名',
  password: '密码',
  promoid: '促销ID',
  suspendreason: '暂停原因',
  overrideautosuspend: '自动暂停覆盖',
  overridesuspenduntil: '暂停覆盖截止',
  dedicatedip: '独立IP',
  assignedips: '其他IP',
  ns1: 'NS1',
  ns2: 'NS2',
  diskusage: '磁盘用量',
  disklimit: '磁盘限额',
  bwusage: '流量用量',
  bwlimit: '流量限额',
  user_cate_id: '用户分类',
  lastupdate: '最后更新',
  create_time: '创建时间',
  update_time: '更新时间',
  suspend_time: '暂停时间',
  auto_terminate_end_cycle: '到期自动终止',
  auto_terminate_reason: '自动终止原因',
  dcimid: 'DCIM ID',
  dcim_os: 'DCIM系统',
  os: '操作系统',
  os_url: '系统标识',
  reinstall_info: '重装信息',
  show_last_act_message: '显示最近操作',
  port: '端口',
  dcim_area: 'DCIM区域',
  flag: '标记',
  flag_cycle: '标记周期',
  initiative_renew: '主动续费',
  agent_client: '代理客户',
  percent_value: '百分比值',
  firstpaymentamount: '首次价格',
  amount: '续费价格',
  billingcycle: '计费周期',
  domainstatus: '产品状态',
  nextduedate: '到期时间',
  hostid: '主机ID',
};

// 时间戳字段（自动转为可读日期）
const TIMESTAMP_FIELDS = [
  'regdate', 'nextduedate', 'nextinvoicedate', 'termination_date',
  'completed_date', 'lastupdate', 'create_time', 'update_time',
  'suspend_time', 'overridesuspenduntil',
];

function ManageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hostid = searchParams.get('hostid') || '';
  const uidParam = searchParams.get('uid') || '';

  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showCrackPassDialog, setShowCrackPassDialog] = useState(false);
  const [crackPassValue, setCrackPassValue] = useState('');
  const [powerConfirm, setPowerConfirm] = useState<{ action: string; name: string } | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const reloginInProgress = useRef(false);
  const fetchInProgress = useRef(false);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusFetchInProgress = useRef(false);

  // 从 localStorage 读取认证信息
  const loadAuth = useCallback((): { url?: string; token?: string; cookie?: string; username?: string; password?: string } => {
    if (typeof window === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    try {
      const data = JSON.parse(raw);
      return {
        token: data.token || '',
        cookie: data.cookie || '',
        username: data.username ? decryptAuth(data.username) : '',
        password: data.password ? decryptAuth(data.password) : '',
      };
    } catch { return {}; }
  }, []);

  // 保存认证信息到 localStorage
  const saveAuth = useCallback((data: Record<string, unknown>) => {
    if (typeof window === 'undefined') return;
    const raw = loadAuth();
    const merged = { ...raw, ...data };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  }, [loadAuth]);

  // 判断当前用户是否为管理员
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const auth = loadAuth();
        const currentUsername = auth.username || '';
        if (!currentUsername) return;
        const resp = await fetch('/api/config');
        const config = await resp.json();
        const adminList = (config.adminUsernames || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        setIsAdminUser(adminList.includes(currentUsername));
      } catch { /* ignore */ }
    };
    checkAdmin();
  }, [loadAuth]);

  // 自动重新登录（session过期时）
  const autoRelogin = useCallback(async (): Promise<boolean> => {
    if (reloginInProgress.current) return false;
    reloginInProgress.current = true;
    try {
      const saved = loadAuth();
      if (!saved.username || !saved.password) return false;
      const url = saved.url || '';
      if (!url) return false;

      const testResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', url }),
      });
      const testData = await testResp.json();
      if (testData.captchaEnabled) return false;
      const newCookie = testData.cookie || '';

      const loginResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          url,
          username: saved.username,
          password: saved.password,
          cookie: newCookie,
        }),
      });
      const loginData = await loginResp.json();
      if (loginData.success) {
        const token = loginData.token || 'authenticated';
        const cookie = loginData.cookie || '';
        saveAuth({ token, cookie });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      reloginInProgress.current = false;
    }
  }, [loadAuth, saveAuth]);

  // 调用IDC后台API的统一方法（带自动重登）
  // 使用 useRef 避免闭包问题导致无限循环
  const callIdcApiRef = useRef<(action: string, params?: Record<string, unknown>, retry?: boolean) => Promise<Record<string, any>>>(
    async () => ({})
  );

  callIdcApiRef.current = async (action: string, params: Record<string, unknown> = {}, retry = true): Promise<Record<string, any>> => {
    const auth = loadAuth();
    const cookie = auth.cookie || '';
    const url = auth.url || '';
    const token = auth.token || '';

    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, url, token, cookie, ...params }),
    });
    const data = await response.json() as Record<string, unknown>;

    // 如果返回未登录，尝试自动重新登录
    if (retry && (
      data.status === 401 || data.status === 405 ||
      data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录' ||
      (data.success === false && typeof data.message === 'string' && data.message.includes('非JSON'))
    )) {
      const relogined = await autoRelogin();
      if (relogined) {
        const freshAuth = loadAuth();
        const freshCookie = freshAuth.cookie || '';
        const retryResp = await fetch('/api/idc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, url, token: freshAuth.token || token, cookie: freshCookie, ...params }),
        });
        return retryResp.json();
      } else {
        setActionMsg({ type: 'error', text: '登录已过期，请返回首页重新登录' });
      }
    }
    return data;
  };

  // 安全提取字段：后台可能返回对象而非字符串
  const extractStr = useCallback((val: unknown): string => {
    if (val == null) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      return String(obj.billingcycle_zh || obj.name || obj.value || obj.billingcycle || '');
    }
    return String(val);
  }, []);

  const extractNum = useCallback((val: unknown): number => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return Number(val) || 0;
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      return Number(obj.value || obj.id || 0);
    }
    return 0;
  }, []);

  // 从原始产品数据解析为 ProductInfo
  const parseProductData = useCallback((productData: Record<string, any>): ProductInfo => {
    const domainstatus = productData?.domainstatus;
    const statusName = typeof domainstatus === 'object' && domainstatus !== null
      ? (domainstatus as Record<string, unknown>).name || ''
      : typeof domainstatus === 'string' ? domainstatus : '';

    // DCIMCloud 详情可能返回 os_url（系统图标URL）
    const osUrl = extractStr(productData?.os_url || productData?.os_image || '');

    return {
      id: extractNum(productData?.id) || Number(hostid),
      name: extractStr(productData?.product_name || productData?.productname || productData?.name || productData?.pname) || '未知产品',
      domain: extractStr(productData?.domain),
      ip: extractStr(productData?.dedicatedip || productData?.ip || productData?.assignedips || productData?.mainip),
      hostname: extractStr(productData?.hostname || productData?.host_name),
      os: extractStr(productData?.os || productData?.operating_system || productData?.os_name),
      status: statusName,
      statusColor: typeof domainstatus === 'object' ? String((domainstatus as Record<string, unknown>).color || '') : '',
      billingcycle: extractStr(productData?.billingcycle || productData?.billing_cycle),
      amount: extractStr(productData?.amount || productData?.firstpaymentamount || productData?.recurringamount || '0'),
      nextduedate: extractStr(productData?.nextduedate),
      regdate: extractStr(productData?.regdate),
      username: extractStr(productData?.username),
      password: extractStr(productData?.password),
      serverid: extractNum(productData?.serverid),
      dedicatedip: extractStr(productData?.dedicatedip),
      osUrl,
      ram: extractStr(productData?.ram || productData?.memory || productData?.mem),
      cpu: extractStr(productData?.cpu || productData?.core || productData?.vcpu),
      bw: extractStr(productData?.bw || productData?.bandwidth || productData?.bandwidthlimit),
      traffic: extractStr(productData?.traffic || productData?.traffic_limit),
      node: extractStr(productData?.node || productData?.node_name || productData?.area),
      pid: extractNum(productData?.productid || productData?.pid),
      configMap: (productData?._configMap as Record<string, string>) || {},
      serverStatus: null, // 实时状态单独获取
    } as unknown as ProductInfo;
  }, [hostid, extractStr, extractNum]);

  const fetchProductDetail = useCallback(async () => {
    if (!hostid || fetchInProgress.current) return;
    fetchInProgress.current = true;
    setIsLoading(true);
    try {
      const api = callIdcApiRef.current;
      const numericHostid = Number(hostid);
      let productData: Record<string, any> | null = null;

      // 方案1: 用 getServiceInfo 获取产品列表基本信息（有 IP、domain、billingcycle 等）
      {
        const listUid = uidParam ? Number(uidParam) : 0;
        const listRes = await api('getServiceInfo', { uid: listUid });
        if (listRes && (listRes.status === 200 || listRes.status === 1 || listRes.msg === '请求成功') && listRes.data) {
          const rawData = listRes.data;
          let list: Record<string, any>[] = [];
          if (rawData && Array.isArray(rawData.list)) {
            list = rawData.list;
          } else if (Array.isArray(rawData)) {
            list = rawData;
          } else if (rawData && Array.isArray(rawData.data)) {
            list = rawData.data;
          }
          const found = list.find((item: Record<string, any>) => Number(item.id) === numericHostid);
          if (found) {
            productData = found;
          }
        }
      }

      // 方案2: 用 getProductConfig (set_config) 获取产品的配置选项信息
      // 传入 hostid 参数可以获取已开通产品的当前配置（CPU、内存、系统、带宽等）
      const productId = productData?.pid || productData?.productid;
      if (productData && productId) {
        try {
          const billingcycle = extractStr(productData.billingcycle || productData.billing_cycle);
          const configRes = await api('getProductConfig', {
            pid: Number(productId),
            billingcycle: billingcycle || 'monthly',
            hostid: numericHostid,
          });
          if (configRes && (configRes.status === 200 || configRes.status === 1 || configRes.msg === '请求成功')) {
            // set_config 返回 option 数组，每个选项含 option_name, option_type, child 等
            // 已开通产品的当前配置在 configRes.configoptions 或 configRes.current_config 中
            const configOptions: Array<{ id: number; option_name: string; option_type: number; child: unknown }> = configRes.option || configRes.configoptions || [];
            const currentConfig: Record<string, unknown> = configRes.current_config || configRes.config || {};
            
            // 提取配置信息到 productData
            const configMap: Record<string, string> = {};
            for (const opt of configOptions) {
              const optName = opt.option_name || '';
              const optId = String(opt.id);
              // 如果有当前配置值，使用当前值
              const currentValue = currentConfig[optId];
              if (currentValue !== undefined) {
                configMap[optName] = String(currentValue);
              }
              // 尝试从 child 中获取子选项名称
              const childArr = Array.isArray(opt.child) ? opt.child : [];
              if (opt.option_type === 5 && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
                // 操作系统类型 - 嵌套结构
                configMap[optName] = '已配置';
              } else if (childArr.length > 0) {
                for (const sub of childArr) {
                  const subObj = sub as Record<string, unknown>;
                  if (String(subObj.id) === String(currentValue)) {
                    configMap[optName] = String(subObj.option_name || subObj.name || currentValue);
                    break;
                  }
                }
              }
            }
            
            // 映射常见配置名到 productData 字段
            if (configMap['CPU'] || configMap['cpu'] || configMap['核心'] || configMap['核心数']) {
              productData.cpu = configMap['CPU'] || configMap['cpu'] || configMap['核心'] || configMap['核心数'];
            }
            if (configMap['内存'] || configMap['RAM'] || configMap['ram'] || configMap['Memory']) {
              productData.ram = configMap['内存'] || configMap['RAM'] || configMap['ram'] || configMap['Memory'];
            }
            if (configMap['带宽'] || configMap['Bandwidth'] || configMap['bandwidth'] || configMap['网络']) {
              productData.bw = configMap['带宽'] || configMap['Bandwidth'] || configMap['bandwidth'] || configMap['网络'];
            }
            if (configMap['流量'] || configMap['Traffic'] || configMap['traffic']) {
              productData.traffic = configMap['流量'] || configMap['Traffic'] || configMap['traffic'];
            }
            if (configMap['操作系统'] || configMap['系统'] || configMap['OS'] || configMap['os']) {
              productData.os = configMap['操作系统'] || configMap['系统'] || configMap['OS'] || configMap['os'];
            }
            if (configMap['机房'] || configMap['节点'] || configMap['Node']) {
              productData.node = configMap['机房'] || configMap['节点'] || configMap['Node'];
            }
            // 保存所有配置到 productData
            productData._configMap = configMap;
          }
        } catch {
          // 获取配置失败不影响主流程
        }
      }

      if (productData) {
        setProduct(parseProductData(productData));
        // 自动获取产品配置详情（CPU、内存、带宽等），用于产品信息卡片显示
        if (uidParam) {
          api('getServiceDetail', { hostid, uid: uidParam }).then((detailRes) => {
            if (detailRes.success && detailRes.data) {
              setHostDetail(detailRes.data);
              try {
                const configArray = Array.isArray(detailRes.config_array) ? detailRes.config_array : [];
                const hostOptionConfig = Array.isArray(detailRes.host_option_config) ? detailRes.host_option_config : [];
                const optionsMap: Record<string, string> = {};
                for (const opt of hostOptionConfig) {
                  const configId = String(opt.configid || '');
                  const optionId = String(opt.optionid || '');
                  const qty = Number(opt.qty || 0);
                  const configItem = configArray.find((c: Record<string, unknown>) => String(c.id) === configId);
                  if (configItem) {
                    const configName = String(configItem.option_name || '');
                    const subItems = Array.isArray(configItem.sub) ? configItem.sub : [];
                    const selectedItem = subItems.find((s: Record<string, unknown>) => String(s.id) === optionId);
                    if (selectedItem) {
                      let optionName = String(selectedItem.option_name || '');
                      if (qty > 0) {
                        const unit = String(configItem.unit || '');
                        optionName = `${qty}${unit || optionName}`;
                      }
                      optionsMap[configName] = optionName;
                    }
                  }
                }
                setConfigOptions(optionsMap);
              } catch { /* ignore */ }
            }
          }).catch(() => { /* ignore */ });
        }
      } else {
        setActionMsg({ type: 'error', text: '获取产品详情失败: 未找到产品信息' });
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: `请求异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setIsLoading(false);
      fetchInProgress.current = false;
    }
  }, [hostid, uidParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // 初始加载 — 只执行一次
  const hasFetched = useRef(false);
  useEffect(() => {
    if (!hasFetched.current && hostid) {
      hasFetched.current = true;
      fetchProductDetail();
      // 进入页面自动加载产品详情
      fetchHostDetail();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 获取服务器实时状态
  const fetchServerStatus = useCallback(async () => {
    if (!hostid || statusFetchInProgress.current) return;
    statusFetchInProgress.current = true;
    try {
      const res = await callIdcApiRef.current('provisionStatus', { hostid: Number(hostid) });
      if (res && (res.status === 200 || res.status === 1 || res.msg === '请求成功' || res.success === true)) {
        const data = res.data || res;
        const d = (typeof data === 'object' && data !== null) ? data as Record<string, unknown> : {};

        const status: ServerStatus = {
          powerStatus: '',
          cpuUsage: '',
          memUsage: '',
          diskUsage: '',
          bandwidthUsage: '',
          uptime: '',
          osRunning: '',
        };

        // provision/default?func=status 返回格式：
        // { status: "on"/"off"/"process", des: "运行中"/"已关机"/"关机中" }
        // 或者更详细的魔方云数据
        
        // 电源状态
        const rawStatus = String(d.status || d.power_status || d.powerStatus || d.power || d.vm_status || '');
        const rawDes = String(d.des || d.description || d.desc || d.msg || '');
        
        if (rawStatus === 'on' || rawStatus === 'running' || rawStatus === 'active') {
          status.powerStatus = 'on';
        } else if (rawStatus === 'off' || rawStatus === 'stopped' || rawStatus === 'inactive') {
          status.powerStatus = 'off';
        } else if (rawStatus === 'process' || rawStatus === 'pending' || rawStatus === 'suspending') {
          status.powerStatus = rawDes || rawStatus; // "关机中"、"开机中" 等
        } else if (rawStatus) {
          status.powerStatus = rawDes || rawStatus;
        }

        // 尝试获取更详细的资源使用数据
        const cpu = d.cpu || d.cpu_usage || d.cpuUsage || d.cpu_used;
        if (typeof cpu === 'object' && cpu !== null) {
          const cpuObj = cpu as Record<string, unknown>;
          status.cpuUsage = String(cpuObj.percent || cpuObj.usage || cpuObj.value || '');
        } else if (cpu !== undefined && cpu !== null && cpu !== '') {
          status.cpuUsage = String(cpu);
        }
        
        const mem = d.memory || d.mem || d.mem_usage || d.memUsage || d.ram;
        if (typeof mem === 'object' && mem !== null) {
          const memObj = mem as Record<string, unknown>;
          status.memUsage = String(memObj.percent || memObj.usage || memObj.value || 
            (memObj.used && memObj.total ? `${memObj.used}/${memObj.total}` : ''));
        } else if (mem !== undefined && mem !== null && mem !== '') {
          status.memUsage = String(mem);
        }
        
        const disk = d.disk || d.disk_usage || d.diskUsage;
        if (typeof disk === 'object' && disk !== null) {
          const diskObj = disk as Record<string, unknown>;
          status.diskUsage = String(diskObj.percent || diskObj.usage || diskObj.value || 
            (diskObj.used && diskObj.total ? `${diskObj.used}/${diskObj.total}` : ''));
        } else if (disk !== undefined && disk !== null && disk !== '') {
          status.diskUsage = String(disk);
        }
        
        const bw = d.bw || d.bandwidth || d.bw_usage || d.bandwidthUsage || d.flow || d.traffic;
        if (typeof bw === 'object' && bw !== null) {
          const bwObj = bw as Record<string, unknown>;
          status.bandwidthUsage = String(bwObj.percent || bwObj.usage || bwObj.value || 
            (bwObj.used && bwObj.total ? `${bwObj.used}/${bwObj.total}` : ''));
        } else if (bw !== undefined && bw !== null && bw !== '') {
          status.bandwidthUsage = String(bw);
        }
        
        status.uptime = String(d.uptime || d.running_time || d.run_time || '').replace(/^undefined$/, '');
        status.osRunning = String(d.os || d.system || d.os_name || d.template || '').replace(/^undefined$/, '');

        // 将其他字段也保存
        const knownKeys = new Set(['status','power_status','powerStatus','power','vm_status',
          'des','description','desc','msg',
          'cpu','cpu_usage','cpuUsage','cpu_used',
          'memory','mem','mem_usage','memUsage','ram',
          'disk','disk_usage','diskUsage',
          'bw','bandwidth','bw_usage','bandwidthUsage','flow','traffic',
          'uptime','running_time','run_time',
          'os','system','os_name','template']);
        for (const [key, val] of Object.entries(d)) {
          if (!knownKeys.has(key) && val !== '' && val !== undefined && val !== null) {
            status[key] = val;
          }
        }

        setServerStatus(status);
      }
    } catch {
      // 获取状态失败不影响主流程
    } finally {
      statusFetchInProgress.current = false;
    }
  }, [hostid]);

  // 自动刷新实时状态（每30秒） + 初始获取
  useEffect(() => {
    if (!hostid || !product) return;
    
    // 初始获取一次状态
    fetchServerStatus();
    
    // 每30秒刷新
    statusTimerRef.current = setInterval(fetchServerStatus, 30000);
    
    return () => {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
      }
    };
  }, [hostid, product, fetchServerStatus]);

  // 手动刷新
  const refreshProduct = useCallback(async () => {
    fetchInProgress.current = false;
    await fetchProductDetail();
    fetchServerStatus();
  }, [fetchProductDetail, fetchServerStatus]);

  const executeAction = async (actionType: string, actionName: string, extraParams?: Record<string, unknown>) => {
    setActionLoading(actionType);
    setActionMsg({ type: 'info', text: `正在${actionName}...` });
    try {
      const res = await callIdcApiRef.current(actionType, { hostid: Number(hostid), ...extraParams });
      if (res && (res.status === 200 || res.status === 1 || res.msg === '删除成功' || res.msg === '请求成功' || res.success === true)) {
        // VNC 特殊处理：获取 VNC URL 后新窗口打开
        if (actionType === 'provisionVnc') {
          const vncUrl = res.data?.url || res.url || res.data?.vnc_url || '';
          const vncPwd = res.data?.password || res.password || '';
          if (vncUrl) {
            window.open(vncUrl, '_blank');
            setActionMsg({ type: 'success', text: `VNC已打开${vncPwd ? `，密码: ${vncPwd}` : ''}` });
          } else {
            setActionMsg({ type: 'error', text: `VNC: 未返回控制台地址，返回数据: ${JSON.stringify(res.data || res).substring(0, 200)}` });
          }
        } else {
          setActionMsg({ type: 'success', text: `${actionName}成功` });
          // 刷新产品详情
          setTimeout(() => refreshProduct(), 2000);
        }
      } else {
        setActionMsg({ type: 'error', text: `${actionName}失败: ${res?.msg || '未知错误'}` });
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: `${actionName}异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setActionLoading(null);
    }
  };

  // 重置密码确认
  const handleCrackPassConfirm = () => {
    if (!crackPassValue.trim()) return;
    setShowCrackPassDialog(false);
    executeAction('provisionCrackPass', '重置密码', { password: crackPassValue.trim() });
    setCrackPassValue('');
  };

  // ===== 套餐升级相关状态 =====
  interface PackageConfig {
    id: string;
    name: string;
    productId: number;
    productName: string;
    billingCycle: string;
    billingCycleLabel: string;
    configValues: Record<string, string>;
    customFieldValues: Record<string, string>;
    productQty: number;
    firstPrice: string;
    renewPrice: string;
    gateway: string;
    useCredit: boolean;
    autoRecharge: boolean;
    createdAt: number;
  }

  const [packages, setPackages] = useState<PackageConfig[]>([]);
  const [currentPackageId, setCurrentPackageId] = useState<string | null>(null);
  const [targetPackageId, setTargetPackageId] = useState<string | null>(null);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [showUpgradePanel, setShowUpgradePanel] = useState(false);
  const [upgradeConfigOptions, setUpgradeConfigOptions] = useState<Array<{
    id: number;
    option_name: string;
    option_type: number;
    child: Array<{ id: number; option_name: string; [key: string]: unknown }>;
  }>>([]);

  // 产品详情编辑
  const [hostDetail, setHostDetail] = useState<Record<string, unknown> | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(true);
  const [configOptions, setConfigOptions] = useState<Record<string, string>>({}); // 配置项：如 CPU=2核, 内存=2G
  const [upgradeBillingCycle, setUpgradeBillingCycle] = useState<'monthly' | 'annually'>('monthly');
  const [upgradeCurrentConfig, setUpgradeCurrentConfig] = useState<Record<string, string>>({});

  // 加载产品详情（完整 host_data）
  const fetchHostDetail = useCallback(async () => {
    if (!hostid || !uidParam) {
      setActionMsg({ type: 'error', text: '缺少产品ID或用户ID，无法加载详情' });
      return;
    }
    setDetailLoading(true);
    try {
      const api = callIdcApiRef.current;
      const res = await api('getServiceDetail', { hostid, uid: uidParam });
      if (res.success && res.data) {
        setHostDetail(res.data);
        // 初始化可编辑字段
        const fields: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.data)) {
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) continue;
          if (typeof v === 'object') continue;
          fields[k] = String(v);
        }
        setEditFields(fields);
        // 解析配置选项：匹配 config_array 和 host_option_config
        try {
          const configArray = Array.isArray(res.config_array) ? res.config_array : [];
          const hostOptionConfig = Array.isArray(res.host_option_config) ? res.host_option_config : [];
          const optionsMap: Record<string, string> = {};
          for (const opt of hostOptionConfig) {
            const configId = String(opt.configid || '');
            const optionId = String(opt.optionid || '');
            const qty = Number(opt.qty || 0);
            // 在 config_array 中找到对应的配置项名称
            const configItem = configArray.find((c: Record<string, unknown>) => String(c.id) === configId);
            if (configItem) {
              const configName = String(configItem.option_name || '');
              const subItems = Array.isArray(configItem.sub) ? configItem.sub : [];
              const selectedItem = subItems.find((s: Record<string, unknown>) => String(s.id) === optionId);
              if (selectedItem) {
                let optionName = String(selectedItem.option_name || '');
                // 如果是数量型配置（qty > 0），追加数量
                if (qty > 0) {
                  const unit = String(configItem.unit || '');
                  optionName = `${qty}${unit || optionName}`;
                }
                optionsMap[configName] = optionName;
              }
            }
          }
          setConfigOptions(optionsMap);
        } catch {
          setConfigOptions({});
        }
        setShowDetailPanel(true);
      } else {
        setActionMsg({ type: 'error', text: res.message || '获取产品详情失败' });
      }
    } catch {
      setActionMsg({ type: 'error', text: '获取产品详情失败' });
    } finally {
      setDetailLoading(false);
    }
  }, [hostid, uidParam]);

  // 保存产品详情
  const saveHostDetail = useCallback(async () => {
    if (!hostid || !uidParam) return;
    setDetailSaving(true);
    try {
      const api = callIdcApiRef.current;
      // 从 editFields 中提取用户修改的字段（与原始 hostDetail 对比）
      const updateFields: Record<string, string> = {};
      if (hostDetail) {
        for (const [k, v] of Object.entries(editFields)) {
          const origVal = hostDetail[k];
          const origStr = origVal === undefined || origVal === null ? '' : String(origVal);
          if (v !== origStr) {
            updateFields[k] = v;
          }
        }
      }
      if (Object.keys(updateFields).length === 0) {
        setActionMsg({ type: 'info', text: '没有修改任何字段' });
        setDetailSaving(false);
        return;
      }
      console.log('[保存产品详情] 修改的字段:', updateFields);
      const res = await api('saveServiceInfo', { hostid, uid: uidParam, updateFields });
      if (res.success) {
        setActionMsg({ type: 'success', text: '保存成功' });
        // 重新获取详情
        await fetchHostDetail();
        // 也刷新产品基础信息
        refreshProduct();
      } else {
        setActionMsg({ type: 'error', text: res.message || '保存失败' });
      }
    } catch {
      setActionMsg({ type: 'error', text: '保存失败' });
    } finally {
      setDetailSaving(false);
    }
  }, [hostid, uidParam, editFields, hostDetail, fetchHostDetail, refreshProduct]);

  // 获取套餐列表并匹配当前套餐
  const fetchUpgradePackages = useCallback(async () => {
    if (!hostid || !product) return;
    setUpgradeLoading(true);
    try {
      const pid = product._pid || product.pid;
      if (!pid) {
        setActionMsg({ type: 'error', text: '无法获取产品PID，请先刷新产品详情' });
        setUpgradeLoading(false);
        return;
      }

      // 1. 获取产品配置选项（用于显示配置项名称）
      const api = callIdcApiRef.current;
      const billingcycle = product.billingCycle || 'monthly';
      const configRes = await api('getProductConfig', {
        pid: Number(pid),
        billingcycle,
        hostid: Number(hostid),
      });

      if (configRes && (configRes.status === 200 || configRes.status === 1 || configRes.msg === '请求成功')) {
        const optArr = configRes.option || configRes.configoptions || [];
        const rawOpts = Array.isArray(optArr) ? optArr : [];
        const parsedOpts = rawOpts.map((opt: Record<string, unknown>) => {
          const o = opt;
          const childArr = Array.isArray(o.child || o.subs || o.items)
            ? (o.child || o.subs || o.items) as Array<Record<string, unknown>>
            : [];
          return {
            id: Number(o.id || 0),
            option_name: String(o.option_name || o.name || ''),
            option_type: Number(o.option_type || o.optiontype || 1),
            child: childArr.map(c => ({
              id: Number(c.id || 0),
              option_name: String(c.option_name || c.name || ''),
              ...c,
            })),
          };
        });
        setUpgradeConfigOptions(parsedOpts);
      }

      // 1.5 获取当前产品完整详情（含host_option_config，包含OS等所有配置项的当前值）
      try {
        const detailRes = await api('getServiceDetail', {
          hostid: Number(hostid),
          uid: Number(uidParam),
        });
        if (detailRes.success && Array.isArray(detailRes.host_option_config)) {
          const currentConfig: Record<string, string> = {};
          for (const opt of detailRes.host_option_config as Array<Record<string, unknown>>) {
            const configId = String(opt.configid || '');
            const optionId = String(opt.optionid || '');
            const qty = Number(opt.qty || 0);
            if (!configId) continue;
            if (qty > 0) {
              currentConfig[configId] = String(qty);
            } else if (optionId) {
              currentConfig[configId] = optionId;
            }
          }
          setUpgradeCurrentConfig(currentConfig);
        }
      } catch {
        // 获取详情失败不影响主流程
      }

      // 2. 获取套餐列表
      const pkgRes = await fetch('/api/packages?productId=' + pid);
      const pkgData = await pkgRes.json();
      const allPackages: PackageConfig[] = pkgData.data || pkgData.packages || [];
      
      // 过滤同产品、同计费周期的套餐
      const matchedPkgs = allPackages.filter(
        (p: PackageConfig) => p.productId === Number(pid) && p.billingCycle === billingcycle
      );
      setPackages(matchedPkgs);

      // 3. 尝试匹配当前产品属于哪个套餐
      // 根据产品名称 + 价格匹配（数值比较，容忍小数位差异）
      const productAmount = parseFloat(String(product.amount || '0').replace(/[^\d.]/g, '')) || 0;
      let matchedId: string | null = null;
      for (const pkg of matchedPkgs) {
        const nameMatch = pkg.productName === product.name;
        const pkgPrice = parseFloat(String(pkg.renewPrice || pkg.firstPrice || '0')) || 0;
        const priceMatch = pkgPrice === productAmount;
        if (nameMatch && priceMatch) {
          matchedId = pkg.id;
          break;
        }
      }
      setCurrentPackageId(matchedId);
      setTargetPackageId(null);
      setShowUpgradePanel(true);
    } catch (err) {
      setActionMsg({ type: 'error', text: `获取套餐信息失败: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setUpgradeLoading(false);
    }
  }, [hostid, product]);

  // 获取配置项名称
  const getConfigLabel = useCallback((optionId: string, subId: string) => {
    const opt = upgradeConfigOptions.find(o => String(o.id) === optionId);
    if (!opt) return subId;
    const sub = opt.child.find(c => String(c.id) === subId);
    return sub?.option_name || subId;
  }, [upgradeConfigOptions]);

  // 提交套餐升级 - 使用前台升级结算流程
  // 流程: upgradeConfigCalc(计算差价) → upgradeConfigCheckout(结算+更新价格) → 余额支付账单
  const submitUpgrade = useCallback(async () => {
    if (!hostid || !targetPackageId) return;
    const targetPkg = packages.find(p => p.id === targetPackageId);
    if (!targetPkg) return;

    setUpgradeSubmitting(true);
    try {
      // 构建配置变更参数（提交所有配置项，OS用当前值避免被清空）
      const osOptionIds = new Set<string>();
      for (const key of Object.keys(targetPkg.configValues)) {
        if (key.startsWith('os_cat_')) {
          osOptionIds.add(key.replace('os_cat_', ''));
        }
      }
      // 通过 upgradeConfigOptions 识别 option_type===5 的OS配置项
      for (const opt of upgradeConfigOptions) {
        if (opt.option_type === 5) {
          osOptionIds.add(String(opt.id));
        }
      }

      const configoption: Record<string, string | number> = {};

      // 提交所有配置项（魔方云upgrade_config会清空未提交的配置项）
      for (const [key, value] of Object.entries(targetPkg.configValues)) {
        if (key.startsWith('os_cat_')) continue;
        if (key.startsWith('qty_')) {
          const optId = key.replace('qty_', '');
          configoption[optId] = parseInt(String(value), 10) || 0;
          continue;
        }
        // OS配置项用当前值覆盖，确保不被修改
        if (osOptionIds.has(key) && upgradeCurrentConfig[key] !== undefined) {
          configoption[key] = upgradeCurrentConfig[key];
          continue;
        }
        configoption[key] = value;
      }

      if (Object.keys(configoption).length === 0) {
        setActionMsg({ type: 'error', text: '配置没有变化，无需升级' });
        setUpgradeSubmitting(false);
        return;
      }

      const hid = Number(hostid);
      const newPrice = targetPkg.renewPrice;

      // 用 adminUpgradeConfig 修改配置项
      const upgradeParams: Record<string, unknown> = {
        hid,
        configoption,
      };
      console.log('[套餐升级] 提交参数:', JSON.stringify(upgradeParams));
      const res = await callIdcApiRef.current('adminUpgradeConfig', upgradeParams);
      console.log('[套餐升级] 升级结果:', JSON.stringify(res));

      if (!res || !(res.status === 200 || res.status === 1 || res.msg === '请求成功' || res.success === true)) {
        setActionMsg({ type: 'error', text: `套餐升级失败: ${res?.msg || '未知错误'}` });
        return;
      }

      // Step 2: 通过「保存用户产品」接口更新续费价格和计费周期
      // 后端会先 GET 获取产品完整信息(host_data)，改 amount 和 billingcycle，再原样 POST 保存
      try {
        const uid = Number(uidParam) || Number(product?.uid) || 0;
        const priceParams: Record<string, unknown> = {
          hostid: hid,
          uid: uid,
          amount: parseFloat(String(newPrice)),  // 新套餐的续费价格
        };
        // 如果目标套餐周期和当前不同，也更新周期
        const currentBillingCycle = product?.billingcycle || 'monthly';
        if (targetPkg.billingCycle !== currentBillingCycle) {
          priceParams.billingcycle = targetPkg.billingCycle;
        }
        console.log('[更新续费价格] 提交参数:', JSON.stringify(priceParams));
        const priceRes = await callIdcApiRef.current('updateHostAmount', priceParams);
        console.log('[更新续费价格] 结果:', JSON.stringify(priceRes));

        if (priceRes && (priceRes.status === 200 || priceRes.success === true || priceRes.msg === '更改保存成功！')) {
          console.log('[更新续费价格] 成功!');
        } else {
          console.warn('[更新续费价格] 可能失败:', priceRes);
        }
      } catch (priceErr) {
        console.warn('[更新续费价格] 异常:', priceErr);
      }

      // 升级成功后拉取信息，同步财务侧配置
      try {
        setActionMsg({ type: 'success', text: `套餐升级成功！已升级到「${targetPkg.name}」，正在拉取信息...` });
        const syncRes = await callIdcApiRef.current('provisionSync', { hostid: Number(hid) });
        console.log('[拉取信息] 结果:', JSON.stringify(syncRes));
        if (syncRes && (syncRes.status === 200 || syncRes.status === 1 || syncRes.msg === '请求成功' || syncRes.success === true)) {
          setActionMsg({ type: 'success', text: `套餐升级成功！已升级到「${targetPkg.name}」，信息同步完成` });
        } else {
          setActionMsg({ type: 'success', text: `套餐升级成功！已升级到「${targetPkg.name}」，拉取信息未确认，请手动拉取` });
        }
      } catch (syncErr) {
        console.warn('[拉取信息] 异常:', syncErr);
        setActionMsg({ type: 'success', text: `套餐升级成功！已升级到「${targetPkg.name}」，拉取信息异常，请手动拉取` });
      }

      setShowUpgradePanel(false);
      setTargetPackageId(null);
      setTimeout(() => refreshProduct(), 2000);
    } catch (err) {
      setActionMsg({ type: 'error', text: `套餐升级异常: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setUpgradeSubmitting(false);
    }
  }, [hostid, targetPackageId, packages, product, upgradeConfigOptions, upgradeCurrentConfig, refreshProduct]);

  const statusMap: Record<string, { label: string; color: string; bgColor: string }> = {
    'Active': { label: '已激活', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/30' },
    '活跃': { label: '已激活', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/30' },
    'Suspended': { label: '已暂停', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/30' },
    '暂停': { label: '已暂停', color: 'text-yellow-400', bgColor: 'bg-yellow-500/10 border-yellow-500/30' },
    'Cancelled': { label: '已取消', color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/30' },
    '已取消': { label: '已取消', color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/30' },
  };

  const statusInfo = statusMap[product?.status || ''] || { label: product?.status || '未知', color: 'text-gray-400', bgColor: 'bg-gray-500/10 border-gray-500/30' };

  const formatDate = (timestamp: string | number | undefined) => {
    if (!timestamp) return '-';
    const ts = typeof timestamp === 'string' ? Number(timestamp) : timestamp;
    if (isNaN(ts)) return String(timestamp);
    if (ts < 1e12) return new Date(ts * 1000).toLocaleDateString('zh-CN');
    return new Date(ts).toLocaleDateString('zh-CN');
  };

  const billingMap: Record<string, string> = {
    'monthly': '月付', 'quarterly': '季付', 'semiannually': '半年付',
    'annually': '年付', 'biennially': '两年付', 'triennially': '三年付',
    'free': '免费', 'onetime': '一次性',
  };

  if (!hostid) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center text-gray-400">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 mx-auto mb-3 text-yellow-500" />
          <p>未指定产品ID</p>
          <button onClick={() => router.push('/')} className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
            返回首页
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* 顶部导航栏 */}
      <div className="sticky top-0 z-10 bg-[#1a1d27] border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2">
          <MobileSidebar currentPath="/manage" variant="subpage" />
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>首页</span>
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Monitor className="w-5 h-5 text-orange-500" />
            产品管理
          </h1>
          <button
            onClick={refreshProduct}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-2 sm:p-4 space-y-4">
        {/* 操作提示 */}
        {actionMsg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border ${
            actionMsg.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            actionMsg.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' :
            'bg-blue-500/10 border-blue-500/30 text-blue-400'
          }`}>
            {actionMsg.type === 'success' && <CheckCircle className="w-5 h-5 shrink-0" />}
            {actionMsg.type === 'error' && <XCircle className="w-5 h-5 shrink-0" />}
            {actionMsg.type === 'info' && <Loader2 className="w-5 h-5 shrink-0 animate-spin" />}
            <span>{actionMsg.text}</span>
          </div>
        )}

        {isLoading && !product ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
            <span className="ml-3 text-gray-400">加载产品信息...</span>
          </div>
        ) : product ? (
          <>
            {/* 产品信息卡片 */}
            <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-orange-500" />
                  <h2 className="font-semibold text-lg">{product.name}</h2>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.bgColor} ${statusInfo.color}`}>
                  {statusInfo.label}
                </span>
              </div>

              <div className="p-3 sm:p-5 grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                <InfoItem icon={Hash} label="产品ID" value={String(product.id)} />
                <InfoItem icon={Globe} label="IP地址" value={product.ip || product.dedicatedip || '-'} />
                <InfoItem icon={Server} label="主机名" value={product.hostname || product.domain || '-'} />
                {/* 配置信息 */}
                {Object.keys(configOptions).length > 0 ? (
                  <>
                    {configOptions['处理器核心'] && <InfoItem icon={Cpu} label="CPU" value={String(configOptions['处理器核心'])} />}
                    {configOptions['内存'] && <InfoItem icon={MemoryStick} label="内存" value={String(configOptions['内存'])} />}
                    {configOptions['带宽'] && <InfoItem icon={Wifi} label="带宽" value={String(configOptions['带宽'])} />}
                    {configOptions['系统盘'] && <InfoItem icon={HardDrive} label="系统盘" value={String(configOptions['系统盘'])} />}
                    {configOptions['数据盘'] && <InfoItem label="数据盘" value={String(configOptions['数据盘'])} />}
                  </>
                ) : (
                  <>
                    {product.cpu && <InfoItem label="CPU" value={product.cpu} />}
                    {product.ram && <InfoItem label="内存" value={product.ram} />}
                    {product.bw && <InfoItem label="带宽" value={product.bw} />}
                  </>
                )}
                <InfoItem icon={Monitor} label="操作系统" value={(hostDetail?.os ? String(hostDetail.os) : '') || product.os || (configOptions && configOptions['操作系统']) || '-'} />
                <InfoItem label="计费周期" value={billingMap[product.billingcycle] || product.billingcycle || '-'} />
                <InfoItem label="金额" value={String(product.amount || '0').replace(/[¥元]/g, '').trim() ? `¥${String(product.amount || '0').replace(/[¥元]/g, '')}` : '-'} />
                <InfoItem label="订购日期" value={formatDate(product.regdate)} />
                <InfoItem label="到期时间" value={formatDate(product.nextduedate)} />
                {product.username && <InfoItem label="用户名" value={product.username} />}
              </div>
            </div>

            {/* 操作面板 */}
            <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800">
                <h3 className="font-semibold flex items-center gap-2">
                  <Power className="w-4 h-4 text-orange-500" />
                  服务器操作
                </h3>
              </div>
              <div className="p-3 sm:p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {isAdminUser && (
                    <ActionButton
                      icon={Power}
                      label="开机"
                      color="emerald"
                      loading={actionLoading === 'provisionOn'}
                      disabled={!!actionLoading || serverStatus?.powerStatus === 'on'}
                      onClick={() => setPowerConfirm({ action: 'provisionOn', name: '开机' })}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={PowerOff}
                      label="关机"
                      color="yellow"
                      loading={actionLoading === 'provisionOff'}
                      disabled={!!actionLoading || serverStatus?.powerStatus === 'off'}
                      onClick={() => setPowerConfirm({ action: 'provisionOff', name: '关机' })}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={RotateCcw}
                      label="重启"
                      color="blue"
                      loading={actionLoading === 'provisionReboot'}
                      disabled={!!actionLoading || serverStatus?.powerStatus === 'off'}
                      onClick={() => setPowerConfirm({ action: 'provisionReboot', name: '重启' })}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={Zap}
                      label="硬关机"
                      color="red"
                      loading={actionLoading === 'provisionHardOff'}
                      disabled={!!actionLoading || serverStatus?.powerStatus === 'off'}
                      onClick={() => setPowerConfirm({ action: 'provisionHardOff', name: '硬关机' })}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={Zap}
                      label="硬重启"
                      color="red"
                      loading={actionLoading === 'provisionHardReboot'}
                      disabled={!!actionLoading || serverStatus?.powerStatus === 'off'}
                      onClick={() => setPowerConfirm({ action: 'provisionHardReboot', name: '硬重启' })}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={Pause}
                      label="暂停"
                      color="orange"
                      loading={actionLoading === 'provisionSuspend'}
                      disabled={!!actionLoading}
                      onClick={() => executeAction('provisionSuspend', '暂停')}
                    />
                  )}
                  {isAdminUser && (
                    <ActionButton
                      icon={Play}
                      label="解除暂停"
                      color="emerald"
                      loading={actionLoading === 'provisionUnsuspend'}
                      disabled={!!actionLoading}
                      onClick={() => executeAction('provisionUnsuspend', '解除暂停')}
                    />
                  )}
                  <ActionButton
                    icon={RefreshCw}
                    label="拉取信息"
                    color="cyan"
                    loading={actionLoading === 'provisionSync'}
                    disabled={!!actionLoading}
                    onClick={() => executeAction('provisionSync', '拉取信息')}
                  />
                  <ActionButton
                    icon={Shield}
                    label="实例管理"
                    color="purple"
                    loading={false}
                    disabled={!!actionLoading}
                    onClick={() => router.push(`/advanced?hostid=${hostid}&uid=${uidParam}`)}
                  />
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  提示：操作可能需要等待数秒至数十秒才会有响应
                </p>
              </div>
            </div>

            {/* 产品详情编辑 */}
            <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4 text-orange-500" />
                  产品详情
                </h3>
                {!showDetailPanel && (
                  <button
                    onClick={fetchHostDetail}
                    disabled={detailLoading}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {detailLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Edit3 className="w-3 h-3" />}
                    {detailLoading ? '加载中...' : '编辑详情'}
                  </button>
                )}
                {showDetailPanel && (
                  <button
                    onClick={() => setShowDetailPanel(false)}
                    className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    收起
                  </button>
                )}
              </div>
              {showDetailPanel && hostDetail && (
                <div className="p-5 space-y-3">
                  {/* 可编辑的关键字段 */}
                  <div className="bg-[#0f1117] rounded-lg p-4 space-y-3 border border-orange-500/20">
                    <div className="text-xs text-orange-400 font-medium mb-2">可编辑字段</div>
                    {['amount', 'firstpaymentamount'].map(field => (
                      <div key={field} className="flex items-center gap-3">
                        <label className="text-sm text-gray-400 w-28 shrink-0">
                          {FIELD_LABELS[field] || field}
                        </label>
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-gray-500">¥</span>
                          <input
                            type="text"
                            value={editFields[field] || ''}
                            onChange={(e) => setEditFields(prev => ({ ...prev, [field]: e.target.value }))}
                            className="flex-1 bg-[#1a1d27] border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    ))}
                    {/* 其他可编辑字段：billingcycle, domainstatus */}
                    {['billingcycle', 'domainstatus'].map(field => (
                      <div key={field} className="flex items-center gap-3">
                        <label className="text-sm text-gray-400 w-28 shrink-0">
                          {FIELD_LABELS[field] || field}
                        </label>
                        {field === 'billingcycle' ? (
                          <select
                            value={editFields[field] || ''}
                            onChange={(e) => setEditFields(prev => ({ ...prev, [field]: e.target.value }))}
                            className="flex-1 bg-[#1a1d27] border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                          >
                            <option value="monthly">月付 (monthly)</option>
                            <option value="quarterly">季付 (quarterly)</option>
                            <option value="semiannually">半年付 (semiannually)</option>
                            <option value="annually">年付 (annually)</option>
                            <option value="biennially">两年付 (biennially)</option>
                            <option value="triennially">三年付 (triennially)</option>
                            <option value="onetime">一次性 (onetime)</option>
                            <option value="free">免费 (free)</option>
                          </select>
                        ) : field === 'domainstatus' ? (
                          <select
                            value={editFields[field] || ''}
                            onChange={(e) => setEditFields(prev => ({ ...prev, [field]: e.target.value }))}
                            className="flex-1 bg-[#1a1d27] border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                          >
                            <option value="Pending">Pending - 待审核</option>
                            <option value="Active">Active - 使用中</option>
                            <option value="Completed">Completed - 已完成</option>
                            <option value="Suspended">Suspended - 已暂停</option>
                            <option value="Terminated">Terminated - 已终止</option>
                            <option value="Cancelled">Cancelled - 已取消</option>
                            <option value="Fraud">Fraud - 欺诈</option>
                          </select>
                        ) : null}
                      </div>
                    ))}
                    {/* 其他可编辑字段：dcimid, dedicatedip, port, username, password, assignedips, domain */}
                    {['dcimid', 'dedicatedip', 'port', 'username', 'password', 'assignedips', 'domain'].map(field => (
                      <div key={field} className="flex items-center gap-3">
                        <label className="text-sm text-gray-400 w-28 shrink-0">
                          {FIELD_LABELS[field] || field}
                        </label>
                        <input
                          type={field === 'password' ? 'text' : 'text'}
                          value={editFields[field] || ''}
                          onChange={(e) => setEditFields(prev => ({ ...prev, [field]: e.target.value }))}
                          className="flex-1 bg-[#1a1d27] border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                        />
                      </div>
                    ))}
                    {/* nextduedate 编辑：时间戳 ↔ datetime-local 双向转换 */}
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-400 w-28 shrink-0">{FIELD_LABELS['nextduedate'] || '到期时间'}</label>
                      <input
                        type="datetime-local"
                        value={(() => {
                          const raw = editFields['nextduedate'];
                          if (!raw) return '';
                          const ts = Number(raw);
                          if (isNaN(ts) || ts === 0) return '';
                          // 后台存的是秒级时间戳，datetime-local 需要本地时间
                          const ms = ts < 1e12 ? ts * 1000 : ts;
                          const d = new Date(ms);
                          const pad = (n: number) => String(n).padStart(2, '0');
                          return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                        })()}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (!val) {
                            setEditFields(prev => ({ ...prev, nextduedate: '' }));
                            return;
                          }
                          const ms = new Date(val).getTime();
                          if (isNaN(ms)) return;
                          // 转回秒级时间戳，与后台格式保持一致
                          setEditFields(prev => ({ ...prev, nextduedate: String(Math.floor(ms / 1000)) }));
                        }}
                        className="flex-1 bg-[#1a1d27] border border-gray-700 rounded px-3 py-1.5 text-sm text-white focus:border-orange-500 focus:outline-none [color-scheme:dark]"
                      />
                    </div>
                  </div>

                  {/* 只读字段 */}
                  <div className="space-y-1">
                    <div className="text-xs text-gray-500 font-medium mb-2">其他信息</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                      {Object.entries(hostDetail)
                        .filter(([k, v]) => v !== undefined && v !== null && !Array.isArray(v) && typeof v !== 'object')
                        .filter(([k]) => !['amount', 'firstpaymentamount', 'billingcycle', 'domainstatus', 'nextduedate', 'dcimid', 'dedicatedip', 'port', 'username', 'password', 'assignedips', 'domain'].includes(k))
                        .map(([k, v]) => {
                          const label = FIELD_LABELS[k] || k;
                          let displayVal = String(v);
                          // 时间戳字段自动转日期
                          if (TIMESTAMP_FIELDS.includes(k) && v) {
                            const ts = Number(v);
                            if (!isNaN(ts) && ts > 0) {
                              displayVal = new Date(ts < 1e12 ? ts * 1000 : ts).toLocaleString('zh-CN');
                            } else if (v === 0) {
                              displayVal = '无';
                            }
                          }
                          // 布尔/状态类字段
                          if (v === 0 && ['last_settle','completed_date','termination_date','suspend_time','update_time','promoid','diskusage','bwlimit','user_cate_id','dcim_os','dcim_area','flag','initiative_renew','agent_client','port'].includes(k)) {
                            displayVal = '无';
                          }
                          return (
                            <div key={k} className="bg-[#0f1117] rounded px-3 py-2">
                              <span className="text-gray-500 text-xs">{label}</span>
                              <span className="block text-white text-sm truncate" title={String(v)}>{displayVal}</span>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* 保存按钮 */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={saveHostDetail}
                      disabled={detailSaving}
                      className="px-5 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors text-sm font-medium flex items-center gap-2"
                    >
                      {detailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      保存修改
                    </button>
                    <button
                      onClick={fetchHostDetail}
                      disabled={detailLoading}
                      className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors text-sm flex items-center gap-2"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${detailLoading ? 'animate-spin' : ''}`} />
                      重新加载
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 服务器实时状态 */}
            {serverStatus && (
              <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
                <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800 flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-orange-500" />
                    实时状态
                  </h3>
                  <span className="text-xs text-gray-500">每30秒自动刷新</span>
                </div>
                <div className="p-3 sm:p-5">
                  {/* 电源状态 */}
                  {serverStatus.powerStatus && (
                    <div className="mb-4 flex items-center gap-3">
                      <span className="text-sm text-gray-400">电源状态</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        serverStatus.powerStatus === 'on' || serverStatus.powerStatus === 'running' || serverStatus.powerStatus === 'active'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-red-500/15 text-red-400 border border-red-500/30'
                      }`}>
                        {serverStatus.powerStatus === 'on' || serverStatus.powerStatus === 'running' || serverStatus.powerStatus === 'active'
                          ? '运行中' : serverStatus.powerStatus === 'off' ? '已关机' : serverStatus.powerStatus}
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {serverStatus.cpuUsage && (
                      <UsageBar label="CPU" value={serverStatus.cpuUsage} />
                    )}
                    {serverStatus.memUsage && (
                      <UsageBar label="内存" value={serverStatus.memUsage} />
                    )}
                    {serverStatus.diskUsage && (
                      <UsageBar label="磁盘" value={serverStatus.diskUsage} />
                    )}
                    {serverStatus.bandwidthUsage && (
                      <UsageBar label="带宽/流量" value={serverStatus.bandwidthUsage} />
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    {serverStatus.uptime && (
                      <div>
                        <span className="text-gray-500">运行时间</span>
                        <span className="ml-2 text-white">{serverStatus.uptime}</span>
                      </div>
                    )}
                    {serverStatus.osRunning && (
                      <div>
                        <span className="text-gray-500">运行系统</span>
                        <span className="ml-2 text-white">{serverStatus.osRunning}</span>
                      </div>
                    )}
                    {/* 显示其他未知的状态字段 */}
                    {Object.entries(serverStatus)
                      .filter(([key]) => !['powerStatus','cpuUsage','memUsage','diskUsage','bandwidthUsage','uptime','osRunning'].includes(key) && serverStatus[key] !== '' && serverStatus[key] !== undefined)
                      .map(([key, value]) => (
                        <div key={key}>
                          <span className="text-gray-500">{key}</span>
                          <span className="ml-2 text-white">{String(value)}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              </div>
            )}

            {/* 套餐升级 */}
            <div className="bg-[#1a1d27] rounded-xl border border-gray-800 overflow-hidden">
              <div className="px-3 py-3 sm:px-5 sm:py-4 border-b border-gray-800 flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4 text-orange-500" />
                  套餐升级
                </h3>
                {!showUpgradePanel && !upgradeLoading && (
                  <button
                    onClick={fetchUpgradePackages}
                    className="text-xs text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    加载套餐
                  </button>
                )}
              </div>
              <div className="p-3 sm:p-5">
                {upgradeLoading && !showUpgradePanel && (
                  <div className="flex items-center justify-center py-8 text-gray-400">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />
                    加载套餐信息中...
                  </div>
                )}

                {showUpgradePanel && packages.length === 0 && !upgradeLoading && (
                  <p className="text-gray-400 text-sm text-center py-4">该产品暂无可用套餐</p>
                )}

                {showUpgradePanel && packages.length > 0 && (
                  <div className="space-y-4">
                    {/* 当前套餐 */}
                    {currentPackageId && (
                      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                        <div className="text-sm text-blue-400 font-medium mb-1">当前套餐</div>
                        <div className="text-white font-semibold">
                          {packages.find(p => p.id === currentPackageId)?.name || '未知'}
                        </div>
                      </div>
                    )}
                    {!currentPackageId && (
                      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                        <div className="text-sm text-yellow-400">无法自动匹配当前套餐，请手动选择目标套餐</div>
                      </div>
                    )}

                    {/* 套餐选择 */}
                    {/* 周期切换 */}
                    {(() => {
                      const hasMonthly = packages.some(p => p.billingCycle === 'monthly');
                      const hasAnnually = packages.some(p => p.billingCycle === 'annually');
                      if (!hasMonthly || !hasAnnually) return null;
                      return (
                        <div className="flex gap-2 mb-2">
                          <button
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${upgradeBillingCycle === 'monthly' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                            onClick={() => { setUpgradeBillingCycle('monthly'); setTargetPackageId(null); }}
                          >月付</button>
                          <button
                            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${upgradeBillingCycle === 'annually' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                            onClick={() => { setUpgradeBillingCycle('annually'); setTargetPackageId(null); }}
                          >年付</button>
                        </div>
                      );
                    })()}
                    <div className="text-sm text-gray-400 mb-2">选择升级目标：</div>
                    <div className="grid grid-cols-1 gap-3">
                      {packages.map((pkg) => {
                        const isCurrent = pkg.id === currentPackageId;
                        const isTarget = pkg.id === targetPackageId;
                        // 按周期筛选，只显示当前周期的套餐
                        if (pkg.billingCycle !== upgradeBillingCycle) return null;
                        // 不显示当前套餐
                        if (isCurrent) return null;
                        // 只显示比当前贵的
                        const currentPkg = currentPackageId ? packages.find(p => p.id === currentPackageId) : null;
                        const currentPrice = currentPkg ? parseFloat(String(currentPkg.renewPrice || '0')) || 0 : parseFloat(String(product?.amount || '0').replace(/[^\d.]/g, '')) || 0;
                        const targetPrice = parseFloat(String(pkg.renewPrice || '0')) || 0;
                        if (targetPrice <= currentPrice) return null;

                        return (
                          <div
                            key={pkg.id}
                            onClick={() => !isCurrent && setTargetPackageId(isTarget ? null : pkg.id)}
                            className={`relative rounded-lg border-2 p-4 cursor-pointer transition-all ${
                              isCurrent
                                ? 'border-blue-500/50 bg-blue-500/5 cursor-default'
                                : isTarget
                                  ? 'border-orange-500 bg-orange-500/10'
                                  : 'border-gray-700 bg-[#0f1117] hover:border-gray-500'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                  isCurrent ? 'bg-blue-500 text-white' : isTarget ? 'bg-orange-500 text-white' : 'bg-gray-700 text-gray-300'
                                }`}>
                                  {isCurrent ? '✓' : '▸'}
                                </span>
                                <span className="font-semibold text-white">{pkg.name}</span>
                                {isCurrent && (
                                  <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">当前</span>
                                )}
                              </div>
                              <div className="text-right">
                                <span className="text-orange-400 font-bold">
                                  ¥{pkg.firstPrice}
                                </span>
                                <span className="text-gray-500 text-xs ml-1">
                                  /{pkg.billingCycleLabel || pkg.billingCycle}
                                </span>
                              </div>
                            </div>
                            {/* 套餐配置详情 */}
                            <div className="grid grid-cols-2 gap-1.5 mt-2">
                              {(() => {
                                // 收集os_cat_对应的操作系统配置项ID，升级时跳过
                                const osOptIds = new Set<string>();
                                Object.keys(pkg.configValues).forEach(k => {
                                  if (k.startsWith('os_cat_')) osOptIds.add(k.replace('os_cat_', ''));
                                });
                                return Object.entries(pkg.configValues).filter(([optId]) => {
                                  if (optId.startsWith('os_cat_')) return false;
                                  if (osOptIds.has(optId)) return false; // 跳过操作系统配置项
                                  return true;
                                });
                              })().map(([optId, subId]) => {
                                const isQty = optId.startsWith('qty_');
                                const realOptId = isQty ? optId.replace('qty_', '') : optId;
                                const opt = upgradeConfigOptions.find(o => String(o.id) === realOptId);
                                const label = isQty ? `${opt?.option_name || ''}数量` : (opt?.option_name || `配置${optId}`);
                                const value = isQty ? String(subId) : getConfigLabel(optId, subId);
                                return (
                                  <div key={optId} className="text-xs">
                                    <span className="text-gray-500">{label}:</span>{' '}
                                    <span className="text-gray-300">{value}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 升级变更预览 + 差价计算 */}
                    {targetPackageId && (() => {
                      const targetPkg = packages.find(p => p.id === targetPackageId);
                      if (!targetPkg) return null;
                      const currentPkg = currentPackageId ? packages.find(p => p.id === currentPackageId) : null;
                      const currentConfigMap = product?.configMap || {};
                      const changedConfigs: Array<{ name: string; from: string; to: string }> = [];
                      for (const [optId, subId] of Object.entries(targetPkg.configValues)) {
                        if (optId.startsWith('os_cat_')) continue; // 跳过OS分类
                        if (optId.startsWith('qty_')) {
                          const realOptId = optId.replace('qty_', '');
                          const realOpt = upgradeConfigOptions.find(o => String(o.id) === realOptId);
                          if (realOpt?.option_name === '操作系统') continue;
                        }
                        const opt = upgradeConfigOptions.find(o => String(o.id) === optId);
                        if (opt?.option_name === '操作系统') continue;
                        const name = opt?.option_name || (optId.startsWith('qty_') ? `${upgradeConfigOptions.find(o => String(o.id) === optId.replace('qty_',''))?.option_name || '数量'}数量` : `配置${optId}`);
                        if (optId.startsWith('qty_')) {
                          const realOptId = optId.replace('qty_', '');
                          const currentQty = product?.configMap?.[`qty_${realOptId}`];
                          if (String(currentQty) !== String(subId)) {
                            const optName = upgradeConfigOptions.find(o => String(o.id) === realOptId)?.option_name || '数量';
                            changedConfigs.push({ name: `${optName}数量`, from: String(currentQty || '-'), to: String(subId) });
                          }
                          continue;
                        }
                        const fromVal = getConfigLabel(optId, String(currentConfigMap[optId] || ''));
                        const toVal = getConfigLabel(optId, subId);
                        if (String(currentConfigMap[optId]) !== String(subId)) {
                          changedConfigs.push({ name, from: fromVal, to: toVal });
                        }
                      }
                      if (changedConfigs.length === 0) return null;

                      // 差价计算：按天
                      const currentPrice = currentPkg ? parseFloat(String(currentPkg.renewPrice || currentPkg.firstPrice || '0')) : parseFloat(String(product?.amount || '0').replace(/[^\d.]/g, ''));
                      const targetPrice = parseFloat(String(targetPkg.renewPrice || targetPkg.firstPrice || '0'));
                      const priceDiff = targetPrice - currentPrice;

                      let remainingDays = 0;
                      let totalDays = 0;
                      let upgradeCost = 0;
                      const billingcycle = String(product?.billingcycle || 'monthly');
                      try {
                        const now = new Date();
                        now.setHours(0, 0, 0, 0);
                        const parseDate = (val: string | undefined) => {
                          if (!val) return new Date('');
                          const num = Number(val);
                          if (!isNaN(num)) {
                            const ms = num < 1e12 ? num * 1000 : num;
                            return new Date(ms);
                          }
                          return new Date(val);
                        };
                        const dueDate = parseDate(product?.nextduedate);
                        dueDate.setHours(0, 0, 0, 0);
                        const regDate = parseDate(product?.regdate);
                        regDate.setHours(0, 0, 0, 0);

                        if (!isNaN(dueDate.getTime())) {
                          remainingDays = Math.max(0, Math.round((dueDate.getTime() - now.getTime()) / 86400000));
                          if (remainingDays > 0) {
                            if (billingcycle === 'monthly' && !isNaN(regDate.getTime())) {
                              let periodStart = new Date(regDate.getFullYear(), regDate.getMonth(), regDate.getDate());
                              while (true) {
                                const nextStart = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate());
                                if (nextStart.getTime() > now.getTime()) break;
                                periodStart = nextStart;
                              }
                              const daysInMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
                              totalDays = daysInMonth;
                              upgradeCost = priceDiff / daysInMonth * remainingDays;
                            } else {
                              totalDays = Math.max(1, Math.round((dueDate.getTime() - (isNaN(regDate.getTime()) ? now : regDate).getTime()) / 86400000));
                              upgradeCost = priceDiff / totalDays * remainingDays;
                            }
                          }
                        }
                      } catch {
                        // 日期解析失败则不显示差价
                      }

                      return (
                        <div className="bg-[#0f1117] rounded-lg border border-orange-500/30 p-4 space-y-2">
                          <div className="text-sm font-medium text-orange-400 mb-2">
                            升级变更：{currentPkg?.name || '当前'} → {targetPkg.name}
                          </div>
                          {changedConfigs.map((c, i) => (
                            <div key={i} className="flex items-center justify-between text-sm">
                              <span className="text-gray-400">{c.name}</span>
                              <span className="text-white">
                                <span className="text-gray-400 line-through">{c.from}</span>
                                <span className="mx-2 text-gray-600">→</span>
                                <span className="text-orange-400">{c.to}</span>
                              </span>
                            </div>
                          ))}
                          {/* 差价信息 */}
                          {priceDiff > 0 && totalDays > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-700 space-y-1.5">
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">月价差</span>
                                <span className="text-white">¥{priceDiff.toFixed(2)}/月</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">{billingcycle === 'monthly' ? '当前月天数' : '计费周期'}</span>
                                <span className="text-white">{totalDays}天</span>
                              </div>
                              <div className="flex items-center justify-between text-sm">
                                <span className="text-gray-400">剩余天数</span>
                                <span className="text-white">{remainingDays}天</span>
                              </div>
                              <div className="flex items-center justify-between text-sm font-medium">
                                <span className="text-orange-400">升级差价</span>
                                <span className="text-orange-400 text-lg">¥{upgradeCost.toFixed(2)}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 升级按钮 */}
                    <button
                      onClick={submitUpgrade}
                      disabled={upgradeSubmitting || !targetPackageId}
                      className="w-full px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg transition-colors text-sm font-medium flex items-center justify-center gap-2"
                    >
                      {upgradeSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpDown className="w-4 h-4" />}
                      {targetPackageId ? `确认升级到「${packages.find(p => p.id === targetPackageId)?.name}」` : '请选择目标套餐'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 关闭标签按钮 */}
            <div className="flex justify-center pt-2 pb-8">
              <button
                onClick={() => window.close()}
                className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                关闭标签
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-20 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-yellow-500" />
            <p>无法加载产品信息</p>
          </div>
        )}
      </div>

      {/* 重置密码弹窗 */}
      {showCrackPassDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCrackPassDialog(false)}>
          <div className="bg-[#1a1d27] border border-gray-700 rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-orange-400" />
              重置密码
            </h3>
            <p className="text-sm text-gray-400 mb-3">请输入新的服务器密码：</p>
            <input
              type="text"
              value={crackPassValue}
              onChange={e => setCrackPassValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCrackPassConfirm(); }}
              placeholder="输入新密码"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setShowCrackPassDialog(false)}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleCrackPassConfirm}
                disabled={!crackPassValue.trim()}
                className="px-4 py-2 text-sm bg-orange-600 hover:bg-orange-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 电源操作确认弹窗 */}
      {powerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPowerConfirm(null)}>
          <div className="bg-[#1a1d27] border border-gray-700 rounded-xl p-6 w-[90vw] max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-white mb-3">确认{powerConfirm.name}</h3>
            <p className="text-sm text-gray-400 mb-1">确定要执行「{powerConfirm.name}」操作吗？</p>
            {(powerConfirm.action === 'provisionOff' || powerConfirm.action === 'provisionHardOff' || powerConfirm.action === 'provisionReboot' || powerConfirm.action === 'provisionHardReboot') && (
              <p className="text-xs text-yellow-400 mt-2">建议先在系统内正常关机/重启，强制操作可能导致数据丢失。</p>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setPowerConfirm(null)} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">取消</button>
              <button
                onClick={() => { executeAction(powerConfirm.action, powerConfirm.name); setPowerConfirm(null); }}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ManagePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-400">加载中...</div>}>
      <ManageContent />
    </Suspense>
  );
}

function InfoItem({ icon: Icon, label, value }: { icon?: typeof Server; label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-gray-500 text-xs">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="text-sm font-medium truncate" title={value}>{value}</div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, color, loading, disabled, onClick }: {
  icon: typeof Power; label: string; color: string; loading: boolean; disabled: boolean; onClick: () => void;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    yellow: 'bg-yellow-600 hover:bg-yellow-500 text-white',
    blue: 'bg-blue-600 hover:bg-blue-500 text-white',
    orange: 'bg-orange-600 hover:bg-orange-500 text-white',
    red: 'bg-red-600 hover:bg-red-500 text-white',
    cyan: 'bg-cyan-600 hover:bg-cyan-500 text-white',
    purple: 'bg-purple-600 hover:bg-purple-500 text-white',
  };
  const disabledClass = 'bg-gray-700 text-gray-500 cursor-not-allowed';

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex flex-col items-center gap-1 py-2 px-1.5 rounded-lg transition-colors text-xs font-medium ${
        disabled || loading ? disabledClass : colorMap[color] || colorMap['blue']
      }`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      {label}
    </button>
  );
}

function UsageBar({ label, value }: { label: string; value: string }) {
  // 尝试从值中提取百分比数字
  const parsePercent = (val: string): number | null => {
    const match = val.match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? parseFloat(match[1]) : null;
  };
  
  const percent = parsePercent(value);
  const barColor = percent !== null
    ? percent > 90 ? 'bg-red-500'
    : percent > 70 ? 'bg-yellow-500'
    : 'bg-emerald-500'
    : 'bg-orange-500';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-medium">{value}</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: percent !== null ? `${Math.min(percent, 100)}%` : '100%' }}
        />
      </div>
    </div>
  );
}
