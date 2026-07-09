'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Pencil, Trash2, Copy, ArrowLeft, FileText, CheckCircle,
  X, Tag, Hash, Star, Loader2,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import MobileSidebar from '@/components/mobile-sidebar';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter,
} from '@/components/ui/card';

// ============ 数据类型 ============

interface Template {
  id: string;
  name: string;
  content: string;
  osFilters: string[];
  productIds: number[];
  isDefault: boolean;
  perServer: boolean;  // 是否按台数生成话术
  createdAt: number;
  updatedAt: number;
}

// ============ 变量定义 ============

const VARIABLES = [
  { key: 'ip', label: '服务器IP' },
  { key: 'username', label: '登录账号' },
  { key: 'password', label: '登录密码' },
  { key: 'nextduedate', label: '到期时间' },
  { key: 'amount', label: '续费金额' },
  { key: 'billingcycle', label: '计费周期' },
  { key: 'product_name', label: '产品名称' },
  { key: 'os_name', label: '操作系统' },
] as const;

const STORAGE_KEY = 'idc_auth';

// ============ 空模板 ============

function createEmptyTemplate(): Template {
  return {
    id: '',
    name: '',
    content: '',
    osFilters: [],
    productIds: [],
    isDefault: false,
    perServer: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

// ============ 页面组件 ============

export default function TemplatesPage() {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // 编辑弹窗状态
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template>(createEmptyTemplate());
  const [isSaving, setIsSaving] = useState(false);

  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

  // OS tag 输入
  const [osInput, setOsInput] = useState('');

  // 产品ID输入
  const [productIdInput, setProductIdInput] = useState('');

  // textarea ref（用于变量插入）
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 复制反馈
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ============ 认证检查 ============

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const auth = JSON.parse(raw);
        if (auth?.token && auth?.cookie) {
          setIsAuthenticated(true);
        }
      }
    } catch {
      // ignore
    }
    setAuthChecked(true);
  }, []);

  // ============ 加载模板 ============

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success) {
        setTemplates(data.data ?? []);
      }
    } catch {
      // 静默处理
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadTemplates();
    }
  }, [isAuthenticated, loadTemplates]);

  // ============ 保存模板 ============

  const handleSave = async () => {
    const t = editingTemplate;
    if (!t.name.trim() || !t.content.trim()) return;

    setIsSaving(true);
    try {
      const isNew = !t.id;
      const now = Date.now();
      const template: Template = {
        ...t,
        id: isNew ? crypto.randomUUID() : t.id,
        createdAt: isNew ? now : t.createdAt,
        updatedAt: now,
      };

      // 如果设为默认，先取消旧的默认
      if (template.isDefault) {
        setTemplates(prev => prev.map(item =>
          item.isDefault ? { ...item, isDefault: false } : item
        ));
      }

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', template }),
      });
      const data = await res.json();
      if (data.success) {
        await loadTemplates();
        setShowEditDialog(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  // ============ 删除模板 ============

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: deleteTarget.id }),
      });
      const data = await res.json();
      if (data.success) {
        await loadTemplates();
      }
    } finally {
      setDeleteTarget(null);
    }
  };

  // ============ 打开新建弹窗 ============

  const openCreateDialog = () => {
    setEditingTemplate(createEmptyTemplate());
    setOsInput('');
    setProductIdInput('');
    setShowEditDialog(true);
  };

  // ============ 打开编辑弹窗 ============

  const openEditDialog = (t: Template) => {
    setEditingTemplate({ ...t });
    setOsInput(t.osFilters.join(', '));
    setProductIdInput(t.productIds.length > 0 ? t.productIds.join(', ') : '');
    setShowEditDialog(true);
  };

  // ============ 变量插入 ============

  const insertVariable = (varKey: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = editingTemplate.content;
    const insertText = `{{${varKey}}}`;

    const newContent = text.slice(0, start) + insertText + text.slice(end);
    setEditingTemplate(prev => ({ ...prev, content: newContent }));

    // 延迟设置光标位置
    requestAnimationFrame(() => {
      textarea.selectionStart = start + insertText.length;
      textarea.selectionEnd = start + insertText.length;
      textarea.focus();
    });
  };

  // ============ OS tag 处理 ============

  const handleOsInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addOsFilter();
    }
  };

  const addOsFilter = () => {
    const val = osInput.trim().replace(/,$/g, '');
    if (val && !editingTemplate.osFilters.includes(val)) {
      setEditingTemplate(prev => ({
        ...prev,
        osFilters: [...prev.osFilters, val],
      }));
    }
    setOsInput('');
  };

  const removeOsFilter = (filter: string) => {
    setEditingTemplate(prev => ({
      ...prev,
      osFilters: prev.osFilters.filter(f => f !== filter),
    }));
  };

  // ============ 产品ID 处理 ============

  const handleProductIdInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addProductId();
    }
  };

  const addProductId = () => {
    const val = productIdInput.trim().replace(/,$/g, '');
    const num = parseInt(val, 10);
    if (val && !isNaN(num) && !editingTemplate.productIds.includes(num)) {
      setEditingTemplate(prev => ({
        ...prev,
        productIds: [...prev.productIds, num],
      }));
    }
    setProductIdInput('');
  };

  const removeProductId = (pid: number) => {
    setEditingTemplate(prev => ({
      ...prev,
      productIds: prev.productIds.filter(id => id !== pid),
    }));
  };

  // ============ 复制话术 ============

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }
  };

  // ============ 未认证 ============

  if (authChecked && !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <Card className="bg-slate-900 border-slate-800 max-w-md w-full">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-orange-500/10 flex items-center justify-center mb-2">
              <FileText className="w-6 h-6 text-orange-400" />
            </div>
            <CardTitle className="text-white text-lg">需要登录</CardTitle>
            <CardDescription className="text-slate-400">
              请先登录后台才能使用话术管理功能
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center">
            <Button onClick={() => router.push('/')} className="bg-orange-500 hover:bg-orange-600 text-white">
              <ArrowLeft className="w-4 h-4 mr-1" />返回首页登录
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ============ 主渲染 ============

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <MobileSidebar currentPath="/templates" variant="subpage" />
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-white text-base sm:text-lg truncate">话术管理</span>
            <Badge variant="outline" className="border-slate-700 text-slate-400 bg-slate-800/50 hidden sm:inline-flex">
              {templates.length} 个模板
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={openCreateDialog}
              className="border-emerald-700 bg-emerald-950/50 text-emerald-400 hover:bg-emerald-900/50 hover:text-emerald-300 h-8 px-2 sm:px-3"
            >
              <Plus className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">新建模板</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push('/')}
              className="border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white h-8 px-2 sm:px-3"
            >
              <ArrowLeft className="w-4 h-4 sm:mr-1" />
              <span className="hidden sm:inline">返回开通</span>
            </Button>
          </div>
        </div>
      </header>

      {/* 主体 */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* 加载状态 */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
            <span className="ml-3 text-slate-400">加载中...</span>
          </div>
        )}

        {/* 空状态 */}
        {!isLoading && templates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-white text-lg font-medium mb-1">暂无话术模板</h3>
            <p className="text-slate-500 text-sm mb-4">创建模板后可快速生成客户沟通话术</p>
            <Button onClick={openCreateDialog} className="bg-blue-500 hover:bg-blue-600 text-white">
              <Plus className="w-4 h-4 mr-1" />新建模板
            </Button>
          </div>
        )}

        {/* 模板卡片列表 */}
        {!isLoading && templates.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map(t => (
              <Card
                key={t.id}
                className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors py-4"
              >
                <CardHeader className="pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {t.isDefault && (
                        <Star className="w-4 h-4 text-emerald-400 shrink-0 fill-emerald-400" />
                      )}
                      <CardTitle className="text-white text-sm truncate">{t.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleCopy(t.content, t.id)}
                        className="text-slate-500 hover:text-blue-400"
                      >
                        {copiedId === t.id ? (
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditDialog(t)}
                        className="text-slate-500 hover:text-blue-400"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setDeleteTarget(t)}
                        className="text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-1.5 mt-1">
                    {t.isDefault && (
                      <Badge className="bg-emerald-950/50 text-emerald-400 border-emerald-800 text-[10px] px-1.5 py-0">
                        默认
                      </Badge>
                    )}
                    {t.perServer && (
                      <Badge className="bg-purple-950/50 text-purple-400 border-purple-800 text-[10px] px-1.5 py-0">
                        按台数
                      </Badge>
                    )}
                    {t.osFilters.length > 0 && (
                      <Badge variant="outline" className="border-slate-700 text-slate-400 text-[10px] px-1.5 py-0">
                        <Tag className="w-2.5 h-2.5 mr-0.5" />OS×{t.osFilters.length}
                      </Badge>
                    )}
                    {t.productIds.length > 0 && (
                      <Badge variant="outline" className="border-slate-700 text-slate-400 text-[10px] px-1.5 py-0">
                        <Hash className="w-2.5 h-2.5 mr-0.5" />产品×{t.productIds.length}
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-3">
                  <p className="text-slate-400 text-xs leading-relaxed line-clamp-4 whitespace-pre-wrap break-all">
                    {t.content}
                  </p>
                </CardContent>
                <CardFooter className="pt-0 text-[10px] text-slate-600">
                  更新于 {new Date(t.updatedAt).toLocaleString('zh-CN')}
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* ============ 新建/编辑弹窗 ============ */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">
              {editingTemplate.id ? '编辑模板' : '新建模板'}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              创建话术模板，支持变量插入和匹配规则
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 模板名称 */}
            <div className="space-y-1.5">
              <Label className="text-slate-300">模板名称</Label>
              <Input
                value={editingTemplate.name}
                onChange={e => setEditingTemplate(prev => ({ ...prev, name: e.target.value }))}
                placeholder="如：开通成功通知"
                className="bg-slate-950/70 border-slate-700 text-white placeholder:text-slate-600"
              />
            </div>

            {/* 话术内容 */}
            <div className="space-y-1.5">
              <Label className="text-slate-300">话术内容</Label>
              <Textarea
                ref={textareaRef}
                value={editingTemplate.content}
                onChange={e => setEditingTemplate(prev => ({ ...prev, content: e.target.value }))}
                placeholder="输入话术内容，可使用 {{变量名}} 插入变量..."
                rows={8}
                className="bg-slate-950/70 border-slate-700 text-white placeholder:text-slate-600 resize-y min-h-[120px]"
              />
            </div>

            {/* 变量快捷插入 */}
            <div className="space-y-1.5">
              <Label className="text-slate-300">快捷插入变量</Label>
              <div className="flex flex-wrap gap-1.5">
                {VARIABLES.map(v => (
                  <Button
                    key={v.key}
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(v.key)}
                    className="border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-blue-900/30 hover:text-blue-300 hover:border-blue-700 h-7 text-xs px-2"
                  >
                    {`{{${v.key}}}`}
                    <span className="text-slate-500 ml-1">{v.label}</span>
                  </Button>
                ))}
              </div>
            </div>

            {/* OS匹配关键词 */}
            <div className="space-y-1.5">
              <Label className="text-slate-300">OS匹配关键词</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={osInput}
                  onChange={e => setOsInput(e.target.value)}
                  onKeyDown={handleOsInputKeyDown}
                  onBlur={addOsFilter}
                  placeholder="输入关键词后按回车添加，如 CentOS"
                  className="bg-slate-950/70 border-slate-700 text-white placeholder:text-slate-600 flex-1"
                />
              </div>
              {editingTemplate.osFilters.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {editingTemplate.osFilters.map(filter => (
                    <Badge
                      key={filter}
                      className="bg-blue-950/50 text-blue-300 border-blue-800 pr-1 cursor-pointer hover:bg-blue-900/50"
                      onClick={() => removeOsFilter(filter)}
                    >
                      {filter}
                      <X className="w-3 h-3 ml-0.5" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* 产品ID */}
            <div className="space-y-1.5">
              <Label className="text-slate-300">关联产品ID</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={productIdInput}
                  onChange={e => setProductIdInput(e.target.value)}
                  onKeyDown={handleProductIdInputKeyDown}
                  onBlur={addProductId}
                  placeholder="输入产品ID后按回车添加"
                  className="bg-slate-950/70 border-slate-700 text-white placeholder:text-slate-600 flex-1"
                />
              </div>
              {editingTemplate.productIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {editingTemplate.productIds.map(pid => (
                    <Badge
                      key={pid}
                      className="bg-orange-950/50 text-orange-300 border-orange-800 pr-1 cursor-pointer hover:bg-orange-900/50"
                      onClick={() => removeProductId(pid)}
                    >
                      ID: {pid}
                      <X className="w-3 h-3 ml-0.5" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* 设为默认 */}
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div>
                <Label className="text-slate-300">设为默认模板</Label>
                <p className="text-xs text-slate-500 mt-0.5">默认模板在自动匹配时优先使用</p>
              </div>
              <Switch
                checked={editingTemplate.isDefault}
                onCheckedChange={checked =>
                  setEditingTemplate(prev => ({ ...prev, isDefault: checked }))
                }
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-3">
              <div>
                <Label className="text-slate-300">按台数生成话术</Label>
                <p className="text-xs text-slate-500 mt-0.5">开启后多台服务器时每台生成一份话术，关闭则只生成一份（取第一台信息）</p>
              </div>
              <Switch
                checked={editingTemplate.perServer}
                onCheckedChange={checked =>
                  setEditingTemplate(prev => ({ ...prev, perServer: checked }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowEditDialog(false)}
              className="border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              取消
            </Button>
            <Button
              onClick={handleSave}
              disabled={!editingTemplate.name.trim() || !editingTemplate.content.trim() || isSaving}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============ 删除确认弹窗 ============ */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent className="bg-slate-900 border-slate-800 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">确认删除</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              确定要删除模板「{deleteTarget?.name}」吗？此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white">
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
