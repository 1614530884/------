'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ArrowRightCircle } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { TicketDepartment } from '@/lib/ticket-status';

interface TicketTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ticketId: number;
  departments: TicketDepartment[];
  callApi: (action: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onTransferred: () => void;
}

interface TransferTarget {
  id: number;
  name: string;
  realname?: string;
  user_login?: string;
}

export function TicketTransferDialog({
  open, onOpenChange, ticketId, departments, callApi, onTransferred,
}: TicketTransferDialogProps) {
  const [mode, setMode] = useState<0 | 1>(0);
  const [targets, setTargets] = useState<TransferTarget[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<number | ''>('');
  const [selectedDept, setSelectedDept] = useState<number | ''>('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchTargets = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const res = await callApi('ticketTransferList', { id: ticketId });
      const data = res.data;
      let list: TransferTarget[] = [];
      if (Array.isArray(data)) {
        list = data as TransferTarget[];
      } else if (data && typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        for (const key of ['list', 'admin', 'admins', 'handlers', 'data']) {
          if (Array.isArray(obj[key])) {
            list = obj[key] as TransferTarget[];
            break;
          }
        }
      }
      setTargets(list.map((t) => ({
        id: Number(t.id),
        name: t.realname || t.user_login || t.name || `管理员${t.id}`,
      })));
    } catch {
      setTargets([]);
    } finally {
      setTargetsLoading(false);
    }
  }, [callApi, ticketId]);

  useEffect(() => {
    if (open) {
      setMode(0);
      setSelectedTarget('');
      setSelectedDept('');
      setRemarks('');
      setError('');
      void fetchTargets();
    }
  }, [open, fetchTargets]);

  const handleSubmit = async () => {
    if (submitting) return;
    if (mode === 0 && !selectedTarget) {
      setError('请选择处理人');
      return;
    }
    if (mode === 1 && !selectedDept) {
      setError('请选择部门');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const params: Record<string, unknown> = {
        id: ticketId,
        mode,
        remarks: remarks.trim(),
      };
      if (mode === 0) params.handle = selectedTarget;
      if (mode === 1) params.dptid = selectedDept;
      const res = await callApi('ticketTransfer', params);
      if (res.success === false || (res.status && res.status !== 200 && res.status !== 1)) {
        setError(String(res.msg || res.message || '移交失败'));
        return;
      }
      onTransferred();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightCircle className="w-5 h-5 text-primary" />
            移交工单
          </DialogTitle>
          <DialogDescription>将工单移交给其他处理人或部门</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode(0)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === 0
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              指定处理人
            </button>
            <button
              type="button"
              onClick={() => setMode(1)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                mode === 1
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              移动部门
            </button>
          </div>

          {mode === 0 ? (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">选择处理人</label>
              {targetsLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  加载处理人列表...
                </div>
              ) : targets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">暂无可选处理人</p>
              ) : (
                <select
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
                >
                  <option value="">请选择...</option>
                  {targets.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">选择部门</label>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
              >
                <option value="">请选择...</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">移交备注（可选）</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="添加移交说明..."
              className="w-full min-h-[60px] resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:border-primary"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            确认移交
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
