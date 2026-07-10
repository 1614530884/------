/**
 * /ws/ssh 处理器
 *
 * 协议见 types.ts SshWsMessageIn / SshWsMessageOut
 *
 * 安全：
 * 1. Token 已在 server.ts 升级时校验
 * 2. connect 时根据 connectionId 查 DB，校验 owner（通过 _loginUser 消息字段）
 *
 * 关键修复：
 * - 使用 TextDecoder 的 stream 模式处理 UTF-8，避免多字节字符跨 chunk 分割产生替换字符（"在在在"乱码根因）
 * - shell 创建时传入初始 cols/rows，避免 pty 默认 80x24 与 xterm 实际尺寸不匹配
 */
import type { WebSocket, WebSocketServer } from 'ws';
import { sshClientManager, type SSHSession } from '@/lib/services/server-tools/ssh-client';
import { connectionStore } from '@/lib/services/server-tools/store';
import type { SshWsMessageIn, SshWsMessageOut, ServerStats } from '@/lib/services/server-tools/types';

interface WSContext {
  sessionId: string;
  connectionId?: string;
  session?: SSHSession;
  loginUser?: string;
}

function send(ws: WebSocket, msg: SshWsMessageOut): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function setupSshHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    const ctx: WSContext = { sessionId: Math.random().toString(36).slice(2) };
    let connectMsgReceived = false;
    const connectTimeout = setTimeout(() => {
      if (!connectMsgReceived) {
        send(ws, { type: 'error', payload: '连接超时：未收到 connect 消息' });
        ws.close();
      }
    }, 10000);

    ws.on('message', raw => {
      let msg: SshWsMessageIn;
      try {
        msg = JSON.parse(raw.toString()) as SshWsMessageIn;
      } catch {
        send(ws, { type: 'error', payload: '消息格式错误' });
        return;
      }

      switch (msg.type) {
        case 'ping':
          send(ws, { type: 'pong' });
          break;

        case 'connect': {
          connectMsgReceived = true;
          clearTimeout(connectTimeout);
          void handleConnect(ws, ctx, msg.payload);
          break;
        }

        case 'input': {
          if (ctx.session?.stream && ctx.session.stream.writable) {
            sshClientManager.writeToShell(ctx.session.stream, msg.payload.data);
          }
          break;
        }

        case 'resize': {
          if (ctx.session?.stream) {
            sshClientManager.resizeShell(ctx.session.stream, msg.payload.cols, msg.payload.rows);
          }
          break;
        }

        case 'check_datadisk': {
          if (ctx.session) void handleCheckDatadisk(ws, ctx);
          else send(ws, { type: 'error', payload: 'SSH 未连接' });
          break;
        }

        case 'get_stats': {
          if (ctx.session) void handleGetStats(ws, ctx);
          else send(ws, { type: 'error', payload: 'SSH 未连接' });
          break;
        }

        default:
          send(ws, { type: 'error', payload: `未知消息类型: ${(msg as { type: string }).type}` });
      }
    });

    ws.on('close', () => {
      clearTimeout(connectTimeout);
      if (ctx.sessionId) sshClientManager.removeSession(ctx.sessionId);
    });

    ws.on('error', () => {
      if (ctx.sessionId) sshClientManager.removeSession(ctx.sessionId);
    });
  });
}

async function handleConnect(
  ws: WebSocket,
  ctx: WSContext,
  payload: { connectionId: string; host: string; port: number; username: string; password: string; cols?: number; rows?: number },
): Promise<void> {
  const { connectionId, host, port, username, password, cols, rows } = payload;
  ctx.connectionId = connectionId;
  console.log(`[SSH] handleConnect: ${host}:${port} as ${username}`);

  send(ws, { type: 'status', payload: 'connecting' });

  try {
    console.log('[SSH] Creating ssh2 connection...');
    const client = await sshClientManager.createConnection({
      host,
      port,
      username,
      password,
      readyTimeout: 30000,
    });
    console.log('[SSH] Connection established, creating shell...');

    send(ws, { type: 'status', payload: 'creating_shell' });

    const session: SSHSession = {
      sessionId: ctx.sessionId,
      connectionId,
      client,
      stream: null as never, // 占位，下面 createShell 后填充
      isConnected: false,
      connectedAt: new Date(),
    };

    // 使用 TextDecoder stream 模式：跨 chunk 的多字节 UTF-8 字符会被正确拼接
    // 避免 Buffer.toString('utf-8') 在不完整序列处产生 \uFFFD（"在在在"乱码根因）
    const decoder = new TextDecoder('utf-8');
    const onData = (data: Buffer): void => {
      const text = decoder.decode(data, { stream: true });
      if (text) send(ws, { type: 'output', payload: text });
    };
    const onClose = (): void => {
      // flush 残留字节
      const tail = decoder.decode();
      if (tail) send(ws, { type: 'output', payload: tail });
      send(ws, { type: 'status', payload: 'disconnected' });
    };

    const stream = await sshClientManager.createShell(
      client,
      onData,
      onClose,
      cols ?? 80,
      rows ?? 24,
    );

    session.stream = stream;
    session.isConnected = true;
    sshClientManager.saveSession(ctx.sessionId, session);
    ctx.session = session;

    // 更新最后连接时间
    connectionStore.updateLastConnectedAt(connectionId);

    send(ws, { type: 'status', payload: 'connected' });
    console.log('[SSH] Shell created, sent connected status');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SSH] Error: ${message}`);
    send(ws, { type: 'error', payload: message });
    send(ws, { type: 'status', payload: 'disconnected' });
    ws.close();
  }
}

/**
 * 检测数据盘挂载情况
 * 列出所有未挂载的物理磁盘（排除根盘/光驱/回环）
 * 返回 rootDisk 供前端二次校验，防止误格式化系统盘
 *
 * 用 lsblk -P（pairs 键值对）输出：raw 模式(-r)会省略空字段导致列错位，
 * pairs 模式保留空字段（FSTYPE=""），Node 端按字段名解析，不依赖列位置
 *
 * 已挂载识别：磁盘可能挂载在分区上（如 /dev/vdb1），此时磁盘本身 MOUNTPOINT 为空，
 * 需通过 PKNAME 检查子分区是否已挂载，避免把"有已挂载分区的磁盘"误判为未挂载
 */
async function handleCheckDatadisk(ws: WebSocket, ctx: WSContext): Promise<void> {
  if (!ctx.session) return;
  try {
    // 第一行 ROOT:<根盘名>，后续为 lsblk -P 的 pairs 行
    const lsblkOutput = await sshClientManager.executeCommand(
      ctx.session.client,
      `echo "ROOT:$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1)"
lsblk -Po NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE,TRAN,PKNAME 2>/dev/null`,
    );

    let rootDisk: string | undefined;
    const fieldRe = /(\w+)="([^"]*)"/g;
    const allLines: Array<Record<string, string>> = [];
    for (const line of lsblkOutput.trim().split('\n')) {
      if (!line) continue;
      if (line.startsWith('ROOT:')) {
        const v = line.slice(5).trim();
        if (v) rootDisk = v;
        continue;
      }
      if (!line.startsWith('NAME=')) continue;
      const fields: Record<string, string> = {};
      fieldRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = fieldRe.exec(line)) !== null) {
        fields[m[1]] = m[2];
      }
      allLines.push(fields);
    }

    // 收集所有已挂载分区的父磁盘名（分区通过 PKNAME 指向父磁盘）
    const mountedParentDisks = new Set<string>();
    for (const f of allLines) {
      if (f.MOUNTPOINT && f.PKNAME) {
        mountedParentDisks.add(f.PKNAME);
      }
    }

    const unmountedDisks: Array<{ name: string; size: string; fstype: string; transport?: string }> = [];
    for (const f of allLines) {
      if (f.TYPE !== 'disk' || !f.NAME || f.NAME === rootDisk || /^(sr|loop)/.test(f.NAME)) continue;
      // 磁盘自身已挂载，或其任一子分区已挂载 → 跳过
      const isMounted = !!f.MOUNTPOINT || mountedParentDisks.has(f.NAME);
      if (isMounted) continue;
      unmountedDisks.push({
        name: `/dev/${f.NAME}`,
        size: f.SIZE || '',
        fstype: f.FSTYPE || 'unknown',
        transport: f.TRAN || undefined,
      });
    }

    const result: SshWsMessageOut = {
      type: 'datadisk_result',
      payload: {
        unmountedDisks,
        rootDisk,
      },
    };
    send(ws, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', payload: `检测数据盘失败: ${message}` });
  }
}

/**
 * 获取服务器资源统计
 * 命令格式：===SECTION=== 标记分段
 */
async function handleGetStats(ws: WebSocket, ctx: WSContext): Promise<void> {
  if (!ctx.session) return;
  try {
    // CPU 改用 /proc/stat 两次采样（间隔 1s）计算 1 秒平均使用率
    // 1s 窗口比 0.3s 更稳定，数值跳动更小
    const cmd = `echo "===UPTIME==="; uptime; echo "===LOAD==="; cat /proc/loadavg; echo "===CPU==="; head -1 /proc/stat; sleep 1; head -1 /proc/stat; echo "===MEM==="; free -h; echo "===DISK==="; df -h; echo "===NET==="; cat /proc/net/dev | awk 'NR>2 {print $1, $2, $10}'`;
    const output = await sshClientManager.executeCommand(ctx.session.client, cmd);
    send(ws, { type: 'stats', payload: parseStats(output) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(ws, { type: 'error', payload: `获取资源统计失败: ${message}` });
  }
}

function parseStats(raw: string): ServerStats {
  const sections: Record<string, string> = {};
  const parts = raw.split(/===\w+===/).map(s => s.trim());
  const keys = raw.match(/===(\w+)===/g)?.map(k => k.replace(/===/g, '')) ?? [];
  keys.forEach((k, i) => {
    sections[k] = parts[i + 1] ?? '';
  });

  const uptime = sections.UPTIME?.split('\n')[0] ?? '';
  const loadParts = (sections.LOAD ?? '').split(/\s+/);
  const load = loadParts.slice(0, 3).join(' ');

  // CPU：解析 /proc/stat 的两次采样，计算差值得到瞬时使用率
  // 格式：cpu  user nice system idle iowait irq softirq steal guest guest_nice
  const cpuLines = (sections.CPU ?? '').split('\n').filter(l => l.startsWith('cpu'));
  const cpu = computeCpuPercent(cpuLines);

  const memLine = (sections.MEM ?? '').split('\n').find(l => l.includes('Mem')) ?? '';
  const memory = memLine || ((sections.MEM ?? '').split('\n')[0] ?? '');

  const diskLines = (sections.DISK ?? '').split('\n').slice(1).filter(Boolean);
  const disk = diskLines.map(line => {
    const p = line.split(/\s+/);
    return {
      filesystem: p[0] ?? '',
      size: p[1] ?? '',
      used: p[2] ?? '',
      available: p[3] ?? '',
      percent: p[4] ?? '',
      mount: p[5] ?? '',
    };
  });

  const netLines = (sections.NET ?? '').split('\n').filter(Boolean);
  // 合计所有网卡的字节数（排除 lo 回环）
  let totalDownload = 0;
  let totalUpload = 0;
  for (const line of netLines) {
    const p = line.split(/\s+/);
    const iface = (p[0] ?? '').replace(':', '');
    if (iface === 'lo') continue; // 跳过回环接口
    if (p.length >= 3) {
      totalDownload += Number(p[1] ?? 0);
      totalUpload += Number(p[2] ?? 0);
    }
  }
  const upload = formatBytes(totalUpload);
  const download = formatBytes(totalDownload);

  return {
    uptime,
    load,
    cpu,
    memory,
    disk,
    network: { upload, download },
    rawNetwork: { uploadBytes: totalUpload, downloadBytes: totalDownload },
  };
}

/**
 * 从 /proc/stat 两次采样计算 CPU 使用率
 * 输入：['cpu  100 200 300 4000 100 0 0 0 0 0', 'cpu  110 210 310 4050 105 0 0 0 0 0']
 * 计算：total = 所有字段之和的差值；idle = 第4个字段(idle)的差值
 * CPU% = (1 - idle/total) * 100
 */
function computeCpuPercent(cpuLines: string[]): string {
  if (cpuLines.length < 2) {
    // 只有一次采样，无法计算瞬时值，返回空让前端显示 N/A
    return '';
  }
  const parseLine = (line: string): { total: number; idle: number } => {
    const fields = line.trim().split(/\s+/).slice(1).map(Number);
    // 字段顺序：user nice system idle iowait irq softirq steal guest guest_nice
    // idle = idle + iowait（iowait 也算空闲时间）
    const idle = (fields[3] ?? 0) + (fields[4] ?? 0);
    const total = fields.reduce((sum, n) => sum + (isNaN(n) ? 0 : n), 0);
    return { total, idle };
  };
  const s1 = parseLine(cpuLines[0]);
  const s2 = parseLine(cpuLines[1]);
  const dt = s2.total - s1.total;
  const di = s2.idle - s1.idle;
  if (dt <= 0) return '0';
  const usage = (1 - di / dt) * 100;
  // 返回 "xx.x" 格式，前端 parseCpuPercent 会解析
  return `cpu usage: ${Math.max(0, Math.min(100, usage)).toFixed(1)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
