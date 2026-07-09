import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  let host = '';
  try {
    const body = await request.json();
    host = String(body.host || '').trim();

    if (!host || !/^[\w.-]+$/.test(host)) {
      return NextResponse.json({ success: false, message: '无效的主机地址' });
    }

    // 根据操作系统选择 ping 参数
    const isWin = process.platform === 'win32';
    const pingArgs = isWin
      ? ['-n', '4', '-w', '2000', host]   // Windows: -n次数 -w超时(ms)
      : ['-c', '4', '-W', '2', host];      // Linux: -c次数 -W超时(s)

    let output = '';
    try {
      const result = await execFileAsync('ping', pingArgs, {
        encoding: 'utf-8',
        timeout: 15000,
        killSignal: 'SIGKILL',
      });
      output = result.stdout;
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; killed?: boolean };
      if (execErr.killed) {
        return NextResponse.json({
          success: true,
          host: host,
          reachable: false,
          avgLatency: null,
          minLatency: null,
          maxLatency: null,
          packetLoss: 100,
          replies: 0,
          error: '执行超时',
        });
      }
      output = execErr.stdout || '';
      if (!output && execErr.stderr) {
        return NextResponse.json({
          success: true,
          host: host,
          reachable: false,
          avgLatency: null,
          minLatency: null,
          maxLatency: null,
          packetLoss: 100,
          replies: 0,
          error: '主机不可达',
        });
      }
    }

    // 解析 ping 输出（兼容 Windows 和 Linux）
    let avgLatency: number | null = null;
    let minLatency: number | null = null;
    let maxLatency: number | null = null;
    let packetLoss = 100;

    if (isWin) {
      // Windows 中文: "最小 = 1ms, 最大 = 2ms, 平均 = 1ms"
      // Windows English: "Minimum = 1ms, Maximum = 2ms, Average = 1ms"
      const statsMatch = output.match(/(?:最小|Minimum)\s*=\s*(\d+)ms.*?(?:最大|Maximum)\s*=\s*(\d+)ms.*?(?:平均|Average)\s*=\s*(\d+)ms/i);
      if (statsMatch) {
        minLatency = parseInt(statsMatch[1], 10);
        maxLatency = parseInt(statsMatch[2], 10);
        avgLatency = parseInt(statsMatch[3], 10);
      }
      // Windows 丢包: "(X% 丢失)" 或 "(X% loss)"
      const lossMatch = output.match(/\((\d+)%\s*(?:丢失|loss)\)/i);
      packetLoss = lossMatch ? parseInt(lossMatch[1], 10) : (avgLatency !== null ? 0 : 100);
    } else {
      // Linux: "rtt min/avg/max/mdev = X/X/X/X ms"
      const rttMatch = output.match(/rtt min\/avg\/max\/mdev\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/i);
      if (rttMatch) {
        minLatency = Math.round(parseFloat(rttMatch[1]) * 10) / 10;
        avgLatency = Math.round(parseFloat(rttMatch[2]) * 10) / 10;
        maxLatency = Math.round(parseFloat(rttMatch[3]) * 10) / 10;
      }
      // Linux 丢包: "X% packet loss"
      const lossMatch = output.match(/(\d+)%\s*packet\s*loss/i);
      packetLoss = lossMatch ? parseInt(lossMatch[1], 10) : (avgLatency !== null ? 0 : 100);
    }

    // 逐行提取 icmp_seq 的延迟
    const replies: number[] = [];
    const replyRegex = /(?:time[=<]\s*)([\d.]+)\s*ms/i;
    for (const line of output.split('\n')) {
      const m = line.match(replyRegex);
      if (m) replies.push(parseFloat(m[1]));
    }

    if (avgLatency === null && replies.length > 0) {
      avgLatency = Math.round(replies.reduce((a, b) => a + b, 0) / replies.length * 10) / 10;
      minLatency = Math.round(Math.min(...replies) * 10) / 10;
      maxLatency = Math.round(Math.max(...replies) * 10) / 10;
    }

    const reachable = avgLatency !== null || replies.length > 0;

    return NextResponse.json({
      success: true,
      host: host,
      reachable: reachable,
      avgLatency: avgLatency,
      minLatency: minLatency,
      maxLatency: maxLatency,
      packetLoss: packetLoss,
      replies: replies.length,
    });
  } catch {
    return NextResponse.json({
      success: true,
      host: host,
      reachable: false,
      avgLatency: null,
      minLatency: null,
      maxLatency: null,
      packetLoss: 100,
      replies: 0,
      error: '执行异常',
    });
  }
}
