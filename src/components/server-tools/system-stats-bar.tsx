'use client';

/**
 * 系统资源状态组件
 *
 * 支持两种布局：
 * - horizontal: 横向条状（已废弃，保留兼容）
 * - vertical: 垂直卡片（用于侧栏，类似参考项目 网页ssh远程/monitor）
 *
 * 实时获取：
 * - CPU 使用率（从 top 输出解析 id 百分比，100-id = 使用率）
 * - 内存使用率
 * - 磁盘使用率（根分区 / ）
 * - 网络流量速率（基于两次采样的字节差 / 时间差）
 *
 * 通过 SSH WS 的 get_stats 命令定期获取（每 2s）。
 */
import { useEffect, useRef, useState } from 'react';
import { Cpu, HardDrive, MemoryStick, Activity, Wifi, Clock } from 'lucide-react';

export interface ServerStats {
  uptime: string;
  load: string;
  cpu: string;
  memory: string;
  disk: Array<{
    filesystem: string;
    size: string;
    used: string;
    available: string;
    percent: string;
    mount: string;
  }>;
  network: { upload: string; download: string };
}

interface SystemStatsBarProps {
  /** 是否已连接（仅连接成功后才轮询） */
  connected: boolean;
  /** 发送 WS 消息的函数（用于触发 get_stats） */
  onRequestStats: () => void;
  /** 接收到的 stats 数据（由父组件通过 onStats 回调传入） */
  stats: ServerStats | null;
  /** 布局：vertical 用于侧栏，horizontal 用于顶部条 */
  variant?: 'vertical' | 'horizontal';
}

interface NetRate {
  upload: string;
  download: string;
}

export default function SystemStatsBar({
  connected,
  onRequestStats,
  stats,
  variant = 'vertical',
}: SystemStatsBarProps) {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 网络流量速率计算：记录上次字节数和时间戳
  const prevNetRef = useRef<{ uploadBytes: number; downloadBytes: number; ts: number } | null>(null);
  const [netRate, setNetRate] = useState<NetRate>({ upload: '0 B/s', download: '0 B/s' });

  useEffect(() => {
    if (!connected) {
      prevNetRef.current = null;
      setNetRate({ upload: '0 B/s', download: '0 B/s' });
      return;
    }
    // 立即请求一次
    onRequestStats();
    // 每 2 秒轮询
    timerRef.current = setInterval(() => {
      onRequestStats();
    }, 2000);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [connected, onRequestStats]);

  // 计算网络流量速率（基于两次采样的字节差 / 时间差）
  useEffect(() => {
    if (!stats) return;
    // stats.network.upload/download 是格式化字符串，需要原始字节数
    // 由于 parseStats 在服务端把字节格式化为字符串，前端需要从字符串反解析
    // 改为从 stats 直接取（这里直接用字符串显示总量，速率需要额外字段）
    // 实际上 parseStats 返回的 network 是格式化字符串，我们无法精确反解析
    // 所以此处改为：如果 stats 包含 rawNetwork 字段则使用，否则仅显示总量
    const now = Date.now();
    const rawStats = stats as ServerStats & { rawNetwork?: { uploadBytes: number; downloadBytes: number } };
    if (rawStats.rawNetwork) {
      const cur = { uploadBytes: rawStats.rawNetwork.uploadBytes, downloadBytes: rawStats.rawNetwork.downloadBytes, ts: now };
      if (prevNetRef.current && cur.ts > prevNetRef.current.ts) {
        const dt = (cur.ts - prevNetRef.current.ts) / 1000; // 秒
        const dr = Math.max(0, (cur.downloadBytes - prevNetRef.current.downloadBytes) / dt);
        const ur = Math.max(0, (cur.uploadBytes - prevNetRef.current.uploadBytes) / dt);
        setNetRate({ upload: formatRate(ur), download: formatRate(dr) });
      }
      prevNetRef.current = cur;
    }
  }, [stats]);

  if (!connected || !stats) {
    if (variant === 'horizontal') {
      return (
        <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] text-gray-600 border-b border-gray-800 overflow-x-auto whitespace-nowrap">
          <Activity className="w-3 h-3 shrink-0" />
          <span>{connected ? '获取资源信息中...' : '未连接'}</span>
        </div>
      );
    }
    return (
      <div className="p-3 border-b border-gray-800">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-2">
          <Activity className="w-3 h-3" />
          <span className="uppercase tracking-wider">资源监控</span>
        </div>
        <div className="text-[11px] text-gray-600 text-center py-2">
          {connected ? '获取资源信息中...' : 'SSH 未连接'}
        </div>
      </div>
    );
  }

  // 解析 CPU 使用率
  const cpuPercent = parseCpuPercent(stats.cpu);
  // 解析内存
  const memInfo = parseMemory(stats.memory);
  // 过滤虚拟文件系统，只保留真实磁盘分区
  const VIRTUAL_FS = ['tmpfs', 'devtmpfs', 'overlay', 'udev', 'shm', 'squashfs', 'proc', 'sysfs', 'cgroup', 'mqueue', 'hugetlb', 'none'];
  const realDisks = stats.disk.filter(d => {
    const fs = (d.filesystem || '').toLowerCase();
    return !VIRTUAL_FS.some(v => fs.includes(v));
  });
  // 解析负载
  const loadParts = stats.load.split(/\s+/).filter(Boolean);
  const load1min = loadParts[0] ?? '-';

  if (variant === 'horizontal') {
    return (
      <div className="flex items-center gap-3 px-3 py-1.5 text-[11px] border-b border-gray-800 overflow-x-auto whitespace-nowrap scrollbar-thin">
        <div className="flex items-center gap-1 shrink-0">
          <Cpu className={`w-3 h-3 ${cpuPercent !== null && cpuPercent > 80 ? 'text-red-400' : 'text-blue-400'}`} />
          <span className="text-gray-500">CPU</span>
          <span className={`font-mono ${cpuPercent !== null && cpuPercent > 80 ? 'text-red-400' : 'text-gray-200'}`}>
            {cpuPercent !== null ? `${cpuPercent.toFixed(1)}%` : 'N/A'}
          </span>
        </div>
        <div className="w-px h-3 bg-gray-800 shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <MemoryStick className={`w-3 h-3 ${memInfo.percent > 80 ? 'text-red-400' : 'text-emerald-400'}`} />
          <span className="text-gray-500">内存</span>
          <span className={`font-mono ${memInfo.percent > 80 ? 'text-red-400' : 'text-gray-200'}`}>
            {memInfo.used}/{memInfo.total}
          </span>
        </div>
        {realDisks.length > 0 && (
          <>
            <div className="w-px h-3 bg-gray-800 shrink-0" />
            <div className="flex items-center gap-1 shrink-0">
              <HardDrive className={`w-3 h-3 ${(parseInt(realDisks[0].percent) || 0) > 80 ? 'text-red-400' : 'text-amber-400'}`} />
              <span className="text-gray-500">磁盘</span>
              <span className={`font-mono ${(parseInt(realDisks[0].percent) || 0) > 80 ? 'text-red-400' : 'text-gray-200'}`}>
                {realDisks[0].used}/{realDisks[0].size}
              </span>
            </div>
          </>
        )}
        <div className="w-px h-3 bg-gray-800 shrink-0" />
        <div className="flex items-center gap-1 shrink-0">
          <Wifi className="w-3 h-3 text-purple-400" />
          <span className="text-gray-500">↓</span>
          <span className="font-mono text-gray-200">{netRate.download}</span>
          <span className="text-gray-500 ml-1">↑</span>
          <span className="font-mono text-gray-200">{netRate.upload}</span>
        </div>
      </div>
    );
  }

  // 垂直布局（侧栏）
  return (
    <div className="p-3 border-b border-gray-800">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mb-3">
        <Activity className="w-3 h-3" />
        <span className="uppercase tracking-wider font-semibold">资源监控</span>
      </div>

      <div className="space-y-2.5">
        {/* CPU */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <Cpu className={`w-3 h-3 ${cpuPercent !== null && cpuPercent > 80 ? 'text-red-400' : 'text-blue-400'}`} />
              <span>CPU</span>
            </div>
            <span className={`font-mono text-[11px] ${cpuPercent !== null && cpuPercent > 80 ? 'text-red-400' : 'text-gray-200'}`}>
              {cpuPercent !== null ? `${cpuPercent.toFixed(1)}%` : 'N/A'}
            </span>
          </div>
          <div className="h-1 bg-gray-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${cpuPercent !== null && cpuPercent > 80 ? 'bg-red-500' : 'bg-blue-500'}`}
              style={{ width: `${cpuPercent ?? 0}%` }}
            />
          </div>
        </div>

        {/* 内存 */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-[10px] text-gray-500">
              <MemoryStick className={`w-3 h-3 ${memInfo.percent > 80 ? 'text-red-400' : 'text-emerald-400'}`} />
              <span>内存</span>
            </div>
            <span className={`font-mono text-[11px] ${memInfo.percent > 80 ? 'text-red-400' : 'text-gray-200'}`}>
              {memInfo.used}/{memInfo.total}
            </span>
          </div>
          <div className="h-1 bg-gray-800 rounded overflow-hidden">
            <div
              className={`h-full transition-all ${memInfo.percent > 80 ? 'bg-red-500' : 'bg-emerald-500'}`}
              style={{ width: `${memInfo.percent}%` }}
            />
          </div>
        </div>

        {/* 磁盘 - 显示所有真实磁盘分区 */}
        {realDisks.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1.5">
              <HardDrive className="w-3 h-3 text-amber-400" />
              <span>磁盘</span>
            </div>
            <div className="space-y-1.5">
              {realDisks.map(d => {
                const pct = parseInt(d.percent) || 0;
                const high = pct > 80;
                return (
                  <div key={`${d.filesystem}-${d.mount}`}>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-gray-400 truncate" title={d.filesystem}>{d.mount || d.filesystem}</span>
                      <span className={`font-mono ${high ? 'text-red-400' : 'text-gray-300'}`}>
                        {d.used}/{d.size} <span className="text-gray-500">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1 bg-gray-800 rounded overflow-hidden">
                      <div
                        className={`h-full transition-all ${high ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {d.available && (
                      <div className="text-[9px] text-gray-600 mt-0.5">可用 {d.available}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 网络速率 */}
        <div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500 mb-1">
            <Wifi className="w-3 h-3 text-purple-400" />
            <span>网络速率</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="bg-gray-800/40 rounded px-2 py-1">
              <div className="text-gray-500">↓ 下行</div>
              <div className="font-mono text-purple-300">{netRate.download}</div>
            </div>
            <div className="bg-gray-800/40 rounded px-2 py-1">
              <div className="text-gray-500">↑ 上行</div>
              <div className="font-mono text-cyan-300">{netRate.upload}</div>
            </div>
          </div>
        </div>

        {/* 负载 + 运行时间 */}
        <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-gray-800/50">
          <div className="text-[10px]">
            <div className="text-gray-500 flex items-center gap-0.5">
              <Activity className="w-2.5 h-2.5 text-cyan-400" />
              <span>负载 1m</span>
            </div>
            <div className="font-mono text-gray-200">{load1min}</div>
          </div>
          <div className="text-[10px]">
            <div className="text-gray-500 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5 text-gray-400" />
              <span>运行</span>
            </div>
            <div className="font-mono text-gray-300 truncate" title={stats.uptime}>
              {stats.uptime.replace(/up\s*,?\s*/i, '').slice(0, 20)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 从 top 命令输出解析 CPU 使用率
 * 支持多种格式：
 * - "%Cpu(s):  3.2 us,  1.1 sy,  0.0 ni, 95.5 id,  0.2 wa,  0.0 hi,  0.0 si,  0.0 st"
 * - "Cpu(s):   3.2 us,  1.1 sy, ..., 95.5 id"
 * - "3.2 us,  1.1 sy,  0.0 ni, 95.5 id"
 */
function parseCpuPercent(cpuText: string): number | null {
  if (!cpuText) return null;
  // 优先匹配 id（空闲）百分比，100-id = 使用率
  const idleMatch = cpuText.match(/([\d.]+)\s+id/);
  if (idleMatch) {
    const idle = parseFloat(idleMatch[1]);
    if (!isNaN(idle)) return Math.max(0, Math.min(100, 100 - idle));
  }
  // 尝试匹配 us 百分比（部分 busybox top 格式）
  const usMatch = cpuText.match(/([\d.]+)\s+us/);
  const syMatch = cpuText.match(/([\d.]+)\s+sy/);
  if (usMatch) {
    const us = parseFloat(usMatch[1]);
    const sy = syMatch ? parseFloat(syMatch[1]) : 0;
    if (!isNaN(us)) return Math.max(0, Math.min(100, us + sy));
  }
  // 兜底：直接匹配百分比
  const percentMatch = cpuText.match(/([\d.]+)%/);
  if (percentMatch) {
    const p = parseFloat(percentMatch[1]);
    if (!isNaN(p)) return Math.max(0, Math.min(100, p));
  }
  return null;
}

/**
 * 从 free -h 输出解析内存信息
 * 支持格式：
 * - "Mem:           3.7Gi       2.1Gi       520Mi       1.1Gi       1.1Gi       1.3Gi"
 * - "Mem:        3870252     2110320      520000     1111111     1111111     1333333"
 */
function parseMemory(memText: string): { used: string; total: string; percent: number } {
  const result = { used: '-', total: '-', percent: 0 };
  if (!memText) return result;
  const match = memText.match(/Mem:\s*(\S+)\s+(\S+)/);
  if (match) {
    result.total = match[1];
    result.used = match[2];
    const totalMi = toMiB(match[1]);
    const usedMi = toMiB(match[2]);
    if (totalMi > 0) {
      result.percent = Math.round((usedMi / totalMi) * 100);
    }
  }
  return result;
}

function toMiB(size: string): number {
  if (!size) return 0;
  const num = parseFloat(size);
  if (isNaN(num)) return 0;
  if (size.endsWith('Gi')) return num * 1024;
  if (size.endsWith('Mi')) return num;
  if (size.endsWith('Ki')) return num / 1024;
  if (size.endsWith('G')) return num * 1024;
  if (size.endsWith('M')) return num;
  if (size.endsWith('K')) return num / 1024;
  if (size.endsWith('Ti')) return num * 1024 * 1024;
  // 纯数字（字节）
  if (/^\d+$/.test(size)) return num / (1024 * 1024);
  return num;
}

function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1) return '0 B/s';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(bytesPerSec / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
}
