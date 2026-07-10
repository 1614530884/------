'use client';

/**
 * 数据盘挂载弹窗
 *
 * 功能：
 * - 自动检测未挂载的数据盘（通过 SSH WS check_datadisk）
 * - 选择磁盘、挂载点、文件系统
 * - 提交创建 mount_disk 任务
 *
 * 防循环：hasDetectedRef 保证每次 open 从 false→true 只检测一次，
 * 配合父组件稳定的 onDetectDisks 引用（useCallback），避免无限触发 exec 拖垮 SSH。
 */
import { useState, useEffect, useRef } from 'react';
import { HardDrive, Loader2, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface DiskInfo {
  name: string;
  size: string;
  fstype: string;
  transport?: string;
}

interface DiskMountDialogProps {
  open: boolean;
  onClose: () => void;
  connectionId: string;
  onTaskCreated?: (taskId: string) => void;
  /** 通过 SSH 终端发送检测命令 */
  onDetectDisks?: () => void;
  /** 检测结果（从终端 WS 回调传入） */
  detectResult?: { unmountedDisks: DiskInfo[]; rootDisk?: string } | null;
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

const MOUNT_PRESETS = ['/www', '/data', '/home', '/mnt/data'];

export default function DiskMountDialog({
  open, onClose, connectionId, onTaskCreated, onDetectDisks, detectResult,
}: DiskMountDialogProps) {
  const [disk, setDisk] = useState('');
  const [mountPoint, setMountPoint] = useState('/www');
  const [fstype, setFstype] = useState('ext4');
  const [creating, setCreating] = useState(false);
  const [detecting, setDetecting] = useState(false);
  // 每次弹窗打开只触发一次检测，关闭后重置
  const hasDetectedRef = useRef(false);

  useEffect(() => {
    if (open && onDetectDisks && !hasDetectedRef.current) {
      hasDetectedRef.current = true;
      setDetecting(true);
      onDetectDisks();
    }
    if (!open) {
      hasDetectedRef.current = false;
    }
  }, [open, onDetectDisks]);

  // 检测结果回来后自动选第一个磁盘，并清除 detecting
  useEffect(() => {
    if (detectResult?.unmountedDisks?.length && !disk) {
      setDisk(detectResult.unmountedDisks[0].name);
    }
    if (detectResult) setDetecting(false);
  }, [detectResult, disk]);

  if (!open) return null;

  const handleRedetect = () => {
    setDetecting(true);
    onDetectDisks?.();
  };

  // 手动输入时，校验是否误填系统盘
  const isManualInput = !detectResult?.unmountedDisks?.length;
  const inputIsRootDisk = !!(detectResult?.rootDisk && disk && disk.replace(/^\/dev\//, '') === detectResult.rootDisk);

  const handleMount = async () => {
    if (!disk) {
      toast.error('请选择或输入磁盘');
      return;
    }
    if (inputIsRootDisk) {
      toast.error('不能格式化系统盘，请选择数据盘');
      return;
    }
    if (!mountPoint.startsWith('/')) {
      toast.error('挂载点必须以 / 开头');
      return;
    }
    setCreating(true);
    try {
      const resp = await fetch('/api/server-tools/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          type: 'mount_disk',
          title: `挂载 ${disk} → ${mountPoint}`,
          params: { disk, mountPoint, fstype },
          _loginUser: getLoginUser(),
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('挂载任务已创建');
        onTaskCreated?.(data.data.id);
        onClose();
        setDisk('');
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 格式化磁盘描述：50G, virtio, ext4
  const formatDiskDesc = (d: DiskInfo): string => {
    const parts: string[] = [];
    if (d.size) parts.push(d.size);
    if (d.transport) parts.push(d.transport);
    if (d.fstype && d.fstype !== 'unknown') parts.push(d.fstype);
    return parts.join(', ');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[#222632] border border-gray-700 rounded-lg w-full max-w-md mx-4 p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-medium text-gray-200">挂载数据盘</h3>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 检测结果 */}
        <div className="mb-3 p-2 bg-gray-800/50 rounded text-xs">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              {detecting ? (
                <div className="flex items-center gap-1.5 text-gray-400">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  正在检测磁盘...
                </div>
              ) : detectResult ? (
                <>
                  {detectResult.unmountedDisks.length > 0 ? (
                    <div className="text-gray-500">
                      检测到 {detectResult.unmountedDisks.length} 个未挂载磁盘
                      {detectResult.rootDisk && <span className="ml-1">（已排除系统盘 {detectResult.rootDisk}）</span>}
                    </div>
                  ) : (
                    <div className="text-gray-500">未检测到未挂载磁盘，可手动输入</div>
                  )}
                </>
              ) : (
                <div className="text-gray-500">未检测</div>
              )}
            </div>
            {!detecting && (
              <button
                onClick={handleRedetect}
                className="ml-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-white border border-gray-700 rounded px-1.5 py-0.5"
                title="重新检测"
              >
                <RefreshCw className="w-3 h-3" />
                刷新
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {/* 磁盘选择 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">磁盘设备</label>
            {detectResult?.unmountedDisks?.length ? (
              <select
                value={disk}
                onChange={e => setDisk(e.target.value)}
                className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              >
                {detectResult.unmountedDisks.map(d => (
                  <option key={d.name} value={d.name}>
                    {d.name} ({formatDiskDesc(d)})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={disk}
                onChange={e => setDisk(e.target.value)}
                placeholder="/dev/vdb"
                className={`w-full bg-gray-900/60 border rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none ${
                  inputIsRootDisk ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-blue-500'
                }`}
              />
            )}
            {inputIsRootDisk && (
              <div className="text-red-400 text-[10px] mt-1">
                ⚠ {disk} 是系统盘，格式化将导致系统崩溃！请改选数据盘。
              </div>
            )}
            {isManualInput && !inputIsRootDisk && detectResult?.rootDisk && (
              <div className="text-gray-500 text-[10px] mt-1">
                提示：系统盘为 {detectResult.rootDisk}，请勿填写。
              </div>
            )}
          </div>

          {/* 挂载点 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">挂载点</label>
            <input
              type="text"
              value={mountPoint}
              onChange={e => setMountPoint(e.target.value)}
              placeholder="/www"
              className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            />
            <div className="flex flex-wrap gap-1 mt-1.5">
              {MOUNT_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setMountPoint(p)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    mountPoint === p
                      ? 'bg-blue-900/30 border-blue-600 text-blue-300'
                      : 'border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* 文件系统 */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">文件系统</label>
            <select
              value={fstype}
              onChange={e => setFstype(e.target.value)}
              className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="ext4">ext4</option>
              <option value="xfs">xfs</option>
              <option value="ext3">ext3</option>
            </select>
          </div>

          {/* 警告 */}
          <div className="p-2 bg-amber-900/20 border border-amber-800/50 rounded text-[11px] text-amber-300">
            ⚠ 挂载会格式化所选磁盘，磁盘上的数据将全部丢失！
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
            >
              取消
            </button>
            <button
              onClick={handleMount}
              disabled={creating || inputIsRootDisk}
              className="px-3 py-1.5 text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded flex items-center gap-1.5"
            >
              {creating && <Loader2 className="w-3 h-3 animate-spin" />}
              开始挂载
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
