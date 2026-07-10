'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Server, Loader2, User, Globe, Search, X, Activity, HardDrive, Wifi, ChevronLeft, ChevronRight, Copy, Monitor, Trash2, TerminalSquare } from 'lucide-react';
import MobileSidebar from '@/components/mobile-sidebar';
import { getLoginUser } from '@/lib/auth-client';

interface CloudInstance {
  id: number;
  hostname: string;
  mainip: string;
  status: string;
  cpu: number;
  memory: number;
  os: string;
  node_name: string;
  username: string;
  userId: number;
  in_bw: number;
  out_bw: number;
  disk_size: string;
  // 实时数据
  cpu_usage: number;
  memory_usage: number;
  current_in_bw: string;
  current_out_bw: string;
  current_read_byte: number;
  current_write_byte: number;
  traffic_used: number;
  traffic_percent: number;
}

function UserInstancesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get('userId') || '';
  const queryKeyword = searchParams.get('q') || '';

  const [instances, setInstances] = useState<CloudInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [searchKeyword, setSearchKeyword] = useState(queryKeyword || '');
  const [total, setTotal] = useState(0);
  // 用户是否手动修改过搜索框
  const [searchModified, setSearchModified] = useState(false);

  // Ping 状态
  const [pingMap, setPingMap] = useState<Record<number, { loading: boolean; result: { reachable: boolean; avgLatency: number | null; error?: string } | null }>>({});

  // 分页
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  // 实时数据加载状态
  const [realDataLoading, setRealDataLoading] = useState(false);

  // Ping 处理
  const handlePing = useCallback(async (instId: number, ip: string) => {
    if (!ip || ip === '-') return;
    setPingMap(prev => ({ ...prev, [instId]: { loading: true, result: null } }));
    try {
      const res = await fetch('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: ip }) });
      const data = await res.json();
      setPingMap(prev => ({ ...prev, [instId]: { loading: false, result: { reachable: data.reachable, avgLatency: data.avgLatency, error: data.error } } }));
    } catch {
      setPingMap(prev => ({ ...prev, [instId]: { loading: false, result: { reachable: false, avgLatency: null, error: '请求失败' } } }));
    }
  }, []);

  const callMfyApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<Record<string, any>> => {
    const loginUser = getLoginUser();
    const response = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: loginUser, ...params }),
    });
    return response.json();
  }, []);

  // 格式化带宽字符串
  const formatBwStr = (bw: string): string => {
    if (!bw || bw === '-') return '-';
    return bw;
  };

  // 格式化磁盘IO
  const formatDiskIO = (val: number): string => {
    return `${(val || 0).toFixed(1)}`;
  };

  useEffect(() => {
    const fetchInstances = async () => {
      setLoading(true);
      try {
        const params: Record<string, unknown> = {
          page: currentPage,
          per_page: perPage,
        };
        // 用户手动修改搜索后，取消userId过滤，全局搜索
        if (!searchModified && userId) params.user = Number(userId);
        if (searchKeyword.trim()) {
          params.search = searchKeyword.trim();
          params.searchtype = '0';
        }

        const res = await callMfyApi('userCloudList', params);
        if (res.success && res.data) {
          const d = (res.data as Record<string, unknown>).data || res.data;
          const meta = (res.data as Record<string, unknown>).meta as Record<string, any> | undefined;
          const list = Array.isArray(d) ? d : [];
          setTotal(meta?.total ?? list.length);

          const mapped: CloudInstance[] = list.map((item: Record<string, any>) => ({
            id: item.id,
            hostname: item.hostname || '-',
            mainip: item.mainip || '-',
            status: item.status || '',
            cpu: item.cpu || 0,
            memory: item.memory || 0,
            os: item.os || '-',
            node_name: item.node_name || item.area?.name || '-',
            username: item.user?.username || '-',
            userId: item.user?.id || 0,
            in_bw: item.in_bw || 0,
            out_bw: item.out_bw || 0,
            disk_size: Array.isArray(item.disk)
              ? item.disk.reduce((sum: number, d: Record<string, any>) => sum + (d.size || 0), 0) + ' GB'
              : '-',
            cpu_usage: 0,
            memory_usage: 0,
            current_in_bw: '-',
            current_out_bw: '-',
            current_read_byte: 0,
            current_write_byte: 0,
            traffic_used: Number(item.traffic_used) || 0,
            traffic_percent: Number(item.traffic_percent) || 0,
          }));
          setInstances(mapped);
          if (mapped.length > 0 && mapped[0].username !== '-') {
            setUsername(mapped[0].username);
          }

          // 异步加载实时数据，不阻塞列表显示
          if (mapped.length > 0) {
            const instanceIds = mapped.map(i => i.id);
            setRealDataLoading(true);
            callMfyApi('realDataList', { ids: instanceIds }).then(realRes => {
              if (realRes.success && realRes.data) {
                const realList: unknown[] = Array.isArray(realRes.data) ? realRes.data : (Array.isArray((realRes.data as Record<string, unknown>).data) ? (realRes.data as Record<string, unknown>).data as unknown[] : []);
                const realMap = new Map<number, Record<string, any>>();
                for (const item of realList) {
                  const r = item as Record<string, any>;
                  if (r.id) realMap.set(r.id, r);
                }
                setInstances(prev => prev.map(inst => {
                  const rd = realMap.get(inst.id);
                  if (!rd) return inst;
                  return {
                    ...inst,
                    cpu_usage: Number(rd.cpu_usage) || 0,
                    memory_usage: rd.memory_usage === -1 ? 0 : Number(rd.memory_usage) || 0,
                    current_in_bw: rd.current_in_bw || '-',
                    current_out_bw: rd.current_out_bw || '-',
                    current_read_byte: Number(rd.current_read_byte) || 0,
                    current_write_byte: Number(rd.current_write_byte) || 0,
                  };
                }));
              }
            }).catch(() => { /* 实时数据获取失败不影响主列表 */ }).finally(() => setRealDataLoading(false));
          }
        } else {
          setError(res.msg || '获取实例列表失败');
        }
      } catch {
        setError('请求失败');
      }
      setLoading(false);
    };
    fetchInstances();
  }, [userId, searchKeyword, currentPage, perPage, callMfyApi]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'on': return { label: '运行中', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      case 'off': return { label: '已关机', color: 'bg-red-500/15 text-red-400 border-red-500/30' };
      case 'process': case 'operating': return { label: '操作中', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
      case 'suspend': return { label: '已暂停', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
      case 'recycle': return { label: '回收站', color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
      default: return { label: status || '未知', color: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
    }
  };

  // 条形图组件
  const ProgressBar = ({ value, max = 100, color = 'bg-emerald-500', bgColor = 'bg-gray-700' }: { value: number; max?: number; color?: string; bgColor?: string }) => {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className={`w-full h-1.5 rounded-full ${bgColor} overflow-hidden`}>
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-white">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-10 bg-[#1a1d27] border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <MobileSidebar currentPath="/user-instances" variant="subpage" />
          <button onClick={() => router.push('/')} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors shrink-0">
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline">首页</span>
          </button>
          <h1 className="text-lg font-semibold flex items-center gap-2 shrink-0">
            <Server className="w-5 h-5 text-purple-500" />
            <span className="hidden sm:inline">实例列表</span>
          </h1>
          {/* 搜索框 */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchKeyword}
              onChange={e => { setSearchKeyword(e.target.value); setCurrentPage(1); setSearchModified(true); }}
              placeholder="搜索主机名/IP/用户名..."
              className="w-full pl-9 pr-8 py-1.5 bg-gray-800/80 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 transition-colors"
            />
            {searchKeyword && (
              <button onClick={() => { setSearchKeyword(''); setCurrentPage(1); setSearchModified(true); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <a href="/nodes"
              className="inline-flex items-center gap-1 border border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 hover:text-white px-2 py-1 rounded-lg text-xs transition-colors">
              <Monitor className="w-3.5 h-3.5" />
              <span>节点</span>
            </a>
            <a href="/server-tools"
              className="inline-flex items-center gap-1 border border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 hover:text-white px-2 py-1 rounded-lg text-xs transition-colors">
              <TerminalSquare className="w-3.5 h-3.5" />
              <span>服务器工具</span>
            </a>
            <a href="/recycle-bin"
              className="inline-flex items-center gap-1 border border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 hover:text-white px-2 py-1 rounded-lg text-xs transition-colors">
              <Trash2 className="w-3.5 h-3.5" />
              <span>回收站</span>
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-2 sm:p-4 space-y-4">
        {/* 用户/搜索信息 */}
        <div className="bg-[#1a1d27] rounded-xl border border-gray-800 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              {(!searchModified && userId) ? (
                <>
                  <div className="text-sm text-gray-500">用户ID: {userId}</div>
                  {username && <div className="text-white font-medium">{username}</div>}
                </>
              ) : (
                <>
                  <div className="text-sm text-gray-500">全部实例</div>
                  {searchKeyword && <div className="text-white font-medium">搜索: {searchKeyword}</div>}
                </>
              )}
            </div>
            <div className="ml-auto text-sm text-gray-500">
              共 {total} 个产品
            </div>
          </div>
        </div>

        {/* 加载状态 */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
            <span className="ml-3 text-gray-400">加载实例列表...</span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded-lg">{error}</div>
        )}

        {/* 无结果 */}
        {!loading && !error && instances.length === 0 && (
          <div className="text-center py-20 text-gray-500">{searchKeyword ? '未找到匹配的实例' : '暂无实例'}</div>
        )}

        {/* 实例列表 */}
        {!loading && instances.length > 0 && (
          <div className="grid gap-3">
            {instances.map((inst) => {
              const statusInfo = getStatusLabel(inst.status);
              return (
                <div
                  key={inst.id}
                  onClick={() => router.push(`/advanced?hostid=${inst.id}`)}
                  className="w-full bg-[#1a1d27] border border-gray-800 rounded-xl p-4 hover:border-purple-500/50 transition-colors text-left group cursor-pointer"
                >
                  {/* 第一行：主机名 + 状态 + IP + 用户 + ID */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Server className="w-5 h-5 text-purple-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-medium truncate">{inst.hostname}</span>
                          <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(inst.hostname); }} className="text-gray-500 hover:text-purple-400 transition-colors shrink-0" title="复制主机名"><Copy className="w-3 h-3" /></button>
                          <span className={`px-2 py-0.5 rounded text-xs border ${statusInfo.color}`}>{statusInfo.label}</span>
                          <span className="flex items-center gap-1 text-sm font-semibold text-gray-200"><Globe className="w-3.5 h-3.5 text-gray-400" />{inst.mainip}<button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(inst.mainip); }} className="ml-0.5 text-gray-500 hover:text-purple-400 transition-colors" title="复制IP"><Copy className="w-3 h-3" /></button><button onClick={e => { e.stopPropagation(); handlePing(inst.id, inst.mainip); }} className="text-gray-500 hover:text-emerald-400 transition-colors" title="Ping" disabled={pingMap[inst.id]?.loading}>{pingMap[inst.id]?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}</button>{pingMap[inst.id]?.result && <span className={`text-[10px] font-mono ${pingMap[inst.id].result?.reachable ? 'text-emerald-400' : 'text-red-400'}`}>{pingMap[inst.id].result?.reachable ? `${pingMap[inst.id].result?.avgLatency}ms` : (pingMap[inst.id].result?.error || '超时')}</span>}</span>
                          <span className="flex items-center gap-1 text-sm text-gray-400"><User className="w-3.5 h-3.5" />{inst.username}<button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(inst.username); }} className="ml-0.5 text-gray-500 hover:text-purple-400 transition-colors" title="复制用户名"><Copy className="w-3 h-3" /></button></span>
                          <span className="text-sm text-gray-500">ID:{inst.id}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 第二行：配置信息 + 实时监控 */}
                  <div className="flex flex-col sm:flex-row sm:items-stretch gap-3 mt-3 pt-3 border-t border-gray-800/60">
                    {/* 左侧：基础配置 */}
                    <div className="flex flex-wrap gap-x-5 gap-y-1.5 items-center text-sm shrink-0">
                      <div className="flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-purple-400" />
                        <span className="text-gray-500">配置</span>
                        <span className="text-gray-200 font-semibold">{inst.cpu}核 / {inst.memory}GB</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-gray-500">带宽</span>
                        <span className="text-gray-200 font-semibold">进{inst.in_bw}/出{inst.out_bw} Mbps</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-gray-500">磁盘</span>
                        <span className="text-gray-200 font-semibold">{inst.disk_size}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-orange-400" />
                        <span className="text-gray-500">节点</span>
                        <span className="text-gray-200">{inst.node_name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-gray-500">系统</span>
                        <span className="text-gray-200 truncate max-w-[140px]">{inst.os}</span>
                      </div>
                    </div>

                    {/* 右侧：实时监控（上下布局） */}
                    <div className={`flex gap-4 sm:ml-auto sm:border-l sm:border-gray-800/60 sm:pl-4 shrink-0 ${realDataLoading ? 'opacity-40' : ''} transition-opacity duration-300 relative`}>
                      {realDataLoading && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-400" />
                        </div>
                      )}
                      {/* CPU & 内存 上下排列 */}
                      <div className="space-y-1.5 min-w-[100px]">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-0.5">
                            <span className="text-gray-500">CPU</span>
                            <span className={`font-medium ${inst.cpu_usage > 80 ? 'text-red-400' : 'text-gray-300'}`}>{inst.cpu_usage}%</span>
                          </div>
                          <ProgressBar value={inst.cpu_usage} color={inst.cpu_usage > 80 ? 'bg-red-500' : inst.cpu_usage > 50 ? 'bg-yellow-500' : 'bg-emerald-500'} />
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-xs mb-0.5">
                            <span className="text-gray-500">内存</span>
                            <span className={`font-medium ${inst.memory_usage > 80 ? 'text-red-400' : 'text-gray-300'}`}>{inst.memory_usage}%</span>
                          </div>
                          <ProgressBar value={inst.memory_usage} color={inst.memory_usage > 80 ? 'bg-red-500' : inst.memory_usage > 50 ? 'bg-yellow-500' : 'bg-cyan-500'} />
                        </div>
                      </div>
                      {/* 网络 */}
                      <div className="space-y-1 min-w-[80px]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">上行</span>
                          <span className="text-gray-300">{formatBwStr(inst.current_out_bw)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">下行</span>
                          <span className="text-gray-300">{formatBwStr(inst.current_in_bw)}</span>
                        </div>
                      </div>
                      {/* 磁盘IO */}
                      <div className="space-y-1 min-w-[90px]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">读速</span>
                          <span className="text-gray-300">{formatDiskIO(inst.current_read_byte)} MB/s</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-500">写速</span>
                          <span className="text-gray-300">{formatDiskIO(inst.current_write_byte)} MB/s</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 分页 */}
        {!loading && total > perPage && (
          <div className="flex items-center justify-between bg-[#1a1d27] rounded-xl border border-gray-800 p-3">
            <div className="text-xs text-gray-500">
              第 {(currentPage - 1) * perPage + 1}-{Math.min(currentPage * perPage, total)} 条，共 {total} 条
            </div>
            <div className="flex items-center gap-2">
              <select
                value={perPage}
                onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none"
              >
                <option value={10}>10条/页</option>
                <option value={20}>20条/页</option>
                <option value={50}>50条/页</option>
                <option value={100}>100条/页</option>
              </select>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-400">{currentPage}/{totalPages}</span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-1 rounded hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function UserInstancesPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    }>
      <UserInstancesContent />
    </Suspense>
  );
}
