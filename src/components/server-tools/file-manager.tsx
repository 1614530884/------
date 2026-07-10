'use client';

/**
 * 文件管理组件
 *
 * 功能：
 * - 目录浏览（路径面包屑 + 表格列表）
 * - 文本文件预览
 * - 文件上传、下载
 * - 创建目录、删除、重命名
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Folder, File as FileIcon, ChevronRight, ArrowUp, Upload, Download,
  Trash2, FolderPlus, RefreshCw, Loader2, X, Eye, Home,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/services/server-tools/api-client';

interface SftpEntry {
  name: string;
  longname: string;
  type: 'file' | 'dir' | 'symlink' | 'other';
  size: number;
  modifyTime: number;
  accessTime: number;
  rights: { user: string; group: string; other: string };
  owner: string;
  group: string;
}

interface FileManagerProps {
  connectionId: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(ts: number): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function joinPath(base: string, name: string): string {
  if (base === '/') return `/${name}`;
  return `${base}/${name}`;
}

function parentPath(path: string): string {
  if (path === '/') return '/';
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.length === 0 ? '/' : `/${parts.join('/')}`;
}

const TEXT_EXTENSIONS = ['.txt', '.log', '.conf', '.cfg', '.sh', '.py', '.js', '.ts', '.json', '.xml', '.yaml', '.yml', '.md', '.ini', '.env', '.sql', '.css', '.html', '.csv'];

function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));
}

export default function FileManager({ connectionId }: FileManagerProps) {
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<SftpEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [showMkdir, setShowMkdir] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchList = useCallback(async (p: string) => {
    setLoading(true);
    setSelectedEntry(null);
    try {
      const result = await apiFetch<SftpEntry[]>(`/api/server-tools/sftp?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(p)}`);
      if (result.ok && result.data) {
        // 防御性处理：过滤掉无效条目，补全缺失字段
        const safe = result.data
          .filter(e => e && typeof e === 'object')
          .map(e => ({
            name: e.name ?? '',
            longname: e.longname ?? '',
            type: e.type ?? 'other',
            size: e.size ?? 0,
            modifyTime: e.modifyTime ?? 0,
            accessTime: e.accessTime ?? 0,
            rights: e.rights ?? { user: '', group: '', other: '' },
            owner: e.owner ?? '',
            group: e.group ?? '',
          }));
        // 排序：目录在前，文件在后，各自按名称排序（空值保护防止 localeCompare 崩溃）
        const sorted = safe.sort((a, b) => {
          if (a.type === 'dir' && b.type !== 'dir') return -1;
          if (a.type !== 'dir' && b.type === 'dir') return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        setEntries(sorted);
      } else if (result.status !== 401) {
        toast.error(result.message || '读取目录失败');
        setEntries([]);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取目录失败');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    fetchList(path);
  }, [path, fetchList]);

  const navigateTo = (newPath: string) => {
    setPath(newPath);
  };

  const handleEntryClick = (entry: SftpEntry) => {
    setSelectedEntry(entry);
    if (entry.type === 'dir') {
      navigateTo(joinPath(path, entry.name));
    }
  };

  const handlePreview = async (entry: SftpEntry) => {
    if (!isTextFile(entry.name)) {
      toast.warning('仅支持预览文本文件');
      return;
    }
    setLoadingPreview(true);
    setPreviewName(entry.name);
    try {
      const filePath = joinPath(path, entry.name);
      const resp = await fetch(`/api/server-tools/sftp?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(filePath)}&action=read`);
      const data = await resp.json();
      if (data.success) {
        setPreviewContent(data.data);
      } else {
        toast.error(data.message || '读取文件失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleDownload = (entry: SftpEntry) => {
    const filePath = joinPath(path, entry.name);
    const url = `/api/server-tools/sftp?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(filePath)}&action=download`;
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDelete = async (entry: SftpEntry) => {
    if (!confirm(`确定删除 ${entry.type === 'dir' ? '目录' : '文件'} "${entry.name}"？`)) return;
    const filePath = joinPath(path, entry.name);
    try {
      const resp = await fetch(`/api/server-tools/sftp?connectionId=${encodeURIComponent(connectionId)}&path=${encodeURIComponent(filePath)}&type=${entry.type === 'dir' ? 'dir' : 'file'}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        toast.success('已删除');
        fetchList(path);
      } else {
        toast.error(data.message || '删除失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleMkdir = async () => {
    const name = mkdirName.trim();
    if (!name) {
      toast.error('请输入目录名');
      return;
    }
    try {
      const resp = await fetch('/api/server-tools/sftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mkdir', connectionId, path: joinPath(path, name) }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('目录已创建');
        setShowMkdir(false);
        setMkdirName('');
        fetchList(path);
      } else {
        toast.error(data.message || '创建失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('connectionId', connectionId);
      formData.append('path', joinPath(path, file.name));
      formData.append('file', file);
      const resp = await fetch('/api/server-tools/sftp/upload', { method: 'POST', body: formData });
      const data = await resp.json();
      if (data.success) {
        toast.success(`已上传 ${file.name}`);
        fetchList(path);
      } else {
        toast.error(data.message || '上传失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 面包屑路径段
  const pathParts = path.split('/').filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-[#1a1d27] text-gray-200">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <button
          onClick={() => navigateTo(parentPath(path))}
          disabled={path === '/' || loading}
          className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          title="上级目录"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fetchList(path)}
          disabled={loading}
          className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          title="刷新"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* 面包屑 */}
        <div className="flex items-center gap-0.5 flex-1 min-w-0 text-xs overflow-x-auto">
          <button
            onClick={() => navigateTo('/')}
            className="p-0.5 text-gray-400 hover:text-white shrink-0"
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          {pathParts.map((part, i) => {
            const partPath = '/' + pathParts.slice(0, i + 1).join('/');
            return (
              <div key={partPath} className="flex items-center shrink-0">
                <ChevronRight className="w-3 h-3 text-gray-600" />
                <button
                  onClick={() => navigateTo(partPath)}
                  className={`px-1 hover:text-white ${i === pathParts.length - 1 ? 'text-gray-200 font-medium' : 'text-gray-400'}`}
                >
                  {part}
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={() => setShowMkdir(true)}
          className="p-1 text-gray-400 hover:text-white"
          title="新建目录"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
          title="上传文件"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {/* 文件列表 */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-1" /> 加载中...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-8 text-xs text-gray-600">空目录</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#222632] text-gray-500">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">名称</th>
                <th className="text-right px-3 py-1.5 font-medium w-20">大小</th>
                <th className="text-right px-3 py-1.5 font-medium w-32">修改时间</th>
                <th className="text-center px-3 py-1.5 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr
                  key={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  className={`cursor-pointer border-b border-gray-800/50 hover:bg-gray-800/30 ${
                    selectedEntry?.name === entry.name ? 'bg-emerald-900/20' : ''
                  }`}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {entry.type === 'dir' ? (
                        <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      ) : (
                        <FileIcon className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      )}
                      <span className="truncate">{entry.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-400">
                    {entry.type === 'dir' ? '-' : formatSize(entry.size)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-500">
                    {formatDate(entry.modifyTime)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-center gap-1">
                      {entry.type === 'file' && isTextFile(entry.name) && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePreview(entry); }}
                          className="text-gray-500 hover:text-white"
                          title="预览"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      )}
                      {entry.type === 'file' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                          className="text-gray-500 hover:text-white"
                          title="下载"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(entry); }}
                        className="text-gray-500 hover:text-red-400"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 新建目录弹窗 */}
      {showMkdir && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowMkdir(false)}>
          <div className="bg-[#222632] border border-gray-700 rounded-lg p-4 w-full max-w-xs mx-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-gray-200">新建目录</h3>
              <button onClick={() => setShowMkdir(false)} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={mkdirName}
              onChange={e => setMkdirName(e.target.value)}
              placeholder="目录名"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleMkdir(); }}
              className="w-full bg-gray-900/60 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-blue-500 mb-3"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowMkdir(false)} className="px-3 py-1 text-xs text-gray-400 hover:text-white">取消</button>
              <button onClick={handleMkdir} className="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 text-white rounded">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* 文件预览弹窗 */}
      {(previewContent !== null || loadingPreview) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setPreviewContent(null); setPreviewName(''); }}>
          <div
            className="bg-[#222632] border border-gray-700 rounded-lg w-full max-w-3xl mx-4 max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
              <h3 className="text-sm text-gray-200 truncate">{previewName}</h3>
              <button onClick={() => { setPreviewContent(null); setPreviewName(''); }} className="text-gray-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              {loadingPreview ? (
                <div className="flex items-center justify-center text-xs text-gray-500">
                  <Loader2 className="w-4 h-4 animate-spin mr-1" /> 加载中...
                </div>
              ) : (
                <pre className="text-[11px] text-gray-300 font-mono whitespace-pre-wrap break-all">{previewContent}</pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
