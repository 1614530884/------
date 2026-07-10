'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import { NAV_ITEMS, isPathActive, type NavItem } from '@/config/nav';
import { UserMenu } from '@/components/layout/user-menu';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { logout } from '@/lib/auth-client';

interface NavbarProps {
  username: string;
}

export function Navbar({ username }: NavbarProps) {
  const pathname = usePathname() || '/';
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    setMobileOpen(false);
    void logout();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center justify-between gap-2 sm:gap-3">
        {/* 左侧：Logo + 桌面导航 */}
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          {/* 移动端汉堡按钮 */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMobileOpen(true)}
            className="md:hidden border-border bg-transparent text-foreground hover:bg-accent h-9 w-9 p-0 shrink-0"
            aria-label="打开导航菜单"
          >
            <Menu className="w-4 h-4" />
          </Button>

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground text-base sm:text-lg truncate">
              桔子数据
            </span>
          </Link>

          {/* 桌面端导航菜单 */}
          <NavigationMenu viewport={false} className="hidden md:flex items-center">
            <NavigationMenuList>
              {NAV_ITEMS.map((item) => (
                <DesktopNavItem key={item.href} item={item} pathname={pathname} />
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        {/* 右侧：用户区 */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          <ThemeToggle />
          <UserMenu username={username} />
        </div>
      </div>

      {/* 移动端 Sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-72 max-w-[85vw] bg-card border-r border-border p-0 gap-0 [&_[data-slot=sheet-close]]:bg-transparent [&_[data-slot=sheet-close]]:ring-0 [&_[data-slot=sheet-close]]:ring-offset-0 [&_[data-slot=sheet-close]]:text-muted-foreground"
        >
          <SheetHeader className="p-4 border-b border-border bg-card">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shrink-0">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-foreground font-bold text-base truncate text-left">
                  桔子数据
                </SheetTitle>
                <p className="text-[11px] text-muted-foreground truncate text-left">
                  一键开通管理系统
                </p>
              </div>
            </div>
          </SheetHeader>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            <div className="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              导航菜单
            </div>
            {NAV_ITEMS.map((item) => (
              <MobileNavItem
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </nav>

          <div className="border-t border-border p-3 space-y-1.5 bg-muted/30">
            <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
              <span className="text-xs text-muted-foreground">主题模式</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center gap-2.5 rounded-lg bg-muted px-3 py-2.5">
              <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center shrink-0 text-xs font-semibold text-foreground">
                {(username || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">当前账号</div>
                <div className="text-sm font-medium text-foreground truncate">
                  {username || '未登录'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>退出登录</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}

function DesktopNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isPathActive(pathname, item.matchPaths);

  if (item.children && item.children.length > 0) {
    return (
      <NavigationMenuItem>
        <NavigationMenuTrigger
          className={`relative ${active ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {item.label}
          {active && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />}
        </NavigationMenuTrigger>
        <NavigationMenuContent className="left-1/2 -translate-x-1/2">
          <ul className="grid w-[160px] gap-1 p-2">
            {item.children.map((child) => {
              const childActive = isPathActive(pathname, child.matchPaths, child.exact);
              return (
                <li key={child.href}>
                  <NavigationMenuLink asChild>
                    <Link
                      href={child.href}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                        childActive
                          ? 'bg-primary/15 text-primary'
                          : 'text-foreground hover:bg-accent'
                      }`}
                    >
                      <span>{child.label}</span>
                    </Link>
                  </NavigationMenuLink>
                </li>
              );
            })}
          </ul>
        </NavigationMenuContent>
      </NavigationMenuItem>
    );
  }

  return (
    <NavigationMenuItem>
      <NavigationMenuLink asChild>
        <Link
          href={item.href}
          className={`relative ${navigationMenuTriggerStyle()} ${
            active ? 'text-foreground' : 'text-muted-foreground'
          }`}
        >
          {item.label}
          {active && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-full" />}
        </Link>
      </NavigationMenuLink>
    </NavigationMenuItem>
  );
}

function MobileNavItem({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = isPathActive(pathname, item.matchPaths);

  return (
    <a
      href={item.href}
      onClick={onNavigate}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-foreground hover:bg-accent'
      }`}
    >
      <span className="truncate">{item.label}</span>
    </a>
  );
}
