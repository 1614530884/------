'use client';

import Link from 'next/link';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LogOut, User, Settings } from 'lucide-react';
import { logout } from '@/lib/auth-client';

interface UserMenuProps {
  username: string;
}

export function UserMenu({ username }: UserMenuProps) {
  const displayName = username || '未登录';
  const initial = displayName.charAt(0).toUpperCase() || 'U';

  const handleLogout = () => {
    void logout();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 h-9 px-2 sm:px-3 hover:bg-accent">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="bg-primary/15 text-primary text-xs font-semibold">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium text-foreground hidden sm:inline truncate max-w-[120px]">
            {displayName}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">当前账号</div>
            <div className="text-sm font-medium text-foreground truncate">{displayName}</div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/settings" className="flex items-center">
            <Settings className="w-4 h-4 mr-2" />
            系统设置
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleLogout}
          className="text-destructive focus:text-destructive cursor-pointer"
        >
          <LogOut className="w-4 h-4 mr-2" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
