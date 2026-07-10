'use client';

/**
 * 服务器管理工具 - 脚本管理页面
 *
 * 功能：
 * - 左侧：脚本列表（按分类分组，内置 + 自定义，管理员可拖拽排序）
 * - 右侧：脚本编辑器（名称/分类/描述/内容/参数表单，管理员可设为内置）
 * - 支持 CRUD（管理员可编辑/删除内置脚本，可切换上锁状态）
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Loader2, Trash2, Save, X, Lock, Unlock,
  Search, Code2, Folder, GripVertical, Pencil,
} from 'lucide-react';
import MobileSidebar from '@/components/mobile-sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/services/server-tools/api-client';

interface ScriptParam {
  name: string;
  label: string;
  defaultValue?: string;
  required: boolean;
  placeholder?: string;
}

interface ScriptDef {
  id: string;
  name: string;
  category: 'maintenance' | 'install' | 'inspect' | 'custom';
  description?: string;
  content: string;
  params: ScriptParam[];
  builtin: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: '维护',
  install: '安装',
  inspect: '检查',
  custom: '自定义',
};

const CATEGORY_COLORS: Record<string, string> = {
  maintenance: 'text-blue-400 border-blue-700/50 bg-blue-900/20',
  install: 'text-emerald-400 border-emerald-700/50 bg-emerald-900/20',
  inspect: 'text-amber-400 border-amber-700/50 bg-amber-900/20',
  custom: 'text-purple-400 border-purple-700/50 bg-purple-900/20',
};

type EditorMode = { type: 'idle' } | { type: 'new' } | { type: 'edit'; script: ScriptDef };

export default function ScriptsPage() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>({ type: 'idle' });
  const [deleteTarget, setDeleteTarget] = useState<ScriptDef | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // 编辑器表单状态
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState<ScriptDef['category']>('custom');
  const [formDescription, setFormDescription] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formParams, setFormParams] = useState<ScriptParam[]>([]);
  const [formBuiltin, setFormBuiltin] = useState(false);

  // 拖拽排序状态
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 标记是否发生过真实拖动（区分点击与拖动，解决拖拽结束后 click 触发问题）
  const wasDraggedRef = useRef(false);

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<ScriptDef[]>('/api/server-tools/scripts');
      if (result.ok && result.data) {
        setScripts(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 获取当前用户信息（管理员判定）
  useEffect(() => {
    (async () => {
      const result = await apiFetch<{ currentUser?: { isAdmin: boolean } }>('/api/server-tools/stats');
      if (result.ok && result.data?.currentUser) {
        setIsAdmin(result.data.currentUser.isAdmin);
      }
    })();
  }, []);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  const filteredScripts = scripts.filter(s =>
    !searchQuery ||
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // 按 sortOrder 升序排序后再分组，确保拖拽后乐观更新立即反映到 UI
  const sortedFiltered = [...filteredScripts].sort((a, b) => a.sortOrder - b.sortOrder);
  const grouped: Record<string, ScriptDef[]> = {};
  for (const s of sortedFiltered) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  const selectedScript = scripts.find(s => s.id === selectedId) || null;

  const startNew = () => {
    setEditorMode({ type: 'new' });
    setSelectedId(null);
    setFormName('');
    setFormCategory('custom');
    setFormDescription('');
    setFormContent('#!/bin/bash\nset -e\n\necho "Hello World"');
    setFormParams([]);
    setFormBuiltin(false);
  };

  const startEdit = (script: ScriptDef) => {
    setEditorMode({ type: 'edit', script });
    setSelectedId(script.id);
    setFormName(script.name);
    setFormCategory(script.category);
    setFormDescription(script.description || '');
    setFormContent(script.content);
    setFormParams([...script.params]);
    setFormBuiltin(script.builtin);
  };

  const cancelEdit = () => {
    setEditorMode({ type: 'idle' });
    setFormName('');
    setFormDescription('');
    setFormContent('');
    setFormParams([]);
    setFormBuiltin(false);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error('脚本名称不能为空');
      return;
    }
    if (!formContent.trim()) {
      toast.error('脚本内容不能为空');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        category: formCategory,
        description: formDescription.trim() || undefined,
        content: formContent,
        params: formParams,
      };
      // builtin 仅管理员可设
      if (isAdmin) payload.builtin = formBuiltin;
      if (editorMode.type === 'edit') {
        const result = await apiFetch<ScriptDef>(`/api/server-tools/scripts/${editorMode.script.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        if (result.ok) {
          toast.success('脚本已更新');
          await fetchScripts();
          setEditorMode({ type: 'idle' });
        } else if (result.status !== 401) {
          toast.error(result.message || '更新失败');
        }
      } else {
        const result = await apiFetch<ScriptDef>('/api/server-tools/scripts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (result.ok) {
          toast.success('脚本已创建');
          await fetchScripts();
          setEditorMode({ type: 'idle' });
        } else if (result.status !== 401) {
          toast.error(result.message || '创建失败');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const result = await apiFetch(`/api/server-tools/scripts/${deleteTarget.id}`, { method: 'DELETE' });
    if (result.ok) {
      toast.success('脚本已删除');
      if (selectedId === deleteTarget.id) {
        setSelectedId(null);
        setEditorMode({ type: 'idle' });
      }
      setDeleteTarget(null);
      await fetchScripts();
    } else if (result.status !== 401) {
      toast.error(result.message || '删除失败');
    }
  };

  // 拖拽排序：同分类内拖拽
  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (!isAdmin) return;
    dragId.current = id;
    wasDraggedRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
    // 设置拖拽图像（可选）
    try { e.dataTransfer.setData('text/plain', id); } catch { /* ignore */ }
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!isAdmin || !dragId.current || dragId.current === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string, category: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAdmin) return;
    const sourceId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) {
      // 保留 wasDraggedRef=true，让随后的 click 被忽略
      return;
    }

    // 同分类内重新排序（使用已按 sortOrder 排序的数组，确保索引与显示一致）
    const catScripts = scripts
      .filter(s => s.category === category)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const fromIdx = catScripts.findIndex(s => s.id === sourceId);
    const toIdx = catScripts.findIndex(s => s.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...catScripts];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    // 乐观更新：立即调整 UI
    const sortOrderUpdates = reordered.map((s, i) => ({ id: s.id, sortOrder: i }));
    const sortOrderMap = new Map(sortOrderUpdates.map(u => [u.id, u.sortOrder]));
    setScripts(prev => prev.map(s =>
      sortOrderMap.has(s.id) ? { ...s, sortOrder: sortOrderMap.get(s.id)! } : s,
    ));

    // 持久化
    const result = await apiFetch('/api/server-tools/scripts/reorder', {
      method: 'POST',
      body: JSON.stringify({ items: sortOrderUpdates }),
    });
    if (!result.ok && result.status !== 401) {
      toast.error(result.message || '排序保存失败');
      await fetchScripts();
    }
  };

  const handleDragEnd = () => {
    dragId.current = null;
    setDragOverId(null);
    // 不立即重置 wasDraggedRef，让随后的 click 事件检测到并重置
    // click 事件在 dragEnd 之后触发，所以延后一帧重置
    setTimeout(() => {
      wasDraggedRef.current = false;
    }, 50);
  };

  const addParam = () => {
    setFormParams(prev => [...prev, { name: '', label: '', required: false, defaultValue: '', placeholder: '' }]);
  };

  const updateParam = (index: number, field: keyof ScriptParam, value: string | boolean) => {
    setFormParams(prev => prev.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const removeParam = (index: number) => {
    setFormParams(prev => prev.filter((_, i) => i !== index));
  };

  const isEditing = editorMode.type !== 'idle';

  return (
    <div className="min-h-screen bg-[#1a1d27] text-gray-100">
      {/* 顶部导航 */}
      <div className="sticky top-0 z-10 bg-[#1a1d27] border-b border-gray-800 px-3 py-2 sm:px-4 sm:py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MobileSidebar currentPath="/server-tools/scripts" variant="subpage" />
            <button onClick={() => router.push('/server-tools')} className="text-gray-400 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-purple-900/30 flex items-center justify-center shrink-0">
                <Code2 className="w-4 h-4 text-purple-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">脚本管理</div>
                <div className="text-xs text-gray-500 truncate">{scripts.length} 个脚本</div>
              </div>
            </div>
          </div>
          <Button
            onClick={startNew}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
          >
            <Plus className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">新建脚本</span>
            <span className="sm:hidden">新建</span>
          </Button>
        </div>
      </div>

      {/* 主体 */}
      <div className="flex flex-col md:flex-row gap-0 max-w-7xl mx-auto">
        {/* 左侧：脚本列表 */}
        <div className={`w-full md:w-80 md:border-r md:border-gray-800 md:min-h-[calc(100vh-49px)] ${isEditing ? 'hidden md:block' : ''}`}>
          <div className="p-3">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索脚本..."
                className="pl-9 bg-[#222632] border-gray-700 text-gray-100 placeholder-gray-500"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
              </div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Folder className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">暂无脚本</p>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center gap-1">
                      <span>{CATEGORY_LABELS[cat] || cat}（{list.length}）</span>
                      {isAdmin && (
                        <span className="text-[10px] text-gray-600 font-normal hidden sm:inline">拖拽排序</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {list.map(script => {
                        // 管理员可编辑/删除所有；非管理员仅自己的非内置
                        const canModify = isAdmin || (!script.builtin);
                        const isDragOver = dragOverId === script.id;
                        return (
                          <div
                            key={script.id}
                            draggable={isAdmin}
                            onDragStart={(e) => handleDragStart(e, script.id)}
                            onDragOver={(e) => handleDragOver(e, script.id)}
                            onDrop={(e) => handleDrop(e, script.id, cat)}
                            onDragEnd={handleDragEnd}
                            onClick={(e) => {
                              // 如果刚发生过拖拽，忽略此次 click
                              if (wasDraggedRef.current) {
                                wasDraggedRef.current = false;
                                return;
                              }
                              // 仅当点击不是来自子按钮（已 stopPropagation）时才选中
                              setSelectedId(script.id);
                              if (editorMode.type === 'edit') cancelEdit();
                            }}
                            className={`group cursor-pointer p-2.5 rounded-lg border transition-colors ${
                              selectedId === script.id && !isEditing
                                ? 'bg-[#2a2f3d] border-gray-600'
                                : isDragOver
                                  ? 'bg-[#2a2f3d] border-emerald-600 border-dashed'
                                  : 'bg-[#222632] border-transparent hover:border-gray-700'
                            } ${isAdmin ? 'hover:cursor-grab active:cursor-grabbing' : ''}`}
                          >
                            <div className="flex items-center gap-2 mb-0.5">
                              {isAdmin && (
                                <GripVertical
                                  className="w-3 h-3 text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                                />
                              )}
                              <span className="text-sm font-medium text-gray-100 truncate flex-1">{script.name}</span>
                              {script.builtin && <Lock className="w-3 h-3 text-gray-500 shrink-0" />}
                              {/* 悬浮快捷按钮 */}
                              {canModify && (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); startEdit(script); }}
                                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-blue-400"
                                    title="编辑"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(script); }}
                                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-red-400"
                                    title="删除"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {script.description && (
                              <div className="text-xs text-gray-500 line-clamp-1">{script.description}</div>
                            )}
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[script.category] || ''}`}>
                                {CATEGORY_LABELS[script.category]}
                              </span>
                              <span className="text-[10px] text-gray-600">{script.params.length} 个参数</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：详情/编辑器 */}
        <div className={`flex-1 min-h-[calc(100vh-49px)] ${isEditing || selectedScript ? '' : 'hidden md:block'}`}>
          {isEditing ? (
            // 编辑器
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-200">
                  {editorMode.type === 'new' ? '新建脚本' : `编辑: ${editorMode.script.name}`}
                </h3>
                <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-gray-400 hover:text-white">
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-300">脚本名称 *</Label>
                  <Input
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder="例如：清理日志"
                    className="bg-[#222632] border-gray-700 text-gray-100 placeholder-gray-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-gray-300">分类 *</Label>
                  <Select value={formCategory} onValueChange={(v) => setFormCategory(v as ScriptDef['category'])}>
                    <SelectTrigger className="bg-[#222632] border-gray-700 text-gray-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#222632] border-gray-700">
                      <SelectItem value="maintenance">维护</SelectItem>
                      <SelectItem value="install">安装</SelectItem>
                      <SelectItem value="inspect">检查</SelectItem>
                      <SelectItem value="custom">自定义</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-300">描述</Label>
                <Input
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="简要描述脚本功能"
                  className="bg-[#222632] border-gray-700 text-gray-100 placeholder-gray-500"
                />
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 p-2.5 bg-[#222632] border border-gray-700 rounded-lg">
                  <Checkbox
                    id="form-builtin"
                    checked={formBuiltin}
                    onCheckedChange={(checked) => setFormBuiltin(checked === true)}
                    className="border-gray-600 data-[state=checked]:bg-amber-600 data-[state=checked]:border-amber-600"
                  />
                  <label htmlFor="form-builtin" className="text-xs text-gray-300 cursor-pointer flex items-center gap-1.5 select-none">
                    {formBuiltin ? <Lock className="w-3 h-3 text-amber-400" /> : <Unlock className="w-3 h-3 text-gray-500" />}
                    设为内置脚本
                    <span className="text-gray-500">（所有人可见，普通用户只读）</span>
                  </label>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs text-gray-300">
                  脚本内容 * <span className="text-gray-500 ml-1">（支持 {`{{param}}`} 模板，值会被单引号转义）</span>
                </Label>
                <Textarea
                  value={formContent}
                  onChange={e => setFormContent(e.target.value)}
                  className="font-mono text-xs bg-[#0d1117] border-gray-700 text-gray-100 min-h-[240px] resize-y"
                  spellCheck={false}
                />
              </div>

              {/* 参数表单 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-gray-300">参数列表</Label>
                  <Button variant="outline" size="sm" onClick={addParam} className="border-gray-700 text-gray-300 hover:bg-gray-800 h-7 text-xs">
                    <Plus className="w-3 h-3 mr-1" /> 添加参数
                  </Button>
                </div>
                {formParams.length === 0 ? (
                  <div className="text-xs text-gray-500 py-3 text-center bg-[#222632]/50 rounded border border-gray-800">
                    无参数
                  </div>
                ) : (
                  <div className="space-y-2">
                    {formParams.map((p, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 p-2 bg-[#222632] border border-gray-700 rounded">
                        <Input
                          value={p.name}
                          onChange={e => updateParam(i, 'name', e.target.value)}
                          placeholder="参数名"
                          className="col-span-3 bg-[#1a1d27] border-gray-700 text-gray-100 text-xs h-8"
                        />
                        <Input
                          value={p.label}
                          onChange={e => updateParam(i, 'label', e.target.value)}
                          placeholder="显示名"
                          className="col-span-3 bg-[#1a1d27] border-gray-700 text-gray-100 text-xs h-8"
                        />
                        <Input
                          value={p.defaultValue || ''}
                          onChange={e => updateParam(i, 'defaultValue', e.target.value)}
                          placeholder="默认值"
                          className="col-span-3 bg-[#1a1d27] border-gray-700 text-gray-100 text-xs h-8"
                        />
                        <label className="col-span-2 flex items-center gap-1 text-xs text-gray-400">
                          <input
                            type="checkbox"
                            checked={p.required}
                            onChange={e => updateParam(i, 'required', e.target.checked)}
                            className="accent-emerald-500"
                          />
                          必填
                        </label>
                        <button
                          onClick={() => removeParam(i)}
                          className="col-span-1 flex items-center justify-center text-gray-500 hover:text-red-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800">
                <Button variant="outline" onClick={cancelEdit} className="border-gray-700 text-gray-300 hover:bg-gray-800">
                  取消
                </Button>
                <Button onClick={handleSave} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Save className="w-4 h-4 mr-1.5" />}
                  保存
                </Button>
              </div>
            </div>
          ) : selectedScript ? (
            // 详情查看
            <div className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-gray-100">{selectedScript.name}</h3>
                    {selectedScript.builtin && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-700 text-gray-400 flex items-center gap-1">
                        <Lock className="w-2.5 h-2.5" /> 内置
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[selectedScript.category] || ''}`}>
                      {CATEGORY_LABELS[selectedScript.category]}
                    </span>
                  </div>
                  {selectedScript.description && (
                    <p className="text-xs text-gray-400">{selectedScript.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {(isAdmin || !selectedScript.builtin) && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => startEdit(selectedScript)} className="border-gray-700 text-gray-300 hover:bg-gray-800 h-8">
                        编辑
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setDeleteTarget(selectedScript)} className="border-red-800 text-red-400 hover:bg-red-900/20 h-8">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {selectedScript.params.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">参数</div>
                  <div className="space-y-1.5">
                    {selectedScript.params.map(p => (
                      <div key={p.name} className="flex items-center gap-3 text-xs p-2 bg-[#222632] border border-gray-700 rounded">
                        <code className="text-emerald-400 font-mono">{`{{${p.name}}}`}</code>
                        <span className="text-gray-300">{p.label}</span>
                        {p.required && <span className="text-red-400 text-[10px]">必填</span>}
                        {p.defaultValue && <span className="text-gray-500">默认: {p.defaultValue}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">脚本内容</div>
                <pre className="p-3 bg-[#0d1117] border border-gray-800 rounded text-xs text-gray-300 overflow-x-auto">
{selectedScript.content}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 py-20">
              <Code2 className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">选择左侧脚本查看详情，或点击&quot;新建脚本&quot;创建</p>
            </div>
          )}
        </div>
      </div>

      {/* 删除确认 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-[#1a1d27] border-gray-800 text-gray-100">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gray-100">确认删除脚本</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              确定要删除脚本 &quot;{deleteTarget?.name}&quot; 吗？此操作不可撤销。
              {deleteTarget?.builtin && (
                <span className="block mt-1.5 text-amber-400">
                  注意：这是内置脚本，删除后所有用户将无法使用。
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700 text-white">
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
