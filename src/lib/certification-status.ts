export type CertStatus = 1 | 2 | 3 | 4;
export type CertType = 1 | 2 | 3;
export type CardType = 0 | 1;

export const STATUS_LABELS: Record<number, string> = {
  1: '已认证',
  2: '未通过',
  3: '待审核',
  4: '已提交资料',
};

export const STATUS_COLORS: Record<number, string> = {
  1: 'emerald',
  2: 'red',
  3: 'amber',
  4: 'blue',
};

export const TYPE_LABELS: Record<number, string> = {
  1: '个人',
  2: '企业',
  3: '个人转企业',
};

export const CARD_TYPE_LABELS: Record<number, string> = {
  0: '非大陆',
  1: '大陆',
};

export function getStatusLabel(status: number | string | undefined): string {
  const n = Number(status);
  return STATUS_LABELS[n] || String(status || '-');
}

export function getStatusColor(status: number | string | undefined): string {
  const n = Number(status);
  return STATUS_COLORS[n] || 'zinc';
}

export function getTypeLabel(type: number | string | undefined): string {
  const n = Number(type);
  return TYPE_LABELS[n] || String(type || '-');
}

export function getCardTypeLabel(cardType: number | string | undefined): string {
  const n = Number(cardType);
  return CARD_TYPE_LABELS[n] || String(cardType || '-');
}

/**
 * 认证状态分类（用于Tab筛选）
 */
export type StatusCategory = 'all' | 'pending' | 'approved' | 'rejected';

export const CATEGORY_LABELS: Record<StatusCategory, string> = {
  all: '全部',
  pending: '待审核',
  approved: '已认证',
  rejected: '未通过',
};

export const CATEGORY_VALUES: StatusCategory[] = ['all', 'pending', 'approved', 'rejected'];

export function mapCategoryToStatusId(category: StatusCategory): number | undefined {
  switch (category) {
    case 'pending': return 3;
    case 'approved': return 1;
    case 'rejected': return 2;
    case 'all': return undefined;
  }
}
