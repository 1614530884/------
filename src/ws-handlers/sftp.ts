/**
 * /ws/sftp 处理器
 *
 * P1 阶段：仅占位
 * P5 阶段：实现完整的 SFTP 文件管理
 */
import type { WebSocket, WebSocketServer } from 'ws';

export function setupSftpHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS/SFTP] 新连接（P1 占位，P5 实现）');
    ws.send(JSON.stringify({ type: 'error', payload: 'SFTP 文件管理尚未实现，等待 P5 阶段' }));
    ws.close();
  });
}
