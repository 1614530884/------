'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, AlertCircle, History } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { loadAuth, handleAuthExpired } from '@/lib/auth-client';
import {
  getTypeLabel,
} from '@/lib/certification-status';
import { CertificationStatusBadge } from './certification-status-badge';

export interface CertLogItem {
  id?: number;
  uid?: number;
  auth_user_id?: number;
  certifi_name?: string;
  auth_rela_name?: string;
  auth_card_type?: number;
  auth_card_number?: string;
  company_name?: string;
  company_organ_code?: string;
  pic?: unknown;
  status?: number;
  error?: string;
  create_time?: string | number;
  type?: number;
  is_newest?: boolean;
  card_type?: number;
  idcard?: string;
  card_number?: string;
  certype?: string;
  certifi_type?: string;
  username?: string;
  bank?: string;
  phone?: string;
  notes?: string;
}

/** 获取真实姓名 */
export function getRealName(item: CertLogItem): string {
  return item.certifi_name || item.auth_rela_name || item.username || '-';
}

/** 获取身份证号 */
export function getIdCard(item: CertLogItem): string {
  return item.idcard || item.auth_card_number || item.card_number || '-';
}

/** 获取认证方式（优先certype字符串，fallback到card_type数字转换） */
export function getCertMethod(item: CertLogItem): string {
  if (item.certype) return item.certype;
  const cardType = item.auth_card_type ?? item.card_type;
  if (cardType !== undefined && cardType !== null) {
    return cardType === 1 ? '大陆' : cardType === 0 ? '非大陆' : String(cardType);
  }
  return '-';
}

/** 获取显示名称（个人用姓名，企业用公司名） */
export function getDisplayName(item: CertLogItem): string {
  if (item.type === 2 || item.type === 3) {
    return item.company_name || item.certifi_name || item.auth_rela_name || item.username || '-';
  }
  return item.certifi_name || item.auth_rela_name || item.username || '-';
}

/** 获取用户ID（兼容uid和auth_user_id） */
export function getUserId(item: CertLogItem): number | undefined {
  return item.uid ?? item.auth_user_id;
}

interface Props {
  recordId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatTime(val: unknown): string {
  if (!val || val === '0' || val === '-') return '-';
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    const ms = num < 1e12 ? num * 1000 : num;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? String(val) : d.toLocaleString('zh-CN');
  }
  return String(val);
}

export function CertificationHistoryDialog({ recordId, open, onOpenChange }: Props) {
  const [list, setList] = useState<CertLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchHistory = useCallback(async () => {
    if (!recordId) return;
    setLoading(true);
    setError('');
    try {
      const auth = loadAuth();
      const resp = await fetch('/api/idc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'certifiHistoryLog',
          token: auth?.token || '',
          cookie: auth?.cookie || '',
          id: recordId,
        }),
      });
      const data = await resp.json();
      if (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录') {
        await handleAuthExpired();
        return;
      }
      if (data.success === false) {
        setError(String(data.msg || data.message || '获取历史记录失败'));
        setList([]);
      } else {
        // 兼容多种数据结构：data.data / data.list / data（直接数组）
        const rawData = data.data;
        const items: CertLogItem[] = Array.isArray(rawData)
          ? rawData as CertLogItem[]
          : Array.isArray((rawData as Record<string, unknown>)?.list)
            ? (rawData as Record<string, unknown>).list as CertLogItem[]
            : Array.isArray((rawData as Record<string, unknown>)?.data)
              ? (rawData as Record<string, unknown>).data as CertLogItem[]
              : [];
        setList(items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络请求失败');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    if (open && recordId) {
      void fetchHistory();
    }
  }, [open, recordId, fetchHistory]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            <span>实名认证历史记录</span>
          </DialogTitle>
          <DialogDescription>
            记录ID: {recordId} · 共 {list.length} 条变更记录
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">暂无历史记录</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">姓名</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">认证类型</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">认证方式</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">身份证号</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">状态</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">原因</th>
                  <th className="px-3 py-2 font-medium whitespace-nowrap">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((item, idx) => (
                  <tr key={item.id || idx} className={`hover:bg-accent/50 ${item.is_newest ? 'bg-primary/5' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap text-foreground">{getRealName(item)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{getTypeLabel(item.type)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{getCertMethod(item)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground font-mono text-xs">{getIdCard(item)}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><CertificationStatusBadge status={item.status} /></td>
                    <td className="px-3 py-2 text-muted-foreground text-xs max-w-[220px] truncate" title={item.error || ''}>{item.error || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-xs">{formatTime(item.create_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
