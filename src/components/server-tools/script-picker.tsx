'use client';

/**
 * 脚本选择器弹窗
 *
 * 在详情页快捷命令中调用：
 * 1. 列出所有可用脚本（按分类分组）
 * 2. 选中后填写参数
 * 3. 提交创建 run_script 任务
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Play, Search, Lock, Terminal } from 'lucide-react';
import { toast } from 'sonner';
import { renderScript } from '@/lib/services/server-tools/script-engine';

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
  category: string;
  description?: string;
  content: string;
  params: ScriptParam[];
  builtin: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: '维护',
  install: '安装',
  inspect: '检查',
  custom: '自定义',
};

const CATEGORY_COLORS: Record<string, string> = {
  maintenance: 'text-info border-info/30 bg-info/10',
  install: 'text-success border-success/30 bg-success/10',
  inspect: 'text-warning border-warning/30 bg-warning/10',
  custom: 'text-primary border-primary/50 bg-primary/10',
};

interface ScriptPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string;
  onTaskCreated?: (taskId: string) => void;
  /** 终端执行回调：将渲染后的脚本命令发送到 SSH 终端执行 */
  onRunInTerminal?: (command: string) => void;
}

export default function ScriptPicker({ open, onOpenChange, connectionId, onTaskCreated, onRunInTerminal }: ScriptPickerProps) {
  const [scripts, setScripts] = useState<ScriptDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<ScriptDef | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchScripts = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/server-tools/scripts');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.success) {
        setScripts(data.data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchScripts();
      setSelected(null);
      setParamValues({});
      setSearchQuery('');
    }
  }, [open, fetchScripts]);

  const handleSelect = (script: ScriptDef) => {
    setSelected(script);
    // 预填默认值
    const defaults: Record<string, string> = {};
    for (const p of script.params) {
      if (p.defaultValue !== undefined) defaults[p.name] = p.defaultValue;
    }
    setParamValues(defaults);
  };

  const handleRun = async () => {
    if (!selected) return;
    // 校验必填
    for (const p of selected.params) {
      if (p.required && !paramValues[p.name]?.trim()) {
        toast.error(`参数 "${p.label}" 为必填项`);
        return;
      }
    }
    setSubmitting(true);
    try {
      const resp = await fetch('/api/server-tools/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          type: 'run_script',
          title: `执行脚本: ${selected.name}`,
          params: {
            scriptId: selected.id,
            paramValues,
          },
        }),
      });
      const data = await resp.json();
      if (data.success) {
        toast.success('脚本任务已创建');
        onTaskCreated?.(data.data.id);
        onOpenChange(false);
      } else {
        toast.error(data.message || '创建任务失败');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunInTerminal = () => {
    if (!selected) return;
    if (!onRunInTerminal) {
      toast.error('终端未连接');
      return;
    }
    // 校验必填
    for (const p of selected.params) {
      if (p.required && !paramValues[p.name]?.trim()) {
        toast.error(`参数 "${p.label}" 为必填项`);
        return;
      }
    }
    const result = renderScript(selected.content, selected.params, paramValues);
    if (!result.ok || !result.rendered) {
      toast.error(result.error || '脚本渲染失败');
      return;
    }
    // 发送到终端执行（末尾加换行符触发执行）
    onRunInTerminal(result.rendered + '\n');
    toast.success(`已在终端执行: ${selected.name}`);
    onOpenChange(false);
  };

  const filteredScripts = scripts.filter(s =>
    !searchQuery ||
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // 按分类分组
  const grouped: Record<string, ScriptDef[]> = {};
  for (const s of filteredScripts) {
    if (!grouped[s.category]) grouped[s.category] = [];
    grouped[s.category].push(s);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-card border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="text-foreground">
            {selected ? `运行脚本: ${selected.name}` : '选择脚本'}
          </DialogTitle>
        </DialogHeader>

        {!selected ? (
          <>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="搜索脚本名称或描述..."
                className="pl-9 bg-input border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="flex-1 overflow-y-auto pr-1 space-y-4">
              {loading ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
                </div>
              ) : Object.keys(grouped).length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  暂无可用脚本
                </div>
              ) : (
                Object.entries(grouped).map(([cat, list]) => (
                  <div key={cat}>
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {CATEGORY_LABELS[cat] || cat}
                    </div>
                    <div className="space-y-1.5">
                      {list.map(script => (
                        <button
                          key={script.id}
                          onClick={() => handleSelect(script)}
                          className="w-full flex items-start gap-3 p-3 text-left bg-muted hover:bg-accent border border-border hover:border-border rounded-lg transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-medium text-foreground">{script.name}</span>
                              {script.builtin && (
                                <Lock className="w-3 h-3 text-muted-foreground" />
                              )}
                              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CATEGORY_COLORS[script.category] || ''}`}>
                                {CATEGORY_LABELS[script.category] || script.category}
                              </span>
                            </div>
                            {script.description && (
                              <div className="text-xs text-muted-foreground line-clamp-2">{script.description}</div>
                            )}
                          </div>
                          <Play className="w-4 h-4 text-muted-foreground mt-0.5" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            <div className="bg-card border border-border rounded-lg p-3">
              {selected.description && (
                <div className="text-xs text-muted-foreground mb-2">{selected.description}</div>
              )}
              <div className="text-[11px] text-muted-foreground">
                共 {selected.content.split('\n').length} 行 · {selected.params.length} 个参数
              </div>
            </div>

            {selected.params.length > 0 ? (
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">脚本参数</div>
                {selected.params.map(p => (
                  <div key={p.name} className="space-y-1.5">
                    <Label className="text-xs text-foreground/80 flex items-center gap-1">
                      {p.label}
                      {p.required && <span className="text-destructive">*</span>}
                    </Label>
                    <Input
                      value={paramValues[p.name] ?? ''}
                      onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                      placeholder={p.placeholder}
                      className="bg-input border-border text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">此脚本无需参数</div>
            )}

            {/* 脚本预览 */}
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground/80">查看脚本内容</summary>
              <pre className="mt-2 p-3 bg-muted border border-border rounded text-[11px] text-foreground/80 overflow-x-auto max-h-48 overflow-y-auto">
{selected.content}
              </pre>
            </details>
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={() => { setSelected(null); setParamValues({}); }}
                className="border-border text-foreground/80 hover:bg-muted"
                disabled={submitting}
              >
                返回
              </Button>
              <Button
                onClick={handleRunInTerminal}
                disabled={submitting || !onRunInTerminal}
                className="bg-info hover:bg-info/90 text-info-foreground"
                title="将脚本命令发送到 SSH 终端执行"
              >
                <Terminal className="w-4 h-4 mr-1.5" />
                终端执行
              </Button>
              <Button
                onClick={handleRun}
                disabled={submitting}
                className="bg-success hover:bg-success/90 text-success-foreground"
                title="创建后台任务执行（输出在任务面板查看）"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Play className="w-4 h-4 mr-1.5" />}
                运行脚本
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-border text-foreground/80 hover:bg-muted"
            >
              取消
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
