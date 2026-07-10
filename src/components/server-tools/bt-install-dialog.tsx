'use client';

/**
 * 宝塔面板安装弹窗
 *
 * 功能：
 * - 选择版本（宝塔/aapanel）
 * - 提交创建 install_bt 任务
 */
import { useState } from 'react';
import { Shield, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';

interface BtInstallDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  onTaskCreated?: (taskId: string) => void;
}

const STORAGE_KEY = 'idc_auth';
function getLoginUser(): string {
  try {
    const authStr = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (authStr) {
      const data = JSON.parse(authStr);
      if (data.username) {
        const KEY = 'idc-auth-enc-2026';
        const decoded = atob(data.username);
        let result = '';
        for (let i = 0; i < decoded.length; i++) {
          result += String.fromCharCode(decoded.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
        }
        return result;
      }
    }
  } catch { /* ignore */ }
  return '';
}

export default function BtInstallDialog({ open, onClose, connectionId, onTaskCreated }: BtInstallDialogProps) {
  const [version, setVersion] = useState<'baota' | 'aapanel'>('baota');
  const [creating, setCreating] = useState(false);

  if (!open) return null;

  const handleInstall = async () => {
    setCreating(true);
    try {
      const resp = await fetch('/api/server-tools/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          type: 'install_bt',
          title: `安装${version === 'baota' ? '宝塔面板' : 'aaPanel'}`,
          params: { version },
          _loginUser: getLoginUser(),
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('安装任务已创建，可在任务面板查看进度');
        onTaskCreated?.(data.data.id);
        onClose();
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg w-full max-w-md mx-4 p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-success" />
            <h3 className="text-sm font-medium text-foreground">安装宝塔面板</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">面板版本</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setVersion('baota')}
                className={`p-3 text-xs rounded border text-left transition-colors ${
                  version === 'baota'
                    ? 'bg-success/10 border-success/40 text-success'
                    : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <div className="font-medium mb-0.5">宝塔面板</div>
                <div className="text-[10px] text-muted-foreground">国内官方版</div>
              </button>
              <button
                onClick={() => setVersion('aapanel')}
                className={`p-3 text-xs rounded border text-left transition-colors ${
                  version === 'aapanel'
                    ? 'bg-success/10 border-success/40 text-success'
                    : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted/60'
                }`}
              >
                <div className="font-medium mb-0.5">aaPanel</div>
                <div className="text-[10px] text-muted-foreground">国际版</div>
              </button>
            </div>
          </div>

          <div className="p-2 bg-info/10 border border-info/30 rounded text-[11px] text-info">
            ℹ 自动执行三步流程：1.换阿里云源 2.宝塔官方挂载数据盘 3.安装宝塔面板
            <br />
            完整过程约 5-15 分钟，完成后自动捕获面板地址、用户名和密码。
          </div>

          <div className="p-2 bg-warning/10 border border-warning/30 rounded text-[11px] text-warning/80">
            ⚠ 安装前请确保系统是干净的（未安装过 Apache/Nginx/MySQL 等），否则可能导致冲突。
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              取消
            </button>
            <button
              onClick={handleInstall}
              disabled={creating}
              className="px-3 py-1.5 text-xs bg-success hover:bg-success/90 text-success-foreground rounded flex items-center gap-1.5"
            >
              {creating && <Loader2 className="w-3 h-3 animate-spin" />}
              开始安装
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
