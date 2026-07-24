'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import {
  Server, Loader2, RefreshCw,
  ChevronLeft, ChevronRight,
  Monitor, HardDrive, Wifi, Cpu, MemoryStick,
  Copy, AlertCircle, CheckCircle, XCircle,
  MoreVertical, Shield, Gauge,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { MonitorSheet } from '@/components/node-monitor/MonitorSheet';
import { BandwidthSheet } from '@/components/bandwidth/BandwidthSheet';
import { getLoginUser } from '@/lib/auth-client';
import { PageHeader } from '@/components/layout/page-header';

interface NodeItem {
  id: number;
  name: string;
  ip: string;
  status: number;
  port: number;
  area_id: number;
  area_name: string;
  enable: number;
  cloud_num: number;
  cpu_used: number;
  max_cpu: number;
  memory_used: number;
  max_memory: number;
  type: string;
  group_id: number;
  group_name: string;
  remark: string;
  version: string;
  nat_status: number;
  removable: boolean;
  evacuate: number;
  single_ip_nat: number;
  gpu_num: number;
  gpu_num_leave: number;
  ip_segment_id: number[];
}

// 统一后的节点实时数据（合并 nodeStatus + nodeRealData）
interface MergedNodeData {
  cpu_percent: number;
  cpu_cores: number;
  mem_percent: number;
  mem_used: string;
  mem_total: string;
  disk: Array<{ dev_name: string; disk_free: string; disk_percent: string; disk_use: string; disk_total: string; mount_point?: string }>;
  disk_total_gb: number;
  disk_used_gb: number;
  net_inbw: number;
  net_outbw: number;
  io_read: number;
  io_write: number;
  online: boolean;
}

interface IpSegmentData {
  id: number;
  ip_name: string;
  ip_sengmen: string;
  count: { free: number; used: number; total: number; lock: number };
}

type OrderBy = 'id' | 'name' | 'ip' | 'area_id' | 'cloud_num' | 'group_name';

// 解析 API 返回的嵌套数据
function extractApiData(raw: Record<string, unknown>): Record<string, unknown> {
  return (raw.data as Record<string, unknown>) ?? raw;
}

function parseDiskSizeToGb(sizeStr: string): number {
  if (!sizeStr) return 0;
  const s = String(sizeStr).trim().toUpperCase();
  const match = s.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (isNaN(val)) return 0;
  const unit = (match[2] || 'GB').toUpperCase();
  switch (unit) {
    case 'TB': return val * 1024;
    case 'GB': return val;
    case 'MB': return val / 1024;
    case 'KB': return val / (1024 * 1024);
    case 'B': return val / (1024 * 1024 * 1024);
    default: return val;
  }
}

function formatDiskSize(gb: number): string {
  if (gb <= 0) return '-';
  if (gb >= 1024) return `${(gb / 1024).toFixed(2)}TB`;
  return `${gb.toFixed(2)}GB`;
}

function parseMergedNodeData(statusData: Record<string, unknown> | null, realData: Record<string, unknown> | null): MergedNodeData | null {
  if (!statusData && !realData) return null;

  const cpuInfo = (realData?.cpu_info ?? statusData?.cpu_info) as Record<string, unknown> | undefined;
  const cpuPercent = Number(realData?.cpu_use_percent ?? cpuInfo?.use_percent ?? 0) || 0;
  const cpuCores = Number(cpuInfo?.cores ?? cpuInfo?.cpu ?? 0) || 0;

  const memInfo = (realData?.memory ?? statusData?.memory) as Record<string, unknown> | undefined;
  const memPercent = Number(memInfo?.use_percent ?? 0) || 0;

  const diskArr = (realData?.disk ?? statusData?.disk) as unknown[];
  const disk = Array.isArray(diskArr) && diskArr.length > 0
    ? diskArr.map((d: unknown) => {
        const dd = d as Record<string, string>;
        return {
          dev_name: dd.dev_name || '',
          disk_free: dd.disk_free || dd.free || '',
          disk_percent: dd.disk_percent || dd.percent || dd.use_percent || '0',
          disk_use: dd.disk_use || dd.use || dd.used || '',
          disk_total: dd.disk_total || dd.total || '',
          mount_point: dd.mount_point || '',
        };
      })
    : [];

  let diskTotalGb = 0;
  let diskUsedGb = 0;
  for (const d of disk) {
    const tGb = parseDiskSizeToGb(d.disk_total);
    const uGb = parseDiskSizeToGb(d.disk_use);
    if (tGb > 0) {
      diskTotalGb += tGb;
      diskUsedGb += uGb;
    }
  }

  const netCard = (statusData?.net_card ?? {}) as Record<string, unknown>;
  const ioData = (statusData?.io ?? {}) as Record<string, unknown>;

  return {
    cpu_percent: cpuPercent,
    cpu_cores: cpuCores,
    mem_percent: memPercent,
    mem_used: String(memInfo?.use_memory ?? ''),
    mem_total: String(memInfo?.total_memory ?? ''),
    disk,
    disk_total_gb: diskTotalGb,
    disk_used_gb: diskUsedGb,
    net_inbw: Number(netCard.inbw ?? 0) || 0,
    net_outbw: Number(netCard.outbw ?? 0) || 0,
    io_read: Number(ioData.read_bps ?? 0) || 0,
    io_write: Number(ioData.write_bps ?? 0) || 0,
    online: Number(statusData?.status ?? 1) === 1,
  };
}

// 悬停提示进度条
function TooltipProgressBar({ value, color = 'bg-success', bgColor = 'bg-accent', tooltip }: {
  value: number; color?: string; bgColor?: string; tooltip?: string;
}) {
  const [show, setShow] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pct = Math.min(100, Math.max(0, value));

  const handleTouchStart = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setShow(true);
  };
  const handleTouchEnd = () => {
    hideTimerRef.current = setTimeout(() => setShow(false), 1200);
  };

  return (
    <div
      className="relative w-full h-1.5 rounded-full cursor-pointer"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className={`w-full h-full rounded-full ${bgColor}`}>
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      {show && tooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-muted border border-border rounded-lg shadow-lg text-xs text-foreground whitespace-nowrap z-50 pointer-events-none select-none">
          {tooltip}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[#2a2d3a]" />
        </div>
      )}
    </div>
  );
}

function NodesContent() {
  const router = useRouter();

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [enableFilter, setEnableFilter] = useState<string>('-1');

  const [orderBy, setOrderBy] = useState<OrderBy>('id');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  const [nodeDataMap, setNodeDataMap] = useState<Record<number, MergedNodeData>>({});
  const [realDataLoading, setRealDataLoading] = useState(false);

  const [dropdownId, setDropdownId] = useState<number | null>(null);
  const [ipSegmentMap, setIpSegmentMap] = useState<Record<number, IpSegmentData[]>>({});
  const [ipSegmentLoadingIds, setIpSegmentLoadingIds] = useState<Set<number>>(new Set());

  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<number>>(new Set());
  const [monitorSheetOpen, setMonitorSheetOpen] = useState(false);
  const [bandwidthSheetOpen, setBandwidthSheetOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const callMfyApi = useCallback(async (action: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const loginUser = getLoginUser();
    const response = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: loginUser, ...params }),
      signal,
    });
    return response.json();
  }, [getLoginUser]);

  const callMfyBatch = useCallback(async (requests: Array<Record<string, unknown>>, concurrency = 5, signal?: AbortSignal): Promise<{ results: Record<string, unknown>[] }> => {
    const loginUser = getLoginUser();
    const response = await fetch('/api/mfy/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _loginUser: loginUser, concurrency, requests }),
      signal,
    });
    const data = await response.json();
    return { results: Array.isArray(data.results) ? data.results : [] };
  }, [getLoginUser]);

  // 单节点实时数据获取（保留作为 fallback）
  const fetchNodeRealtime = useCallback(async (nid: number): Promise<MergedNodeData | null> => {
    const [statusRes, realDataRes] = await Promise.allSettled([
      callMfyApi('nodeStatus', { id: nid }),
      callMfyApi('nodeRealData', { id: nid }),
    ]);

    let statusData: Record<string, unknown> | null = null;
    let realData: Record<string, unknown> | null = null;

    if (statusRes.status === 'fulfilled' && (statusRes.value as Record<string, unknown>).success && (statusRes.value as Record<string, unknown>).data) {
      statusData = extractApiData(((statusRes.value as Record<string, unknown>).data) as Record<string, unknown>);
    }
    if (realDataRes.status === 'fulfilled' && (realDataRes.value as Record<string, unknown>).success && (realDataRes.value as Record<string, unknown>).data) {
      realData = extractApiData(((realDataRes.value as Record<string, unknown>).data) as Record<string, unknown>);
    }

    return parseMergedNodeData(statusData, realData);
  }, [callMfyApi]);

  // 批量获取多节点实时数据：一次 HTTP 请求获取所有节点数据
  const fetchNodesRealtimeBatch = useCallback(async (nodeIds: number[], signal?: AbortSignal): Promise<Record<number, MergedNodeData>> => {
    if (nodeIds.length === 0) return {};

    const requests: Array<Record<string, unknown>> = [];
    for (const nid of nodeIds) {
      requests.push({ action: 'nodeStatus', id: nid });
      requests.push({ action: 'nodeRealData', id: nid });
    }

    const { results } = await callMfyBatch(requests, 5, signal);
    const map: Record<number, MergedNodeData> = {};

    for (let i = 0; i < nodeIds.length; i++) {
      const nid = nodeIds[i];
      const statusRes = results[i * 2] || {};
      const realDataRes = results[i * 2 + 1] || {};

      let statusData: Record<string, unknown> | null = null;
      let realData: Record<string, unknown> | null = null;

      if (statusRes.success && statusRes.data) {
        statusData = extractApiData(statusRes.data as Record<string, unknown>);
      }
      if (realDataRes.success && realDataRes.data) {
        realData = extractApiData(realDataRes.data as Record<string, unknown>);
      }

      const merged = parseMergedNodeData(statusData, realData);
      if (merged) map[nid] = merged;
    }

    return map;
  }, [callMfyBatch]);

  const mapNodeItem = useCallback((item: unknown): NodeItem => {
    const n = item as Record<string, unknown>;
    return {
      id: Number(n.id) || 0,
      name: String(n.name || '-'),
      ip: String(n.ip || '-'),
      status: Number(n.status) || 0,
      port: Number(n.port) || 0,
      area_id: Number(n.area_id) || 0,
      area_name: String(n.area_name || '-'),
      enable: Number(n.enable) || 0,
      cloud_num: Number(n.cloud_num) || 0,
      cpu_used: Number(n.cpu_used) || 0,
      max_cpu: Number(n.max_cpu) || 0,
      memory_used: Number(n.memory_used) || 0,
      max_memory: Number(n.max_memory) || 0,
      type: String(n.type || '-'),
      group_id: Number(n.group_id) || 0,
      group_name: String(n.group_name || '-'),
      remark: String(n.remark || ''),
      version: String(n.version || ''),
      nat_status: Number(n.nat_status) || 0,
      removable: Boolean(n.removable),
      evacuate: Number(n.evacuate) || 0,
      single_ip_nat: Number(n.single_ip_nat) || 0,
      gpu_num: Number(n.gpu_num) || 0,
      gpu_num_leave: Number(n.gpu_num_leave) || 0,
      ip_segment_id: Array.isArray(n.ip_segment_id) ? n.ip_segment_id.map(Number) : [],
    };
  }, []);

  // 首次加载
  const fetchNodes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, unknown> = {
        page: currentPage,
        per_page: perPage,
        orderby: orderBy,
        sort: sortDir,
      };
      if (searchKeyword.trim()) params.search = searchKeyword.trim();
      if (enableFilter !== '-1') params.enable = Number(enableFilter);

      const res = await callMfyApi('nodeList', params);
      if (res.success && res.data) {
        const d = extractApiData(res.data as Record<string, unknown>);
        const meta = (res.data as Record<string, unknown>).meta as Record<string, unknown> | undefined;
        const list: unknown[] = Array.isArray(d) ? d : [];
        setTotal(meta?.total != null ? Number(meta.total) : list.length);
        setNodes(list.map(mapNodeItem));
      } else {
        setError(String(res.msg || '获取节点列表失败'));
      }
    } catch {
      setError('请求失败');
    }
    setLoading(false);
  }, [callMfyApi, mapNodeItem, currentPage, perPage, orderBy, sortDir, searchKeyword, enableFilter]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  // 批量加载实时数据：一次 HTTP 请求获取所有节点数据
  useEffect(() => {
    if (nodes.length === 0) return;
    const missingIds = nodes.filter(n => !nodeDataMap[n.id]).map(n => n.id);
    if (missingIds.length === 0) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setRealDataLoading(true);
    fetchNodesRealtimeBatch(missingIds, controller.signal)
      .then(map => {
        if (!controller.signal.aborted && Object.keys(map).length > 0) {
          setNodeDataMap(prev => ({ ...prev, ...map }));
        }
      })
      .catch(() => { /* aborted or error */ })
      .finally(() => {
        if (!controller.signal.aborted) setRealDataLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // 局部刷新：静默更新节点列表 + 批量实时数据，无闪烁
  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const params: Record<string, unknown> = {
        page: currentPage,
        per_page: perPage,
        orderby: orderBy,
        sort: sortDir,
      };
      if (searchKeyword.trim()) params.search = searchKeyword.trim();
      if (enableFilter !== '-1') params.enable = Number(enableFilter);

      const res = await callMfyApi('nodeList', params);
      if (res.success && res.data) {
        const d = extractApiData(res.data as Record<string, unknown>);
        const meta = (res.data as Record<string, unknown>).meta as Record<string, unknown> | undefined;
        const list: unknown[] = Array.isArray(d) ? d : [];
        setTotal(meta?.total != null ? Number(meta.total) : list.length);
        const newNodes = list.map(mapNodeItem);
        setNodes(newNodes);

        setNodeDataMap({});
        if (newNodes.length === 0) {
          setRefreshing(false);
          return;
        }

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const ids = newNodes.map(n => n.id);
        const batchMap = await fetchNodesRealtimeBatch(ids, controller.signal);
        if (!controller.signal.aborted && Object.keys(batchMap).length > 0) {
          setNodeDataMap(batchMap);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, callMfyApi, mapNodeItem, fetchNodesRealtimeBatch, currentPage, perPage, orderBy, sortDir, searchKeyword, enableFilter]);

  const handleToggleEnable = useCallback(async (nodeId: number, currentEnable: number) => {
    setTogglingId(nodeId);
    try {
      const newEnable = currentEnable === 1 ? 0 : 1;
      await callMfyApi('nodeUpdate', { id: nodeId, enable: newEnable });
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, enable: newEnable } : n));
    } catch { /* ignore */ }
    setTogglingId(null);
  }, [callMfyApi]);

  const handleDropdown = useCallback(async (nodeId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDropdownId(prev => prev === nodeId ? null : nodeId);

    if (!ipSegmentMap[nodeId]) {
      setIpSegmentLoadingIds(prev => new Set(prev).add(nodeId));
      try {
        const res = await callMfyApi('ipSegmentList', { node: nodeId, per_page: 100 });
        if (res.success && res.data) {
          const d = extractApiData(res.data as Record<string, unknown>);
          const list: unknown[] = Array.isArray(d) ? d : [];
          const segments: IpSegmentData[] = list.map((item: unknown) => {
            const s = item as Record<string, unknown>;
            const c = (s.count || {}) as Record<string, unknown>;
            return {
              id: Number(s.id) || 0,
              ip_name: String(s.ip_name || '-'),
              ip_sengmen: String(s.ip_sengmen || '-'),
              count: {
                free: Number(c.free) || 0,
                used: Number(c.used) || 0,
                total: Number(c.total) || 0,
                lock: Number(c.lock) || 0,
              },
            };
          });
          setIpSegmentMap(prev => ({ ...prev, [nodeId]: segments }));
        }
      } catch { /* ignore */ }
      setIpSegmentLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }
  }, [ipSegmentMap, callMfyApi]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const formatBw = (bps: number): string => {
    if (!bps && bps !== 0) return '-';
    if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`;
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`;
    return `${bps} bps`;
  };

  const formatIO = (bps: number): string => {
    if (!bps && bps !== 0) return '-';
    if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
    if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} KB/s`;
    return `${bps} B/s`;
  };

  const parseDiskPercent = (pct: string | number): number => {
    if (typeof pct === 'number') return Math.min(100, Math.max(0, pct));
    const cleaned = String(pct).replace(/%/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
  };

  const stats = {
    total: nodes.length,
    online: nodes.filter(n => n.status === 1).length,
    offline: nodes.filter(n => n.status === 0).length,
    totalClouds: nodes.reduce((s, n) => s + n.cloud_num, 0),
  };

  // 节点行数据提取
  const getNodeRowData = (node: NodeItem) => {
    const nd = nodeDataMap[node.id];
    const segments = ipSegmentMap[node.id];
    const ipTotal = segments?.reduce((s, seg) => s + (seg.count?.total || 0), 0);
    const ipUsed = segments?.reduce((s, seg) => s + (seg.count?.used || 0), 0);

    const cpuPct = nd?.cpu_percent ?? 0;
    const cpuCores = nd?.cpu_cores ?? node.max_cpu ?? 0;
    const memPct = nd?.mem_percent ?? 0;
    const memUsed = nd?.mem_used || String(node.memory_used);
    const memTotal = nd?.mem_total || String(node.max_memory);
    const diskList = nd?.disk ?? [];
    const diskTotalGb = nd?.disk_total_gb ?? 0;
    const diskUsedGb = nd?.disk_used_gb ?? 0;
    const diskPct = diskTotalGb > 0 ? Math.min(100, (diskUsedGb / diskTotalGb) * 100) : 0;

    return { nd, segments, ipTotal, ipUsed, cpuPct, cpuCores, memPct, memUsed, memTotal, diskList, diskTotalGb, diskUsedGb, diskPct };
  };

  // 下拉菜单
  const renderDropdown = (node: NodeItem, ipTotal: number | undefined, ipUsed: number | undefined, segments: IpSegmentData[] | undefined) => (
    <>
      {/* 透明遮罩：点击关闭 */}
      <div className="fixed inset-0 z-[15]" onClick={() => setDropdownId(null)} />
      <div
        className="absolute right-0 top-8 z-20 bg-popover border border-border rounded-lg shadow-xl min-w-[280px] py-2 max-h-[60vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">节点详情</div>
        <div className="px-3 py-1.5 text-xs text-muted-foreground">区域: <span className="text-foreground">{node.area_name}</span></div>
        {node.group_name && node.group_name !== '-' && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">分组: <span className="text-foreground">{node.group_name}</span></div>
        )}
        {node.remark && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">备注: <span className="text-foreground">{node.remark}</span></div>
        )}
        {node.version && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">版本: <span className="text-foreground">{node.version}</span></div>
        )}

        <div className="px-3 py-1.5 text-xs text-muted-foreground border-t border-border mt-1 pt-2">IP地址使用</div>
        {ipSegmentLoadingIds.has(node.id) && !segments ? (
          <div className="px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />加载中...
          </div>
        ) : segments && segments.length > 0 ? (
          <>
            <div className="px-3 py-1 text-xs">
              <span className="text-muted-foreground">IP总数: </span>
              <span className="text-foreground font-semibold">{ipTotal}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">已用: </span>
              <span className="text-primary font-semibold">{ipUsed}</span>
              <span className="text-muted-foreground mx-1">|</span>
              <span className="text-muted-foreground">空闲: </span>
              <span className="text-success font-semibold">{(ipTotal || 0) - (ipUsed || 0)}</span>
            </div>
            <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border/50 mt-1 pt-1.5">绑定IP段</div>
            {segments.map(seg => (
              <div key={seg.id} className="px-3 py-1 text-xs flex items-center justify-between">
                <span className="text-foreground/80 truncate max-w-[140px]" title={seg.ip_name}>{seg.ip_name}</span>
                <span className="text-muted-foreground ml-2 shrink-0">
                  <span className="text-primary">{seg.count.used}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-foreground/80">{seg.count.total}</span>
                </span>
              </div>
            ))}
          </>
        ) : (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">无IP段信息</div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      <PageHeader
        title="节点管理"
        titleIcon={Monitor}
        search={{
          value: searchKeyword,
          onChange: (v) => { setSearchKeyword(v); setCurrentPage(1); },
          placeholder: '搜索节点名称/IP...',
        }}
        actions={
          <>
            <select
              value={enableFilter}
              onChange={e => { setEnableFilter(e.target.value); setCurrentPage(1); }}
              className="hidden sm:block bg-muted border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-primary"
            >
              <option value="-1">全部状态</option>
              <option value="1">已启用</option>
              <option value="0">已禁用</option>
            </select>
            <button
              onClick={refreshAll}
              disabled={refreshing}
              className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="刷新数据"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setMonitorSheetOpen(true)}
              className={`p-2 rounded-lg hover:bg-accent transition-colors ${selectedNodeIds.size > 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
              title="监控规则"
            >
              <Shield className="w-4 h-4" />
              {selectedNodeIds.size > 0 && (
                <span className="ml-1 text-xs font-semibold">{selectedNodeIds.size}</span>
              )}
            </button>
            <button
              onClick={() => setBandwidthSheetOpen(true)}
              className={`p-2 rounded-lg hover:bg-accent transition-colors ${selectedNodeIds.size > 0 ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
              title="智能带宽管理"
            >
              <Gauge className="w-4 h-4" />
            </button>
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {/* 摘要统计 */}
        {!loading && nodes.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground">节点总数</div>
              <div className="text-xl font-bold text-foreground">{total}</div>
            </div>
            <div className="bg-card rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle className="w-3 h-3 text-success" />正常运行</div>
              <div className="text-xl font-bold text-success">{stats.online}</div>
            </div>
            <div className="bg-card rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><XCircle className="w-3 h-3 text-destructive" />异常节点</div>
              <div className="text-xl font-bold text-destructive">{stats.offline}</div>
            </div>
            <div className="bg-card rounded-xl border border-border p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Server className="w-3 h-3 text-primary" />总实例数</div>
              <div className="text-xl font-bold text-primary">{stats.totalClouds}</div>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">加载节点列表...</span>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 text-destructive px-4 py-3 rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && nodes.length === 0 && (
          <div className="text-center py-20 text-muted-foreground">
            {searchKeyword ? '未找到匹配的节点' : '暂无节点数据'}
          </div>
        )}

        {/* ===== 桌面端表格 (md+) ===== */}
        {!loading && nodes.length > 0 && (
          <div className="hidden md:block bg-card rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground text-xs">
                    <th className="px-3 py-3 text-left w-8">
                      <Checkbox
                        checked={nodes.length > 0 && selectedNodeIds.size === nodes.length}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedNodeIds(new Set(nodes.map(n => n.id)));
                          } else {
                            setSelectedNodeIds(new Set());
                          }
                        }}
                      />
                    </th>
                    <th className="px-3 py-3 text-left w-12">ID</th>
                    <th className="px-3 py-3 text-left w-16">状态</th>
                    <th className="px-3 py-3 text-left min-w-[120px]">名称</th>
                    <th className="px-3 py-3 text-left">IP</th>
                    <th className="px-3 py-3 text-left w-14">实例</th>
                    <th className="px-3 py-3 text-left min-w-[200px]">CPU / 内存</th>
                    <th className="px-3 py-3 text-left min-w-[100px]">带宽</th>
                    <th className="px-3 py-3 text-left min-w-[140px]">磁盘</th>
                    <th className="px-3 py-3 text-left w-14">启用</th>
                    <th className="px-3 py-3 text-left">区域</th>
                    <th className="px-3 py-3 text-left min-w-[80px]">备注</th>
                    <th className="px-3 py-3 text-left w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map(node => {
                    const d = getNodeRowData(node);
                    const isDropdownOpen = dropdownId === node.id;
                    return (
                      <tr key={node.id} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                        <td className="px-3 py-3">
                          <Checkbox
                            checked={selectedNodeIds.has(node.id)}
                            onCheckedChange={(checked) => {
                              setSelectedNodeIds(prev => {
                                const next = new Set(prev);
                                if (checked) next.add(node.id); else next.delete(node.id);
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td className="px-3 py-3 text-muted-foreground font-mono text-xs">{node.id}</td>
                        <td className="px-3 py-3">
                          {node.status === 1 ? <CheckCircle className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-destructive" />}
                        </td>
                        <td className="px-3 py-3 text-foreground font-medium">{node.name}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <span className="text-foreground font-mono text-xs">{node.ip}</span>
                            <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(node.ip); }} className="text-muted-foreground hover:text-primary transition-colors" title="复制IP">
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`font-semibold ${node.cloud_num > 0 ? 'text-primary' : 'text-muted-foreground'}`}>{node.cloud_num}</span>
                        </td>
                        {/* CPU / 内存 */}
                        <td className="px-3 py-3">
                          {!d.nd && realDataLoading ? (
                            <Loader2 className="w-3 h-3 animate-spin text-primary" />
                          ) : d.nd ? (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <Cpu className="w-3.5 h-3.5 text-primary shrink-0" />
                                <div className="flex-1 min-w-[50px]">
                                  <TooltipProgressBar
                                    value={d.cpuPct}
                                    color={d.cpuPct > 80 ? 'bg-destructive' : d.cpuPct > 50 ? 'bg-warning' : 'bg-success'}
                                    tooltip={`CPU使用率: ${d.cpuPct.toFixed(1)}%  |  总核心数: ${d.cpuCores}`}
                                  />
                                </div>
                                <span className={`text-xs font-mono min-w-[40px] text-right ${d.cpuPct > 80 ? 'text-destructive' : 'text-foreground/80'}`}>{d.cpuPct.toFixed(1)}%</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <MemoryStick className="w-3.5 h-3.5 text-info shrink-0" />
                                <div className="flex-1 min-w-[50px]">
                                  <TooltipProgressBar
                                    value={d.memPct}
                                    color={d.memPct > 80 ? 'bg-destructive' : d.memPct > 50 ? 'bg-warning' : 'bg-info'}
                                    tooltip={`内存使用率: ${d.memPct.toFixed(1)}%  |  用量: ${d.memUsed}  |  总量: ${d.memTotal}`}
                                  />
                                </div>
                                <span className={`text-xs font-mono min-w-[40px] text-right ${d.memPct > 80 ? 'text-destructive' : 'text-foreground/80'}`}>{d.memPct.toFixed(1)}%</span>
                              </div>
                            </div>
                          ) : <span className="text-xs text-muted-foreground">-</span>}
                        </td>
                        {/* 带宽 */}
                        <td className="px-3 py-3">
                          {!d.nd ? (realDataLoading ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : <span className="text-xs text-muted-foreground">-</span>) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <Wifi className="w-3.5 h-3.5 text-info shrink-0" />
                                <span className="text-xs text-foreground/80">入 <span className="text-success font-mono">{formatBw(d.nd.net_inbw)}</span></span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-3.5" />
                                <span className="text-xs text-foreground/80">出 <span className="text-info font-mono">{formatBw(d.nd.net_outbw)}</span></span>
                              </div>
                            </div>
                          )}
                        </td>
                        {/* 磁盘 */}
                        <td className="px-3 py-3">
                          {!d.nd ? (realDataLoading ? <Loader2 className="w-3 h-3 animate-spin text-primary" /> : <span className="text-xs text-muted-foreground">-</span>) : (
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <HardDrive className="w-3.5 h-3.5 text-primary shrink-0" />
                                <div className="flex-1 min-w-[50px]">
                                  <TooltipProgressBar
                                    value={d.diskPct}
                                    color={d.diskPct > 80 ? 'bg-destructive' : d.diskPct > 50 ? 'bg-warning' : 'bg-primary'}
                                    tooltip={`磁盘占用: ${d.diskPct.toFixed(1)}%  |  已用: ${formatDiskSize(d.diskUsedGb)}  |  总量: ${formatDiskSize(d.diskTotalGb)}`}
                                  />
                                </div>
                                <span className={`text-xs font-mono min-w-[40px] text-right ${d.diskPct > 80 ? 'text-destructive' : 'text-foreground/80'}`}>{d.diskPct.toFixed(1)}%</span>
                              </div>
                              {(d.nd.io_read > 0 || d.nd.io_write > 0) && (
                                <div className="flex items-center gap-1.5">
                                  <div className="w-3.5" />
                                  <span className="text-[10px] text-muted-foreground">
                                    读 <span className="text-info font-mono">{formatIO(d.nd.io_read)}</span>
                                    {' '}写 <span className="text-primary font-mono">{formatIO(d.nd.io_write)}</span>
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                        {/* 启用开关 */}
                        <td className="px-3 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleToggleEnable(node.id, node.enable); }}
                            disabled={togglingId === node.id}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 ${node.enable === 1 ? 'bg-success' : 'bg-accent'} ${togglingId === node.id ? 'opacity-50' : ''}`}
                            title={node.enable === 1 ? '点击禁用' : '点击启用'}
                          >
                            {togglingId === node.id && <Loader2 className="w-3 h-3 animate-spin text-foreground absolute left-1" />}
                            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-card transition-transform ${togglingId === node.id ? 'opacity-0' : ''} ${node.enable === 1 ? 'translate-x-4.5' : 'translate-x-1'}`} />
                          </button>
                        </td>
                        <td className="px-3 py-3 text-muted-foreground text-xs">{node.area_name}</td>
                        <td className="px-3 py-3 text-muted-foreground text-xs max-w-[160px] truncate" title={node.remark || ''}>{node.remark || '-'}</td>
                        <td className="px-3 py-3">
                          <div className="relative">
                            <button
                              onClick={(e) => handleDropdown(node.id, e)}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {isDropdownOpen && renderDropdown(node, d.ipTotal, d.ipUsed, d.segments)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== 移动端卡片 (<md) ===== */}
        {!loading && nodes.length > 0 && (
          <div className="md:hidden space-y-3">
            {nodes.map(node => {
              const d = getNodeRowData(node);
              const isDropdownOpen = dropdownId === node.id;
              return (
                <div key={node.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  {/* 标题行 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Checkbox
                        checked={selectedNodeIds.has(node.id)}
                        onCheckedChange={(checked) => {
                          setSelectedNodeIds(prev => {
                            const next = new Set(prev);
                            if (checked) next.add(node.id); else next.delete(node.id);
                            return next;
                          });
                        }}
                      />
                      {node.status === 1 ? <CheckCircle className="w-4 h-4 text-success shrink-0" /> : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                      <span className="text-foreground font-medium truncate">{node.name}</span>
                      <span className="text-xs text-muted-foreground font-mono shrink-0">#{node.id}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleToggleEnable(node.id, node.enable)}
                        disabled={togglingId === node.id}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${node.enable === 1 ? 'bg-success' : 'bg-accent'} ${togglingId === node.id ? 'opacity-50' : ''}`}
                        title={node.enable === 1 ? '点击禁用' : '点击启用'}
                      >
                        {togglingId === node.id && <Loader2 className="w-3 h-3 animate-spin text-foreground absolute left-1.5" />}
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${togglingId === node.id ? 'opacity-0' : ''} ${node.enable === 1 ? 'translate-x-5.5' : 'translate-x-1.5'}`} />
                      </button>
                      <div className="relative">
                        <button
                          onClick={(e) => handleDropdown(node.id, e)}
                          className="p-2 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                        {isDropdownOpen && renderDropdown(node, d.ipTotal, d.ipUsed, d.segments)}
                      </div>
                    </div>
                  </div>

                  {/* 基本信息 */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="flex items-center gap-1 text-foreground/80 font-mono text-xs">
                      {node.ip}
                      <button onClick={() => navigator.clipboard.writeText(node.ip)} className="text-muted-foreground hover:text-primary min-h-[44px] min-w-[44px] flex items-center justify-center -m-1.5 p-1.5">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </span>
                    <span className="text-xs text-muted-foreground"><Server className="w-3 h-3 inline mr-0.5" />{node.cloud_num}台</span>
                    <span className="text-xs text-muted-foreground">{node.area_name}</span>
                    {node.remark && <span className="text-xs text-muted-foreground truncate max-w-[180px]" title={node.remark}>{node.remark}</span>}
                  </div>

                  {/* CPU / 内存 */}
                  {!d.nd && realDataLoading ? (
                    <div className="flex items-center gap-1.5 text-muted-foreground text-xs py-2"><Loader2 className="w-3 h-3 animate-spin text-primary" />加载实时数据...</div>
                  ) : d.nd ? (
                    <div className="space-y-2 pt-2 border-t border-border/60">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-xs text-muted-foreground shrink-0 w-7">CPU</span>
                        <div className="flex-1 min-w-[60px]">
                          <TooltipProgressBar
                            value={d.cpuPct}
                            color={d.cpuPct > 80 ? 'bg-destructive' : d.cpuPct > 50 ? 'bg-warning' : 'bg-success'}
                            tooltip={`CPU使用率: ${d.cpuPct.toFixed(1)}%  |  总核心数: ${d.cpuCores}`}
                          />
                        </div>
                        <span className={`text-xs font-mono min-w-[44px] text-right ${d.cpuPct > 80 ? 'text-destructive' : 'text-foreground/80'}`}>{d.cpuPct.toFixed(1)}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MemoryStick className="w-4 h-4 text-info shrink-0" />
                        <span className="text-xs text-muted-foreground shrink-0 w-7">内存</span>
                        <div className="flex-1 min-w-[60px]">
                          <TooltipProgressBar
                            value={d.memPct}
                            color={d.memPct > 80 ? 'bg-destructive' : d.memPct > 50 ? 'bg-warning' : 'bg-info'}
                            tooltip={`内存使用率: ${d.memPct.toFixed(1)}%  |  用量: ${d.memUsed}  |  总量: ${d.memTotal}`}
                          />
                        </div>
                        <span className={`text-xs font-mono min-w-[44px] text-right ${d.memPct > 80 ? 'text-destructive' : 'text-foreground/80'}`}>{d.memPct.toFixed(1)}%</span>
                      </div>
                    </div>
                  ) : null}

                  {/* 带宽 / 磁盘 */}
                  {d.nd && (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Wifi className="w-3.5 h-3.5 text-info shrink-0" />
                          <span className="text-xs text-muted-foreground">带宽</span>
                        </div>
                        <div className="text-xs text-foreground/80 pl-5">入 <span className="text-success font-mono">{formatBw(d.nd.net_inbw)}</span></div>
                        <div className="text-xs text-foreground/80 pl-5">出 <span className="text-info font-mono">{formatBw(d.nd.net_outbw)}</span></div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <HardDrive className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-xs text-muted-foreground">磁盘</span>
                        </div>
                        {d.diskTotalGb > 0 ? (
                          <>
                            <div className="pl-5">
                              <TooltipProgressBar
                                value={d.diskPct}
                                color={d.diskPct > 80 ? 'bg-destructive' : d.diskPct > 50 ? 'bg-warning' : 'bg-primary'}
                                tooltip={`磁盘占用: ${d.diskPct.toFixed(1)}%  |  已用: ${formatDiskSize(d.diskUsedGb)}  |  总量: ${formatDiskSize(d.diskTotalGb)}`}
                              />
                            </div>
                            <div className="text-[10px] text-muted-foreground pl-5">
                              {d.diskPct.toFixed(1)}%
                            </div>
                          </>
                        ) : <div className="text-xs text-muted-foreground pl-5">-</div>}
                        {(d.nd.io_read > 0 || d.nd.io_write > 0) && (
                          <div className="text-[10px] text-muted-foreground pl-5">
                            读 <span className="text-info font-mono">{formatIO(d.nd.io_read)}</span>
                            {' '}写 <span className="text-primary font-mono">{formatIO(d.nd.io_write)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* 分页 */}
        {!loading && total > perPage && (
          <div className="flex items-center justify-between bg-card rounded-xl border border-border p-3">
            <div className="text-xs text-muted-foreground">
              第 {(currentPage - 1) * perPage + 1}-{Math.min(currentPage * perPage, total)} 条，共 {total} 条
            </div>
            <div className="flex items-center gap-2">
              <select
                value={perPage}
                onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground/80 focus:outline-none min-h-[44px]"
              >
                <option value={10}>10条/页</option>
                <option value={20}>20条/页</option>
                <option value={50}>50条/页</option>
                <option value={100}>100条/页</option>
              </select>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-2 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-muted-foreground">{currentPage}/{totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-2 rounded hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 监控规则 Sheet */}
      <MonitorSheet
        open={monitorSheetOpen}
        onOpenChange={setMonitorSheetOpen}
        nodes={nodes.map(n => ({ id: n.id, name: n.name, ip: n.ip }))}
        selectedNodeIds={selectedNodeIds}
      />

      {/* 智能带宽管理 Sheet */}
      <BandwidthSheet
        open={bandwidthSheetOpen}
        onOpenChange={setBandwidthSheetOpen}
        nodes={nodes.map(n => ({ id: n.id, name: n.name, ip: n.ip }))}
        selectedNodeIds={selectedNodeIds}
      />
    </div>
  );
}

export default function NodesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <NodesContent />
    </Suspense>
  );
}
