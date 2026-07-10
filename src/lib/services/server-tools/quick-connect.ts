'use client';

/**
 * 快速 SSH 连接工具
 *
 * 用于从财务系统/云控制台跳转到 server-tools 内置 SSH 终端。
 * 按 host 查找已有连接（复用），找不到则创建新连接，最后返回连接 ID 供前端跳转。
 */

interface ServerConnectionInfo {
  id: string;
  host: string;
  port: number;
  username: string;
  name: string;
}

interface QuickConnectInput {
  host: string;
  username: string;
  password: string;
  port?: number;
  name?: string;
}

/**
 * 查找或创建 server-tools 连接，返回连接 ID（失败返回 null）
 *
 * 流程：
 * 1. GET /api/server-tools/connections 查找同 host 的已有连接
 * 2. 找到 → PATCH 更新用户名/密码（密码可能已变更）→ 返回 id
 * 3. 没找到 → POST 创建新连接 → 返回 id
 */
export async function quickConnectToServer(input: QuickConnectInput): Promise<string | null> {
  const { host, username, password, port = 22, name } = input;
  if (!host) return null;

  try {
    const listResp = await fetch('/api/server-tools/connections');
    if (listResp.ok) {
      const listData = await listResp.json();
      if (listData.success && Array.isArray(listData.data)) {
        const existing = (listData.data as ServerConnectionInfo[]).find(c => c.host === host);
        if (existing) {
          await fetch(`/api/server-tools/connections/${existing.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
          });
          return existing.id;
        }
      }
    }

    const createResp = await fetch('/api/server-tools/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || host, host, port, username, password }),
    });
    if (createResp.ok) {
      const createData = await createResp.json();
      if (createData.success && createData.data?.id) {
        return createData.data.id as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}
