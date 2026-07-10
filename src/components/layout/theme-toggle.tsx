'use client';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return <Button variant="ghost" size="sm" className="w-9 h-9 p-0" aria-label="切换主题" disabled />;
  }

  const isDark = theme === 'dark';
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="w-9 h-9 p-0 hover:bg-accent text-muted-foreground hover:text-foreground"
      aria-label={isDark ? '切换到白天模式' : '切换到黑夜模式'}
      title={isDark ? '切换到白天模式' : '切换到黑夜模式'}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}
