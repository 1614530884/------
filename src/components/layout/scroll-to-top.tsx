'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * 路由切换时滚动到顶部。
 * 解决从已滚动页面切换到新页面时，sticky 头部栏遮挡内容顶部的问题。
 */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
