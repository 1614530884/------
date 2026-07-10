/**
 * SFTP 文件管理 API
 *
 * GET    /api/server-tools/sftp?connectionId=X&path=/                 - 列出目录
 * GET    /api/server-tools/sftp?connectionId=X&path=/file&action=read - 读取文本文件
 * GET    /api/server-tools/sftp?connectionId=X&path=/file&action=download - 下载文件
 * POST   /api/server-tools/sftp  body: { action, connectionId, path, ... }
 *   - action: 'mkdir' | 'rename'
 * DELETE /api/server-tools/sftp?connectionId=X&path=/file            - 删除文件/目录
 */
import { NextRequest, NextResponse } from 'next/server';
import { sftpClientManager } from '@/lib/services/server-tools/sftp-client';
import { connectionStore } from '@/lib/services/server-tools/store';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

export const GET = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connectionId');
  const path = url.searchParams.get('path');
  const action = url.searchParams.get('action');

  if (!connectionId || !path) {
    return NextResponse.json({ success: false, message: '缺少 connectionId 或 path' }, { status: 400 });
  }

  // 校验连接归属
  const conn = connectionStore.getById(connectionId, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }

  try {
    if (action === 'read') {
      const buffer = await sftpClientManager.readFile(connectionId, path);
      const text = buffer.toString('utf-8');
      return NextResponse.json({ success: true, data: text });
    }

    if (action === 'download') {
      const stream = await sftpClientManager.createReadStream(connectionId, path);
      const filename = path.split('/').pop() || 'download';
      const readable = new ReadableStream({
        start(controller) {
          stream.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          stream.on('end', () => controller.close());
          stream.on('error', err => controller.error(err));
        },
      });
      return new NextResponse(readable, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        },
      });
    }

    // 默认：列出目录
    const entries = await sftpClientManager.list(connectionId, path);
    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}, 'st-sftp-get');

export const POST = withAuth(async (request, currentUser) => {
  const body = await request.json() as {
    action: 'mkdir' | 'rename';
    connectionId: string;
    path?: string;
    oldPath?: string;
    newPath?: string;
  };

  if (!body.connectionId || !body.action) {
    return NextResponse.json({ success: false, message: '缺少 connectionId 或 action' }, { status: 400 });
  }

  const conn = connectionStore.getById(body.connectionId, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }

  try {
    if (body.action === 'mkdir') {
      if (!body.path) return NextResponse.json({ success: false, message: '缺少 path' }, { status: 400 });
      await sftpClientManager.mkdir(body.connectionId, body.path);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'rename') {
      if (!body.oldPath || !body.newPath) return NextResponse.json({ success: false, message: '缺少 oldPath 或 newPath' }, { status: 400 });
      await sftpClientManager.rename(body.connectionId, body.oldPath, body.newPath);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, message: `未知 action: ${body.action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}, 'st-sftp-post');

export const DELETE = withAuth(async (request, currentUser) => {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get('connectionId');
  const path = url.searchParams.get('path');
  const type = url.searchParams.get('type') || 'file';

  if (!connectionId || !path) {
    return NextResponse.json({ success: false, message: '缺少 connectionId 或 path' }, { status: 400 });
  }

  const conn = connectionStore.getById(connectionId, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }

  try {
    if (type === 'dir') {
      await sftpClientManager.rmdir(connectionId, path);
    } else {
      await sftpClientManager.unlink(connectionId, path);
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}, 'st-sftp-delete');
