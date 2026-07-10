'use client';
import { Search, X, type LucideIcon } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  titleIcon?: LucideIcon;
  search?: { value: string; onChange: (v: string) => void; placeholder: string; };
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export function PageHeader({ title, titleIcon: Icon, search, actions, meta }: PageHeaderProps) {
  return (
    <div className="sticky top-14 z-30 bg-background px-3 sm:px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-base sm:text-lg font-semibold flex items-center gap-2 shrink-0 text-foreground">
            {Icon && <Icon className="w-5 h-5 text-primary" />}
            <span>{title}</span>
          </h1>
          {meta && <div className="hidden md:block text-sm text-muted-foreground">{meta}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {search && (
            <div className="relative flex-1 min-w-[160px] max-w-sm order-3 sm:order-none w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input type="text" value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder}
                className="w-full pl-9 pr-8 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors" />
              {search.value && (<button type="button" onClick={() => search.onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="清除搜索"><X className="w-3.5 h-3.5" /></button>)}
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
