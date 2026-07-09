/**
 * 产品相关工具函数
 */

/** 产品状态类型 */
export type ProductStatusLabel = '运行中' | '已暂停' | '待开通' | '已删除' | '未知';

/** 将后台 domainstatus 转为统一的中文标签 */
export function getStatusLabel(domainstatus: unknown): ProductStatusLabel {
  const statusVal = typeof domainstatus === 'object' && domainstatus !== null
    ? (domainstatus as Record<string, string>).name || ''
    : String(domainstatus || '');

  if (statusVal === 'Active' || statusVal === '已激活') return '运行中';
  if (statusVal === 'Suspended' || statusVal === '已暂停') return '已暂停';
  if (statusVal === 'Pending' || statusVal === '待开通') return '待开通';
  if (statusVal === 'Deleted' || statusVal === '被删除') return '已删除';
  return '未知';
}

/** 根据状态标签返回样式类名 */
export function getStatusClass(label: ProductStatusLabel): string {
  switch (label) {
    case '运行中': return 'bg-green-500/20 text-green-400';
    case '已暂停': return 'bg-red-500/20 text-red-400';
    case '待开通': return 'bg-yellow-500/20 text-yellow-400';
    default: return 'bg-slate-500/20 text-slate-400';
  }
}

/** 格式化日期时间戳为可读字符串 */
export function formatDueDate(nextduedate: number | string | undefined): string {
  if (!nextduedate) return '-';
  const ts = typeof nextduedate === 'string' ? parseInt(nextduedate) : nextduedate;
  if (isNaN(ts)) return '-';
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}

/** 格式化金额 */
export function formatAmount(amount: string | number | undefined): string {
  if (!amount) return '¥0.00';
  return `¥${Number(amount).toFixed(2)}`;
}

/** 计费周期映射表 */
export const CYCLE_MAP: Record<string, string> = {
  monthly: '月付',
  quarterly: '季付',
  semiannually: '半年付',
  annually: '年付',
  biennially: '两年付',
  triennially: '三年付',
};
