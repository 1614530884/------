import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { nodeMonitorService } from './lib/services/node-monitor-service';
import { flushLogs, migrateLogsFromJson } from './lib/services/node-monitor-store';
import { serverToolsService } from './lib/services/server-tools/service';
import { bandwidthManagerService } from './lib/services/bandwidth-manager';
import { setupSshHandler } from './ws-handlers/ssh';
import { setupSftpHandler } from './ws-handlers/sftp';
import { setupTasksHandler } from './ws-handlers/tasks';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ─── WebSocket 安全：Origin 校验 ─────────────────────────
function validateOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // 非 browser 客户端无 origin
  const host = req.headers.host;
  if (!host) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

// ─── WS 路由注册 ─────────────────────────────────────────
const wssMap = new Map<string, WebSocketServer>();

function registerWsEndpoint(path: string): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  wssMap.set(path, wss);
  return wss;
}

function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const parsedUrl = new URL(req.url!, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;
  console.log(`[WS] Upgrade request: ${pathname}`);
  const wss = wssMap.get(pathname);
  if (wss) {
    // Origin 校验，防 CSRF
    if (!validateOrigin(req)) {
      console.log(`[WS] Origin validation failed for ${pathname}`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    // Token 校验
    const token = parsedUrl.searchParams.get('token');
    if (!serverToolsService.validateToken(token)) {
      console.log(`[WS] Token validation failed for ${pathname}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    console.log(`[WS] Upgrade OK for ${pathname}`);
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else if (!dev) {
    socket.destroy();
  }
}

// ─── 注册 WS 端点 ────────────────────────────────────────
setupSshHandler(registerWsEndpoint('/ws/ssh'));
setupSftpHandler(registerWsEndpoint('/ws/sftp'));
setupTasksHandler(registerWsEndpoint('/ws/tasks'));

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });

  // WebSocket 升级处理
  server.on('upgrade', handleUpgrade);

  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });

  // 启动节点监控后台服务
  nodeMonitorService.start();

  // 迁移旧 JSON 日志到 SQLite（仅执行一次，导入后重命名为 .bak）
  migrateLogsFromJson();

  // 启动服务器管理工具服务（含 DB 初始化、Token 管理、任务恢复）
  serverToolsService.start();

  // 启动智能带宽管理服务
  bandwidthManagerService.start();

  // 优雅关闭
  const shutdown = () => {
    nodeMonitorService.stop();
    bandwidthManagerService.stop();
    serverToolsService.stop();
    flushLogs();
    server.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});
