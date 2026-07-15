import { getStatusLabel, getStatusColor } from '@/lib/certification-status';

interface Props {
  status: number | string | undefined;
}

const COLOR_CLASSES: Record<string, string> = {
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  red: 'bg-red-500/15 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  zinc: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

export function CertificationStatusBadge({ status }: Props) {
  const label = getStatusLabel(status);
  const color = getStatusColor(status);
  const cls = COLOR_CLASSES[color] || COLOR_CLASSES.zinc;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}
