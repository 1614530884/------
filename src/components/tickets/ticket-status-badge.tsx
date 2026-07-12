'use client';

import { TicketStatus, mapStatusToCategory, CATEGORY_LABELS } from '@/lib/ticket-status';

interface TicketStatusBadgeProps {
  status: string | number;
  statusList?: TicketStatus[];
  title?: string;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(107, 114, 128, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return false;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

export function TicketStatusBadge({ status, statusList = [], title }: TicketStatusBadgeProps) {
  let color = '';
  let label = title || String(status);

  const matched = statusList.find((s) => String(s.id) === String(status) || s.title === String(status));
  if (matched) {
    color = matched.color || '';
    label = matched.title || label;
  }

  if (color) {
    const bg = hexToRgba(color, 0.15);
    const border = hexToRgba(color, 0.3);
    const textColor = isLightColor(color) ? '#1f2937' : color;
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
        style={{ backgroundColor: bg, borderColor: border, color: textColor, borderWidth: 1, borderStyle: 'solid' }}
      >
        {label}
      </span>
    );
  }

  let category = 'replied';
  if (matched) {
    category = mapStatusToCategory(matched);
  } else {
    const lower = label.toLowerCase();
    if (lower.includes('关') || lower.includes('close')) category = 'closed';
    else if (lower.includes('等') || lower.includes('wait')) category = 'waiting';
    else if (lower.includes('待') || lower.includes('open') || lower.includes('active')) category = 'pending';
  }

  const fallbackColors: Record<string, string> = {
    pending: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    replied: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    waiting: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    closed: 'bg-gray-500/15 text-gray-600 dark:text-gray-400 border-gray-500/30',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap border ${fallbackColors[category] || fallbackColors.replied}`}>
      {label}
    </span>
  );
}

export function CategoryBadge({ category }: { category: keyof typeof CATEGORY_LABELS }) {
  const colors: Record<string, string> = {
    pending: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    replied: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
    waiting: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    closed: 'bg-gray-500/15 text-gray-600 dark:text-gray-400',
    all: 'bg-primary/15 text-primary',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[category] || colors.all}`}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
