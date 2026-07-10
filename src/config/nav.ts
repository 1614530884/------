export interface NavItem {
  label: string;
  href: string;
  matchPaths: string[];
  children?: NavItem[];
  adminOnly?: boolean;
  exact?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: '首页', href: '/', matchPaths: ['/'] },
  { label: '实例管理', href: '/user-instances', matchPaths: ['/user-instances'] },
  { label: '节点管理', href: '/nodes', matchPaths: ['/nodes'] },
  {
    label: '服务器工具',
    href: '/server-tools',
    matchPaths: ['/server-tools'],
    children: [
      { label: '服务器列表', href: '/server-tools', matchPaths: ['/server-tools'], exact: true },
      { label: '脚本管理', href: '/server-tools/scripts', matchPaths: ['/server-tools/scripts'] },
      { label: '清理规则', href: '/server-tools/cleanup', matchPaths: ['/server-tools/cleanup'] },
    ],
  },
  { label: '话术模板', href: '/templates', matchPaths: ['/templates'] },
  { label: '回收站', href: '/recycle-bin', matchPaths: ['/recycle-bin'] },
];

export function isPathActive(currentPath: string, matchPaths: string[], exact?: boolean): boolean {
  if (!currentPath) return false;
  if (matchPaths.includes('/')) return currentPath === '/';
  if (exact) return matchPaths.includes(currentPath);
  return matchPaths.some((p) => currentPath === p || currentPath.startsWith(`${p}/`));
}
