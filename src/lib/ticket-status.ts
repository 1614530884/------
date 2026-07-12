export type StatusCategory = 'pending' | 'replied' | 'waiting' | 'closed' | 'all';

export interface TicketStatus {
  id: number;
  title: string;
  color: string;
  show_active: number;
  show_await: number;
  auto_close: number;
  order: number;
}

export interface TicketDepartment {
  id: number;
  name: string;
  description: string;
  email: string;
  hidden: number;
  order: number;
}

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  pending: '待处理',
  replied: '已回复',
  waiting: '等待中',
  closed: '已关闭',
  all: '全部',
};

export const CATEGORY_VALUES: StatusCategory[] = ['pending', 'replied', 'waiting', 'closed', 'all'];

export function mapStatusToCategory(status: TicketStatus): StatusCategory {
  const title = status.title || '';
  const lowerTitle = title.toLowerCase();
  if (lowerTitle.includes('关') || lowerTitle.includes('close') || lowerTitle.includes('结束')) return 'closed';
  if (title.includes('待处理') || title.includes('客户回复') || lowerTitle.includes('pending')) return 'pending';
  if (title.includes('处理中') || title.includes('等待') || lowerTitle.includes('waiting')) return 'waiting';
  if (title.includes('已回复') || lowerTitle.includes('replied')) return 'replied';
  if (status.show_active === 1) return 'pending';
  if (status.show_await === 1) return 'waiting';
  if (status.auto_close === 1) return 'waiting';
  return 'replied';
}

export function mapCategoryToStatusIds(category: StatusCategory, statusList: TicketStatus[]): number[] {
  if (category === 'all') return [];
  return statusList
    .filter((s) => mapStatusToCategory(s) === category)
    .map((s) => s.id);
}

export function findClosedStatusId(statusList: TicketStatus[]): number | string | null {
  const byTitle = statusList.find((s) => {
    const t = (s.title || '').toLowerCase();
    return t.includes('关') || t.includes('close') || t.includes('结束');
  });
  if (byTitle) return byTitle.id;
  const byAutoClose = statusList.find((s) => s.auto_close === 1);
  if (byAutoClose) return byAutoClose.id;
  return statusList.length > 0 ? statusList[statusList.length - 1].id : null;
}

export function findStatusByTitle(statusList: TicketStatus[], title: string): TicketStatus | null {
  const lower = title.toLowerCase();
  return statusList.find((s) => (s.title || '').toLowerCase() === lower) || null;
}

const STATUS_CACHE_KEY = 'ticket_status_list';
const DEPT_CACHE_KEY = 'ticket_dept_list';

export function getCachedStatusList(): TicketStatus[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STATUS_CACHE_KEY);
    return raw ? JSON.parse(raw) as TicketStatus[] : null;
  } catch {
    return null;
  }
}

export function setCachedStatusList(list: TicketStatus[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

export function getCachedDeptList(): TicketDepartment[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(DEPT_CACHE_KEY);
    return raw ? JSON.parse(raw) as TicketDepartment[] : null;
  } catch {
    return null;
  }
}

export function setCachedDeptList(list: TicketDepartment[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(DEPT_CACHE_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}
