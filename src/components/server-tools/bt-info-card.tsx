'use client';

/**
 * 宝塔面板信息卡组件
 *
 * 功能：
 * - 显示当前连接关联的宝塔面板信息（URL/用户名/密码）
 * - 复制按钮、打开 URL、删除
 * - 安装完成后自动刷新
 */
import { useState, useEffect, useCallback } from 'react';
import { Shield, Copy, ExternalLink, Trash2, RefreshCw, Eye, EyeOff, Loader2, ClipboardList } from 'lucide-react';
import { toast } from 'sonner';

interface BtPanelInfo {
  id: string;
  url?: string;
  innerUrl?: string;
  username?: string;
  password?: string;
  panelPort?: number;
  capturedAt: string;
}

interface BtInfoCardProps {
  connectionId: string;
  /** 触发刷新（如任务完成后） */
  refreshTrigger?: number;
}

export default function BtInfoCard({ connectionId, refreshTrigger }: BtInfoCardProps) {
  const [panels, setPanels] = useState<BtPanelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  const fetchPanels = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/server-tools/bt-panels?connectionId=${encodeURIComponent(connectionId)}`);
      const data = await resp.json();
      if (data.success) {
        setPanels(data.data);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [connectionId]);

  useEffect(() => {
    fetchPanels();
  }, [fetchPanels, refreshTrigger]);

  // 定期轮询（捕获后台安装任务产生的新宝塔信息）
  useEffect(() => {
    const timer = setInterval(fetchPanels, 15000);
    return () => clearInterval(timer);
  }, [fetchPanels]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`已复制${label}`);
    }).catch(() => {
      toast.error('复制失败');
    });
  };

  // 一键复制所有宝塔信息，格式化输出方便直接发给客户
  const handleCopyAll = (panel: BtPanelInfo) => {
    const lines: string[] = ['=== 宝塔面板信息 ==='];
    if (panel.url) lines.push(`公网面板地址: ${panel.url}`);
    if (panel.innerUrl) lines.push(`内网面板地址: ${panel.innerUrl}`);
    if (panel.username) lines.push(`面板账号: ${panel.username}`);
    if (panel.password) lines.push(`面板密码: ${panel.password}`);
    if (panel.panelPort) lines.push(`面板端口: ${panel.panelPort}`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast.success('已复制全部宝塔信息', { duration: 2000 });
    }).catch(() => {
      // 后备方案
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        toast.success('已复制全部宝塔信息', { duration: 2000 });
      } catch {
        toast.error('复制失败，请手动复制');
      }
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该宝塔信息记录？')) return;
    try {
      const resp = await fetch(`/api/server-tools/bt-panels/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        toast.success('已删除');
        fetchPanels();
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const togglePassword = (id: string) => {
    setShowPassword(prev => ({ ...prev, [id]: !prev[id] }));
  };

  if (loading && panels.length === 0) {
    return (
      <div className="flex items-center text-[11px] text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin mr-1" />
        加载中...
      </div>
    );
  }

  if (panels.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground">
        暂无宝塔信息，安装完成后将自动显示
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {panels.map(panel => (
        <div key={panel.id} className="p-2 bg-muted/40 rounded border border-border/50 text-[11px]">
          {/* 公网地址 */}
          {panel.url && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-muted-foreground shrink-0 w-12">公网</span>
              <span className="flex-1 truncate text-success" title={panel.url}>{panel.url}</span>
              <button onClick={() => handleCopy(panel.url!, '公网地址')} className="text-muted-foreground hover:text-foreground" title="复制">
                <Copy className="w-3 h-3" />
              </button>
              <a href={panel.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" title="打开">
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {/* 内网地址 */}
          {panel.innerUrl && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-muted-foreground shrink-0 w-12">内网</span>
              <span className="flex-1 truncate text-info" title={panel.innerUrl}>{panel.innerUrl}</span>
              <button onClick={() => handleCopy(panel.innerUrl!, '内网地址')} className="text-muted-foreground hover:text-foreground" title="复制">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 用户名 */}
          {panel.username && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-muted-foreground shrink-0 w-12">账号</span>
              <span className="flex-1 truncate text-foreground/80">{panel.username}</span>
              <button onClick={() => handleCopy(panel.username!, '用户名')} className="text-muted-foreground hover:text-foreground" title="复制">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 密码 */}
          {panel.password && (
            <div className="flex items-center gap-1 mb-1">
              <span className="text-muted-foreground shrink-0 w-12">密码</span>
              <span className="flex-1 truncate text-foreground/80 font-mono">
                {showPassword[panel.id] ? panel.password : '••••••••'}
              </span>
              <button onClick={() => togglePassword(panel.id)} className="text-muted-foreground hover:text-foreground" title={showPassword[panel.id] ? '隐藏' : '显示'}>
                {showPassword[panel.id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              </button>
              <button onClick={() => handleCopy(panel.password!, '密码')} className="text-muted-foreground hover:text-foreground" title="复制">
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 底部操作 */}
          <div className="flex items-center justify-between pt-1 mt-1 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground">
              {new Date(panel.capturedAt).toLocaleString('zh-CN')}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleCopyAll(panel)}
                className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-success/15 hover:bg-success/25 text-success/80 rounded border border-success/30"
                title="一键复制全部信息（可直接发给客户）"
              >
                <ClipboardList className="w-3 h-3" />
                复制全部
              </button>
              <button
                onClick={() => handleDelete(panel.id)}
                className="text-muted-foreground hover:text-destructive p-0.5"
                title="删除"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
