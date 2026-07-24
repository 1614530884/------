/**
 * 任务管理 API
 *
 * GET  /api/server-tools/tasks       - 任务列表
 * POST /api/server-tools/tasks       - 创建任务（异步启动）
 */
import { NextRequest, NextResponse } from 'next/server';
import { taskStore } from '@/lib/services/server-tools/store';
import { taskRunner } from '@/lib/services/server-tools/task-runner';
import type { ServerTaskInput, TaskType, TaskStatus } from '@/lib/services/server-tools/types';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

const VALID_TYPES: TaskType[] = ['mount_disk', 'install_bt', 'run_script', 'custom_cmd'];
const VALID_STATUSES: TaskStatus[] = ['pending', 'running', 'success', 'failed', 'cancelled', 'interrupted'];

export const GET = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const status = statusParam && VALID_STATUSES.includes(statusParam as TaskStatus) ? statusParam as TaskStatus : undefined;
  // status 支持逗号分隔多值："success,failed,cancelled,interrupted"
  const statusList = statusParam
    ? statusParam.split(',').map(s => s.trim()).filter((s): s is TaskStatus => VALID_STATUSES.includes(s as TaskStatus))
    : undefined;
  const connectionId = url.searchParams.get('connectionId');
  const finishedAfter = url.searchParams.get('finishedAfter') ?? undefined;
  // onlyOwn=1 时强制按 owner 过滤（通知场景：仅展示当前用户自己创建的任务）
  const onlyOwn = url.searchParams.get('onlyOwn') === '1';
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(200, Math.max(1, Number(limitParam) || 200)) : undefined;
  const list = taskStore.list(currentUser, {
    status,
    statusList: statusList && statusList.length > 1 ? statusList : undefined,
    connectionId: connectionId ?? undefined,
    finishedAfter,
    limit,
    onlyOwn,
  });
  // 标注运行中状态（内存中真实状态）
  const annotated = list.map(t => ({
    ...t,
    isRunning: taskRunner.isRunning(t.id),
  }));
  return NextResponse.json({ success: true, data: annotated });
}, 'st-tasks-get');

export const POST = withAuth(async (request, currentUser) => {
  const body = await request.json() as Partial<ServerTaskInput> & { _loginUser?: string };
  const { _loginUser, ...input } = body;

  if (!input.connectionId || !input.type || !input.title) {
    return NextResponse.json({ success: false, message: '缺少必填字段: connectionId, type, title' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(input.type)) {
    return NextResponse.json({ success: false, message: `无效任务类型: ${input.type}` }, { status: 400 });
  }

  // 校验连接归属（通过 store.getById 的 owner 校验）
  const { connectionStore } = await import('@/lib/services/server-tools/store');
  const conn = connectionStore.getById(input.connectionId, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '关联的连接不存在或无权访问' }, { status: 404 });
  }

  const task = taskStore.create({
    connectionId: input.connectionId,
    type: input.type,
    title: input.title,
    params: input.params ?? {},
  }, currentUser);

  // 异步启动任务（不阻塞 HTTP 响应）
  taskRunner.startTask(task.id, currentUser.username);

  return NextResponse.json({ success: true, data: task });
}, 'st-tasks-post');
