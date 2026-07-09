'use client';

import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  Menu, Zap, Server, Monitor, FileText, RotateCcw,
  Settings, LogOut, Home, User,
} from 'lucide-react';

interface MobileSidebarProps {
  username?: string;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  currentPath?: string;
  variant?: 'home' | 'subpage';
}

interface NavItem {
  label: string;
  href: string;
  icon: typeof Home;
  matchPaths: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: '首页', href: '/', icon: Home, matchPaths: ['/'] },
  { label: '实例管理', href: '/user-instances', icon: Server, matchPaths: ['/user-instances'] },
  { label: '节点管理', href: '/nodes', icon: Monitor, matchPaths: ['/nodes'] },
  { label: '话术模板', href: '/templates', icon: FileText, matchPaths: ['/templates'] },
  { label: '回收站', href: '/recycle-bin', icon: RotateCcw, matchPaths: ['/recycle-bin'] },
];

function isPathActive(currentPath: string | undefined, matchPaths: string[]): boolean {
  if (!currentPath) return false;
  if (matchPaths.includes('/')) return currentPath === '/';
  return matchPaths.some((p) => currentPath === p || currentPath.startsWith(`${p}/`));
}

export default function MobileSidebar({
  username,
  onLogout,
  onOpenSettings,
  currentPath,
  variant = 'home',
}: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  const handleNavClick = () => {
    setOpen(false);
  };

  const handleSettingsClick = () => {
    setOpen(false);
    onOpenSettings?.();
  };

  const handleLogoutClick = () => {
    setOpen(false);
    onLogout?.();
  };

  const closeButtonOverride = variant === 'subpage'
    ? '[&_[data-slot=sheet-close]]:bg-transparent [&_[data-slot=sheet-close]]:ring-0 [&_[data-slot=sheet-close]]:ring-offset-0 [&_[data-slot=sheet-close]]:text-slate-400 [&_[data-slot=sheet-close]]:hover:opacity-80 [&_[data-slot=sheet-close]]:hover:text-white'
    : '';

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="md:hidden border-zinc-700 bg-zinc-800/50 text-zinc-300 hover:bg-zinc-700 hover:text-white h-8 w-8 p-0 shrink-0"
        aria-label="打开导航菜单"
      >
        <Menu className="w-4 h-4" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className={`w-72 max-w-[85vw] bg-slate-900/95 backdrop-blur border-r border-slate-800 p-0 gap-0 ${closeButtonOverride}`}
        >
          <SheetHeader className="p-4 border-b border-slate-800 bg-slate-900/80">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-white font-bold text-base truncate text-left">
                  桔子数据
                </SheetTitle>
                <p className="text-[11px] text-slate-500 truncate text-left">一键开通管理系统</p>
              </div>
            </div>
          </SheetHeader>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            <div className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              导航菜单
            </div>
            {NAV_ITEMS.map((item) => {
              const active = isPathActive(currentPath, item.matchPaths);
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-orange-500/15 text-orange-400'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-orange-400' : 'text-slate-500'}`} />
                  <span className="truncate">{item.label}</span>
                  {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" />}
                </a>
              );
            })}
          </nav>

          <div className="border-t border-slate-800 p-3 space-y-1.5 bg-slate-900/60">
            {username && (
              <div className="flex items-center gap-2.5 rounded-lg bg-slate-800/50 px-3 py-2.5">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                  <User className="w-3.5 h-3.5 text-slate-300" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs text-slate-500">当前账号</div>
                  <div className="text-sm font-medium text-white truncate">{username || '未登录'}</div>
                </div>
              </div>
            )}

            {onOpenSettings && (
              <button
                type="button"
                onClick={handleSettingsClick}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800/70 hover:text-white transition-colors"
              >
                <Settings className="w-4 h-4 text-slate-500" />
                <span>设置</span>
              </button>
            )}

            {onLogout && (
              <button
                type="button"
                onClick={handleLogoutClick}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>退出登录</span>
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
