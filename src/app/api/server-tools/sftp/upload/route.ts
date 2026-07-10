/**
 * SFTP 文件上传 API
 *
 * POST /api/server-tools/sftp/upload
 *
 * 使用 multipart/form-data：
 * - connectionId: 连接 ID
 * - path: 目标路径（含文件名）
 * - file: 文件内容
 */
import { NextRequest, NextResponse } from 'next/server';
import { sftpClientManager } from '@/lib/services/server-tools/sftp-client';
import { connectionStore } from '@/lib/services/server-tools/store';
import { withAuth } from '@/lib/services/server-tools/api-helpers';

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB

export const POST = withAuth(async (request, currentUser) => {
  const formData = await request.formData();
  const connectionId = formData.get('connectionId') as string | null;
  const path = formData.get('path') as string | null;
  const file = formData.get('file') as File | null;

  if (!connectionId || !path || !file) {
    return NextResponse.json({ success: false, message: '缺少 connectionId, path 或 file' }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return NextResponse.json({ success: false, message: `文件过大，超过 ${MAX_UPLOAD_SIZE / 1024 / 1024}MB 限制` }, { status: 400 });
  }

  const conn = connectionStore.getById(connectionId, currentUser);
  if (!conn) {
    return NextResponse.json({ success: false, message: '连接不存在或无权访问' }, { status: 404 });
  }

  try {
    const writeStream = await sftpClientManager.createWriteStream(connectionId, path);
    const buffer = Buffer.from(await file.arrayBuffer());

    await new Promise<void>((resolve, reject) => {
      writeStream.on('error', err => reject(new Error(`上传失败: ${err.message}`)));
      writeStream.on('close', () => resolve());
      writeStream.write(buffer);
      writeStream.end();
    });

    return NextResponse.json({ success: true, data: { size: buffer.length } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}, 'st-sftp-upload');
