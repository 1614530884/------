/**
 * /ws/tasks 处理器
 *
 * 协议见 types.ts TasksWsMessageIn / TasksWsMessageOut
 *
 * 用法：
 * 1. 客户端建立连接（Token 已在 server.ts 校验）
 * 2. 发送 { type: 'subscribe', taskId: 'xxx', loginUser: 'xxx' }
 * 3. 服务端推送 task_status / task_log / task_finished
 * 4. 历史日志通过 REST /api/server-tools/tasks/[id]/logs 补齐
 */
import type { WebSocket, WebSocketServer } from 'ws';
import { taskRunner } from '@/lib/services/server-tools/task-runner';
import { taskStore, taskLogStore } from '@/lib/services/server-tools/store';
import { loadAdminUsernames } from '@/lib/services/server-tools/auth';
import type { TasksWsMessageIn, TasksWsMessageOut } from '@/lib/services/server-tools/types';

function send(ws: WebSocket, msg: TasksWsMessageOut): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

interface WSContext {
  subscribedTaskIds: Set<string>;
}

export function setupTasksHandler(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    const ctx: WSContext = { subscribedTaskIds: new Set() };
    // 60s 没收到 ping 就关闭
    const idleTimeout = setTimeout(() => {
      if (ctx.subscribedTaskIds.size === 0) {
        ws.close();
      }
    }, 60000);

    ws.on('message', raw => {
      let msg: TasksWsMessageIn;
      try {
        msg = JSON.parse(raw.toString()) as TasksWsMessageIn;
      } catch {
        send(ws, { type: 'error', payload: '消息格式错误' });
        return;
      }

      switch (msg.type) {
        case 'ping':
          send(ws, { type: 'pong' });
          // 重置 idle timer
          clearTimeout(idleTimeout);
          break;

        case 'subscribe': {
          const taskId = msg.taskId;
          const loginUser = msg.loginUser;
          // 校验任务归属
          const task = taskStore.getByIdInternal(taskId);
          if (!task) {
            send(ws, { type: 'error', payload: `任务不存在: ${taskId}` });
            return;
          }
          const adminList = loadAdminUsernames();
          const isAdmin = adminList.includes(loginUser);
          if (!isAdmin && task.owner !== loginUser) {
            send(ws, { type: 'error', payload: '无权订阅此任务' });
            return;
          }

          taskRunner.subscribe(taskId, ws);
          ctx.subscribedTaskIds.add(taskId);

          // 推送当前任务状态
          send(ws, {
            type: 'task_status',
            payload: {
              id: task.id,
              status: task.status,
              progress: task.progress,
              error: task.error,
            },
          });

          // 推送历史日志（增量）
          const logs = taskLogStore.listInternal(taskId);
          for (const log of logs) {
            send(ws, {
              type: 'task_log',
              payload: {
                taskId: log.taskId,
                seq: log.seq,
                ts: log.ts,
                level: log.level,
                msg: log.msg,
              },
            });
          }

          // 如果任务已结束，发送 task_finished
          if (task.status === 'success' || task.status === 'failed' || task.status === 'cancelled' || task.status === 'interrupted') {
            send(ws, {
              type: 'task_finished',
              payload: { id: task.id, status: task.status },
            });
          }
          break;
        }

        case 'unsubscribe': {
          const taskId = msg.taskId;
          taskRunner.unsubscribe(taskId, ws);
          ctx.subscribedTaskIds.delete(taskId);
          break;
        }

        default:
          send(ws, { type: 'error', payload: `未知消息类型: ${(msg as { type: string }).type}` });
      }
    });

    ws.on('close', () => {
      clearTimeout(idleTimeout);
      taskRunner.unsubscribeAll(ws);
    });

    ws.on('error', () => {
      taskRunner.unsubscribeAll(ws);
    });
  });
}
