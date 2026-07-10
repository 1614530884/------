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
import { getCurrentUser } from '@/lib/services/server-tools/auth';
import { verifySessionToken, SESSION_COOKIE_NAME } from '@/lib/auth-server';
import { logUnauthorizedAccess } from '@/lib/access-log';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!verifySessionToken(sessionCookie)) {
    logUnauthorizedAccess(request, 'st-task-cancel');
    return NextResponse.json({ success: false, message: '未授权，请先登录' }, { status: 401 });
  }
  const currentUser = await getCurrentUser(request);
  if (!currentUser) {
    return NextResponse.json({ success: false, message: '未登录' }, { status: 401 });
  }
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
}
