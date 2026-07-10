/**
 * 单个任务 API
 *
 * GET    /api/server-tools/tasks/[id]    - 任务详情
 * DELETE /api/server-tools/tasks/[id]    - 删除任务（仅历史任务）
 */
import { NextRequest, NextResponse } from 'next/server';
import { taskStore } from '@/lib/services/server-tools/store';
import { taskRunner } from '@/lib/services/server-tools/task-runner';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  const task = taskStore.getById(id, currentUser);
  if (!task) {
    return NextResponse.json({ success: false, message: '任务不存在或无权访问' }, { status: 404 });
  }
  return NextResponse.json({ success: true, data: { ...task, isRunning: taskRunner.isRunning(task.id) } });
}, 'st-task-id-get');

export const DELETE = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;
  // 不允许删除正在运行的任务
  if (taskRunner.isRunning(id)) {
    return NextResponse.json({ success: false, message: '任务运行中，请先取消' }, { status: 400 });
  }
  const ok = taskStore.delete(id, currentUser);
  if (!ok) {
    return NextResponse.json({ success: false, message: '任务不存在或无权删除' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}, 'st-task-id-delete');
