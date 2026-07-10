/**
 * 任务取消 API
 *
 * POST /api/server-tools/tasks/[id]/cancel  - 取消运行中的任务
 *
 * 仅任务 owner 或管理员可取消；仅 running/pending 状态可取消。
 */
import { NextRequest, NextResponse } from 'next/server';
import { taskStore } from '@/lib/services/server-tools/store';
import { taskRunner } from '@/lib/services/server-tools/task-runner';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (_request, currentUser, { params }: RouteParams) => {
  const { id } = await params;

  // 校验任务归属
  const task = taskStore.getById(id, currentUser);
  if (!task) {
    return NextResponse.json({ success: false, message: '任务不存在或无权访问' }, { status: 404 });
  }

  // 仅运行中可取消
  if (!taskRunner.isRunning(id)) {
    return NextResponse.json({ success: false, message: '任务不在运行中，无法取消' }, { status: 400 });
  }

  const ok = taskRunner.cancelTask(id);
  if (!ok) {
    return NextResponse.json({ success: false, message: '取消失败' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}, 'st-task-cancel');
