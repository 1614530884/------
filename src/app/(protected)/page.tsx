'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { loadAuth, saveAuth } from '@/lib/auth-client';
import ProductCard from '@/components/ProductCard';
import ConfigOptionItem from '@/components/ConfigOptionItem';
import { PageHeader } from '@/components/layout/page-header';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Zap, Users, Search, Loader2, CheckCircle, XCircle, AlertCircle,
  Package, CreditCard, User, Eye, EyeOff, RefreshCw,
  Plus, X, Copy, ExternalLink, Settings, FileText,
  Bookmark, Trash2, Star, ChevronDown, ChevronRight, GripVertical,
  Server, AlertTriangle, Power, Cloud,
  Sliders, Pencil, ArrowUpDown, Monitor, Minus, Download, RotateCcw, Check, TerminalSquare,
} from 'lucide-react';
import { getStatusLabel, getStatusClass, formatDueDate, formatAmount, CYCLE_MAP } from '@/lib/product-utils';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// 魔方云实例状态映射（模块级常量）
const CLOUD_STATUS_MAP: Record<string, string> = {
  'init': '创建中', 'on': '开机', 'off': '关机', 'suspend': '暂停',
  'paused': '挂起', 'rescue': '救援系统', 'unknown': '未知', 'recycle': '回收站',
};

// 订单处理步骤
const ORDER_STEPS = [
  { id: 1, name: '登录验证', description: '连接后台系统' },
  { id: 2, name: '查找用户', description: '验证用户信息' },
  { id: 3, name: '自动充余额', description: '充值套餐所需金额' },
  { id: 4, name: '创建订单', description: '提交订单请求' },
  { id: 5, name: '开通服务', description: '自动开通云服务器' },
];

// 操作系统版本项
interface OsVersion {
  id: number;
  version: string;
  [key: string]: unknown;
}

// 操作系统分类
interface OsCategory {
  system: string;
  ico_url?: string;
  child: OsVersion[];
  [key: string]: unknown;
}

// 可配置选项子项类型（来自 set_config API 的 sub 数组）
interface ConfigSubItem {
  id: number;
  config_id: number;
  option_name: string;
  option_name_first?: string;
  pricing?: string;
  show_pricing?: string;
  qty_minimum?: number;
  qty_maximum?: number;
  is_default?: number;
  [key: string]: unknown;
}

// 可配置选项类型（来自后台 set_config API）
interface ConfigOption {
  id: number;
  option_name: string;
  option_type: number;
  unit: string;
  hidden: number;
  senior: number;
  linkage_pid: number;
  linkage_top_pid: number;
  qty_minimum: number;
  qty_maximum: number;
  child: ConfigSubItem[] | Record<string, OsCategory>;
  [key: string]: unknown;
}

// 产品项类型（来自 /product_list_page API）
interface ProductItem {
  id: number;
  name: string;
  gid?: number;
  product_group_id?: number;
  type?: string;
  type_zh?: string;
  pay_type: string | Array<{ billingcycle: string; billingcycle_zh: string; product_price: string; setup_fee: string }>;
  qty?: number;
  auto_setup?: string;
  hidden?: number;
  count?: number;
  count_active?: number;
}

// 二级产品分组
interface ProductSubGroup {
  id: number;
  name: string;
  hidden: number;
  products: ProductItem[];
}

// 一级产品分组
interface ProductFirstGroup {
  id: number;
  name: string;
  hidden: number;
  groups: ProductSubGroup[];
}

interface ProcessingStep {
  id: string | number;
  name: string;
  description: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  message?: string;
}

// 套餐配置（保存为预设，一键选择开通）
interface PackageConfig {
  id: string;           // 唯一标识（timestamp-based）
  name: string;         // 套餐名称，如"香港云-标准版"
  productId: number;    // 产品ID
  productName: string;  // 产品名称（冗余存储，方便显示）
  billingCycle: string; // 计费周期
  billingCycleLabel: string; // 计费周期中文名
  configValues: Record<string, string>;  // 所有配置选项值
  customFieldValues: Record<string, string>; // 自定义字段值
  productQty: number;   // 数量
  firstPrice: string;   // 首次价格
  renewPrice: string;   // 续费价格
  gateway: string;      // 支付网关
  useCredit: boolean;   // 是否使用余额
  autoRecharge: boolean; // 是否自动充余额
  createdAt: number;    // 创建时间戳
}

interface Template {
  id: string;
  name: string;
  content: string;
  osFilters: string[];
  productIds: number[];
  isDefault: boolean;
  perServer: boolean;  // 是否按台数生成话术（true=每台一份，false=只生成一份）
  scene: 'provision' | 'renew';  // 场景：开通 / 续费
  createdAt: number;
  updatedAt: number;
}

// 可拖拽排序的产品分类项
function SortableGroupItem({ id, name, subCount, hidden, onToggleHidden }: { id: number; name: string; subCount: number; hidden: boolean; onToggleHidden: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: String(id) });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className={`flex items-center gap-2 p-2 rounded border cursor-grab active:cursor-grabbing ${hidden ? 'bg-muted/40 border-border/50 opacity-60' : 'bg-muted border-border hover:border-primary/50'}`}>
      <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" {...listeners} />
      <span className={`text-sm truncate ${hidden ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{name}</span>
      <span className="text-xs text-muted-foreground ml-auto shrink-0">{subCount}个子分组</span>
      <button
        type="button"
        onClick={() => onToggleHidden(id)}
        title={hidden ? '显示产品' : '隐藏产品'}
        className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors"
      >
        {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

// 可拖拽排序的套餐卡片（支持月付/年付切换）
function SortablePackageCard({
  pkg,
  isSelected,
  onSelect,
  onDelete,
  onEdit,
  siblingPkg,
  onSwitchCycle,
  selectedCycle,
}: {
  pkg: PackageConfig;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onEdit?: () => void;
  siblingPkg?: PackageConfig | null;
  onSwitchCycle?: (targetId: string) => void;
  selectedCycle?: 'monthly' | 'annually'; // 当前选中的周期
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pkg.id });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : 1,
  };

  const hasSibling = !!siblingPkg;
  const isMonthly = pkg.billingCycle === 'monthly';
  const activeCycle = selectedCycle || (isMonthly ? 'monthly' : 'annually');
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-lg border px-3 py-2.5 cursor-pointer transition-all ${
        isSelected
          ? 'border-primary bg-primary/15 shadow-sm shadow-primary/20'
          : 'border-border bg-card/50 hover:border-border hover:bg-accent/40'
      } ${isDragging ? 'shadow-lg shadow-black/30' : ''}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground/80 shrink-0 p-0"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <Star className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
        <span className="text-foreground font-medium text-sm truncate">{pkg.name}</span>
        {/* 月付/年付切换 */}
        {hasSibling && (
          <div className="flex ml-auto mr-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded-l text-[10px] font-medium transition-colors ${
                activeCycle === 'monthly' ? 'bg-accent2 text-accent2-foreground' : 'bg-accent text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => { if (activeCycle !== 'monthly') onSwitchCycle?.(pkg.id); }}
            >月付</button>
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded-r text-[10px] font-medium transition-colors ${
                activeCycle === 'annually' ? 'bg-accent2 text-accent2-foreground' : 'bg-accent text-muted-foreground hover:bg-accent'
              }`}
              onClick={() => { if (activeCycle !== 'annually' && siblingPkg) onSwitchCycle?.(siblingPkg.id); }}
            >年付</button>
          </div>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-info transition-all shrink-0"
          title="编辑套餐"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all shrink-0"
          title="删除套餐"
        >
          <Trash2 className="w-3 h-3" />
        </button>
        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent className="bg-card border-border">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-destructive">确认删除套餐</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                确定要删除套餐「{pkg.name}」吗？此操作不可撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-muted border-border text-foreground/80 hover:bg-accent">取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => onDelete()}
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              >
                确认删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground ml-9">
        {(() => {
          const showPkg = activeCycle === 'annually' && siblingPkg ? siblingPkg : pkg;
          const showMonthly = showPkg.billingCycle === 'monthly';
          const otherPkg = showMonthly ? siblingPkg : (activeCycle === 'annually' ? pkg : null);
          return (
            <>
              <span>{showMonthly ? '月付' : '年付'}</span>
              <span>x{showPkg.productQty}</span>
              {showPkg.firstPrice && <span className="text-primary font-medium">¥{parseFloat(showPkg.firstPrice).toFixed(2)}/{showMonthly ? '月' : '年'}</span>}
              {otherPkg?.firstPrice && (
                <span className="text-muted-foreground">{showMonthly ? '年付' : '月付'}¥{parseFloat(otherPkg.firstPrice).toFixed(2)}/{showMonthly ? '年' : '月'}</span>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}


export default function OneClickOrderPage() {
  // 通知状态
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  }, []);

  // 套餐拖拽排序
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handlePackageDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    setSavedPackages(prev => {
      const oldIndex = prev.findIndex(p => p.id === activeId);
      const newIndex = prev.findIndex(p => p.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const reordered = arrayMove(prev, oldIndex, newIndex);
      // 保存排序到服务端
      const ids = reordered.map(p => p.id);
      fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', ids }),
      }).catch(() => {});
      return reordered;
    });
  }, []);

  // 登录配置
  // 财务后台/魔方云跳转URL配置（持久化到服务端配置文件）
  const [financeUrl, setFinanceUrl] = useState('');
  const [mfyUrl, setMfyUrl] = useState('');
  const [mfyUsername, setMfyUsername] = useState('');
  const [mfyPassword, setMfyPassword] = useState('');
  type MfyAccountMapping = { loginUser: string; mfyUrl: string; mfyUsername: string; mfyPassword: string };
  const [mfyAccounts, setMfyAccounts] = useState<MfyAccountMapping[]>([]);
  const [productSortOrder, setProductSortOrder] = useState<number[]>([]);
  const [hiddenProductIds, setHiddenProductIds] = useState<number[]>([]);
  const [adminUsernames, setAdminUsernames] = useState('');

  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // 权限控制：当前登录用户是否在管理员列表中
  const isAdminUser = adminUsernames.trim() ? adminUsernames.split(',').map(s => s.trim()).filter(Boolean).includes(adminUsername) : false;

  const [sessionCookie, setSessionCookie] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // 从服务端加载财务/魔方云/远程配置
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.ok ? res.json() : {})
      .then((data: Record<string, unknown>) => {
        if (data.financeUrl) setFinanceUrl(data.financeUrl as string);
        if (data.mfyUrl) setMfyUrl(data.mfyUrl as string);
        if (data.mfyUsername) setMfyUsername(data.mfyUsername as string);
        if (data.mfyPassword) setMfyPassword(data.mfyPassword as string);
        if (Array.isArray(data.mfyAccounts)) setMfyAccounts(data.mfyAccounts as MfyAccountMapping[]);
        if (data.adminUsernames) setAdminUsernames(data.adminUsernames as string);
        if (Array.isArray(data.productSortOrder)) setProductSortOrder(data.productSortOrder as number[]);
        if (Array.isArray(data.hiddenProductIds)) setHiddenProductIds(data.hiddenProductIds as number[]);
      })
      .catch(() => {});
  }, []);

  // 用户管理
  const urlSearchParams = useSearchParams();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchType, setSearchType] = useState<'auto' | 'uid' | 'username' | 'email' | 'phone' | 'qq'>('auto');
  const [searchResults, setSearchResults] = useState<Array<{
    id: number;
    username: string;
    phone?: string;
    email?: string;
    credit?: string;
    phonenumber?: string;
    qq?: string;
    create_time?: string;
  }>>([]);
  const [selectedUser, setSelectedUser] = useState<{
    id: number;
    username: string;
    phone?: string;
    email?: string;
    credit?: string;
    phonenumber?: string;
    qq?: string;
    person_status?: string;
    company_status?: string;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  // 从 localStorage 恢复 selectedUser（避免 hydration 不匹配）
  const [userRestored, setUserRestored] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem('idc_selectedUser');
    if (saved) {
      try { setSelectedUser(JSON.parse(saved)); } catch {}
    }
    setUserRestored(true);
  }, []);

  // 持久化 selectedUser 到 localStorage
  useEffect(() => {
    if (!userRestored) return;
    if (selectedUser) {
      localStorage.setItem('idc_selectedUser', JSON.stringify(selectedUser));
    } else {
      localStorage.removeItem('idc_selectedUser');
    }
  }, [selectedUser, userRestored]);

  const [addAmount, setAddAmount] = useState('');
  const [addDescription, setAddDescription] = useState('强制添加余额');
  const [isAddingBalance, setIsAddingBalance] = useState(false);
  const [showRechargeArea, setShowRechargeArea] = useState(false);

  // 产品 & 配置选项
  const [productGroups, setProductGroups] = useState<ProductFirstGroup[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProductDetail, setSelectedProductDetail] = useState<ProductItem | null>(null);
  const [productCycles, setProductCycles] = useState<Array<{ value: string; label: string }>>([]);
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([]);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const [selectedBillingCycle, setSelectedBillingCycle] = useState('monthly');

  const [customFieldValues, setCustomFieldValues] = useState<Record<string, string>>({});
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);

  // 产品配置缓存: key = "pid_billingcycle"，避免重复请求
  const configCacheRef = useRef<Record<string, { options: ConfigOption[]; customFields: Array<{ id: number; fieldname: string; description: string; fieldtype: string; required: number }>; cycles: Array<{ value: string; label: string }> }>>({});


  // 使用余额
  const [useCredit, setUseCredit] = useState(false);
  // 自动充余额
  const [autoRecharge, setAutoRecharge] = useState(true);

  // 支付网关
  const [gateways, setGateways] = useState<Array<{ id: number; name: string; title: string; status: number }>>([]);
  const [selectedGateway, setSelectedGateway] = useState<string>('');

  // ===== 用户产品管理 =====
  const [userProducts, setUserProducts] = useState<Array<Record<string, unknown>>>([]);
  const [selectedRenewIds, setSelectedRenewIds] = useState<Set<number>>(new Set());
  // 套餐配置指纹：忽略 os_cat_* 和 qty_*，只比较核心配置项
  const getConfigFingerprint = (pkg: PackageConfig): string => {
    const cv = pkg.configValues || {};
    const keys = Object.keys(cv).filter(k => !k.startsWith('os_cat_') && !k.startsWith('qty_')).sort();
    return keys.map(k => `${k}=${cv[k]}`).join('&');
  };

  // 按配置分组套餐，合并月付/年付


  const [isLoadingUserProducts, setIsLoadingUserProducts] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [showRenewConfirm, setShowRenewConfirm] = useState(false);
  const [renewAsAnnually, setRenewAsAnnually] = useState<Set<number>>(new Set()); // 续费时转年付的产品ID集合
  const [renewCycles, setRenewCycles] = useState(1); // 续费周期数（续几个月/几年）
  const [directRenewId, setDirectRenewId] = useState<number | null>(null); // 单个续费按钮直接续费的产品ID
  // 续费目标：直接续费ID 优先，否则用勾选的
  const renewTargetIds = directRenewId !== null ? new Set([directRenewId]) : selectedRenewIds;
  const [showCertifiConfirm, setShowCertifiConfirm] = useState(false);
  const [certifiInfo, setCertifiInfo] = useState<{ status: number; msg: string } | null>(null);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);

  // ===== 快速选用户弹窗 =====
  const [showQuickUserSearch, setShowQuickUserSearch] = useState(false);
  const [quickSearchKeyword, setQuickSearchKeyword] = useState('');
  const [quickSearchType, setQuickSearchType] = useState<'auto' | 'uid' | 'username' | 'email' | 'phone' | 'qq'>('auto');
  const [quickSearchResults, setQuickSearchResults] = useState<Array<{
    id: number; username: string; email?: string; phone?: string; phonenumber?: string;
    credit?: string; status?: string; qq?: string; person_status?: string; company_status?: string;
  }>>([]);
  const [quickIsSearching, setQuickIsSearching] = useState(false);
  const [pendingProvision, setPendingProvision] = useState(false); // 是否在弹窗选完用户后自动开通

  // ===== 升级套餐 =====
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [upgradeProduct, setUpgradeProduct] = useState<Record<string, unknown> | null>(null);
  const [upgradePackages, setUpgradePackages] = useState<PackageConfig[]>([]);
  const [currentPackageId, setCurrentPackageId] = useState<string | null>(null);
  const [targetPackageId, setTargetPackageId] = useState<string | null>(null);
  const [upgradeConfigOptions, setUpgradeConfigOptions] = useState<Array<{
    id: number;
    option_name: string;
    option_type: number;
    child: Array<{ id: number; option_name: string; [key: string]: unknown }>;
  }>>([]);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] = useState(false);
  const [upgradeBillingCycle, setUpgradeBillingCycle] = useState<'monthly' | 'annually'>('monthly');
  const [upgradeCurrentConfig, setUpgradeCurrentConfig] = useState<Record<string, string>>({});

  // ===== 套餐修改 =====
  const [modifyDialogOpen, setModifyDialogOpen] = useState(false);
  const [modifyProduct, setModifyProduct] = useState<Record<string, unknown> | null>(null);
  const [modifyConfigOptions, setModifyConfigOptions] = useState<Array<{
    id: number;
    option_name: string;
    option_type: number;
    unit?: string;
    qty_minimum?: number;
    qty_maximum?: number;
    child: Array<{ id: number; option_name: string; [key: string]: unknown }>;
  }>>([]);
  const [modifyCurrentValues, setModifyCurrentValues] = useState<Record<string, string>>({});
  const [floatingUserPanelEnabled, setFloatingUserPanelEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('idcsmart_floating_user_panel_enabled') !== 'false';
  });
  const [showFloatingUserPanel, setShowFloatingUserPanel] = useState(false);
  const [floatingUserPanelMinimized, setFloatingUserPanelMinimized] = useState(false);
  const [floatingUserPanelClosed, setFloatingUserPanelClosed] = useState(false);
  const [floatingUserPanelSize, setFloatingUserPanelSize] = useState(() => {
    if (typeof window === 'undefined') return { width: 384, height: 560 };
    try {
      const saved = localStorage.getItem('idcsmart_floating_user_panel_size');
      if (saved) {
        const parsed = JSON.parse(saved) as { width?: number; height?: number };
        return {
          width: Math.min(Math.max(Number(parsed.width) || 384, 300), Math.min(window.innerWidth - 16, 640)),
          height: Math.min(Math.max(Number(parsed.height) || 560, 320), Math.min(window.innerHeight - 32, 820)),
        };
      }
    } catch {}
    return { width: 384, height: 560 };
  });
  const [isResizingFloatingPanel, setIsResizingFloatingPanel] = useState(false);
  const [isDesktopFloatingPanel, setIsDesktopFloatingPanel] = useState(false);
  // 搜索后自动清空输入框（保存在localStorage）
  const [autoClearSearch, setAutoClearSearch] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('idcsmart_auto_clear_search') === 'true';
  });
  const [modifySelectedValues, setModifySelectedValues] = useState<Record<string, string>>({});
  const [modifyLoading, setModifyLoading] = useState(false);
  const [modifySubmitting, setModifySubmitting] = useState(false);
  const [modifyCurrentAmount, setModifyCurrentAmount] = useState('');
  const [modifyNewAmount, setModifyNewAmount] = useState('');
  const [modifySelectedQtyValues, setModifySelectedQtyValues] = useState<Record<string, number>>({});
  const [modifyCurrentQtyValues, setModifyCurrentQtyValues] = useState<Record<string, number>>({});

  // ===== 退款删除 =====
  const [showRefundConfirm, setShowRefundConfirm] = useState(false);
  const [refundTarget, setRefundTarget] = useState<Record<string, unknown> | null>(null);
  const [refundInfo, setRefundInfo] = useState<Record<string, unknown> | null>(null);
  const [isLoadingRefund, setIsLoadingRefund] = useState(false);
  const [isRefundDeleting, setIsRefundDeleting] = useState(false);

  // ===== 批量删除 =====
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [batchDeleteSteps, setBatchDeleteSteps] = useState<Array<{ id: string; name: string; status: 'processing' | 'completed' | 'failed'; message?: string }>>([]);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [remoteConnectInfo, setRemoteConnectInfo] = useState<{
    ip: string;
    username: string;
    password: string;
    hostid: number;
    uid: number;
    productName?: string;
  } | null>(null);
  const [remoteConnecting, setRemoteConnecting] = useState(false);
  const [remoteCopiedField, setRemoteCopiedField] = useState<string | null>(null);
  const [remoteCopiedAll, setRemoteCopiedAll] = useState(false);
  const remoteCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvoiceIdsRef = useRef<number[]>([]);
  const [refundSteps, setRefundSteps] = useState<Array<{ id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }>>([]);
  const [refundMode, setRefundMode] = useState<'credit' | 'record'>('record');

  // ===== 套餐管理 =====
  const [savedPackages, setSavedPackages] = useState<PackageConfig[]>([]);

  const findMatchingPackage = useCallback((product: Record<string, unknown> | undefined, targetCycle: string) => {
    if (!product) return null;
    const productName = String(product.productname || product.product_name || '');
    const currentCycle = String(product.billingcycle || 'monthly');
    const productAmount = parseFloat(String(product.amount || '0').replace(/[^\d.]/g, '')) || 0;
    const currentPkg = savedPackages.find((pkg) => {
      if (pkg.productName !== productName) return false;
      if (pkg.billingCycle !== currentCycle) return false;
      const pkgPrice = parseFloat(String(pkg.renewPrice || pkg.firstPrice || '0').replace(/[^\d.]/g, '')) || 0;
      return Math.abs(pkgPrice - productAmount) < 0.01;
    });
    if (!currentPkg) return null;
    const fingerprint = getConfigFingerprint(currentPkg);
    return savedPackages.find((pkg) => (
      pkg.productName === productName
      && pkg.productId === currentPkg.productId
      && pkg.billingCycle === targetCycle
      && getConfigFingerprint(pkg) === fingerprint
    )) || null;
  }, [savedPackages]);

  // 当 savedPackages 加载后，如果 productSortOrder 为空，自动初始化排序
  useEffect(() => {
    if (productSortOrder.length === 0 && savedPackages.length > 0) {
      const allProductIds = [...new Set(savedPackages.map(p => p.productId))];
      setProductSortOrder(allProductIds);
    }
  }, [savedPackages, productSortOrder.length]);

  const [selectedPackageId, setSelectedPackageId] = useState<string>('');
  const [packageNameInput, setPackageNameInput] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showEditPackageDialog, setShowEditPackageDialog] = useState(false);
  const [editingPackage, setEditingPackage] = useState<PackageConfig | null>(null);
  const [editConfigOptions, setEditConfigOptions] = useState<ConfigOption[]>([]);
  const [isLoadingEditConfig, setIsLoadingEditConfig] = useState(false);
  const [showGroupSortDialog, setShowGroupSortDialog] = useState(false);
  const [configMode, setConfigMode] = useState<'package' | 'custom'>('package');
  const [mainTab, setMainTab] = useState<'provision' | 'renew'>('provision');
  const [packageExtraExpanded, setPackageExtraExpanded] = useState(false);
  const saveInputRef = useRef<HTMLInputElement>(null);
  const [importingPackages, setImportingPackages] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [productStatusFilters, setProductStatusFilters] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('productStatusFilters');
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem('productStatusFilters', JSON.stringify(productStatusFilters)); } catch {}
  }, [productStatusFilters]);

  // 产品搜索
  const [productSearch, setProductSearch] = useState('');
  const [productSearchDebounced, setProductSearchDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setProductSearchDebounced(productSearch), 250);
    return () => clearTimeout(timer);
  }, [productSearch]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const handleChange = () => setIsDesktopFloatingPanel(mediaQuery.matches);
    handleChange();
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const shouldShow = window.scrollY > 220;
      setShowFloatingUserPanel(shouldShow);
      if (!shouldShow) {
        setFloatingUserPanelClosed(false);
        setFloatingUserPanelMinimized(false);
      }
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    localStorage.setItem('idcsmart_floating_user_panel_enabled', String(floatingUserPanelEnabled));
  }, [floatingUserPanelEnabled]);

  const handleFloatingPanelResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = floatingUserPanelSize.width;
    const startHeight = floatingUserPanelSize.height;
    setIsResizingFloatingPanel(true);
    const handleMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.min(window.innerWidth - 16, 640);
      const maxHeight = Math.min(window.innerHeight - 32, 820);
      const nextWidth = Math.min(Math.max(startWidth + startX - moveEvent.clientX, 300), maxWidth);
      const nextHeight = Math.min(Math.max(startHeight + moveEvent.clientY - startY, 320), maxHeight);
      setFloatingUserPanelSize({ width: nextWidth, height: nextHeight });
    };
    const handleUp = () => {
      setIsResizingFloatingPanel(false);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      setFloatingUserPanelSize((size) => {
        localStorage.setItem('idcsmart_floating_user_panel_size', JSON.stringify(size));
        return size;
      });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [floatingUserPanelSize]);

  useEffect(() => {
    if (isResizingFloatingPanel) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'nwse-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizingFloatingPanel]);

  // useMemo: 过滤后的产品列表，避免每次渲染重复计算
  const filteredProducts = useMemo(() => {
    let result = userProducts;
    // 状态过滤
    if (productStatusFilters.length > 0) {
      result = result.filter((p) => {
        const label = getStatusLabel(p.domainstatus);
        return productStatusFilters.includes(label);
      });
    }
    // 搜索过滤：主机名 + IP 模糊匹配
    if (productSearchDebounced.trim()) {
      const keyword = productSearchDebounced.trim().toLowerCase();
      result = result.filter((p) => {
        const hostname = String(p.domain || p.hostname || p.host_name || '').toLowerCase();
        const ip = String(p.dedicatedip || p.ip || '').toLowerCase();
        return hostname.includes(keyword) || ip.includes(keyword);
      });
    }
    return result;
  }, [userProducts, productStatusFilters, productSearchDebounced]);

  // useMemo: 按 productSortOrder 排序后的产品ID列表（套餐模式下拉框用，排除已隐藏产品）
  const sortedProductIds = useMemo(() => {
    const productIds = [...new Set(savedPackages.map(p => p.productId))].filter(id => !hiddenProductIds.includes(id));
    if (productSortOrder.length === 0) return productIds;
    return [...productIds].sort((a, b) => {
      const idxA = productSortOrder.indexOf(a);
      const idxB = productSortOrder.indexOf(b);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }, [savedPackages, productSortOrder, hiddenProductIds]);

  // 预计算产品信息映射，避免渲染时重复 find/filter
  const productInfoMap = useMemo(() => {
    const map = new Map<number, { name: string; count: number }>();
    // 先从 savedPackages 提取
    savedPackages.forEach(p => {
      const existing = map.get(p.productId);
      if (existing) {
        existing.count++;
      } else {
        map.set(p.productId, { name: p.productName, count: 1 });
      }
    });
    // 再从 productGroups 补充（覆盖更完整的产品名）
    productGroups.forEach(g => (g.groups || []).forEach(sg => (sg.products || []).forEach(p => {
      if (!map.has(p.id)) {
        map.set(p.id, { name: p.name || `产品${p.id}`, count: 0 });
      }
    })));
    return map;
  }, [savedPackages, productGroups]);

  // 当前选中产品的名称
  const selectedProductName = useMemo(() => {
    if (!selectedProductId) return '--';
    return productInfoMap.get(selectedProductId)?.name || String(selectedProductId);
  }, [selectedProductId, productInfoMap]);

  // 当前选中节点的名称
  const selectedNodeName = useMemo(() => {
    const nodeOpt = configOptions.find(opt => ['节点'].some(k => opt.option_name.includes(k)) && !opt.option_name.includes('分组') && !opt.option_name.includes('优先级') && Array.isArray(opt.child));
    if (!nodeOpt) return null;
    const selectedNodeId = configValues[nodeOpt.id];
    if (!selectedNodeId) return null;
    const selectedItem = (nodeOpt.child as { id: number; option_name: string }[]).find(item => String(item.id) === selectedNodeId);
    if (!selectedItem) return null;
    const getDisplayName = (name: string) => { const sep = name.includes('^') ? '^' : name.includes('|') ? '|' : null; return sep ? name.split(sep).pop()!.trim() : name; };
    return getDisplayName(selectedItem.option_name);
  }, [configOptions, configValues]);

  // useMemo: 弹性模式下保持原样（分组结构不变）
  const sortedProductGroups = useMemo(() => {
    return productGroups;
  }, [productGroups]);

  const [importRows, setImportRows] = useState<Array<{
    name: string; cpu: string; ram: string; disk: string; bandwidth: string; monthlyPrice: string; annuallyPrice: string;
  }>>([]);

  // 打开导入弹窗，预填默认数据
  const openImportDialog = () => {
    if (!selectedProductId) {
      showNotification('error', '请先选择产品');
      return;
    }
    if (configOptions.length === 0) {
      showNotification('error', '请先加载产品配置选项');
      return;
    }
    // 每次打开都预填默认套餐数据
    setImportRows([
      { name: '套餐一', cpu: '2', ram: '2', disk: '30', bandwidth: '30', monthlyPrice: '19', annuallyPrice: '190' },
      { name: '套餐二', cpu: '2', ram: '4', disk: '40', bandwidth: '40', monthlyPrice: '29', annuallyPrice: '290' },
      { name: '套餐三', cpu: '4', ram: '4', disk: '50', bandwidth: '40', monthlyPrice: '39', annuallyPrice: '390' },
      { name: '套餐四', cpu: '4', ram: '8', disk: '60', bandwidth: '50', monthlyPrice: '69', annuallyPrice: '690' },
      { name: '套餐五', cpu: '8', ram: '8', disk: '90', bandwidth: '50', monthlyPrice: '89', annuallyPrice: '890' },
      { name: '套餐六', cpu: '8', ram: '16', disk: '100', bandwidth: '60', monthlyPrice: '149', annuallyPrice: '1490' },
      { name: '套餐七', cpu: '16', ram: '16', disk: '120', bandwidth: '60', monthlyPrice: '189', annuallyPrice: '1890' },
      { name: '套餐八', cpu: '32', ram: '32', disk: '200', bandwidth: '80', monthlyPrice: '289', annuallyPrice: '2890' },
    ]);
    setShowImportDialog(true);
  };

  // 更新导入行
  const updateImportRow = (index: number, field: string, value: string) => {
    setImportRows(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  // 添加导入行
  const addImportRow = () => {
    setImportRows(prev => [...prev, { name: `套餐${prev.length + 1}`, cpu: '', ram: '', disk: '', bandwidth: '', monthlyPrice: '', annuallyPrice: '' }]);
  };

  // 删除导入行
  const removeImportRow = (index: number) => {
    setImportRows(prev => prev.filter((_, i) => i !== index));
  };

  // 匹配配置项的子选项：根据选项名称关键词找到最匹配的子选项ID
  const matchSubOption = (subs: ConfigSubItem[], keywords: string[]): string | null => {
    for (const kw of keywords) {
      const found = subs.find(s => {
        const name = (s.option_name || '').replace(/\s/g, '');
        return name === kw || name.includes(kw);
      });
      if (found) return String(found.id);
    }
    return null;
  };

  // 根据数字值匹配数量型配置项的子选项
  // 数量型(option_type=14)通常只有一个子选项，直接取第一个，值通过qty控制
  const matchQtyOption = (subs: ConfigSubItem[], value: number): { optionId: string; qty: number } | null => {
    if (subs.length === 0) return null;
    // 优先按名称中的数字匹配
    for (const s of subs) {
      const name = (s.option_name || '').replace(/\s/g, '');
      const numMatch = name.match(/(\d+)/);
      if (numMatch && parseInt(numMatch[1]) === value) {
        return { optionId: String(s.id), qty: value };
      }
    }
    // 数量型通常只有一个子选项，直接用第一个，设置qty
    return { optionId: String(subs[0].id), qty: value };
  };

  // 执行批量导入
  const handleBatchImport = async () => {
    if (!selectedProductId || configOptions.length === 0) return;

    // 过滤掉没有价格的行
    const validRows = importRows.filter(r => r.monthlyPrice || r.annuallyPrice);
    if (validRows.length === 0) {
      showNotification('error', '没有有效的套餐数据');
      return;
    }

    setImportingPackages(true);
    try {
      let productName = '';
      for (const fg of productGroups) {
        for (const sg of fg.groups || []) {
          const found = (sg.products || []).find(p => p.id === selectedProductId);
          if (found) { productName = found.name; break; }
        }
        if (productName) break;
      }

      // 匹配配置项
      const cpuOpt = configOptions.find(o => /CPU|核心|核数/i.test(o.option_name));
      const ramOpt = configOptions.find(o => /内存|RAM/i.test(o.option_name));
      const diskOpt = configOptions.find(o => /数据盘|硬盘|磁盘|存储|Data\s*Disk|Disk/i.test(o.option_name));
      const bwOpt = configOptions.find(o => /带宽|网络带宽|BWP/i.test(o.option_name));

      const newPkgs: PackageConfig[] = [];
      const cycles: Array<{ value: string; label: string }> = [
        { value: 'monthly', label: '月付' },
        { value: 'annually', label: '年付' },
      ];

      for (const tmpl of validRows) {
        for (const cycle of cycles) {
          const price = cycle.value === 'monthly' ? tmpl.monthlyPrice : tmpl.annuallyPrice;
          if (!price) continue; // 没有该周期价格则跳过

          const cv: Record<string, string> = {};
          // 设置所有配置项默认值
          for (const opt of configOptions) {
            if (opt.option_type === 5 && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
              const osCategories = Object.entries(opt.child as Record<string, { system?: string; child: Array<{ id: number }> }>);
              if (osCategories.length > 0) {
                const [firstKey, firstCat] = osCategories[0];
                cv[`os_cat_${opt.id}`] = firstKey;
                if (firstCat?.child?.[0]) cv[opt.id] = String(firstCat.child[0].id);
              }
              continue;
            }
            if (opt.option_type === 3) {
              cv[opt.id] = '0';
              continue;
            }
            const subs = Array.isArray(opt.child) ? opt.child : [];
            if (subs.length > 0) {
              const defaultSub = subs.find((s: ConfigSubItem) => s.is_default === 1) || subs[0];
              cv[opt.id] = String(defaultSub.id);
              if ([7, 9, 11, 14, 15].includes(opt.option_type)) {
                cv[`qty_${opt.id}`] = String(defaultSub.qty_minimum || opt.qty_minimum || 0);
              }
            }
          }

          // 替换CPU
          if (cpuOpt && Array.isArray(cpuOpt.child) && tmpl.cpu) {
            const cpuNum = parseInt(tmpl.cpu);
            if (cpuNum > 0) {
              const keywords = [`${cpuNum}核`, `${cpuNum}核CPU`, `${cpuNum}核心`, `${cpuNum} Core`, `${cpuNum}Core`, `${cpuNum}`];
              const matched = matchSubOption(cpuOpt.child as ConfigSubItem[], keywords);
              if (matched) cv[cpuOpt.id] = matched;
            }
          }

          // 替换内存
          if (ramOpt && Array.isArray(ramOpt.child) && tmpl.ram) {
            const ramNum = parseInt(tmpl.ram);
            if (ramNum > 0) {
              const keywords = [`${ramNum}G`, `${ramNum}GB`, `${ramNum}M`, `${ramNum}`];
              const matched = matchSubOption(ramOpt.child as ConfigSubItem[], keywords);
              if (matched) cv[ramOpt.id] = matched;
            }
          }

          // 替换数据盘
          if (diskOpt && Array.isArray(diskOpt.child) && tmpl.disk) {
            const diskNum = parseInt(tmpl.disk);
            if (diskNum > 0) {
              if ([7, 9, 11, 14, 15].includes(diskOpt.option_type)) {
                const matched = matchQtyOption(diskOpt.child as ConfigSubItem[], diskNum);
                if (matched) {
                  cv[diskOpt.id] = matched.optionId;
                  cv[`qty_${diskOpt.id}`] = String(diskNum);
                }
              } else {
                const keywords = [`${diskNum}G`, `${diskNum}GB`, `${diskNum}`];
                const matched = matchSubOption(diskOpt.child as ConfigSubItem[], keywords);
                if (matched) cv[diskOpt.id] = matched;
              }
            }
          }

          // 替换带宽
          if (bwOpt && Array.isArray(bwOpt.child) && tmpl.bandwidth) {
            const bwNum = parseInt(tmpl.bandwidth);
            if (bwNum > 0) {
              if ([7, 9, 11, 14, 15].includes(bwOpt.option_type)) {
                const matched = matchQtyOption(bwOpt.child as ConfigSubItem[], bwNum);
                if (matched) {
                  cv[bwOpt.id] = matched.optionId;
                  cv[`qty_${bwOpt.id}`] = String(bwNum);
                }
              } else {
                const keywords = [`${bwNum}M`, `${bwNum}Mbps`, `${bwNum}M带宽`, `${bwNum}`];
                const matched = matchSubOption(bwOpt.child as ConfigSubItem[], keywords);
                if (matched) cv[bwOpt.id] = matched;
              }
            }
          }

          const pkg: PackageConfig = {
            id: `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: tmpl.name,
            productId: selectedProductId,
            productName,
            billingCycle: cycle.value,
            billingCycleLabel: cycle.label,
            configValues: cv,
            customFieldValues: {},
            productQty: 1,
            firstPrice: price,
            renewPrice: price,
            gateway: selectedGateway,
            useCredit,
            autoRecharge,
            createdAt: Date.now(),
          };
          newPkgs.push(pkg);
        }
      }

      if (newPkgs.length === 0) {
        showNotification('error', '没有生成有效的套餐');
        return;
      }

      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batchSave', packages: newPkgs }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedPackages(json.data as PackageConfig[]);
        setShowImportDialog(false);
        showNotification('success', `已导入 ${newPkgs.length} 个套餐（${validRows.length}个 × 月付/年付）`);
      }
    } catch {
      showNotification('error', '批量导入套餐失败');
    } finally {
      setImportingPackages(false);
    }
  };

  // 产品数量与价格覆盖
  const [productQty, setProductQty] = useState(1);
  const [firstPrice, setFirstPrice] = useState('');
  const [renewPrice, setRenewPrice] = useState('');

  // 处理状态
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingSteps, setProcessingSteps] = useState<ProcessingStep[]>([]);
  const [progress, setProgress] = useState(0);
  const [orderResult, setOrderResult] = useState<{
    success: boolean;
    orderId?: string;
    message?: string;
  } | null>(null);
  const [resultData, setResultData] = useState<{
    orderId: string;
    ip: string;
    username: string;
    password: string;
    hostId: string;
    uid: string;
    dcimid: string;
    nextduedate?: string;
    amount?: string;
    billingcycle?: string;
    productName?: string;
  }[] | null>(null);

  // ===== 续费完成话术弹窗 =====
  const [renewResultData, setRenewResultData] = useState<{
    hostId: number;
    ip: string;
    nextduedate: string;
    productName: string;
    amount: string;
    billingcycle: string;
  }[] | null>(null);
  const [showRenewResult, setShowRenewResult] = useState(false);

  // ===== 话术模板 =====
  const [templates, setTemplates] = useState<Template[]>([]);

  // 加载话术模板
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/templates');
      const data = await res.json();
      if (data.success) setTemplates(data.data || []);
    } catch { /* ignore */ }
  }, []);

  // 页面加载时获取模板
  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // 匹配话术模板：OS版本精确匹配 > 产品ID匹配 > 默认模板 > 通用模板兜底（按 scene 过滤）
  const matchTemplate = useCallback((osName: string, productId: number | null, tmplList: Template[], scene: 'provision' | 'renew' = 'provision'): Template | null => {
    // 0. 先按场景过滤（向后兼容：无 scene 字段视为 provision）
    const list = tmplList.filter(t => (t.scene || 'provision') === scene);
    if (list.length === 0) return null;
    // 1. OS版本精确匹配
    const osMatch = list.find(t => t.osFilters.some(f => osName && f && osName.includes(f)));
    if (osMatch) return osMatch;
    // 2. 产品ID匹配
    if (productId) {
      const prodMatch = list.find(t => t.productIds.includes(productId));
      if (prodMatch) return prodMatch;
    }
    // 3. 默认模板
    const defaultTmpl = list.find(t => t.isDefault);
    if (defaultTmpl) return defaultTmpl;
    // 4. 兜底：无 OS 过滤且无产品ID 限制的通用模板（续费场景常配单一通用模板）
    return list.find(t => t.osFilters.length === 0 && t.productIds.length === 0) || null;
  }, []);

  // 替换话术变量
  const renderTemplate = useCallback((tmpl: Template, vars: Record<string, string>): string => {
    let text = tmpl.content;
    for (const [key, val] of Object.entries(vars)) {
      const strVal = val == null ? '' : (typeof val === 'string' ? val : String(val));
      text = text.replaceAll(`{{${key}}}`, strVal.replace(/[\r\n]+/g, ''));
    }
    return text;
  }, []);

  // 获取当前选择的OS名称
  const getCurrentOsName = useCallback((): string => {
    const osOpt = configOptions.find(o => o.option_type === 5);
    if (!osOpt || typeof osOpt.child !== 'object' || Array.isArray(osOpt.child)) return '';
    const osCatKey = `os_cat_${osOpt.id}`;
    const catName = configValues[osCatKey] || '';
    const osCategories = osOpt.child as Record<string, { system?: string; child: Array<{ id: number; version?: string; option_name?: string }> }>;
    const cat = osCategories[catName];
    const val = configValues[String(osOpt.id)];
    const osItem = val && cat?.child?.find(c => String(c.id) === val);
    const osVersion = osItem && typeof osItem === 'object' ? (osItem.version || osItem.option_name || '') : '';
    return osVersion ? `${cat?.system || catName} - ${osVersion}` : (cat?.system || catName || '');
  }, [configOptions, configValues]);

  // ===== 凭证持久化（使用 src/lib/auth-client.ts 共享工具）=====

  // ===== 套餐持久化 =====
  // 从服务端加载套餐列表
  const fetchPackages = useCallback(async () => {
    try {
      const res = await fetch('/api/packages');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedPackages(json.data as PackageConfig[]);
      }
    } catch { /* ignore */ }
  }, []);

  // 页面加载时从服务端恢复套餐列表，并确保周期默认为月付
  useEffect(() => {
    fetchPackages();
    // 强制重置为月付，防止HMR或浏览器缓存保留年付状态
    setSelectedBillingCycle('monthly');
    setSelectedPackageId('');
  }, [fetchPackages]);

  // 保存当前配置为套餐
  const handleSavePackage = async () => {
    if (!packageNameInput.trim()) {
      showNotification('error', '请输入套餐名称');
      return;
    }
    if (!selectedProductId) {
      showNotification('error', '请先选择产品');
      return;
    }
    // 找到产品名称
    let productName = '';
    for (const fg of productGroups) {
      for (const sg of fg.groups || []) {
        const found = (sg.products || []).find(p => p.id === selectedProductId);
        if (found) { productName = found.name; break; }
      }
      if (productName) break;
    }
    const cycleLabel = productCycles.find(c => c.value === selectedBillingCycle)?.label || selectedBillingCycle;
    const pkg: PackageConfig = {
      id: `pkg_${Date.now()}`,
      name: packageNameInput.trim(),
      productId: selectedProductId,
      productName,
      billingCycle: selectedBillingCycle,
      billingCycleLabel: cycleLabel,
      configValues: { ...configValues },
      customFieldValues: { ...customFieldValues },
      productQty,
      firstPrice,
      renewPrice,
      gateway: selectedGateway,
      useCredit,
      autoRecharge,
      createdAt: Date.now(),
    };
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', pkg }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedPackages(json.data as PackageConfig[]);
      }
    } catch { /* fallback */ }
    setPackageNameInput('');
    setShowSaveDialog(false);
    showNotification('success', `套餐「${pkg.name}」已保存`);
  };

  // 删除套餐
  const handleDeletePackage = async (pkgId: string) => {
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: pkgId }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedPackages(json.data as PackageConfig[]);
      }
    } catch { /* fallback */ }
    if (selectedPackageId === pkgId) setSelectedPackageId('');
    showNotification('info', '套餐已删除');
  };

  // 编辑套餐
  const openEditPackageDialog = async (pkgId: string) => {
    const pkg = savedPackages.find(p => p.id === pkgId);
    if (!pkg) return;
    setEditingPackage({ ...pkg, configValues: { ...pkg.configValues }, customFieldValues: { ...pkg.customFieldValues } });
    setShowEditPackageDialog(true);
    // 加载该产品的配置选项，用于显示名称
    if (pkg.productId && pkg.billingCycle) {
      setIsLoadingEditConfig(true);
      try {
        const res = await callIdcApi('getProductConfig', { pid: pkg.productId, billingcycle: pkg.billingCycle });
        if (res && Array.isArray(res.option)) {
          setEditConfigOptions(res.option);
        } else {
          setEditConfigOptions([]);
        }
      } catch {
        setEditConfigOptions([]);
      } finally {
        setIsLoadingEditConfig(false);
      }
    } else {
      setEditConfigOptions([]);
    }
  };

  const saveEditPackage = async () => {
    if (!editingPackage) return;
    if (!editingPackage.name.trim()) {
      showNotification('error', '套餐名称不能为空');
      return;
    }
    try {
      const res = await fetch('/api/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', pkg: editingPackage }),
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedPackages(json.data as PackageConfig[]);
      }
    } catch { /* fallback */ }
    setShowEditPackageDialog(false);
    setEditingPackage(null);
    showNotification('success', `套餐「${editingPackage.name}」已更新`);
  };

  // 选择套餐 - 加载套餐配置到表单
  const handleSelectPackage = async (pkgId: string) => {
    const pkg = savedPackages.find(p => p.id === pkgId);
    if (!pkg) return;
    setSelectedPackageId(pkgId);

    const isSameProduct = pkg.productId === selectedProductId;

    // 选择产品（跨产品切换时重新加载configOptions，OS会随之重新初始化）
    if (!isSameProduct) {
      await handleSelectProduct(pkg.productId);
    }

    // 同产品内切换套餐时，保留用户当前已选择的操作系统选项
    // 仅跨产品切换时才使用套餐自身的OS默认值
    const mergedConfigValues = isSameProduct
      ? mergeCurrentOsValues(pkg.configValues, configValues)
      : pkg.configValues;

    // 直接应用套餐值（handleSelectProduct完成后config已加载，React会批处理state更新）
    setSelectedBillingCycle(pkg.billingCycle);
    setConfigValues(mergedConfigValues);
    setCustomFieldValues(pkg.customFieldValues);
    setProductQty(pkg.productQty);
    setFirstPrice(pkg.firstPrice);
    setRenewPrice(pkg.renewPrice);
    if (pkg.gateway) setSelectedGateway(pkg.gateway);
    setUseCredit(pkg.useCredit);
    setAutoRecharge(pkg.autoRecharge ?? true);
    showNotification('success', `已加载套餐「${pkg.name}」配置`);
  };

  // ===== 页面加载时从 localStorage 恢复凭证 =====
  useEffect(() => {
    const saved = loadAuth();
    if (!saved || !saved.token || !saved.cookie) {
      // localStorage 无凭证（可能被清除），跳转登录页
      window.location.href = '/login?reason=session_expired';
      return;
    }
    setAuthToken(saved.token);
    setSessionCookie(saved.cookie);
    setAdminUsername(saved.username);
    if (saved.password) setAdminPassword(saved.password);
  }, []);

  // 自动重新登录（session过期时）
  const autoRelogin = useCallback(async (): Promise<boolean> => {
    const saved = loadAuth();
    if (!saved || !saved.username || !saved.password) return false;
    try {
      // 获取新session
      const testResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      const testData = await testResp.json();
      if (testData.captchaEnabled) return false; // 需要验证码，无法自动登录
      let newCookie = testData.cookie || '';
      // 自动登录
      const loginResp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: saved.username,
          password: saved.password,
          cookie: newCookie,
        }),
      });
      const loginData = await loginResp.json();
      if (loginData.success) {
        const token = loginData.token || 'authenticated';
        const cookie = loginData.cookie || '';
        setAuthToken(token);
        setSessionCookie(cookie || null);
        saveAuth({ token, cookie, username: saved.username, password: saved.password });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 调用IDC后台API的统一方法（带自动重登）— 用useCallback保持引用稳定
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callIdcApi = useCallback(async (action: string, params: Record<string, unknown> = {}, retry = true): Promise<any> => {
    // 每次调用时读取最新的cookie（避免闭包捕获旧值）
    const currentAuth = loadAuth();
    const currentCookie = sessionCookie || currentAuth?.cookie || '';
    const currentToken = currentAuth?.token || authToken;
    // 不再发送url参数，后端从httpOnly cookie读取
    const response = await fetch('/api/idc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token: currentToken, cookie: currentCookie, ...params }),
    });
    const data = await response.json() as Record<string, unknown>;
    // 如果返回未登录，尝试自动重新登录
    if (retry && (data.status === 401 || data.msg === '请先登录' || data.msg === '未登录' || data.msg === '您还没有登录' || (data.success === false && typeof data.message === 'string' && data.message.includes('非JSON')))) {
      const relogined = await autoRelogin();
      if (relogined) {
        // 重登成功后，从localStorage获取最新cookie重新请求
        const freshAuth = loadAuth();
        const freshCookie = freshAuth?.cookie || '';
        const freshToken = freshAuth?.token || currentToken;
        const retryResp = await fetch('/api/idc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, token: freshToken, cookie: freshCookie, ...params }),
        });
        return retryResp.json();
      }
      // 重登失败：凭证已过期，仅提示用户手动重新登录（不自动登出，避免多用户互相影响）
      showNotification('error', 'IDCSmart 后台登录已过期，请返回登录页重新登录');
      return { success: false, message: '登录已过期，请重新登录' };
    }
    return data;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 调用魔方云API的统一方法（参考 advanced/page.tsx，支持多账号映射）
  const callMfyApi = useCallback(async (action: string, params: Record<string, unknown> = {}): Promise<any> => {
    const loginUser = String(selectedUser?.username || '');
    const response = await fetch('/api/mfy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, _loginUser: loginUser, ...params }),
    });
    return response.json();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser?.username]);

  // ===== 产品续费 =====

  // ===== 用户产品管理 =====
  const fetchUserProducts = useCallback(async (uid: number) => {
    setIsLoadingUserProducts(true);
    try {
      // 调用 GET /admin/host/list?uid=X 获取用户产品列表
      const res = await callIdcApi('getServiceInfo', { uid });
      if (res && (res.status === 200 || res.status === 1 || res.msg === '请求成功')) {
        const rawData = res.data;
        let list: typeof userProducts = [];
        // /admin/host/list 返回 data.list 数组（分页格式）
        if (rawData && Array.isArray(rawData.list)) {
          list = rawData.list;
        } else if (Array.isArray(rawData)) {
          list = rawData;
        } else if (rawData && Array.isArray(rawData.host_list)) {
          list = rawData.host_list;
        } else if (rawData && Array.isArray(rawData.data)) {
          list = rawData.data;
        }
        if (list.length > 0) {
        }

        setUserProducts(list);
      } else {
        setUserProducts([]);
      }
    } catch (err) {
      setUserProducts([]);
    } finally {
      setIsLoadingUserProducts(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRenewSelect = useCallback((id: number) => {
    setSelectedRenewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 批量导出相关状态（函数在 handleGetServiceDetail 之后定义）
  const [exportText, setExportText] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  const handleRenewSelected = useCallback(async (cycles: number = 1) => {
    const targetIds = directRenewId !== null ? new Set([directRenewId]) : selectedRenewIds;
    if (targetIds.size === 0 || !selectedUser) return;
    const renewCycles = Math.max(1, cycles);
    setIsRenewing(true);
    const steps: ProcessingStep[] = [];
    let successCount = 0;
    let failCount = 0;
    const renewedHostIds: number[] = [];

    for (const hostId of targetIds) {
      const product = userProducts.find((p: Record<string, unknown>) => p.id === hostId);
      const productName = String(product?.productname || product?.product_name || '产品');
      const isConvertToAnnually = renewAsAnnually.has(hostId);

      try {
        let billingCycle = String(product?.billingcycle || 'monthly');

        // 月付转年付：先修改续费价格和周期
        const annuallyPkg = isConvertToAnnually ? findMatchingPackage(product, 'annually') : null;
        if (isConvertToAnnually && billingCycle !== 'annually') {
          if (annuallyPkg) {
            const priceParams = {
              hostid: hostId,
              uid: selectedUser.id,
              amount: parseFloat(String(annuallyPkg.renewPrice)),
              billingcycle: 'annually',
              skipNextDueDate: 'true', // 转年付续费时跳过到期时间更新，由renewService自行处理
            };
            const priceRes = await callIdcApi('updateHostAmount', priceParams);
            if (!(priceRes && (priceRes.status === 200 || priceRes.success === true || priceRes.msg === '更改保存成功！'))) {
              failCount++;
              steps.push({ id: `${hostId}-convert`, name: `转年付 ${productName}`, description: `ID: ${hostId}`, status: 'failed', message: `转年付失败: ${priceRes?.msg || '未知错误'}` });
              setProcessingSteps([...steps]);
              continue;
            }
            billingCycle = 'annually';
          } else {
            failCount++;
            steps.push({ id: `${hostId}-convert`, name: `转年付 ${productName}`, description: `ID: ${hostId}`, status: 'failed', message: '未找到对应年付套餐' });
            setProcessingSteps([...steps]);
            continue;
          }
        }

        // 获取续费单价：如果是转年付，用年付套餐价格；否则用产品当前价格
        const renewAmount = isConvertToAnnually
          ? (annuallyPkg?.renewPrice || product?.amount || '0')
          : (product?.amount || '0');
        const perCycleAmount = parseFloat(String(renewAmount).replace(/[^\d.]/g, '')) || 0;

        let renewFailed = false;

        // 逐周期续费：每次续费 → 充值 → 支付完成即可进行下一周期
        for (let i = 0; i < renewCycles; i++) {
          const stepId = renewCycles > 1 ? `${hostId}-cycle-${i}` : hostId;
          const cycleLabel = renewCycles > 1 ? ` 第${i + 1}/${renewCycles}次` : '';
          steps.push({ id: stepId, name: `续费 ${productName}${isConvertToAnnually ? '(转年付)' : ''}${cycleLabel}`, description: `ID: ${hostId}`, status: 'processing' });
          setProcessingSteps([...steps]);

          try {
            // 1. 调用续费API（生成账单）
            const renewRes = await callIdcApi('renewService', { hostid: hostId, billingcycles: billingCycle });
            if (!(renewRes && renewRes.status === 200)) {
              renewFailed = true;
              failCount++;
              steps[steps.length - 1].status = 'failed';
              steps[steps.length - 1].message = `续费失败: ${renewRes?.msg || '未知错误'}`;
              setProcessingSteps([...steps]);
              break;
            }

            const invId = renewRes.data?.invoice_id || renewRes.data?.invoiceid || renewRes.data?.id;
            const invIdStr = invId ? String(invId) : '';

            // 2. 充值余额（单周期金额）
            if (perCycleAmount > 0) {
              steps[steps.length - 1].message = invIdStr ? `账单ID: ${invIdStr}，充值余额中...` : '充值余额中...';
              setProcessingSteps([...steps]);
              try {
                await callIdcApi('addBalance', {
                  uid: selectedUser.id,
                  amount: perCycleAmount,
                  type: 'recharge',
                  description: `${isConvertToAnnually ? '年付' : ''}续费充值(第${i + 1}周期) - ${productName}`
                });
              } catch (e) {
                console.warn('续费充值余额失败:', e);
              }
            }

            // 3. 余额支付账单
            if (invIdStr) {
              steps[steps.length - 1].message = `账单ID: ${invIdStr}，支付中...`;
              setProcessingSteps([...steps]);
              try {
                await callIdcApi('invoicePaid', { invoiceid: invId, uid: selectedUser.id });
              } catch (e) {
                console.warn('使用余额支付账单失败:', e);
              }
            }

            // 支付完成即视为本周期续费成功
            steps[steps.length - 1].status = 'completed';
            steps[steps.length - 1].message = invIdStr ? `账单ID: ${invIdStr}` : '续费成功';
          } catch (err) {
            renewFailed = true;
            failCount++;
            steps[steps.length - 1].status = 'failed';
            steps[steps.length - 1].message = String(err instanceof Error ? err.message : '请求异常');
            setProcessingSteps([...steps]);
            break;
          }
          setProcessingSteps([...steps]);
        }
        if (renewFailed) continue;

        successCount++;
        renewedHostIds.push(hostId);
      } catch (err) {
        failCount++;
        steps[steps.length - 1].status = 'failed';
        steps[steps.length - 1].message = String(err instanceof Error ? err.message : '请求异常');
      }
      setProcessingSteps([...steps]);
    }

    // 拉取最新产品列表，提取续费成功产品的 IP、到期时间、金额、周期
    let renewSuccessItems: {
      hostId: number; ip: string; nextduedate: string;
      productName: string; amount: string; billingcycle: string;
    }[] = [];
    if (renewedHostIds.length > 0 && selectedUser) {
      try {
        const latestRes = await callIdcApi('getServiceInfo', { uid: selectedUser.id });
        const rawData = latestRes?.data;
        let list: typeof userProducts = [];
        if (rawData && Array.isArray(rawData.list)) list = rawData.list;
        else if (Array.isArray(rawData)) list = rawData;
        else if (rawData && Array.isArray(rawData.host_list)) list = rawData.host_list;
        else if (rawData && Array.isArray(rawData.data)) list = rawData.data;

        renewSuccessItems = renewedHostIds.map(hid => {
          const p = list.find((it: Record<string, unknown>) => it.id === hid);
          const rawCycle = String(p?.billingcycle || '');
          return {
            hostId: hid,
            ip: String(p?.dedicatedip || p?.ip || '-'),
            nextduedate: formatDueDate(p?.nextduedate as string | number | undefined),
            productName: String(p?.productname || p?.product_name || '产品'),
            amount: String(p?.amount || '0'),
            billingcycle: CYCLE_MAP[rawCycle] || rawCycle,
          };
        }).filter(it => it.ip !== '-' || it.nextduedate !== '-');
      } catch {
        // 拉取失败不影响主流程，notification 已展示
      }
    }

    setIsRenewing(false);
    if (failCount === 0) {
      showNotification('success', `全部 ${successCount} 个产品管理成功`);
    } else {
      showNotification('info', `${successCount} 个成功，${failCount} 个失败`);
    }
    if (selectedUser) fetchUserProducts(selectedUser.id);
    setSelectedRenewIds(new Set());
    setRenewAsAnnually(new Set());
    setRenewCycles(1);
    setDirectRenewId(null);

    // 仿开通模式：续费完成立即清空进度弹窗，直接显示话术弹窗
    setProcessingSteps([]);
    setProgress(0);
    if (renewSuccessItems.length > 0) {
      setRenewResultData(renewSuccessItems);
      setShowRenewResult(true);
    }
  }, [directRenewId, selectedRenewIds, selectedUser, userProducts, renewAsAnnually, callIdcApi, showNotification, fetchUserProducts, findMatchingPackage]);

  // ===== 升级套餐 =====
  // 打开升级对话框
  const openUpgradeDialog = useCallback(async (svc: Record<string, unknown>) => {
    setUpgradeProduct(svc);
    setUpgradeDialogOpen(true);
    setUpgradeLoading(true);
    setCurrentPackageId(null);
    setTargetPackageId(null);
    setUpgradeConfigOptions([]);
    setUpgradePackages([]);
    setUpgradeCurrentConfig({});

    try {
      const pid = svc.productid as number;
      const uid = (svc.uid as number) || (selectedUser?.id) || 0;
      const hostid = svc.id as number;
      // billingcycle 可能是对象 {name, billingcycle, billingcycle_zh}
      const bcRaw = svc.billingcycle;
      const billingcycle = typeof bcRaw === 'object' && bcRaw !== null
        ? String((bcRaw as Record<string, unknown>).billingcycle || 'monthly')
        : String(bcRaw || 'monthly');

      // 1. 获取产品配置选项
      const configRes = await callIdcApi('getProductConfig', {
        pid: Number(pid),
        billingcycle,
        hostid: Number(hostid),
      });

      if (configRes && (configRes.status === 200 || configRes.status === 1 || configRes.msg === '请求成功')) {
        const optArr = configRes.option || configRes.configoptions || [];
        const rawOpts = Array.isArray(optArr) ? optArr : [];
        const parsedOpts = rawOpts.map((opt: Record<string, unknown>) => {
          const o = opt;
          const childArr = Array.isArray(o.child || o.subs || o.items)
            ? (o.child || o.subs || o.items) as Array<Record<string, unknown>>
            : [];
          return {
            id: Number(o.id || 0),
            option_name: String(o.option_name || o.name || ''),
            option_type: Number(o.option_type || o.optiontype || 1),
            child: childArr.map(c => ({
              id: Number(c.id || 0),
              option_name: String(c.option_name || c.name || ''),
              ...c,
            })),
          };
        });
        setUpgradeConfigOptions(parsedOpts);
      }

      // 1.5 获取当前产品完整详情（含host_option_config，包含OS等所有配置项的当前值）
      try {
        const detailRes = await callIdcApi('getServiceDetail', {
          hostid: Number(hostid),
          uid: Number(uid),
        });
        if (detailRes.success && Array.isArray(detailRes.host_option_config)) {
          const currentConfig: Record<string, string> = {};
          for (const opt of detailRes.host_option_config as Array<Record<string, unknown>>) {
            const configId = String(opt.configid || '');
            const optionId = String(opt.optionid || '');
            const qty = Number(opt.qty || 0);
            if (!configId) continue;
            if (qty > 0) {
              currentConfig[configId] = String(qty);
            } else if (optionId) {
              currentConfig[configId] = optionId;
            }
          }
          setUpgradeCurrentConfig(currentConfig);
        }
      } catch {
        // 获取详情失败不影响主流程
      }

      // 2. 获取套餐列表（所有周期）
      const pkgRes = await fetch('/api/packages?productId=' + pid);
      const pkgData = await pkgRes.json();
      const allPackages: PackageConfig[] = pkgData.data || pkgData.packages || [];

      // 过滤同产品的所有套餐（不过滤周期）
      const matchedPkgs = allPackages.filter((p: PackageConfig) => p.productId === Number(pid));
      setUpgradePackages(matchedPkgs);

      // 设置默认周期为当前产品的周期
      setUpgradeBillingCycle(billingcycle === 'annually' ? 'annually' : 'monthly');

      // 3. 匹配当前套餐（产品名+价格）
      const productName = String(svc.productname || svc.product_name || '');
      const amountStr = String(svc.amount || '0');
      const productAmount = parseFloat(amountStr.replace(/[^\d.]/g, '')) || 0;
      let matchedId: string | null = null;
      for (const pkg of matchedPkgs) {
        const nameMatch = pkg.productName === productName;
        const pkgPrice = parseFloat(String(pkg.renewPrice || pkg.firstPrice || '0')) || 0;
        const priceMatch = pkgPrice === productAmount;
        if (nameMatch && priceMatch) {
          matchedId = pkg.id;
          break;
        }
      }
      setCurrentPackageId(matchedId);
    } catch (err) {
      showNotification('error', `获取升级信息失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpgradeLoading(false);
    }
  }, [callIdcApi, selectedUser, showNotification]);

  // 提交套餐升级
  const submitUpgrade = useCallback(async () => {
    if (!upgradeProduct || !targetPackageId) return;
    const targetPkg = upgradePackages.find(p => p.id === targetPackageId);
    if (!targetPkg) return;

    setUpgradeSubmitting(true);
    try {
      const hostid = Number(upgradeProduct.id);
      const uid = Number(upgradeProduct.uid || selectedUser?.id || 0);

      // 构建配置变更参数（提交所有配置项，OS用当前值避免被清空）
      const osOptionIds = new Set<string>();
      for (const key of Object.keys(targetPkg.configValues)) {
        if (key.startsWith('os_cat_')) {
          osOptionIds.add(key.replace('os_cat_', ''));
        }
      }
      for (const opt of upgradeConfigOptions) {
        if (opt.option_type === 5) {
          osOptionIds.add(String(opt.id));
        }
      }

      const configoption: Record<string, string | number> = {};

      // 提交所有配置项（魔方云upgrade_config会清空未提交的配置项）
      for (const [key, value] of Object.entries(targetPkg.configValues)) {
        if (key.startsWith('os_cat_')) continue;
        if (key.startsWith('qty_')) {
          const optId = key.replace('qty_', '');
          configoption[optId] = parseInt(String(value), 10) || 0;
          continue;
        }
        // OS配置项用当前值覆盖，确保不被修改
        if (osOptionIds.has(key) && upgradeCurrentConfig[key] !== undefined) {
          configoption[key] = upgradeCurrentConfig[key];
          continue;
        }
        configoption[key] = value;
      }

      if (Object.keys(configoption).length === 0) {
        showNotification('error', '配置没有变化，无需升级');
        setUpgradeSubmitting(false);
        return;
      }

      // Step 1: 修改配置项
      const upgradeParams: Record<string, unknown> = {
        hid: hostid,
        configoption,
      };

      const res = await callIdcApi('adminUpgradeConfig', upgradeParams);

      if (!res || !(res.status === 200 || res.status === 1 || res.msg === '请求成功' || res.success === true)) {
        showNotification('error', `套餐升级失败: ${res?.msg || '未知错误'}`);
        return;
      }

      // Step 2: 更新续费价格和计费周期
      try {
        const newPrice = targetPkg.renewPrice;
        const priceParams: Record<string, unknown> = {
          hostid: hostid,
          uid: uid,
          amount: parseFloat(String(newPrice)),
        };
        // 如果目标套餐周期和当前不同，也更新周期
        const currentBillingCycle = String(upgradeProduct.billingcycle || 'monthly');
        if (targetPkg.billingCycle !== currentBillingCycle) {
          priceParams.billingcycle = targetPkg.billingCycle;
        }
        const priceRes = await callIdcApi('updateHostAmount', priceParams);

        if (priceRes && (priceRes.status === 200 || priceRes.success === true || priceRes.msg === '更改保存成功！')) {
        } else {
          console.warn('[升级套餐-更新价格] 可能失败:', priceRes);
        }
      } catch (priceErr) {
        console.warn('[升级套餐-更新价格] 异常:', priceErr);
      }

      // Step 3: 升级成功后拉取信息，同步财务侧配置
      try {
        showNotification('success', `套餐升级成功！已升级到「${targetPkg.name}」，正在拉取信息...`);
        const syncRes = await callIdcApi('provisionSync', { hostid });
        console.log('[拉取信息] 结果:', JSON.stringify(syncRes));
        if (syncRes && (syncRes.status === 200 || syncRes.status === 1 || syncRes.msg === '请求成功' || syncRes.success === true)) {
          showNotification('success', `套餐升级成功！已升级到「${targetPkg.name}」，信息同步完成`);
        } else {
          showNotification('success', `套餐升级成功！已升级到「${targetPkg.name}」，拉取信息未确认，请手动拉取`);
        }
      } catch (syncErr) {
        console.warn('[拉取信息] 异常:', syncErr);
        showNotification('success', `套餐升级成功！已升级到「${targetPkg.name}」，拉取信息异常，请手动拉取`);
      }

      setUpgradeDialogOpen(false);
      setUpgradeProduct(null);
      setTargetPackageId(null);
      // 刷新产品列表
      if (selectedUser) fetchUserProducts(selectedUser.id);
    } catch (err) {
      showNotification('error', `套餐升级异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUpgradeSubmitting(false);
    }
  }, [upgradeProduct, targetPackageId, upgradePackages, upgradeConfigOptions, upgradeCurrentConfig, callIdcApi, selectedUser, showNotification, fetchUserProducts]);

  // ===== 套餐修改 =====
  const openModifyDialog = useCallback(async (product: Record<string, unknown>) => {
    setModifyProduct(product);
    setModifyDialogOpen(true);
    setModifyLoading(true);
    setModifyConfigOptions([]);
    setModifyCurrentValues({});
    setModifySelectedValues({});
    setModifyCurrentAmount('');
    setModifyNewAmount('');

    try {
      const hostid = Number(product.id || product.hostid);
      const uid = Number(product.uid || selectedUser?.id);

      // 获取产品详情（当前配置值 + 所有可选配置项）
      const detail = await callIdcApi('getServiceDetail', { uid, hostid });

      // 获取当前续费价格
      const currentAmount = String(detail?.data?.amount || product.amount || '');
      setModifyCurrentAmount(currentAmount);
      setModifyNewAmount(currentAmount);

      // 解析 host_option_config（当前选中值）: [{configid, optionid, qty}, ...]
      const hostOptionConfigArr: Array<Record<string, unknown>> = Array.isArray(detail?.host_option_config) ? detail.host_option_config : [];
      const currentVals: Record<string, string> = {};
      const currentQtyVals: Record<string, number> = {};
      for (const item of hostOptionConfigArr) {
        const configId = String(item.configid || '');
        const optionId = String(item.optionid || '');
        if (configId && optionId) {
          currentVals[configId] = optionId;
        }
        if (configId && item.qty !== undefined && item.qty !== null) {
          currentQtyVals[configId] = Number(item.qty);
        }
      }

      // 解析 config_array（所有可选配置项及其子选项）
      const configArray: Array<Record<string, unknown>> = Array.isArray(detail?.config_array) ? detail.config_array : [];
      const options = configArray.map((opt) => {
        const subArr = Array.isArray(opt.sub) ? opt.sub as Array<Record<string, unknown>> : [];
        return {
          id: Number(opt.id || 0),
          option_name: String(opt.option_name || ''),
          option_type: Number(opt.option_type || 1),
          unit: String(opt.unit || ''),
          hidden: Number(opt.hidden || 0),
          qty_minimum: opt.qty_minimum !== undefined ? Number(opt.qty_minimum) : undefined,
          qty_maximum: opt.qty_maximum !== undefined ? Number(opt.qty_maximum) : undefined,
          child: subArr.map(s => ({
            id: Number(s.id || 0),
            option_name: String(s.option_name || ''),
            ...s,
          })),
        };
      });

      // 只显示需要的配置项：CPU核心数、内存、数据盘、带宽、网络类型、IP数量
      const ALLOWED_CONFIG_KEYWORDS = ['CPU', 'cpu', '核心', '内存', '数据盘', '带宽', '网络类型', 'IP数量', 'ip数量', 'Ip数量', 'IP数'];
      const filteredOptions = options.filter(opt =>
        opt.hidden !== 1 &&
        ALLOWED_CONFIG_KEYWORDS.some(kw => opt.option_name.includes(kw))
      );

      setModifyConfigOptions(filteredOptions);
      setModifyCurrentValues(currentVals);
      setModifyCurrentQtyValues(currentQtyVals);
      setModifySelectedValues({ ...currentVals });
    } catch (err) {
      showNotification('error', `加载配置失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setModifyLoading(false);
    }
  }, [selectedUser, callIdcApi, showNotification]);

  const submitModify = useCallback(async () => {
    if (!modifyProduct) return;
    setModifySubmitting(true);

    try {
      const hostid = Number(modifyProduct.id || modifyProduct.hostid);
      const uid = Number(modifyProduct.uid || selectedUser?.id);

      // 1. 修改配置项：提交所有配置项（当前值+修改值），避免adminUpgradeConfig清空未提交的配置项
      // 数量型配置（qty>0）提交qty值，非数量型配置提交optionid
      // 与appendConfigOptions的判断逻辑一致：qty>0则为数量型
      const configoption: Record<string, number> = {};

      // 判断是否是数量型配置：当前qty>0说明是数量型配置
      const isQtyType = (optId: string): boolean => {
        const curQty = modifyCurrentQtyValues[optId];
        return curQty !== undefined && curQty > 0;
      };

      // 先提交所有当前值
      for (const [optId, subId] of Object.entries(modifyCurrentValues)) {
        if (isQtyType(optId)) {
          // 数量型配置：提交qty值
          const curQty = modifyCurrentQtyValues[optId];
          if (curQty !== undefined) configoption[optId] = Number(curQty);
        } else {
          configoption[optId] = Number(subId);
        }
      }
      // 再用用户修改的值覆盖
      for (const [optId, subId] of Object.entries(modifySelectedValues)) {
        if (isQtyType(optId)) {
          // 数量型配置：用selectedQtyValues的值（即使为0也提交0）
          const selQty = modifySelectedQtyValues[optId];
          if (selQty !== undefined) {
            configoption[optId] = Number(selQty);
          } else {
            configoption[optId] = Number(modifyCurrentQtyValues[optId] ?? 0);
          }
        } else {
          configoption[optId] = Number(subId);
        }
      }

      if (Object.keys(configoption).length > 0) {
        const res = await callIdcApi('adminUpgradeConfig', { hid: hostid, configoption });
        if (!res || !(res.status === 200 || res.status === 1 || res.msg === '请求成功' || res.success === true)) {
          showNotification('error', `修改配置失败: ${res?.msg || '未知错误'}`);
          return;
        }
      }

      // 2. 修改续费价格（如金额有变化）
      const newPrice = Number(modifyNewAmount);
      const currentPrice = Number(modifyCurrentAmount);
      if (modifyNewAmount && !isNaN(newPrice) && Math.abs(newPrice - currentPrice) >= 0.01) {
        const priceRes = await callIdcApi('updateHostAmount', {
          hostid,
          uid,
          amount: newPrice,
        });
        if (!priceRes?.success) {
          showNotification('error', `修改价格失败: ${priceRes?.msg || '未知错误'}`);
          return;
        }
      }

      if (Object.keys(configoption).length === 0 && !(modifyNewAmount && !isNaN(newPrice) && Math.abs(newPrice - currentPrice) >= 0.01)) {
        showNotification('error', '配置和价格都没有变化');
        setModifySubmitting(false);
        return;
      }

      showNotification('success', '套餐修改成功！');
      setModifyDialogOpen(false);
      setModifyProduct(null);
      if (selectedUser) fetchUserProducts(selectedUser.id);
    } catch (err) {
      showNotification('error', `修改配置异常: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setModifySubmitting(false);
    }
  }, [modifyProduct, modifySelectedValues, modifyCurrentValues, modifySelectedQtyValues, modifyCurrentQtyValues, modifyNewAmount, modifyCurrentAmount, callIdcApi, selectedUser, showNotification, fetchUserProducts]);


  // 计算退款金额（月付按自然月，其他周期按天数比例）
  const calculateRefundAmount = useCallback((product: Record<string, unknown>): { refundAmount: number; remainingDays: number; dailyRate: number; periodDays: number; periodType: string; currentPeriodStart: Date; expireDate: Date; orderDate: Date } | null => {
    // 从产品信息获取必要数据
    const nextduedate = product.nextduedate as number | undefined;
    const regdate = product.regdate as number | undefined; // 订购时间（秒级时间戳）
    const amountStr = String(product.amount || product.firstpaymentamount || '0');
    const amountMatch = amountStr.match(/([\d.]+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    const billingcycle = String(product.billingcycle || 'monthly');

    if (!nextduedate || !amount || amount <= 0) return null;

    const now = new Date();
    const expireDate = new Date(nextduedate * 1000);
    const orderDate = regdate ? new Date(regdate * 1000) : now;
    // 截断到日期级别（去掉时分秒），避免日期比较时精度问题
    const expireDateOnly = new Date(expireDate.getFullYear(), expireDate.getMonth(), expireDate.getDate());
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    let periodType: string;
    if (['annually', 'biennially'].includes(billingcycle)) {
      periodType = billingcycle === 'biennially' ? '两年付' : '年付';
    } else if (billingcycle === 'quarterly') {
      periodType = '季付';
    } else if (billingcycle === 'semiannually') {
      periodType = '半年付';
    } else {
      periodType = '月付';
    }

    // 剩余天数：从现在到到期日
    const remainingDays = Math.max(0, Math.ceil((expireDateOnly.getTime() - nowDateOnly.getTime()) / (1000 * 60 * 60 * 24)));
    if (remainingDays <= 0) return null;

    let refundAmount = 0;
    let periodDays = 0;
    let dailyRate = 0;

    // 当前周期起始时间（用于显示）：从订购日推算最近一个周期起始
    let currentPeriodStart: Date;

    if (billingcycle === 'monthly') {
      // 月付退款计算：按自然月逐月计算
      // 从订购日开始，每个自然月 = 月付金额
      // 计算从 now 到 expireDate 之间有多少完整计费月 + 当月部分天数退款

      // 1. 从订购日推算当前周期起始日
      // 从订购日开始，每次加1个月，找到 <= now 的最后一个周期起始
      currentPeriodStart = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
      while (true) {
        const nextStart = new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, currentPeriodStart.getDate());
        if (nextStart.getTime() > nowDateOnly.getTime()) break;
        currentPeriodStart = nextStart;
      }

      // 2. 计算完整月数：从当前周期的下一个周期开始，只有完整结束的月才算
      let fullMonths = 0;
      let tempStart = new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, currentPeriodStart.getDate());
      while (tempStart.getTime() < expireDateOnly.getTime()) {
        fullMonths++;
        tempStart = new Date(tempStart.getFullYear(), tempStart.getMonth() + 1, tempStart.getDate());
      }

      // 3. 当前周期剩余天数：从 now 到当前周期结束日
      const currentPeriodEndDate = new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, currentPeriodStart.getDate());
      const remainingDaysInCurrentPeriod = Math.max(0, Math.round((currentPeriodEndDate.getTime() - nowDateOnly.getTime()) / (1000 * 60 * 60 * 24)));

      // 4. 当前周期所在自然月的天数
      const daysInCurrentMonth = new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() + 1, 0).getDate();

      // 5. 日均价格 = 月付金额 / 当前周期所在月的天数
      dailyRate = amount / daysInCurrentMonth;

      // 6. 退款 = 完整月数 × 月付金额 + 当前周期剩余天数 × 日均价格
      refundAmount = fullMonths * amount + remainingDaysInCurrentPeriod * dailyRate;

      // 7. periodDays 用于显示当前月天数
      periodDays = daysInCurrentMonth;
    } else {
      // 非月付：按总天数比例计算
      periodDays = billingcycle === 'biennially' ? 730 : billingcycle === 'annually' ? 365 : billingcycle === 'quarterly' ? 90 : 180;
      currentPeriodStart = new Date(expireDate.getTime() - periodDays * 24 * 60 * 60 * 1000);
      refundAmount = (remainingDays / periodDays) * amount;
      dailyRate = periodDays > 0 ? amount / periodDays : 0;
    }

    refundAmount = Math.floor(refundAmount * 100) / 100; // 向下取整到分，避免多退

    return { refundAmount, remainingDays, dailyRate, periodType, periodDays, currentPeriodStart, expireDate, orderDate };
  }, []);

  // ===== 回收站检查 + 恢复 + 续费 =====
  const [recycleCheckState, setRecycleCheckState] = useState<{
    open: boolean;
    loading: boolean;
    svc: Record<string, unknown> | null;
    matches: Array<Record<string, unknown>>;
    selectedInstanceId: number | null;
    copiedInstField: string | null;
  }>({ open: false, loading: false, svc: null, matches: [], selectedInstanceId: null, copiedInstField: null });

  // 魔方云实例状态 → 中文
  const formatCloudStatus = (status: string): string => {
    return CLOUD_STATUS_MAP[status] || status;
  };

  // 弹窗内复制（带短暂勾选反馈 + timer 清理）
  const instCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyInstField = useCallback(async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setRecycleCheckState(prev => ({ ...prev, copiedInstField: field }));
      if (instCopyTimerRef.current) clearTimeout(instCopyTimerRef.current);
      instCopyTimerRef.current = setTimeout(() => setRecycleCheckState(prev => ({ ...prev, copiedInstField: null })), 1500);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => () => { if (instCopyTimerRef.current) clearTimeout(instCopyTimerRef.current); }, []);
  const [recycleSteps, setRecycleSteps] = useState<Array<{ id: string; name: string; status: 'processing' | 'completed' | 'failed'; message?: string }>>([]);
  const [isRecycleProcessing, setIsRecycleProcessing] = useState(false);

  // 竞态保护：连续点击多个产品的回收站检查时，只保留最后一次结果
  const recycleCheckReqIdRef = useRef(0);
  // 检查回收站：通过主机名查询魔方云回收站实例
  const handleRecycleCheck = useCallback(async (svc: Record<string, unknown>) => {
    if (isRecycleProcessing) return; // 处理中不允许新查询
    const hostname = String(svc.domain || svc.hostname || svc.host_name || '').trim();
    if (!hostname) {
      showNotification('error', '缺少主机名，无法检查回收站');
      return;
    }
    const reqId = ++recycleCheckReqIdRef.current;
    setRecycleCheckState({ open: true, loading: true, svc, matches: [], selectedInstanceId: null, copiedInstField: null });
    setRecycleSteps([]);
    try {
      // 第一步：用 hostname 参数让 API 服务端搜索（快速，一次请求）
      const res = await callMfyApi('cloudList', { status: ['recycle'], hostname, per_page: 200 });
      if (reqId !== recycleCheckReqIdRef.current) return;
      const outer = res?.data || res;
      const listRaw = (outer as Record<string, unknown>)?.data;
      const list: Array<Record<string, unknown>> = Array.isArray(listRaw) ? listRaw : (Array.isArray(outer) ? outer : []);
      let exact = list.filter((c) => String(c.hostname || '') === hostname);

      // 第二步：如果 hostname 搜索没有精确匹配，fallback 逐页全量查询直到找到
      if (exact.length === 0) {
        const perPage = 200;
        let page = 1;
        const maxPages = 50;
        while (page <= maxPages) {
          const res2 = await callMfyApi('cloudList', { status: ['recycle'], per_page: perPage, page });
          if (reqId !== recycleCheckReqIdRef.current) return;
          const outer2 = res2?.data || res2;
          const listRaw2 = (outer2 as Record<string, unknown>)?.data;
          const list2: Array<Record<string, unknown>> = Array.isArray(listRaw2) ? listRaw2 : (Array.isArray(outer2) ? outer2 : []);
          const matched = list2.filter((c) => String(c.hostname || '') === hostname);
          if (matched.length > 0) {
            exact = matched;
            break;
          }
          if (list2.length < perPage) break;
          const lp = Number((outer2 as Record<string, unknown>)?.last_page || 0);
          if (lp > 0 && page >= lp) break;
          page++;
        }
      }

      setRecycleCheckState({
        open: true,
        loading: false,
        svc,
        matches: exact,
        selectedInstanceId: exact[0]?.id != null ? Number(exact[0].id) : null,
        copiedInstField: null,
      });
    } catch (e) {
      if (reqId !== recycleCheckReqIdRef.current) return;
      setRecycleCheckState(prev => ({ ...prev, loading: false }));
      showNotification('error', '查询回收站失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  }, [callMfyApi, showNotification, isRecycleProcessing]);

  // 恢复实例 + 续费完整流程（4步顺序执行，失败即中断）
  const doRestoreAndRenew = useCallback(async (svc: Record<string, unknown>, instanceId: number) => {
    if (isRecycleProcessing) return; // 防重复提交
    const hostid = Number(svc.id);
    const uid = Number(svc.uid || selectedUser?.id || 0);
    const productName = String(svc.productname || svc.product_name || svc.name || '产品');
    const billingcycle = String(svc.billingcycle || 'monthly');
    const amount = parseFloat(String(svc.amount || svc.firstpaymentamount || '0').replace(/[^\d.]/g, '')) || 0;
    const steps: typeof recycleSteps = [];
    const pushStep = (name: string) => {
      steps.push({ id: String(steps.length), name, status: 'processing' });
      setRecycleSteps([...steps]);
      return steps.length - 1;
    };
    const updStep = (i: number, status: 'completed' | 'failed', message?: string) => {
      steps[i].status = status;
      if (message) steps[i].message = message;
      setRecycleSteps([...steps]);
    };

    setIsRecycleProcessing(true);
    setRecycleCheckState(prev => ({ ...prev, open: false }));
    try {
      // 1. 魔方云恢复回收站实例
      const i1 = pushStep(`恢复魔方云实例 (ID:${instanceId})`);
      const restoreRes = await callMfyApi('restoreRecycleBin', { id: [instanceId] });
      if (!restoreRes?.success) {
        updStep(i1, 'failed', String(restoreRes?.msg || restoreRes?.message || '恢复失败'));
        showNotification('error', '魔方云实例恢复失败');
        return;
      }
      updStep(i1, 'completed');

      // 2. 财务保存：domainstatus=Active, dcimid=实例ID
      const i2 = pushStep('更新财务产品状态 (Active) + dcimid');
      const saveRes = await callIdcApi('saveServiceInfo', {
        hostid,
        uid,
        updateFields: { domainstatus: 'Active', dcimid: String(instanceId) },
      });
      if (!saveRes?.success) {
        updStep(i2, 'failed', String(saveRes?.message || saveRes?.msg || '保存失败'));
        showNotification('error', '财务产品状态更新失败');
        return;
      }
      updStep(i2, 'completed');

      // 3. 续费1周期（renewService → addBalance → invoicePaid）
      const i3 = pushStep(`续费 ${productName} (${billingcycle})`);
      const renewRes = await callIdcApi('renewService', { hostid, billingcycles: billingcycle });
      if (!(renewRes?.status === 200)) {
        updStep(i3, 'failed', String(renewRes?.msg || '续费失败'));
        showNotification('error', '续费失败');
        return;
      }
      const invId = renewRes.data?.invoice_id || renewRes.data?.invoiceid || renewRes.data?.id;
      const invIdStr = invId ? String(invId) : '';
      if (amount > 0 && invIdStr) {
        try {
          await callIdcApi('addBalance', {
            uid,
            amount,
            type: 'recharge',
            description: `回收站恢复续费 - ${productName}`,
          });
        } catch (e) {
          console.warn('回收站续费充值余额失败:', e);
        }
        try {
          await callIdcApi('invoicePaid', { invoiceid: invId, uid });
        } catch (e) {
          console.warn('回收站续费支付账单失败:', e);
        }
      }
      updStep(i3, 'completed', invIdStr ? `账单ID: ${invIdStr}` : '续费成功');

      // 4. 财务拉取状态（最后执行）
      const i4 = pushStep('拉取状态 (provisionSync)');
      const syncRes = await callIdcApi('provisionSync', { hostid });
      if (!(syncRes?.status === 200 || syncRes?.success === true || syncRes?.msg === '请求成功')) {
        updStep(i4, 'failed', String(syncRes?.msg || '拉取失败'));
        showNotification('error', '拉取状态失败');
        return;
      }
      updStep(i4, 'completed');

      showNotification('success', `${productName} 已恢复并续费成功`);
      if (selectedUser) fetchUserProducts(selectedUser.id);
    } finally {
      setIsRecycleProcessing(false);
    }
  }, [callMfyApi, callIdcApi, selectedUser, fetchUserProducts, showNotification, isRecycleProcessing]);

  // 打开退款确认对话框
  const handleRefundDelete = useCallback(async (product: Record<string, unknown>) => {
    setRefundTarget(product);
    setIsLoadingRefund(true);
    setRefundInfo(null);

    // 计算本地退款金额
    const calc = calculateRefundAmount(product);
    const amountStr = String(product.amount || product.firstpaymentamount || '0');
    const amountMatch = amountStr.match(/([\d.]+)/);
    const periodAmount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    setRefundInfo(calc ? {
      calculated: true,
      ...calc,
      periodAmount,
      currentPeriodStart: calc.currentPeriodStart.toLocaleDateString('zh-CN'),
      expireDate: calc.expireDate.toLocaleDateString('zh-CN'),
      orderDate: calc.orderDate.toLocaleDateString('zh-CN'),
    } : { calculated: false });


    // 尝试从后台API获取退款页面信息（同时获取关联账单）
    try {
      const hostId = product.id as number;
      const res = await callIdcApi('refundPage', { hid: hostId });
      if (res && typeof res === 'object') {
        const refundData = res as Record<string, unknown>;
        // API返回 refund_amount, refund_method, refund_type, invoices 等
        setRefundInfo(prev => ({
          ...prev,
          ...refundData,
          apiLoaded: true,
        }));
        // 缓存账单ID列表，refund_page返回的data.invoices就是关联账单
        const refundPageData = (refundData.data as Record<string, unknown>) || refundData;
        if (Array.isArray(refundPageData.invoices)) {
          pendingInvoiceIdsRef.current = (refundPageData.invoices as Array<Record<string, unknown>>)
            .map((inv: Record<string, unknown>) => Number(inv.id))
            .filter((id: number) => id > 0);
        }
      }
    } catch {
      // API获取失败不影响，用本地计算
    }

    setIsLoadingRefund(false);
    setShowRefundConfirm(true);
  }, [callIdcApi, calculateRefundAmount]);

  // 执行退款+删除
  const executeRefundDelete = useCallback(async () => {
    if (!refundTarget || !selectedUser) return;
    setIsRefundDeleting(true);

    const hostId = refundTarget.id as number;
    const uid = selectedUser.id as number;
    const productName = String(refundTarget.productname || refundTarget.product_name || '未知产品');

    const steps: Array<{ id: string; label: string; status: 'pending' | 'running' | 'done' | 'error'; detail?: string }> = [
      { id: 'refund', label: refundMode === 'credit' ? '退余额' : '仅记录', status: 'pending' },
      { id: 'terminate', label: '终止云服务器', status: 'pending' },
      { id: 'delete_invoice', label: '删除账单', status: 'pending' },
    ];
    setRefundSteps(steps);

    // 使用refund_page已缓存的账单ID列表（ref避免闭包问题）
    const invoiceIds: number[] = [...pendingInvoiceIdsRef.current];

    // 步骤1: 退款
    steps[0].status = 'running';
    setRefundSteps([...steps]);
    try {
      const calc = calculateRefundAmount(refundTarget);
      const refundAmount = calc?.refundAmount || 0;

      if (refundMode === 'record') {
        // 仅记录，不实际退款
        steps[0].status = 'done';
        steps[0].detail = `仅记录退款 ¥${refundAmount.toFixed(2)}，未实际退款`;
      } else if (refundAmount > 0) {
        // 退余额：直接调用后台充值余额API
        const creditRes = await callIdcApi('addCredit', {
          uid,
          amount: String(refundAmount.toFixed(2)),
          description: `退款：${productName} (ID:${hostId}) 剩余${calc?.remainingDays || 0}天`,
        }) as Record<string, unknown>;
        if (creditRes && (creditRes.status === 200 || creditRes.success === true)) {
          steps[0].status = 'done';
          steps[0].detail = `已退余额 ¥${refundAmount.toFixed(2)}`;
        } else {
          const msg = String(creditRes?.msg || creditRes?.message || '退余额失败');
          steps[0].status = 'error';
          steps[0].detail = msg;
        }
      } else {
        steps[0].status = 'done';
        steps[0].detail = '无需退款（已过期或金额为0）';
      }
    } catch (e) {
      steps[0].status = 'error';
      steps[0].detail = String(e);
    }
    setRefundSteps([...steps]);

    // 步骤2: 终止云服务器（调用模块terminate，实际删除对接的机器）
    steps[1].status = 'running';
    setRefundSteps([...steps]);
    try {
      const terminateRes = await callIdcApi('provisionTerminate', {
        id: hostId,
        func: 'terminate',
      }) as Record<string, unknown>;
      const terminateSuccess = terminateRes?.status === 200 || terminateRes?.success === true;
      if (terminateSuccess) {
        steps[1].status = 'done';
        steps[1].detail = `已终止云服务器 ${productName}`;
      } else {
        const msg = String(terminateRes?.msg || terminateRes?.message || '终止失败');
        steps[1].status = 'error';
        steps[1].detail = msg;
      }
    } catch (e) {
      steps[1].status = 'error';
      steps[1].detail = String(e);
    }
    setRefundSteps([...steps]);

    // 步骤3: 删除关联账单（使用之前预先获取的账单ID列表）
    steps[2].status = 'running';
    setRefundSteps([...steps]);
    try {
      if (invoiceIds.length > 0) {
        const invoiceDeleteRes = await callIdcApi('invoiceDelete', { ids: invoiceIds }) as Record<string, unknown>;
        const invDeleteSuccess = invoiceDeleteRes?.status === 200 || invoiceDeleteRes?.success === true;
        if (invDeleteSuccess) {
          steps[2].status = 'done';
          steps[2].detail = `已删除 ${invoiceIds.length} 条账单`;
        } else {
          const msg = String(invoiceDeleteRes?.msg || invoiceDeleteRes?.message || '删除失败');
          steps[2].status = 'error';
          steps[2].detail = msg;
        }
      } else {
        steps[2].status = 'done';
        steps[2].detail = '无关联账单';
      }
    } catch (e) {
      steps[2].status = 'error';
      steps[2].detail = String(e);
    }
    setRefundSteps([...steps]);

    setIsRefundDeleting(false);
    // 刷新产品列表
    if (selectedUser) fetchUserProducts(selectedUser.id);
  }, [refundTarget, selectedUser, refundMode, callIdcApi, calculateRefundAmount, fetchUserProducts]);

  // 获取产品详情（远程连接用）
  const handleGetServiceDetail = useCallback(async (uid: number, hostid: number) => {
    try {
      const res = await callIdcApi('getServiceDetail', { uid, hostid }) as Record<string, unknown>;
      if (res?.data) {
        return res.data as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }, [callIdcApi]);

  // 批量导出选中产品的服务器信息（需逐个获取详情以拿到账号密码）
  const handleExportProducts = useCallback(async () => {
    const selectedProducts = filteredProducts.filter((p: Record<string, unknown>) => selectedRenewIds.has(p.id as number));
    if (selectedProducts.length === 0) return;

    // 安全提取字段：后台可能返回对象而非字符串
    const extractField = (val: unknown): string => {
      if (val == null) return '';
      let result = '';
      if (typeof val === 'string') result = val;
      else if (typeof val === 'number') result = String(val);
      else if (typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        result = String(obj.name || obj.value || obj.username || obj.password || '');
      } else result = String(val);
      // 清除换行符，防止导出格式错乱
      return result.replace(/[\r\n]+/g, '');
    };

    setIsExporting(true);
    const lines: string[] = [];
    for (const p of selectedProducts) {
      const ip = extractField(p.dedicatedip || p.ip) || '-';
      const uid = Number(p.uid || selectedUser?.id || 0);
      const hostid = Number(p.id);
      let username = extractField(p.username);
      let password = extractField(p.password);
      // 通过 getServiceDetail 获取完整账号密码（与远程弹窗逻辑一致）
      if (uid && hostid) {
        try {
          const detail = await handleGetServiceDetail(uid, hostid);
          if (detail) {
            const detailUsername = extractField(detail.username);
            const detailPassword = extractField(detail.password);
            if (detailUsername) username = detailUsername;
            if (detailPassword) password = detailPassword;
          }
        } catch { /* 获取失败使用列表数据 */ }
      }
      if (!username) username = 'root';
      lines.push(`IP: ${ip}  用户名: ${username}  密码: ${password}`);
    }
    setExportText(lines.join('\n'));
    setIsExporting(false);
  }, [filteredProducts, selectedRenewIds, selectedUser, handleGetServiceDetail]);

  // 弹窗打开时触发导出
  useEffect(() => {
    if (showExportDialog) {
      setExportText('');
      handleExportProducts();
    }
  }, [showExportDialog]); // eslint-disable-line react-hooks/exhaustive-deps

  // 远程连接：先获取服务器详情，弹出确认弹窗展示 IP/账号/密码，确认后创建 SSH 连接
  const handleRemoteConnect = useCallback(async (product: Record<string, unknown>) => {
    const hostid = product.id as number;
    const uid = product.uid as number;
    const ip = String(product.dedicatedip || product.ip || '');
    if (!ip) {
      showNotification('error', '该产品没有IP地址');
      return;
    }
    showNotification('info', '正在获取服务器连接信息...');
    try {
      const detail = await handleGetServiceDetail(uid, hostid);
      const username = detail ? String(detail.username || 'root') : 'root';
      const password = detail ? String(detail.password || '') : '';
      if (!password) {
        showNotification('error', '未获取到服务器密码');
        return;
      }
      setRemoteConnectInfo({
        ip,
        username,
        password,
        hostid,
        uid,
        productName: product.name ? String(product.name) : undefined,
      });
    } catch {
      showNotification('error', '获取服务器详情失败');
    }
  }, [handleGetServiceDetail, showNotification]);

  // 确认连接：调用 quickConnectToServer 创建/复用连接并跳转
  const confirmRemoteConnect = useCallback(async () => {
    if (!remoteConnectInfo) return;
    setRemoteConnecting(true);
    try {
      const { quickConnectToServer } = await import('@/lib/services/server-tools/quick-connect');
      const connId = await quickConnectToServer({
        host: remoteConnectInfo.ip,
        username: remoteConnectInfo.username,
        password: remoteConnectInfo.password,
        name: remoteConnectInfo.ip,
      });
      if (connId) {
        setRemoteConnectInfo(null);
        window.open(`/server-tools/${connId}`, '_blank');
        showNotification('success', 'SSH 连接已在新窗口打开');
      } else {
        showNotification('error', '创建 SSH 连接失败，请到服务器工具手动添加');
      }
    } catch {
      showNotification('error', '远程连接失败');
    } finally {
      setRemoteConnecting(false);
    }
  }, [remoteConnectInfo, showNotification]);

  // 弹窗内复制字段（带短暂勾选反馈，不依赖外部 copy 函数避免 TDZ）
  const copyRemoteField = useCallback((field: string, value: string) => {
    if (!value) return;
    const doFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.left = '0';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(value).catch(doFallback);
    } else {
      doFallback();
    }
    setRemoteCopiedField(field);
    if (remoteCopyTimerRef.current) clearTimeout(remoteCopyTimerRef.current);
    remoteCopyTimerRef.current = setTimeout(() => setRemoteCopiedField(null), 1500);
  }, []);

  // 一键复制全部远程连接信息
  const copyAllRemoteInfo = useCallback(() => {
    if (!remoteConnectInfo) return;
    const text = `IP 地址: ${remoteConnectInfo.ip}\n登录账号: ${remoteConnectInfo.username}\n密码: ${remoteConnectInfo.password}`;
    const doFallback = () => {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '0';
      textarea.style.top = '0';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(textarea);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(doFallback);
    } else {
      doFallback();
    }
    setRemoteCopiedAll(true);
    if (remoteCopyTimerRef.current) clearTimeout(remoteCopyTimerRef.current);
    remoteCopyTimerRef.current = setTimeout(() => setRemoteCopiedAll(false), 1500);
  }, [remoteConnectInfo]);

  // 卸载时清理 timer
  useEffect(() => () => { if (remoteCopyTimerRef.current) clearTimeout(remoteCopyTimerRef.current); }, []);

  const handleMfyCloud = useCallback(async (product: Record<string, unknown>) => {
    if (!mfyUrl) {
      showNotification('error', '请先在设置中配置魔方云地址');
      return;
    }
    const hostid = product.id as number;
    const uid = product.uid as number;
    try {
      const detail = await handleGetServiceDetail(uid, hostid);
      const dcimid = detail ? String(detail.dcimid || '') : '';
      if (dcimid) {
        window.open(`${mfyUrl}/#/cloudsHome?id=${dcimid}`, '_blank');
      } else {
        showNotification('error', '未获取到魔方云实例ID');
      }
    } catch {
      showNotification('error', '获取产品详情失败');
    }
  }, [mfyUrl, handleGetServiceDetail, showNotification]);

  // 单个产品续费 - 打开续费确认弹窗
  const handleDirectRenew = useCallback((hostid: number) => {
    setDirectRenewId(hostid);
    setShowRenewConfirm(true);
  }, []);

  // 批量删除
  const handleBatchDelete = useCallback(async () => {
    if (selectedRenewIds.size === 0 || !selectedUser) return;
    setIsBatchDeleting(true);
    const productsToDelete = filteredProducts.filter((p: Record<string, unknown>) => selectedRenewIds.has(p.id as number));
    const steps: Array<{ id: string; name: string; status: 'processing' | 'completed' | 'failed'; message?: string }> = productsToDelete.map((p: Record<string, unknown>) => ({
      id: `del-${p.id}`,
      name: `终止 ${String(p.productname || p.product_name || '未知产品')} (ID:${p.id})`,
      status: 'processing' as const,
    }));
    setBatchDeleteSteps([...steps]);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < productsToDelete.length; i++) {
      const p = productsToDelete[i];
      const hostId = p.id as number;
      const productName = String(p.productname || p.product_name || '未知产品');
      steps[i].status = 'processing';
      setBatchDeleteSteps([...steps]);

      // 步骤1: 终止云服务器
      try {
        const terminateRes = await callIdcApi('provisionTerminate', {
          id: hostId,
          func: 'terminate',
        }) as Record<string, unknown>;
        const terminateSuccess = terminateRes?.status === 200 || terminateRes?.success === true;
        if (terminateSuccess) {
          // 步骤2: 获取关联账单并删除
          try {
            const refundPageRes = await callIdcApi('refundPage', { hid: hostId }) as Record<string, unknown>;
            const refundPageData = (refundPageRes.data as Record<string, unknown>) || refundPageRes;
            const invoices = Array.isArray(refundPageData.invoices) ? refundPageData.invoices as Array<Record<string, unknown>> : [];
            const invoiceIds = invoices.map((inv: Record<string, unknown>) => inv.id as number).filter(Boolean);

            if (invoiceIds.length > 0) {
              try {
                await callIdcApi('invoiceDelete', { ids: invoiceIds });
              } catch {
                // 账单删除失败不影响主流程
              }
            }
            steps[i].status = 'completed';
            steps[i].message = `已终止，删除${invoiceIds.length}条账单`;
            successCount++;
          } catch {
            // 获取账单失败，但终止已成功
            steps[i].status = 'completed';
            steps[i].message = '已终止，账单处理失败';
            successCount++;
          }
        } else {
          const msg = String(terminateRes?.msg || terminateRes?.message || '终止失败');
          steps[i].status = 'failed';
          steps[i].message = msg;
          failCount++;
        }
      } catch (e) {
        steps[i].status = 'failed';
        steps[i].message = String(e);
        failCount++;
      }
      setBatchDeleteSteps([...steps]);
    }

    setIsBatchDeleting(false);
    // 清空选择并刷新产品列表
    setSelectedRenewIds(new Set());
    if (selectedUser) fetchUserProducts(selectedUser.id);
  }, [selectedRenewIds, filteredProducts, selectedUser, callIdcApi, fetchUserProducts]);

  // 加载支付网关列表
  const loadGateways = useCallback(async () => {
    try {
      const res = await callIdcApi('getGateways');
      if (res.success && Array.isArray(res.gateway)) {
        setGateways(res.gateway);
        // 默认选中第一个启用的网关
        const activeGateway = res.gateway.find((g: { status: number }) => g.status === 1);
        if (activeGateway) {
          setSelectedGateway(activeGateway.name);
        }
      }
    } catch {
      // 加载网关失败不影响主流程
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 加载产品列表
  const loadProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    try {
      // 并行加载产品列表和支付网关
      const [productRes, gatewayRes] = await Promise.all([
        callIdcApi('getProductList'),
        gateways.length === 0 ? callIdcApi('getGateways') : Promise.resolve(null),
      ]);

      // 处理支付网关
      if (gatewayRes && gatewayRes.success && Array.isArray(gatewayRes.gateway)) {
        setGateways(gatewayRes.gateway);
        const activeGateway = gatewayRes.gateway.find((g: { status: number }) => g.status === 1);
        if (activeGateway && !selectedGateway) {
          setSelectedGateway(activeGateway.name);
        }
      }

      // 处理产品列表
      const groups: ProductFirstGroup[] = productRes.data || [];
      if (productRes.success && groups.length > 0) {
        setProductGroups(groups);
        // 如果没有排序配置，初始化为所有产品ID（从子分组的products中提取）
        if (productSortOrder.length === 0) {
          const allProductIds: number[] = [];
          groups.forEach(g => (g.groups || []).forEach(sg => (sg.products || []).forEach(p => {
            if (!allProductIds.includes(p.id)) allProductIds.push(p.id);
          })));
          setProductSortOrder(allProductIds);
        }
        // 统计产品总数
        const totalProducts = groups.reduce((acc, g) =>
          acc + (g.groups || []).reduce((a, sg) => a + (sg.products || []).length, 0), 0);
        showNotification('success', `已加载 ${groups.length} 个分组，共 ${totalProducts} 个产品`);
      } else {
        showNotification('error', productRes.msg || '加载产品列表失败');
      }
    } catch (err) {
      console.error('[loadProducts] Error:', err);
      showNotification('error', '加载产品列表失败');
    } finally {
      setIsLoadingProducts(false);
    }
  }, [authToken, sessionCookie, showNotification]); // eslint-disable-line react-hooks/exhaustive-deps

  // 选择产品 → 加载配置选项
  const handleSelectProduct = async (pid: number) => {
    setSelectedProductId(pid);
    setConfigOptions([]);
    setConfigValues({});
    setProductCycles([]);
    setSelectedBillingCycle('');
    setPrevBillingCycle('');
    setCustomFieldValues({});
    setIsLoadingConfig(true);
    setProductQty(1);
    setFirstPrice('');
    setRenewPrice('');

    try {
      // 并行加载支付网关（如果还没加载）
      if (gateways.length === 0) {
        loadGateways();
      }

      // 找到选中的产品详情
      let productDetail: ProductItem | null = null;
      for (const firstGroup of productGroups) {
        for (const subGroup of firstGroup.groups) {
          const found = subGroup.products.find(p => p.id === pid);
          if (found) { productDetail = found; break; }
        }
        if (productDetail) break;
      }
      setSelectedProductDetail(productDetail);

      // 1. 获取产品的计费周期（优先从缓存读取）
      let cycleToUse = selectedBillingCycle;
      const cacheKeyBase = `${pid}_`;
      let cachedCycles: Array<{ value: string; label: string }> | undefined;

      // 先检查是否有该产品任意周期的缓存
      for (const key of Object.keys(configCacheRef.current)) {
        if (key.startsWith(cacheKeyBase)) {
          cachedCycles = configCacheRef.current[key].cycles;
          break;
        }
      }

      if (cachedCycles && cachedCycles.length > 0) {
        setProductCycles(cachedCycles);
        const monthlyCycle = cachedCycles.find(c => c.value === 'monthly');
        cycleToUse = monthlyCycle ? monthlyCycle.value : cachedCycles[0].value;
        setSelectedBillingCycle(cycleToUse);
      } else {
        try {
          const pageRes = await callIdcApi('getProductCycles', { uid: selectedUser?.id || 0, pid, flag: 1 });
          if (pageRes.success && pageRes.data?.product?.cycle) {
            const cycles: Array<{ value: string; label: string }> = pageRes.data.product.cycle;
            setProductCycles(cycles);
            if (cycles.length > 0) {
              const monthlyCycle = cycles.find(c => c.value === 'monthly');
              cycleToUse = monthlyCycle ? monthlyCycle.value : cycles[0].value;
              setSelectedBillingCycle(cycleToUse);
            }
            // 暂存cycles到缓存
            cachedCycles = cycles;
          }
        } catch {
          // 获取周期失败不影响主流程
        }
      }

      // 2. 获取产品的可配置选项（优先从缓存读取）
      if (!cycleToUse) {
        cycleToUse = 'monthly';
        setSelectedBillingCycle(cycleToUse);
      }

      const cacheKey = `${pid}_${cycleToUse}`;
      const cached = configCacheRef.current[cacheKey];

      if (cached) {
        // 从缓存加载，无需API请求
        setConfigOptions(cached.options);
        const defaultCfValues: Record<string, string> = {};
        for (const field of cached.customFields) {
          defaultCfValues[field.id] = '';
        }
        setCustomFieldValues(defaultCfValues);
        // 设置默认值
        const defaultValues = buildDefaultConfigValues(cached.options);
        setConfigValues(defaultValues);
        if (cachedCycles && cachedCycles.length > 0 && !cached.cycles?.length) {
          cached.cycles = cachedCycles;
        }
      } else {
        const res = await callIdcApi('getProductConfig', { pid, billingcycle: cycleToUse });
        if (res.success) {
          const options: ConfigOption[] = res.option || [];
          const cf: Array<{ id: number; fieldname: string; description: string; fieldtype: string; required: number }> = res.custom_fields || [];

          // 写入缓存
          configCacheRef.current[cacheKey] = { options, customFields: cf, cycles: cachedCycles || [] };

          setConfigOptions(options);
          const defaultCfValues: Record<string, string> = {};
          for (const field of cf) {
            defaultCfValues[field.id] = '';
          }
          setCustomFieldValues(defaultCfValues);
          const defaultValues = buildDefaultConfigValues(options);
          setConfigValues(defaultValues);
          showNotification('success', `已加载 ${options.length} 个配置选项`);
        } else {
          showNotification('error', res.msg || '加载配置选项失败');
        }
      }
    } catch {
      showNotification('error', '加载配置选项失败');
    } finally {
      setIsLoadingConfig(false);
    }
  };

  // 构建默认配置值的辅助函数
  const buildDefaultConfigValues = (options: ConfigOption[]): Record<string, string> => {
    const defaultValues: Record<string, string> = {};
    for (const opt of options) {
      if (opt.option_type === 5 && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
        const osCategories = Object.entries(opt.child as Record<string, { system?: string; child: Array<{ id: number }> }>);
        if (osCategories.length > 0) {
          const [firstKey, firstCat] = osCategories[0];
          defaultValues[`os_cat_${opt.id}`] = firstKey;
          if (firstCat?.child?.[0]) {
            defaultValues[opt.id] = String(firstCat.child[0].id);
          }
        }
        continue;
      }
      if (opt.option_type === 3) {
        defaultValues[opt.id] = '0';
        continue;
      }
      const subs = Array.isArray(opt.child) ? opt.child : [];
      if (subs.length > 0) {
        const defaultSub = subs.find((s: ConfigSubItem) => s.is_default === 1) || subs[0];
        defaultValues[opt.id] = String(defaultSub.id);
        if ([7, 9, 11, 14, 15].includes(opt.option_type)) {
          const qtyDefault = defaultSub.qty_minimum || opt.qty_minimum || 0;
          defaultValues[`qty_${opt.id}`] = String(qtyDefault);
        }
      }
    }
    return defaultValues;
  };

  // 将当前用户选择的OS值合并到目标configValues中（同产品内保持OS选择不变）
  const mergeCurrentOsValues = (targetValues: Record<string, string>, currentVals: Record<string, string>): Record<string, string> => {
    if (!currentVals) return targetValues;
    const result = { ...targetValues };
    for (const [key, value] of Object.entries(currentVals)) {
      if (key.startsWith('os_cat_')) {
        result[key] = value;
        const optId = key.replace('os_cat_', '');
        if (currentVals[optId] !== undefined) {
          result[optId] = currentVals[optId];
        }
      }
    }
    return result;
  };

  // 计算价格
  // 合计直接使用 firstPrice，不再异步查询

  // 配置选项变化时不再异步查询价格，合计直接使用 firstPrice

  // 切换计费周期时重新加载配置选项
  const [prevBillingCycle, setPrevBillingCycle] = useState('');
  useEffect(() => {
    if (selectedBillingCycle && selectedBillingCycle !== prevBillingCycle && selectedProductId) {
      setPrevBillingCycle(selectedBillingCycle);
      // 只有在初始化加载之后（configOptions已有数据）才重新加载
      if (configOptions.length > 0) {
        (async () => {
          setIsLoadingConfig(true);
          try {
            const cacheKey = `${selectedProductId}_${selectedBillingCycle}`;
            const cached = configCacheRef.current[cacheKey];
            if (cached) {
              // 从缓存加载
              setConfigOptions(cached.options);
              const defaultValues = buildDefaultConfigValues(cached.options);
              // 如果有选中的套餐，尝试切换到对应周期的套餐
              const currentPkg = savedPackages.find(p => p.id === selectedPackageId);
              if (currentPkg) {
                const targetPkg = savedPackages.find(p =>
                  p.name === currentPkg.name &&
                  p.productId === currentPkg.productId &&
                  p.billingCycle === selectedBillingCycle
                );
                if (targetPkg) {
                  setConfigValues(mergeCurrentOsValues(targetPkg.configValues, configValues));
                  setCustomFieldValues(targetPkg.customFieldValues);
                  setProductQty(targetPkg.productQty);
                  setFirstPrice(targetPkg.firstPrice);
                  setRenewPrice(targetPkg.renewPrice);
                  setSelectedPackageId(targetPkg.id);
                  if (targetPkg.gateway) setSelectedGateway(targetPkg.gateway);
                  setUseCredit(targetPkg.useCredit);
                  setAutoRecharge(targetPkg.autoRecharge ?? true);
                } else {
                  setConfigValues(mergeCurrentOsValues(defaultValues, configValues));
                  setSelectedPackageId('');
                }
              } else {
                setConfigValues(mergeCurrentOsValues(defaultValues, configValues));
              }
            } else {
              const res = await callIdcApi('getProductConfig', { pid: selectedProductId, billingcycle: selectedBillingCycle });
              if (res.success) {
                const options: ConfigOption[] = res.option || [];
                const cf: Array<{ id: number; fieldname: string; description: string; fieldtype: string; required: number }> = res.custom_fields || [];
                // 写入缓存
                configCacheRef.current[cacheKey] = { options, customFields: cf, cycles: [] };
                setConfigOptions(options);
                const defaultValues = buildDefaultConfigValues(options);
                // 如果有选中的套餐，尝试切换到对应周期的套餐
                const currentPkg = savedPackages.find(p => p.id === selectedPackageId);
                if (currentPkg) {
                  const targetPkg = savedPackages.find(p =>
                    p.name === currentPkg.name &&
                    p.productId === currentPkg.productId &&
                    p.billingCycle === selectedBillingCycle
                  );
                  if (targetPkg) {
                    setConfigValues(mergeCurrentOsValues(targetPkg.configValues, configValues));
                    setCustomFieldValues(targetPkg.customFieldValues);
                    setProductQty(targetPkg.productQty);
                    setFirstPrice(targetPkg.firstPrice);
                    setRenewPrice(targetPkg.renewPrice);
                    setSelectedPackageId(targetPkg.id);
                    if (targetPkg.gateway) setSelectedGateway(targetPkg.gateway);
                    setUseCredit(targetPkg.useCredit);
                    setAutoRecharge(targetPkg.autoRecharge ?? true);
                  } else {
                    setConfigValues(mergeCurrentOsValues(defaultValues, configValues));
                    setSelectedPackageId('');
                  }
                } else {
                  setConfigValues(mergeCurrentOsValues(defaultValues, configValues));
                }
              }
            }
          } catch {
            // ignore
          } finally {
            setIsLoadingConfig(false);
          }
        })();
      }
    }
  }, [selectedBillingCycle, selectedProductId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 切换用户时重置周期相关状态
  const resetCycleOnUserChange = () => {
    setSelectedBillingCycle('monthly');
    setSelectedPackageId('');
  };

  // 快速搜索用户（弹窗内使用，独立state）
  const handleQuickSearchUsers = async () => {
    if (!quickSearchKeyword.trim()) { showNotification('error', '请输入搜索关键词'); return; }
    setQuickIsSearching(true);
    try {
      const kw = quickSearchKeyword.trim();

      // UID搜索：根据UID估算页码，二分法精确定位
      // auto模式下：手机号(1开头11位)走手机搜索，其余纯数字走UID搜索
      const isUidSearch = quickSearchType === 'uid' || (quickSearchType === 'auto' && /^\d+$/.test(kw) && !/^1[3-9]\d{9}$/.test(kw));
      if (isUidSearch) {
        const uid = parseInt(kw);
        const pageSize = 50;
        let foundUser: Record<string, unknown> | null = null;

        let lowPage = 1;
        let highPage = Math.ceil(uid / pageSize) + 2;
        let visitedPages = new Set<number>();
        let maxAttempts = 15;

        while (maxAttempts-- > 0 && lowPage <= highPage) {
          const page = maxAttempts === 14 ? Math.ceil(uid / pageSize) : Math.floor((lowPage + highPage) / 2);
          if (visitedPages.has(page)) { lowPage = page + 1; continue; }
          visitedPages.add(page);

          const res = await callIdcApi('searchUser', {
            keyword: '',
            searchParams: { page, limit: pageSize, order: 'id', sort: 'ASC' },
          });
          const list = res.data?.list || res.list || [];
          if (!Array.isArray(list) || list.length === 0) {
            highPage = page - 1;
            continue;
          }

          const matched = list.find((u: Record<string, unknown>) => Number(u.id) === uid);
          if (matched) { foundUser = matched; break; }

          const minId = Math.min(...list.map((u: Record<string, unknown>) => Number(u.id)));
          const maxId = Math.max(...list.map((u: Record<string, unknown>) => Number(u.id)));

          if (uid < minId) {
            highPage = page - 1;
          } else if (uid > maxId) {
            lowPage = page + 1;
          } else {
            break;
          }
        }

        if (foundUser) {
          const foundUid = Number(foundUser.id);
          let personCertStatus = 0;
          try {
            const certRes = await fetch('/api/idc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'certifiPerson', token: authToken, cookie: sessionCookie, client_id: foundUid }),
            });
            const certData = await certRes.json();
            personCertStatus = certData?.certifi_message?.status || certData?.data?.certifi_message?.status || 0;
          } catch { /* 查询认证状态失败不阻塞 */ }
          setQuickSearchResults([{
            id: foundUid, username: String(foundUser.username || ''),
            email: String(foundUser.email || ''), phone: String(foundUser.phone || ''),
            phonenumber: String(foundUser.phonenumber || ''), credit: String(foundUser.credit || '0'),
            status: String(foundUser.status || ''), qq: String(foundUser.qq || ''),
            person_status: personCertStatus === 1 ? '已认证' : '', company_status: '',
          }]);
        } else {
          setQuickSearchResults([]);
          showNotification('error', `UID ${kw} 对应的用户不存在`);
        }
        return;
      }

      // 其他搜索类型：用searchUser + searchParams
      const searchParams: Record<string, string | number> = { page: 1, limit: 20 };
      if (quickSearchType === 'username') {
        searchParams.username = kw;
      } else if (quickSearchType === 'email') {
        searchParams.email = kw;
      } else if (quickSearchType === 'phone') {
        searchParams.phonenumber = kw;
      } else if (quickSearchType === 'qq') {
        searchParams.qq = kw;
      } else {
        if (/^[\w.-]+@[\w.-]+\.\w+$/.test(kw)) {
          searchParams.email = kw;
        } else if (/^1[3-9]\d{9}$/.test(kw)) {
          searchParams.phonenumber = kw;
        } else if (/^\d{5,11}$/.test(kw)) {
          searchParams.qq = kw;
        } else {
          searchParams.username = kw;
        }
      }
      const res = await fetch('/api/idc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'searchUser', token: authToken, cookie: sessionCookie,
          searchParams,
        }),
      });
      const data = await res.json();
      if (data.success || data.status === 200 || data.status === 1) {
        const userList = data.list || data.data?.list || [];
        if (!userList.length) {
          setQuickSearchResults([]);
          showNotification('error', '未找到匹配的用户');
        } else {
          // 搜索到用户列表，逐个查询认证状态
          const usersWithCert = await Promise.all(
            userList.map(async (u: Record<string, unknown>) => {
              let personCertStatus = 0;
              try {
                const certRes = await fetch('/api/idc', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'certifiPerson', token: authToken, cookie: sessionCookie, client_id: Number(u.id) }),
                });
                const certData = await certRes.json();
                personCertStatus = certData?.certifi_message?.status || certData?.data?.certifi_message?.status || 0;
              } catch { /* 查询认证状态失败不阻塞 */ }
              return {
                id: Number(u.id), username: String(u.username || ''),
                email: String(u.email || ''), phone: String(u.phone || ''),
                phonenumber: String(u.phonenumber || ''), credit: String(u.credit || '0'),
                status: String(u.status || ''), qq: String(u.qq || ''),
                person_status: personCertStatus === 1 ? '已认证' : '', company_status: '',
              };
            })
          );
          setQuickSearchResults(usersWithCert);
        }
      } else {
        setQuickSearchResults([]);
        showNotification('error', data.msg || data.message || '搜索失败');
      }
    } catch {
      setQuickSearchResults([]);
      showNotification('error', '搜索失败');
    } finally {
      setQuickIsSearching(false);
    }
  };

  // 快速选用户后选中并继续开通
  const handleQuickSelectUser = (user: typeof quickSearchResults[0]) => {
    resetCycleOnUserChange();
    setSelectedUser({ ...user } as Record<string, unknown> as typeof selectedUser);
    setUseCredit(parseFloat(String(user.credit || '0')) > 0);
    fetchUserProducts(user.id);
    setShowQuickUserSearch(false);
    setQuickSearchKeyword('');
    setQuickSearchResults([]);
    // pendingProvision由useEffect监听处理，选完用户后自动继续
  };

  // 监听：选完用户后自动继续开通流程
  useEffect(() => {
    if (pendingProvision && selectedUser) {
      setPendingProvision(false);
      const runProvision = async () => {
        try {
          const certifiRes = await callIdcApi('certifiPerson', { client_id: selectedUser.id });
          const certifiStatus = certifiRes?.certifi_message?.status;
          if (certifiStatus !== 1) {
            const statusMap: Record<number, string> = { 2: '未通过', 3: '待审核', 4: '已提交资料' };
            setCertifiInfo({ status: certifiStatus, msg: statusMap[certifiStatus] || '未认证' });
            setShowCertifiConfirm(true);
            return;
          }
        } catch { /* 查询认证状态失败，不阻塞 */ }
        executeProvision();
      };
      runProvision();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProvision, selectedUser]);

  // 搜索用户
  const handleSearchUsers = async (overrideKeyword?: string, overrideType?: typeof searchType) => {
    const kw = (overrideKeyword ?? searchKeyword).trim();
    if (!kw) { showNotification('error', '请输入搜索关键词'); return; }
    const currentSearchType = overrideType ?? searchType;
    setIsSearching(true);
    try {

      // UID搜索：根据UID估算页码，二分法精确定位
      // auto模式下：手机号(1开头11位)走手机搜索，其余纯数字走UID搜索
      const isUidSearch = currentSearchType === 'uid' || (currentSearchType === 'auto' && /^\d+$/.test(kw) && !/^1[3-9]\d{9}$/.test(kw));
      if (isUidSearch) {
        const uid = parseInt(kw);
        const pageSize = 50;
        let foundUser: Record<string, unknown> | null = null;

        // 先估算起始页（UID除以每页条数）
        let lowPage = 1;
        let highPage = Math.ceil(uid / pageSize) + 2; // 多留2页余量
        let visitedPages = new Set<number>();
        let maxAttempts = 15; // 最多15次请求

        while (maxAttempts-- > 0 && lowPage <= highPage) {
          // 估算当前页：先取估算页，后续二分
          const page = maxAttempts === 14 ? Math.ceil(uid / pageSize) : Math.floor((lowPage + highPage) / 2);
          if (visitedPages.has(page)) { lowPage = page + 1; continue; }
          visitedPages.add(page);

          const res = await callIdcApi('searchUser', {
            keyword: '',
            searchParams: { page, limit: pageSize, order: 'id', sort: 'ASC' },
          });
          const list = res.data?.list || res.list || [];
          if (!Array.isArray(list) || list.length === 0) {
            highPage = page - 1; // 没数据，往前找
            continue;
          }

          // 检查当前页是否包含目标UID
          const matched = list.find((u: Record<string, unknown>) => Number(u.id) === uid);
          if (matched) { foundUser = matched; break; }

          // 根据当前页ID范围调整搜索区间
          const minId = Math.min(...list.map((u: Record<string, unknown>) => Number(u.id)));
          const maxId = Math.max(...list.map((u: Record<string, unknown>) => Number(u.id)));

          if (uid < minId) {
            highPage = page - 1; // 目标在前面的页
          } else if (uid > maxId) {
            lowPage = page + 1; // 目标在后面的页
          } else {
            // uid在当前页ID范围内但没精确匹配，说明该UID不存在
            break;
          }
        }

        if (foundUser) {
          resetCycleOnUserChange();
          setSelectedUser(foundUser as typeof selectedUser);
          setSearchResults([]);
          showNotification('success', `已选中用户: ${foundUser.username || foundUser.email || `UID:${foundUser.id}`}`);
          fetchUserProducts(Number(foundUser.id));
          if (autoClearSearch) setSearchKeyword('');
        } else {
          showNotification('error', `UID ${kw} 对应的用户不存在`);
          setSearchResults([]);
        }
        return;
      }

      // 其他搜索类型：搜索用户列表
      const searchParams: Record<string, string | number> = { page: 1, limit: 20 };
      if (currentSearchType === 'username') {
        searchParams.username = kw;
      } else if (currentSearchType === 'email') {
        searchParams.email = kw;
      } else if (currentSearchType === 'phone') {
        searchParams.phonenumber = kw;
      } else if (currentSearchType === 'qq') {
        searchParams.qq = kw;
      } else {
        // auto: 自动判断
        if (/^[\w.-]+@[\w.-]+\.\w+$/.test(kw)) {
          searchParams.email = kw;
        } else if (/^1[3-9]\d{9}$/.test(kw)) {
          searchParams.phonenumber = kw;
        } else if (/^\d{5,11}$/.test(kw)) {
          searchParams.qq = kw;
        } else {
          searchParams.username = kw;
        }
      }
      const res = await fetch('/api/idc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'searchUser', token: authToken, cookie: sessionCookie,
          searchParams,
        }),
      });
      const data = await res.json();
      if (data.success || data.status === 200 || data.status === 1) {
        const userList = data.list || data.data?.list || [];
        if (!userList.length) {
          showNotification('info', '未找到匹配的用户');
          setSearchResults([]);
        } else if (userList.length === 1) {
          // 只有一个结果，自动选中
          resetCycleOnUserChange();
          setSelectedUser(userList[0] as typeof selectedUser);
          setSearchResults([]);
          showNotification('success', `已自动选择用户 ${userList[0].username || userList[0].id}`);
          fetchUserProducts(Number(userList[0].id));
          if (autoClearSearch) setSearchKeyword('');
        } else {
          setSearchResults(userList);
          showNotification('success', `找到 ${data.total || userList.length} 个用户`);
        }
      } else {
        showNotification('error', data.msg || data.message || '搜索失败');
        setSearchResults([]);
      }
    } catch {
      showNotification('error', '搜索请求失败');
    } finally {
      setIsSearching(false);
    }
  };

  // URL参数自动查询用户（从工单详情页跳转，优先手机号/邮箱）
  const urlQuerySearchedRef = useRef(false);
  useEffect(() => {
    if (urlQuerySearchedRef.current) return;
    if (!authToken) return; // 等待认证信息从 localStorage 加载完成
    const qParam = urlSearchParams?.get('q');
    if (qParam && qParam.trim()) {
      urlQuerySearchedRef.current = true;
      setSearchKeyword(qParam.trim());
      setSearchType('auto');
      void handleSearchUsers(qParam.trim(), 'auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSearchParams, authToken]);

  // 添加余额
  const handleAddBalance = async () => {
    if (!selectedUser) { showNotification('error', '请先选择用户'); return; }
    const amount = parseFloat(addAmount);
    if (isNaN(amount) || amount <= 0) { showNotification('error', '请输入有效的金额'); return; }

    setIsAddingBalance(true);
    try {
      const res = await fetch('/api/idc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addBalance', token: authToken, cookie: sessionCookie,
          uid: selectedUser.id, amount, description: addDescription || '强制添加余额',
        }),
      });
      const data = await res.json();
      if (data.success || data.status === 200 || data.status === 1) {
        showNotification('success', `成功为用户 ${selectedUser.username} 添加余额 ¥${amount}`);
        setAddAmount('');
        const currentCredit = parseFloat(selectedUser.credit || '0');
        setSelectedUser({ ...selectedUser, credit: (currentCredit + amount).toFixed(2) });
        handleSearchUsers();
      } else {
        showNotification('error', data.msg || '添加余额失败');
      }
    } catch {
      showNotification('error', '添加余额请求失败');
    } finally {
      setIsAddingBalance(false);
    }
  };

  // 更新步骤状态
  const updateStep = (stepId: number, status: ProcessingStep['status'], message?: string) => {
    setProcessingSteps(prev => prev.map(step => step.id === stepId ? { ...step, status, message } : step));
    setProgress(Math.round((stepId / ORDER_STEPS.length) * 100));
  };

  // 一键开通
  const handleOneClickOrder = async () => {
    if (isProcessing) return;
    if (!selectedUser) {
      setPendingProvision(true);
      setShowQuickUserSearch(true);
      return;
    }
    if (!selectedProductId) { showNotification('error', '请选择产品'); return; }
    if (!selectedBillingCycle) { showNotification('error', '请选择付款周期'); return; }

    setShowCreateConfirm(true);
  };

  const confirmAndCreate = async () => {
    setShowCreateConfirm(false);
    if (!selectedUser) return;

    // 检查用户实名认证状态
    try {
      const certifiRes = await callIdcApi('certifiPerson', { client_id: selectedUser.id });
      // 认证状态在 certifi_message.status 字段中，status=1表示已认证
      const certifiStatus = certifiRes?.certifi_message?.status;
      if (certifiStatus !== 1) {
        const statusMap: Record<number, string> = { 2: '未通过', 3: '待审核', 4: '已提交资料' };
        const statusText = statusMap[certifiStatus] || '未认证';
        setCertifiInfo({ status: certifiStatus, msg: statusText });
        setShowCertifiConfirm(true);
        return; // 等待用户确认
      }
    } catch {
      // 查询认证状态失败，不阻塞流程
    }

    // 执行开通
    await executeProvision();
  };

  // 实际执行开通流程
  const executeProvision = async () => {
    if (!selectedUser || !selectedProductId || !selectedBillingCycle) return;

    setIsProcessing(true);
    setOrderResult(null);
    setResultData(null);
    setProcessingSteps(ORDER_STEPS.map((s): ProcessingStep => ({ ...s, status: 'pending' })));
    setProgress(0);

    try {
      // Step 1: 验证登录
      updateStep(1, 'processing');
      if (!authToken) {
        updateStep(1, 'failed', '未登录');
        showNotification('error', '请先登录后台系统');
        return;
      }
      updateStep(1, 'completed', '已连接后台');

      // Step 2: 确认用户
      updateStep(2, 'processing');
      updateStep(2, 'completed', `用户: ${selectedUser.username} (ID: ${selectedUser.id})`);

      // Step 3: 自动充余额（充值内部价格全额）
      updateStep(3, 'processing');
      // 充值金额 = 单价 × 数量（内部价格是单价，订单总额需乘以数量）
      const rechargeAmount = firstPrice ? parseFloat(firstPrice) * productQty : 0;
      if (autoRecharge && rechargeAmount > 0) {
        const currentBalance = parseFloat(String(selectedUser.credit || '0'));
        // 直接充值全额，不扣除现有余额，避免消耗用户原有余额
        const addMoneyRes = await fetch('/api/idc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'addBalance', token: authToken, cookie: sessionCookie,
            uid: selectedUser.id, amount: rechargeAmount, description: `一键开通充值 - 产品ID:${selectedProductId} - ${selectedBillingCycle}`,
          }),
        });
        const addMoneyResult = await addMoneyRes.json();
        if (addMoneyResult.success || addMoneyResult.status === 200 || addMoneyResult.status === 1 || addMoneyResult.msg === '请求成功') {
          setSelectedUser(prev => prev ? { ...prev, credit: (currentBalance + rechargeAmount).toFixed(2) } : prev);
          updateStep(3, 'completed', `已充值 ¥${rechargeAmount.toFixed(2)} (原余额 ¥${currentBalance.toFixed(2)})`);
        } else {
          updateStep(3, 'failed', addMoneyResult.msg || '余额充值失败');
          showNotification('error', addMoneyResult.msg || '余额充值失败');
          return;
        }
      } else if (!autoRecharge) {
        updateStep(3, 'completed', '未启用自动充值');
      } else {
        updateStep(3, 'completed', '无需充值');
      }

      // Step 4: 创建订单
      // 关键: configoptions(复数)才能保存到host_configoptions表
      // 构建configoptions: 过滤掉os_cat_前缀的临时值和qty_前缀的数量值
      const configoptions: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(configValues)) {
        if (key.startsWith('os_cat_')) continue; // 跳过OS分类的临时选择
        if (key.startsWith('qty_')) {
          // option_type=14(数量类型): configoptions直接传数量值(如36)，不再使用configoption_qty
          // API实测: configoptions={"392124": 36} 才能正确保存qty，configoption_qty无效
          const optId = key.replace('qty_', '');
          configoptions[optId] = parseInt(value, 10) || 0;
          continue;
        }
        configoptions[key] = value;
      }

      // 构建customfield (自定义字段) - 从set_config API动态获取
      const customfield: Record<string, string> = {};
      for (const [key, value] of Object.entries(customFieldValues)) {
        if (value) customfield[key] = value;
      }

      updateStep(4, 'processing');
      const orderRes = await callIdcApi('createOrder', {
        uid: selectedUser.id,
        payment: selectedGateway || 'E007alipay',
        pid: selectedProductId,
        billingcycle: selectedBillingCycle,
        qty: productQty,
        use_credit: (autoRecharge || useCredit) ? 1 : 0,
        interior_price: firstPrice ? parseFloat(firstPrice) : 0,
        interior_price_renew: renewPrice ? parseFloat(renewPrice) : 0,
        configoptions,
        customfield,
      });

      if (!orderRes.success) {
        updateStep(4, 'failed', orderRes.msg || '订单创建失败');
        showNotification('error', orderRes.msg || '订单创建失败');
        return;
      }

      const orderId = orderRes.data?.orderid || orderRes.data?.order_id || orderRes.data?.id;
      updateStep(4, 'completed', `订单号: ${orderId || '已创建'}`);

      // Step 5: 开通服务
      // adminorderconf=1 + status=Active 时，IDCSmart后台创建订单后已自动开通
      updateStep(5, 'processing');

      // 分阶段轮询获取产品信息：台数多时财务系统可能尚未处理完，需要等待重试
      const currentProductName = productInfoMap.get(selectedProductId || 0)?.name || '';
      const maxWaitMs = Math.min(3000 + productQty * 2000, 30000); // 基础3秒 + 每台2秒，上限30秒
      const retryBudgetMs = Math.min(productQty * 3000, 30000); // 重试阶段独立时间预算：每台3秒，上限30秒
      const pollInterval = 3000;
      const startTime = Date.now();
      let hostItems: Record<string, unknown>[] = [];

      while (Date.now() - startTime < maxWaitMs) {
        const serviceRes = await callIdcApi('getServiceInfo', { uid: selectedUser.id });
        const hostList = serviceRes.data?.list || [];
        hostItems = hostList.filter((h: Record<string, unknown>) => h.orderid === orderId);
        if (hostItems.length === 0) {
          const sorted = [...hostList].sort((a: Record<string, unknown>, b: Record<string, unknown>) => (b.id as number) - (a.id as number));
          hostItems = sorted.slice(0, productQty);
        }
        if (hostItems.length >= productQty) break;
        updateStep(5, 'processing', `等待开通中 (${hostItems.length}/${productQty})...`);
        await new Promise(r => setTimeout(r, pollInterval));
      }
      
      if (hostItems.length === 0) {
        updateStep(5, 'failed', '无法获取服务ID，请手动开通');
        showNotification('error', '订单已创建但无法自动获取服务ID');
        setOrderResult({ success: false, orderId: String(orderId || ''), message: '订单已创建，需手动开通' });
        return;
      }

      // 逐个获取服务详情（IP、密码等）
      const results: { orderId: string; ip: string; username: string; password: string; hostId: string; uid: string; dcimid: string; nextduedate?: string; amount?: string; billingcycle?: string; productName?: string }[] = [];
      for (const hostItem of hostItems) {
        const hid = hostItem.id;
        try {
          const detailRes = await callIdcApi('getHostDetail', { uid: selectedUser.id, hostselect: hid });
          const hostData = detailRes.data?.host_data || {};
          const dedicatedIp = hostData.dedicatedip || '';
          const assignedIps = Array.isArray(hostData.assignedips) ? hostData.assignedips.filter((ip: string) => ip) : [];
          const serverIp = dedicatedIp || (assignedIps.length > 0 ? assignedIps[0] : '');
          results.push({
            orderId: String(orderId || ''),
            ip: serverIp || '',
            username: hostData.username || '',
            password: hostData.password || '',
            hostId: String(hid),
            uid: String(hostData.uid || selectedUser?.id || ''),
            dcimid: String(hostData.dcimid || ''),
            nextduedate: hostData.nextduedate || '',
            amount: hostData.amount || '',
            billingcycle: hostData.billingcycle || '',
            productName: currentProductName,
          });
        } catch {
          results.push({
            orderId: String(orderId || ''),
            ip: '',
            username: '',
            password: '',
            hostId: String(hid),
            uid: String(selectedUser?.id || ''),
            dcimid: '',
            nextduedate: '',
            amount: '',
            billingcycle: '',
            productName: currentProductName,
          });
        }
      }

      // 对缺少IP或用户名的产品重试获取详情（财务系统可能还在处理）
      const incompleteIndices = results.map((r, i) => ((!r.ip || !r.username) ? i : -1)).filter(i => i >= 0);
      if (incompleteIndices.length > 0) {
        const retryStart = Date.now();
        updateStep(5, 'processing', `获取详情中 (${results.length - incompleteIndices.length}/${results.length})...`);
        for (let retry = 0; retry < 4 && incompleteIndices.length > 0 && Date.now() - retryStart < retryBudgetMs; retry++) {
          await new Promise(r => setTimeout(r, pollInterval));
          const stillIncomplete: number[] = [];
          for (const idx of incompleteIndices) {
            const item = results[idx];
            try {
              const detailRes = await callIdcApi('getHostDetail', { uid: selectedUser.id, hostselect: item.hostId });
              const hostData = detailRes.data?.host_data || {};
              const dedicatedIp = hostData.dedicatedip || '';
              const assignedIps = Array.isArray(hostData.assignedips) ? hostData.assignedips.filter((ip: string) => ip) : [];
              const serverIp = dedicatedIp || (assignedIps.length > 0 ? assignedIps[0] : '');
              if (serverIp && hostData.username) {
                results[idx] = { ...item, ip: serverIp, username: hostData.username || item.username, password: hostData.password || item.password, nextduedate: hostData.nextduedate || item.nextduedate, amount: hostData.amount || item.amount, billingcycle: hostData.billingcycle || item.billingcycle, dcimid: String(hostData.dcimid || item.dcimid) };
              } else {
                stillIncomplete.push(idx);
              }
            } catch {
              stillIncomplete.push(idx);
            }
          }
          incompleteIndices.length = 0;
          incompleteIndices.push(...stillIncomplete);
        }
      }

      setResultData(results);
      const ips = results.map(r => r.ip).filter(Boolean);
      const incompleteCount = results.filter(r => !r.ip || !r.username).length;
      if (incompleteCount > 0) {
        updateStep(5, 'completed', `已获取 ${ips.length}/${results.length} 台信息，${incompleteCount}台仍在开通中`);
        showNotification('info', `${incompleteCount}台服务器信息暂未就绪，可稍后在管理页查看`);
      } else {
        updateStep(5, 'completed', ips.length > 0 ? `服务已开通 IP:${ips.join(', ')}` : `服务已开通(${results.length}台)`);
      }
      setProgress(100);
      setOrderResult({ success: true, orderId: String(orderId || ''), message: '一键开通成功！' });
      showNotification('success', '一键开通成功！云服务器已自动开通');
      if (selectedUser) fetchUserProducts(selectedUser.id);
    } catch (error) {
      showNotification('error', `处理过程出错: ${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const copyText = useCallback((text: string) => {
    if (!text) return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showNotification('success', '已复制到剪贴板');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }, [showNotification]);

  const fallbackCopy = useCallback((text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
    try {
      document.execCommand('copy');
      showNotification('success', '已复制到剪贴板');
    } catch {
      showNotification('error', '复制失败，请手动复制');
    }
    document.body.removeChild(textarea);
  }, [showNotification]);

  // 渲染配置选项
  // 套餐模式下判断配置选项是否为核心选项（始终显示）
  // 核心：操作系统(option_type=5)、节点、IP分组节点优先级
  // 其余为额外选项（折叠显示）
  const isCoreOptionInPackageMode = (opt: ConfigOption): boolean => {
    // 操作系统 (option_type=5) 始终是核心
    if (opt.option_type === 5) return true;
    const name = (opt.option_name || '').toLowerCase();
    // 节点相关（包含"节点"）
    if (name.includes('节点')) return true;
    if (name.includes('node')) return true;
    // IP分组节点优先级（精确匹配，排除"IP数量"等）
    if (name.includes('ip分组') || name.includes('ip优先级') || name.includes('分组节点') || name.includes('优先级')) return true;
    return false;
  };

  // ==================== 主界面 ====================
  return (
    <div className="min-h-screen">
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm animate-in slide-in-from-top-2 ${
          notification.type === 'success' ? 'bg-success text-success-foreground' :
          notification.type === 'error' ? 'bg-destructive text-destructive-foreground' : 'bg-info text-info-foreground'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4" /> :
           notification.type === 'error' ? <XCircle className="w-4 h-4" /> :
           <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      <PageHeader
        title="首页"
        titleIcon={Zap}
        actions={
          <>
            <Badge variant="outline" className="border-success/40 text-success bg-success/10">
              <CheckCircle className="w-3 h-3 mr-1" />已连接
            </Badge>
            <Button variant="outline" size="sm" onClick={loadProducts} disabled={isLoadingProducts}
              className="border-border bg-muted text-foreground hover:bg-accent h-8 px-2 sm:px-3">
              {isLoadingProducts ? <Loader2 className="w-4 h-4 animate-spin sm:mr-1" /> : <RefreshCw className="w-4 h-4 sm:mr-1" />}
              <span className="hidden sm:inline">刷新产品</span>
            </Button>
          </>
        }
      />
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6 space-y-4 sm:space-y-6">
        {floatingUserPanelEnabled && isDesktopFloatingPanel && showFloatingUserPanel && !floatingUserPanelClosed && (
          <div
            className={`fixed z-40 right-2 sm:right-4 top-1/2 -translate-y-1/2 transform-gpu transition-[opacity,transform] duration-300 ease-out ${floatingUserPanelMinimized ? 'w-auto' : ''} ${showFloatingUserPanel ? 'translate-x-0 opacity-100' : 'translate-x-8 opacity-0 pointer-events-none'}`}
            style={floatingUserPanelMinimized ? undefined : { width: Math.min(floatingUserPanelSize.width, typeof window !== 'undefined' ? window.innerWidth - 16 : floatingUserPanelSize.width) }}
          >
            {floatingUserPanelMinimized ? (
              <button
                type="button"
                onClick={() => setFloatingUserPanelMinimized(false)}
                className="flex items-center gap-2 rounded-full border border-primary/40 bg-card/95 px-3 py-2 text-sm text-foreground shadow-2xl shadow-black/30 backdrop-blur hover:border-primary hover:text-primary transition-colors"
              >
                <Users className="w-4 h-4 text-primary" />
                用户管理
              </button>
            ) : (
              <div
                className={`relative overflow-hidden rounded-2xl border bg-background text-foreground shadow-2xl shadow-black/40 ring-1 ring-white/5 ${isResizingFloatingPanel ? 'border-primary/80 ring-primary/30' : 'border-border/80'}`}
                style={{ height: Math.min(floatingUserPanelSize.height, typeof window !== 'undefined' ? window.innerHeight - 32 : floatingUserPanelSize.height) }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-border/70 bg-muted/80 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                      <Users className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-foreground">悬浮用户管理</div>
                      <div className="text-xs text-muted-foreground">搜索、选择、查看用户信息</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => setFloatingUserPanelMinimized(true)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                      <Minus className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setFloatingUserPanelClosed(true)} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-3 overflow-y-auto p-3" style={{ height: 'calc(100% - 53px)' }}>
                  <div className="flex gap-2">
                    <select
                      value={searchType}
                      onChange={(e) => setSearchType(e.target.value as typeof searchType)}
                      className="h-9 w-20 shrink-0 rounded-md border border-border bg-background/70 px-2 text-xs text-foreground"
                    >
                      <option value="auto">自动</option>
                      <option value="uid">UID</option>
                      <option value="username">用户名</option>
                      <option value="email">邮箱</option>
                      <option value="phone">手机号</option>
                      <option value="qq">QQ号</option>
                    </select>
                    <div className="relative min-w-0 flex-1">
                      <Input
                        placeholder="搜索用户"
                        value={searchKeyword}
                        onChange={(e) => { setSearchKeyword(e.target.value); if (!e.target.value) setSearchResults([]); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                        className="h-9 bg-background/70 border-border text-foreground placeholder:text-muted-foreground pr-8"
                      />
                      {searchKeyword && (
                        <button onClick={() => { setSearchKeyword(''); setSearchResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <Button onClick={() => void handleSearchUsers()} disabled={isSearching} size="sm" className="h-9 bg-primary hover:bg-primary/90 px-3">
                      {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>

                  {searchResults.length > 0 && (
                    <div className="overflow-hidden rounded-lg border border-border">
                      <div className="max-h-56 overflow-y-auto">
                        {searchResults.map((user) => (
                          <button key={user.id} type="button" onClick={() => {
                            resetCycleOnUserChange();
                            setSelectedUser(user);
                            setUseCredit(parseFloat(String(user.credit || '0')) > 0);
                            fetchUserProducts(user.id);
                            if (autoClearSearch) setSearchKeyword('');
                          }} className={`block w-full border-b border-border px-3 py-2 text-left last:border-b-0 transition-colors ${selectedUser?.id === user.id ? 'bg-primary/15' : 'hover:bg-muted/70'}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <Avatar key={user.qq || user.id} className="h-8 w-8 bg-accent shrink-0">
                                  {user.qq && <AvatarImage src={`https://q.qlogo.cn/headimg_dl?dst_uin=${user.qq}&spec=640&img_type=jpg`} alt={user.username} />}
                                  <AvatarFallback className="text-xs">{user.username?.[0]?.toUpperCase() || 'U'}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-foreground">{user.username || `UID:${user.id}`}</div>
                                  <div className="truncate text-xs text-muted-foreground">{user.email || user.phone || user.phonenumber || user.qq || '无联系方式'}</div>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="text-xs font-semibold text-primary">¥{user.credit || '0.00'}</div>
                                <div className="text-[11px] text-muted-foreground">ID: {user.id}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedUser ? (
                    <div className="rounded-xl border border-primary/30 bg-background/60 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Avatar key={selectedUser.qq || selectedUser.id} className="h-10 w-10 bg-primary/20 shrink-0">
                            {selectedUser.qq && <AvatarImage src={`https://q.qlogo.cn/headimg_dl?dst_uin=${selectedUser.qq}&spec=640&img_type=jpg`} alt={selectedUser.username} />}
                            <AvatarFallback className="text-primary">{selectedUser.username?.[0]?.toUpperCase() || 'U'}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-foreground">{selectedUser.username || `UID:${selectedUser.id}`}</div>
                            <div className="text-xs text-muted-foreground">UID: {selectedUser.id}</div>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => { resetCycleOnUserChange(); setSelectedUser(null); }} className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded-lg bg-card/70 p-2">
                          <div className="text-muted-foreground">余额</div>
                          <div className="mt-0.5 text-base font-bold text-primary">¥{selectedUser.credit || '0.00'}</div>
                        </div>
                        <div className="rounded-lg bg-card/70 p-2">
                          <div className="text-muted-foreground">认证</div>
                          <div className={`mt-1 font-medium ${selectedUser.person_status === '已认证' || selectedUser.company_status === '已认证' ? 'text-success' : 'text-destructive'}`}>
                            {selectedUser.person_status === '已认证' ? '个人已认证' : selectedUser.company_status === '已认证' ? '企业已认证' : '未认证'}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">手机</span>
                          <span className="truncate text-foreground">{selectedUser.phonenumber || selectedUser.phone || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">邮箱</span>
                          <span className="truncate text-foreground">{selectedUser.email || '-'}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">QQ</span>
                          <span className="truncate text-foreground">{selectedUser.qq || '-'}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border bg-background/40 py-6 text-center">
                      <User className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                      <div className="text-sm text-muted-foreground">暂无选中用户</div>
                      <div className="mt-1 text-xs text-muted-foreground">搜索后点击用户即可选择</div>
                    </div>
                  )}
                </div>
                <div
                  role="separator"
                  aria-label="拖动调整悬浮窗大小"
                  onPointerDown={handleFloatingPanelResizeStart}
                  className="absolute bottom-0 left-0 h-6 w-6 cursor-nwse-resize rounded-tr-xl border-t border-r border-primary/30 bg-primary/10 transition-colors hover:bg-primary/25"
                >
                  <div className="absolute bottom-1 left-1 h-2.5 w-2.5 border-b-2 border-l-2 border-primary/80" />
                </div>
              </div>
            )}
          </div>
        )}
        {/* 用户管理 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-foreground text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              用户管理 - 余额充值
            </CardTitle>
            <CardDescription className="text-muted-foreground">搜索用户并为指定用户添加余额</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as typeof searchType)}
                className="h-9 rounded-md border border-border bg-card/50 text-sm text-foreground px-2 shrink-0 sm:w-auto w-full"
              >
                <option value="auto">自动</option>
                <option value="uid">UID</option>
                <option value="username">用户名</option>
                <option value="email">邮箱</option>
                <option value="phone">手机号</option>
                <option value="qq">QQ号</option>
              </select>
              <div className="relative flex-1">
                <Input placeholder={searchType === 'uid' ? '输入用户UID' : searchType === 'username' ? '输入用户名' : searchType === 'email' ? '输入邮箱' : searchType === 'phone' ? '输入手机号' : searchType === 'qq' ? '输入QQ号' : '输入UID/用户名/邮箱/手机号/QQ号搜索用户'}
                  value={searchKeyword}
                  onChange={(e) => { setSearchKeyword(e.target.value); if (!e.target.value) setSearchResults([]); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearchUsers()}
                  className="bg-card/50 border-border text-foreground placeholder:text-muted-foreground pr-8" />
                {searchKeyword && (
                  <button onClick={() => { setSearchKeyword(''); setSearchResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <Button onClick={() => void handleSearchUsers()} disabled={isSearching} className="bg-primary hover:bg-primary/90">
                {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span className="ml-1">搜索</span>
              </Button>
            </div>

            {searchResults.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.map((user) => (
                    <div key={user.id} onClick={() => { 
                      resetCycleOnUserChange();
                      setSelectedUser(user); 
                      setUseCredit(parseFloat(String(user.credit || '0')) > 0);
                      fetchUserProducts(user.id);
                      if (autoClearSearch) setSearchKeyword('');
                    }}
                      className={`px-4 py-3 cursor-pointer transition-colors border-b border-border last:border-b-0 ${
                        selectedUser?.id === user.id ? 'bg-primary/20' : 'hover:bg-accent/50'
                      }`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                          <Avatar key={user.qq || user.id} className="w-8 h-8 bg-muted shrink-0">
                            {user.qq && <AvatarImage src={`https://q.qlogo.cn/headimg_dl?dst_uin=${user.qq}&spec=640&img_type=jpg`} alt={user.username} />}
                            <AvatarFallback className="text-xs">{user.username?.[0]?.toUpperCase() || 'U'}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-foreground font-medium truncate">{user.username}</p>
                            <p className="text-muted-foreground text-xs truncate">{user.email || user.phone || user.phonenumber || '无联系方式'}</p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-primary font-bold text-sm">¥{user.credit || '0.00'}</p>
                          <p className="text-muted-foreground text-xs">ID: {user.id}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedUser && (
              <div className="bg-card/50 rounded-lg p-3 sm:p-4 border border-primary/30">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 overflow-hidden">
                    <Avatar key={selectedUser.qq || selectedUser.id} className="w-10 h-10 bg-primary/20 shrink-0">
                      {selectedUser.qq && <AvatarImage src={`https://q.qlogo.cn/headimg_dl?dst_uin=${selectedUser.qq}&spec=640&img_type=jpg`} alt={selectedUser.username} />}
                      <AvatarFallback className="text-primary">{selectedUser.username?.[0]?.toUpperCase() || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground font-bold truncate">{selectedUser.username} <span className="text-muted-foreground font-normal text-xs">UID: {selectedUser.id}</span></p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                        {selectedUser.phonenumber && (
                          <p className="text-muted-foreground text-sm flex items-center gap-1">
                            手机: <span className="text-foreground">{selectedUser.phonenumber}</span>
                            <button onClick={() => copyText(selectedUser.phonenumber!)} className="text-muted-foreground hover:text-primary transition-colors" title="复制手机号">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                            </button>
                          </p>
                        )}
                        {selectedUser.email && (
                          <p className="text-muted-foreground text-sm flex items-center gap-1">
                            邮箱: <span className="text-foreground">{selectedUser.email}</span>
                            <button onClick={() => copyText(selectedUser.email!)} className="text-muted-foreground hover:text-primary transition-colors" title="复制邮箱">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                            </button>
                          </p>
                        )}
                        {selectedUser.qq && (
                          <p className="text-muted-foreground text-sm flex items-center gap-1">
                            QQ: <span className="text-foreground">{selectedUser.qq}</span>
                            <button onClick={() => copyText(selectedUser.qq!)} className="text-muted-foreground hover:text-primary transition-colors" title="复制QQ">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" strokeWidth="2"/></svg>
                            </button>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                        <p className="text-muted-foreground text-sm">余额: <span className="text-primary font-bold">¥{selectedUser.credit || '0.00'}</span></p>
                        <p className="text-muted-foreground text-sm">
                          认证: {' '}
                          {selectedUser.person_status === '已认证' ? (
                            <span className="text-success font-medium">已认证(个人)</span>
                          ) : selectedUser.company_status === '已认证' ? (
                            <span className="text-success font-medium">已认证(企业)</span>
                          ) : (
                            <span className="text-destructive font-medium">未认证</span>
                          )}
                        </p>
                        {isAdminUser && financeUrl && (
                          <a href={`${financeUrl}/#/customer-view/abstract?id=${selectedUser.id}`} target="_blank" rel="noopener noreferrer"
                            className="text-info text-sm hover:text-info transition-colors inline-flex items-center gap-0.5">
                            <ExternalLink className="w-3 h-3" />财务
                          </a>
                        )}
                        <a href={`/user-instances?q=${encodeURIComponent(selectedUser.phonenumber || selectedUser.phone || selectedUser.email || selectedUser.username || '')}`} target="_blank" rel="noopener noreferrer"
                          className="text-primary text-sm hover:text-primary transition-colors inline-flex items-center gap-0.5">
                          <Server className="w-3 h-3" />实例
                        </a>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-0 shrink-0">
                    <Button variant="ghost" size="sm" onClick={async () => {
                      if (!selectedUser) return;
                      try {
                        const keyword = selectedUser.phonenumber || selectedUser.phone || String(selectedUser.username);
                        const res = await callIdcApi('searchUser', { keyword });
                        const list = res.data?.list || res.list || [];
                        const matched = list.find((u: Record<string, unknown>) => String(u.phonenumber || u.phone) === keyword || String(u.username) === String(selectedUser.username));
                        if (matched) {
                          setSelectedUser(matched as typeof selectedUser);
                        }
                        fetchUserProducts(Number(selectedUser.id));
                        showNotification('success', '用户信息已刷新');
                      } catch { showNotification('error', '刷新失败'); }
                    }} className="text-muted-foreground hover:text-primary h-7 w-7 p-0" title="刷新用户信息">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { resetCycleOnUserChange(); setSelectedUser(null); }} className="text-muted-foreground hover:text-foreground h-7 w-7 p-0">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {isAdminUser && (
                <button type="button" onClick={() => setShowRechargeArea(!showRechargeArea)}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary transition-colors mt-1">
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>余额充值</span>
                  {showRechargeArea ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                )}
                {isAdminUser && showRechargeArea && (
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="flex-1">
                    <label className="text-muted-foreground text-sm mb-1 block">充值金额 (元)</label>
                    <Input type="number" min="0" step="0.01" placeholder="输入金额" value={addAmount}
                      onChange={(e) => setAddAmount(e.target.value)} className="bg-muted border-border text-foreground" />
                  </div>
                  <div className="flex-1">
                    <label className="text-muted-foreground text-sm mb-1 block">备注 (可选)</label>
                    <Input placeholder="充值备注" value={addDescription}
                      onChange={(e) => setAddDescription(e.target.value)} className="bg-muted border-border text-foreground" />
                  </div>
                  <div className="flex items-end sm:self-end">
                    <Button onClick={handleAddBalance} disabled={isAddingBalance} className="bg-success text-success-foreground hover:bg-success/90 whitespace-nowrap w-full sm:w-auto">
                      {isAddingBalance ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      <span className="ml-1">确认充值</span>
                    </Button>
                  </div>
                </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 主标签切换 */}
        <Card>
          <CardContent className="py-px flex justify-center">
            <div className="flex rounded-lg overflow-hidden border border-border bg-card dark:bg-accent shadow-sm">
            <button
              type="button"
              onClick={() => setMainTab('provision')}
              className={`py-2.5 px-4 sm:px-6 text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors justify-center ${
                mainTab === 'provision'
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <Zap className="w-4 h-4" />
              开通套餐
            </button>
            <button
              type="button"
              onClick={() => { setMainTab('renew'); if (selectedUser) fetchUserProducts(selectedUser.id); }}
              className={`py-2.5 px-4 sm:px-6 text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors justify-center ${
                mainTab === 'renew'
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              产品管理
            </button>
            </div>
          </CardContent>
        </Card>

        {/* 产品管理页 */}
        {mainTab === 'renew' && !selectedUser && (
            <Card className="border-dashed">
              <CardContent className="py-16 text-center">
                <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">请先选择用户</h3>
                <p className="text-sm text-muted-foreground">在上方搜索并选择用户后，即可查看产品管理信息</p>
              </CardContent>
            </Card>
        )}

        {/* 续费确认对话框 */}
        <Dialog open={showRenewConfirm} onOpenChange={(open) => { setShowRenewConfirm(open); if (!open) { setRenewAsAnnually(new Set()); setRenewCycles(1); setDirectRenewId(null); } }}>
          <DialogContent className="border-border bg-card text-foreground w-[calc(100vw-1.5rem)] sm:w-full max-h-[85vh] flex flex-col p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-foreground">确认续费</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                以下产品将被续费，月付产品可转年付续费
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 max-h-[30vh] sm:max-h-[350px] overflow-y-auto overscroll-contain -mx-1 px-1">
              {Array.from(renewTargetIds).map(hostId => {
                const product = userProducts.find((p: Record<string, unknown>) => p.id === hostId);
                if (!product) return null;
                const productName = String(product.productname || product.product_name || '未知产品');
                const domain = String(product.domain || '');
                const amount = String(product.amount || '0');
                const cycle = String(product.billingcycle || '');
                const isConvertToAnnually = renewAsAnnually.has(hostId);
                const isMonthly = cycle !== 'annually';
                const annuallyPkg = isMonthly ? findMatchingPackage(product, 'annually') : null;
                const displayAmount = isConvertToAnnually && annuallyPkg ? annuallyPkg.renewPrice : amount;
                const displayCycle = isConvertToAnnually ? '年付' : (CYCLE_MAP[cycle] || cycle);
                const totalAmount = parseFloat(String(displayAmount).replace(/[^\d.]/g, '') || '0') * renewCycles;
                return (
                  <div key={hostId} className={`rounded-lg border px-2.5 py-2 sm:px-3 sm:py-2 transition-colors ${isConvertToAnnually ? 'border-warning/40 bg-warning/5' : 'border-border bg-muted/50'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{productName}</div>
                        <div className="text-xs text-muted-foreground truncate">{domain && <span className="mr-1">{domain}</span>}ID: {hostId}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-sm font-semibold ${isConvertToAnnually ? 'text-warning' : 'text-primary'}`}>
                          {renewCycles > 1 ? (
                            <><span className="text-xs sm:text-sm">¥{totalAmount.toFixed(2)}</span> <span className="text-[10px] sm:text-xs font-normal text-muted-foreground">(¥{parseFloat(String(displayAmount).replace(/[^\d.]/g, '') || '0').toFixed(2)}×{renewCycles})</span></>
                          ) : (
                            <>¥{parseFloat(String(displayAmount).replace(/[^\d.]/g, '') || '0').toFixed(2)}</>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{displayCycle}{renewCycles > 1 ? ` ×${renewCycles}` : ''}</div>
                      </div>
                    </div>
                    {/* 月付产品显示转年付选项 */}
                    {isMonthly && annuallyPkg && (
                      <div className="mt-1.5 pt-1.5 border-t border-border/50">
                        <button
                          type="button"
                          onClick={() => {
                            setRenewAsAnnually(prev => {
                              const next = new Set(prev);
                              if (next.has(hostId)) next.delete(hostId); else next.add(hostId);
                              return next;
                            });
                          }}
                          className={`flex items-center gap-1.5 text-xs transition-colors ${isConvertToAnnually ? 'text-warning' : 'text-muted-foreground hover:text-warning'}`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${isConvertToAnnually ? 'border-warning bg-warning' : 'border-border'}`}>
                            {isConvertToAnnually && <CheckCircle className="w-2.5 h-2.5 text-primary-foreground" />}
                          </span>
                          <span className="truncate">转年付 ¥{parseFloat(String(annuallyPkg.renewPrice).replace(/[^\d.]/g, '') || '0').toFixed(2)}/年</span>
                          <span className="text-muted-foreground line-through ml-0.5 shrink-0">¥{parseFloat(String(amount).replace(/[^\d.]/g, '') || '0').toFixed(2)}/月</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 续费周期数选择 */}
            <div className="flex items-center justify-between border-t border-border pt-3 gap-2">
              <span className="text-foreground/80 text-sm shrink-0">续费周期数</span>
              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={() => setRenewCycles(prev => Math.max(1, prev - 1))}
                  className="w-7 h-7 rounded border border-border bg-muted text-foreground/80 hover:bg-accent flex items-center justify-center transition-colors text-base"
                >−</button>
                <input
                  type="number"
                  min={1}
                  max={36}
                  value={renewCycles}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= 36) setRenewCycles(v);
                    else if (e.target.value === '') setRenewCycles(1);
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (isNaN(v) || v < 1) setRenewCycles(1);
                    else if (v > 36) setRenewCycles(36);
                  }}
                  className="w-11 h-7 rounded border border-border bg-muted text-foreground font-semibold text-base text-center outline-none focus:border-info [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => setRenewCycles(prev => Math.min(36, prev + 1))}
                  className="w-7 h-7 rounded border border-border bg-muted text-foreground/80 hover:bg-accent flex items-center justify-center transition-colors text-base"
                >+</button>
                <span className="text-muted-foreground text-xs">个周期</span>
              </div>
            </div>
            <div className="border-t border-border pt-3 mt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-sm">共 {renewTargetIds.size} 项，总计</span>
                <span className={`text-lg sm:text-xl font-bold ${renewAsAnnually.size > 0 ? 'text-warning' : 'text-primary'}`}>
                  ¥{Array.from(renewTargetIds).reduce((sum, hostId) => {
                    const product = userProducts.find((p: Record<string, unknown>) => p.id === hostId);
                    if (!product) return sum;
                    const isConvertToAnnually = renewAsAnnually.has(hostId);
                    if (isConvertToAnnually) {
                      const annuallyPkg = findMatchingPackage(product, 'annually');
                      return sum + (parseFloat(String(annuallyPkg?.renewPrice || '0').replace(/[^\d.]/g, '')) || 0) * renewCycles;
                    }
                    return sum + (parseFloat(String(product.amount || '0').replace(/[^\d.]/g, '')) || 0) * renewCycles;
                  }, 0).toFixed(2)}
                </span>
              </div>
              {renewAsAnnually.size > 0 && (
                <div className="text-xs text-warning/70 mt-1">
                  其中 {renewAsAnnually.size} 项将转年付续费
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowRenewConfirm(false)} className="border-border text-foreground/80 h-9">取消</Button>
              <Button onClick={() => { const c = renewCycles; setShowRenewConfirm(false); handleRenewSelected(c); }} className={`${renewAsAnnually.size > 0 ? 'bg-warning text-warning-foreground hover:bg-warning/90' : 'bg-primary text-primary-foreground hover:bg-primary/90'} h-9`}>
                <RefreshCw className="w-4 h-4 mr-1" />
                确认续费{renewCycles > 1 ? ` ×${renewCycles}` : ''}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 升级套餐对话框 */}
        <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
          <DialogContent className="border-border bg-card text-foreground max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Package className="w-5 h-5 text-primary" />
                升级套餐
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {upgradeProduct ? `${String(upgradeProduct.productname || upgradeProduct.product_name || '')} (ID: ${upgradeProduct.id})` : ''}
              </DialogDescription>
            </DialogHeader>

            {upgradeLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
                <span className="text-muted-foreground">加载套餐信息...</span>
              </div>
            ) : upgradePackages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                暂无可升级套餐，请先在开通页面配置套餐
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto">
                {/* 当前套餐 */}
                {currentPackageId && (() => {
                  const currentPkg = upgradePackages.find(p => p.id === currentPackageId);
                  if (!currentPkg) return null;
                  return (
                    <div className="rounded-lg border border-info/30 bg-info/10 p-3">
                      <div className="text-xs text-info mb-1">当前套餐</div>
                      <div className="text-sm text-foreground font-medium">{currentPkg.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">续费 ¥{parseFloat(String(currentPkg.renewPrice || '0')).toFixed(2)}/{currentPkg.billingCycle === 'annually' ? '年' : '月'}</div>
                    </div>
                  );
                })()}

                {/* 周期切换 */}
                {(() => {
                  const hasMonthly = upgradePackages.some(p => p.billingCycle === 'monthly');
                  const hasAnnually = upgradePackages.some(p => p.billingCycle === 'annually');
                  if (!hasMonthly || !hasAnnually) return null;
                  return (
                    <div className="flex gap-2">
                      <button
                        className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${upgradeBillingCycle === 'monthly' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                        onClick={() => { setUpgradeBillingCycle('monthly'); setTargetPackageId(null); }}
                      >月付</button>
                      <button
                        className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${upgradeBillingCycle === 'annually' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-accent'}`}
                        onClick={() => { setUpgradeBillingCycle('annually'); setTargetPackageId(null); }}
                      >年付</button>
                    </div>
                  );
                })()}

                {/* 可升级套餐列表（按当前选中周期筛选） */}
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">选择目标套餐：</div>
                  {(() => {
                    const currentPkg = currentPackageId ? upgradePackages.find(p => p.id === currentPackageId) : null;
                    const currentPrice = currentPkg
                      ? parseFloat(String(currentPkg.renewPrice || '0')) || 0
                      : parseFloat(String(upgradeProduct?.amount || '0').replace(/[^\d.]/g, '')) || 0;

                    // 按当前选中周期筛选，只显示比当前贵的
                    const filteredPkgs = upgradePackages.filter(p => {
                      if (p.billingCycle !== upgradeBillingCycle) return false;
                      if (p.id === currentPackageId) return false;
                      const targetPrice = parseFloat(String(p.renewPrice || '0')) || 0;
                      return targetPrice > currentPrice;
                    });

                    if (filteredPkgs.length === 0) {
                      return <div className="text-xs text-muted-foreground text-center py-4">当前周期下暂无可升级套餐</div>;
                    }

                    return filteredPkgs.map(pkg => {
                      const isSelected = targetPackageId === pkg.id;
                      const targetPrice = parseFloat(String(pkg.renewPrice || '0')) || 0;
                      const priceDiff = targetPrice - currentPrice;
                      let upgradeCost = 0;
                      let remainingDays = 0;
                      let totalDays = 0;
                      const nextduedate = Number(upgradeProduct?.nextduedate || 0);
                      const regdate = Number(upgradeProduct?.regdate || 0);
                      const billingcycle = String(upgradeProduct?.billingcycle || 'monthly');
                      if (nextduedate > 0 && priceDiff > 0) {
                        const now = new Date();
                        now.setHours(0, 0, 0, 0);
                        const expire = new Date(nextduedate * 1000);
                        expire.setHours(0, 0, 0, 0);
                        remainingDays = Math.max(0, Math.ceil((expire.getTime() - now.getTime()) / 86400000));
                        if (remainingDays > 0) {
                          if (billingcycle === 'monthly') {
                            const orderDate = regdate > 0 ? new Date(regdate * 1000) : now;
                            let periodStart = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate());
                            while (true) {
                              const nextStart = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, periodStart.getDate());
                              if (nextStart.getTime() > now.getTime()) break;
                              periodStart = nextStart;
                            }
                            const daysInMonth = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0).getDate();
                            totalDays = daysInMonth;
                            upgradeCost = priceDiff / daysInMonth * remainingDays;
                          } else {
                            const start = regdate > 0 ? new Date(regdate * 1000) : now;
                            start.setHours(0, 0, 0, 0);
                            totalDays = Math.max(1, Math.ceil((expire.getTime() - start.getTime()) / 86400000));
                            upgradeCost = priceDiff / totalDays * remainingDays;
                          }
                        }
                      }

                      return (
                        <div
                          key={pkg.id}
                          className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                            isSelected
                              ? 'border-primary ring-1 ring-primary/30'
                              : 'border-border bg-muted/50 hover:border-border'
                          }`}
                          onClick={() => setTargetPackageId(pkg.id)}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-foreground">{pkg.name}</div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">续费 ¥{targetPrice.toFixed(2)}/{pkg.billingCycle === 'annually' ? '年' : '月'}</span>
                                {priceDiff > 0 && (
                                  <span className="text-xs text-primary">+¥{priceDiff.toFixed(2)}/{pkg.billingCycle === 'annually' ? '年' : '月'}</span>
                                )}
                              </div>
                              {/* 配置差异预览 */}
                              {isSelected && upgradeConfigOptions.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {(() => {
                                    const diffs: Array<{ name: string; from: string; to: string }> = [];
                                    for (const [key, value] of Object.entries(pkg.configValues)) {
                                      if (key.startsWith('os_cat_')) continue;
                                      const currentValue = currentPkg?.configValues?.[key];
                                      if (currentValue && currentValue !== value) {
                                        const optId = key.startsWith('qty_') ? key.replace('qty_', '') : key;
                                        const opt = upgradeConfigOptions.find(o => String(o.id) === optId);
                                        const name = opt?.option_name || `配置${optId}`;
                                        const fromLabel = currentPkg
                                          ? (opt?.child.find(c => String(c.id) === currentValue)?.option_name || currentValue)
                                          : currentValue;
                                        const toLabel = opt?.child.find(c => String(c.id) === value)?.option_name || value;
                                        diffs.push({ name, from: fromLabel, to: toLabel });
                                      }
                                    }
                                    return diffs.map((d, i) => (
                                      <div key={i} className="text-xs flex items-center gap-1">
                                        <span className="text-muted-foreground">{d.name}:</span>
                                        <span className="text-muted-foreground">{d.from}</span>
                                        <span className="text-muted-foreground">→</span>
                                        <span className="text-primary">{d.to}</span>
                                      </div>
                                    ));
                                  })()}
                                  {priceDiff > 0 && (
                                    <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2 space-y-1.5">
                                      <div className="text-xs font-medium text-primary">差价明细</div>
                                      <div className="flex justify-between gap-3 text-xs">
                                        <span className="text-muted-foreground">当前套餐价格</span>
                                        <span className="text-foreground">¥{currentPrice.toFixed(2)}/{currentPkg?.billingCycle === 'annually' ? '年' : '月'}</span>
                                      </div>
                                      <div className="flex justify-between gap-3 text-xs">
                                        <span className="text-muted-foreground">目标套餐价格</span>
                                        <span className="text-foreground">¥{targetPrice.toFixed(2)}/{pkg.billingCycle === 'annually' ? '年' : '月'}</span>
                                      </div>
                                      <div className="flex justify-between gap-3 text-xs">
                                        <span className="text-muted-foreground">周期价格差额</span>
                                        <span className="text-primary">+¥{priceDiff.toFixed(2)}/{pkg.billingCycle === 'annually' ? '年' : '月'}</span>
                                      </div>
                                      <div className="border-t border-border/70 pt-1.5 space-y-1">
                                        <div className="text-xs font-medium text-foreground/80">费用组成</div>
                                        <div className="flex justify-between gap-3 text-xs">
                                          <span className="text-muted-foreground">基础套餐费用差异</span>
                                          <span className="text-primary">+¥{priceDiff.toFixed(2)}/{pkg.billingCycle === 'annually' ? '年' : '月'}</span>
                                        </div>
                                      </div>
                                      {upgradeCost > 0 && (
                                        <div className="border-t border-border/70 pt-1.5 space-y-1">
                                          <div className="flex justify-between gap-3 text-xs">
                                            <span className="text-muted-foreground">剩余天数</span>
                                            <span className="text-foreground">{remainingDays} 天</span>
                                          </div>
                                          <div className="flex justify-between gap-3 text-xs">
                                            <span className="text-muted-foreground">{billingcycle === 'monthly' ? '当前月天数' : '周期总天数'}</span>
                                            <span className="text-foreground">{totalDays} 天</span>
                                          </div>
                                          <div className="mt-1 rounded-lg border border-primary/40 bg-gradient-to-r from-primary/20 via-amber-500/10 to-transparent px-3 py-2 shadow-[0_0_18px_rgba(251,146,60,0.12)]">
                                            <div className="flex items-center justify-between gap-3">
                                              <span className="text-xs font-medium text-primary">最终应付升级差价</span>
                                              <span className="text-xl font-bold tracking-tight text-primary">¥{upgradeCost.toFixed(2)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className={`w-4 h-4 rounded-full border-2 ${
                              isSelected ? 'border-primary bg-primary/10' : 'border-border'
                            }`}>
                              {isSelected && <div className="w-full h-full rounded-full bg-card scale-50" />}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setUpgradeDialogOpen(false)} className="border-border text-foreground/80">取消</Button>
              <Button
                onClick={submitUpgrade}
                disabled={!targetPackageId || upgradeSubmitting}
                className="bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50"
              >
                {upgradeSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-1" />升级中...</>
                ) : (
                  <><Package className="w-4 h-4 mr-1" />确认升级</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 套餐修改对话框 */}
        <Dialog open={modifyDialogOpen} onOpenChange={setModifyDialogOpen}>
          <DialogContent className="border-border bg-card text-foreground max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Sliders className="w-5 h-5 text-info" />
                修改套餐配置
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                修改产品「{String(modifyProduct?.product_name || modifyProduct?.name || '')}」的配置项
              </DialogDescription>
            </DialogHeader>

            {modifyLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-info" />
                <span className="ml-2 text-muted-foreground">加载配置中...</span>
              </div>
            ) : modifyConfigOptions.length > 0 ? (
              <div className="space-y-4 py-2">
                {modifyConfigOptions.map(opt => (
                  <div key={opt.id} className="space-y-2">
                    <label className="text-sm font-medium text-foreground/80">
                      {opt.option_name}
                      {[7, 9, 11, 14, 15].includes(opt.option_type) && opt.unit && <span className="text-muted-foreground ml-1">({opt.unit})</span>}
                    </label>
                    {opt.option_type === 3 ? (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={modifySelectedValues[String(opt.id)] === '1'}
                          onClick={() => {
                            const cur = modifySelectedValues[String(opt.id)];
                            setModifySelectedValues(prev => ({ ...prev, [String(opt.id)]: cur === '1' ? '0' : '1' }));
                          }}
                          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                            modifySelectedValues[String(opt.id)] === '1' ? 'bg-primary' : 'bg-muted'
                          }`}
                        >
                          <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-card shadow transition duration-200 ${
                            modifySelectedValues[String(opt.id)] === '1' ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                        <span className="text-muted-foreground text-xs">{modifySelectedValues[String(opt.id)] === '1' ? '是' : '否'}</span>
                        {modifyCurrentValues[String(opt.id)] !== undefined && (
                          <span className="text-info/70 text-xs ml-1">
                            当前: {modifyCurrentValues[String(opt.id)] === '1' ? '是' : '否'}
                          </span>
                        )}
                      </div>
                    ) : [7, 9, 11, 14, 15].includes(opt.option_type) ? (
                      /* 数量型配置（如数据盘）- 显示数量输入框 */
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={opt.qty_minimum || 0}
                          max={opt.qty_maximum || 9999}
                          value={modifySelectedQtyValues[String(opt.id)] ?? modifyCurrentQtyValues[String(opt.id)] ?? opt.qty_minimum ?? 0}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const raw = e.target.value;
                            if (raw === '' || raw === '-') {
                              // 允许清空输入：设置为0但不立即触发范围限制
                              setModifySelectedQtyValues(prev => ({ ...prev, [String(opt.id)]: 0 }));
                              return;
                            }
                            setModifySelectedQtyValues(prev => ({ ...prev, [String(opt.id)]: Number(raw) }));
                          }}
                          onBlur={(e: React.FocusEvent<HTMLInputElement>) => {
                            // 失焦时才限制范围
                            const min = Number(opt.qty_minimum || 0);
                            const max = Number(opt.qty_maximum || 9999);
                            const val = Math.max(min, Math.min(max, Number(e.target.value) || min));
                            setModifySelectedQtyValues(prev => ({ ...prev, [String(opt.id)]: val }));
                          }}
                          className="w-24 px-3 py-1.5 rounded-md bg-muted border border-border text-foreground text-sm focus:border-primary focus:outline-none"
                        />
                        <span className="text-muted-foreground text-xs">{opt.unit || ''}</span>
                        <span className="text-muted-foreground text-xs">
                          ({opt.qty_minimum}-{opt.qty_maximum}{opt.unit || ''})
                        </span>
                        {modifyCurrentQtyValues[String(opt.id)] !== undefined && (
                          <span className="text-info/70 text-xs ml-1">
                            当前: {String(modifyCurrentQtyValues[String(opt.id)])}{opt.unit || ''}
                          </span>
                        )}
                      </div>
                    ) : (
                      /* 选择型配置 - 显示选项按钮 */
                      <div className="flex flex-wrap gap-2">
                        {opt.child.map(sub => {
                          const isSelected = modifySelectedValues[String(opt.id)] === String(sub.id);
                          const isCurrent = modifyCurrentValues[String(opt.id)] === String(sub.id);
                          const displayQty = Number(sub.qty || 0);
                          const displayUnit = String(sub.unit || '');
                          const subLabel = displayQty > 0 ? `${displayQty}${displayUnit || sub.option_name}` : sub.option_name;
                          return (
                            <button
                              key={sub.id}
                              type="button"
                              className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
                                isSelected && !isCurrent
                                  ? 'border-warning bg-warning/15 text-warning'
                                  : isCurrent
                                    ? 'border-info bg-info/15 text-info'
                                    : 'border-border bg-muted/50 text-muted-foreground hover:border-border'
                              }`}
                              onClick={() => {
                                setModifySelectedValues(prev => ({
                                  ...prev,
                                  [String(opt.id)]: String(sub.id),
                                }));
                              }}
                            >
                              {subLabel}
                              {isCurrent && <span className="ml-1 text-info/70">(当前)</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}

                {/* 价格修改 */}
                <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border">
                  <div className="flex items-center justify-center gap-4 px-6 py-2.5 bg-muted/50 rounded-lg">
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground mb-1 block">续费价格</label>
                      <div className="px-3 py-1.5 rounded-md bg-muted border border-border text-muted-foreground text-sm">
                        ¥{modifyCurrentAmount}
                      </div>
                    </div>
                    <span className="text-muted-foreground mt-4">→</span>
                    <div className="flex-1">
                      <label className="text-xs text-muted-foreground mb-1 block">新价格（不修改则保持原价）</label>
                      <input
                        type="number"
                        step="0.01"
                        value={modifyNewAmount}
                        onChange={e => setModifyNewAmount(e.target.value)}
                        className="w-full px-3 py-1.5 rounded-md bg-muted border border-border text-sm focus:outline-none focus:border-primary text-foreground"
                        placeholder={modifyCurrentAmount}
                      />
                    </div>
                  </div>
                </div>

                {/* 变更摘要 */}
                {(() => {
                  const changes: Array<{ name: string; from: string; to: string }> = [];
                  for (const [optId, subId] of Object.entries(modifySelectedValues)) {
                    if (modifyCurrentValues[optId] !== subId) {
                      const opt = modifyConfigOptions.find(o => String(o.id) === optId);
                      const fromSub = opt?.child.find(c => String(c.id) === modifyCurrentValues[optId]);
                      const toSub = opt?.child.find(c => String(c.id) === subId);
                      changes.push({
                        name: opt?.option_name || `配置${optId}`,
                        from: fromSub?.option_name || modifyCurrentValues[optId],
                        to: toSub?.option_name || subId,
                      });
                    }
                  }
                  const _np = Number(modifyNewAmount);
                  const _cp = Number(modifyCurrentAmount);
                  if (modifyNewAmount && !isNaN(_np) && Math.abs(_np - _cp) >= 0.01) {
                    changes.push({
                      name: '续费价格',
                      from: `¥${modifyCurrentAmount}`,
                      to: `¥${modifyNewAmount}`,
                    });
                  }
                  if (changes.length === 0) return null;
                  return (
                    <div className="mt-3 p-3 rounded-lg bg-info/10 border border-info/20">
                      <p className="text-xs text-info font-medium mb-2">变更摘要</p>
                      {changes.map((c, i) => (
                        <div key={i} className="text-xs flex items-center gap-1">
                          <span className="text-muted-foreground">{c.name}:</span>
                          <span className="text-muted-foreground">{c.from}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-info">{c.to}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">无可用配置项</div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setModifyDialogOpen(false)} className="border-border text-foreground/80">取消</Button>
              <Button
                onClick={submitModify}
                disabled={modifySubmitting || (() => {
                  let hasConfigChange = false;
                  for (const [optId, subId] of Object.entries(modifySelectedValues)) {
                    if (modifyCurrentValues[optId] !== subId) { hasConfigChange = true; break; }
                  }
                  // 检查数量型配置是否有变化
                  if (!hasConfigChange) {
                    for (const [optId, qty] of Object.entries(modifySelectedQtyValues)) {
                      if (modifyCurrentQtyValues[optId] !== qty) { hasConfigChange = true; break; }
                    }
                  }
                  const _np2 = Number(modifyNewAmount);
                  const _cp2 = Number(modifyCurrentAmount);
                  const hasPriceChange = modifyNewAmount && !isNaN(_np2) && Math.abs(_np2 - _cp2) >= 0.01;
                  return !(hasConfigChange || hasPriceChange);
                })()}
                className="bg-info text-info-foreground hover:bg-info/90 disabled:opacity-50"
              >
                {modifySubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin mr-1" />修改中...</>
                ) : (
                  <><Sliders className="w-4 h-4 mr-1" />确认修改</>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 批量导入套餐对话框 */}
        <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
          <DialogContent className="border-border bg-card text-foreground sm:!max-w-7xl !max-w-7xl w-[98vw] max-h-[85vh] overflow-y-auto p-6">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2 text-lg">
                <Plus className="w-5 h-5 text-success" />
                批量导入套餐
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-sm">
                填写套餐配置信息，系统会自动匹配当前产品的配置项并保存（每个套餐自动生成月付+年付两条）
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 mt-3">
              <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">名称</th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">CPU<span className="text-muted-foreground font-normal ml-1">(核)</span></th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">内存<span className="text-muted-foreground font-normal ml-1">(G)</span></th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">数据盘</th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">带宽<span className="text-muted-foreground font-normal ml-1">(M)</span></th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">月付价<span className="text-muted-foreground font-normal ml-1">(元)</span></th>
                    <th className="text-left py-3 px-3 text-foreground/80 font-semibold text-sm">年付价<span className="text-muted-foreground font-normal ml-1">(元)</span></th>
                    <th className="py-3 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((row, idx) => (
                    <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 px-3">
                        <Input value={row.name} onChange={(e) => updateImportRow(idx, 'name', e.target.value)}
                          className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[80px]" />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          <Input type="number" min="1" value={row.cpu} onChange={(e) => updateImportRow(idx, 'cpu', e.target.value)} placeholder="2"
                            className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[50px]" />
                          <span className="text-muted-foreground text-sm shrink-0">核</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          <Input type="number" min="1" value={row.ram} onChange={(e) => updateImportRow(idx, 'ram', e.target.value)} placeholder="2"
                            className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[50px]" />
                          <span className="text-muted-foreground text-sm shrink-0">G</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                          <Input type="number" min="0" value={row.disk} onChange={(e) => updateImportRow(idx, 'disk', e.target.value)} placeholder="30"
                            className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[50px]" />
                      </td>
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-1">
                          <Input type="number" min="1" value={row.bandwidth} onChange={(e) => updateImportRow(idx, 'bandwidth', e.target.value)} placeholder="30"
                            className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[50px]" />
                          <span className="text-muted-foreground text-sm shrink-0">M</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        <Input type="number" min="0" value={row.monthlyPrice} onChange={(e) => updateImportRow(idx, 'monthlyPrice', e.target.value)} placeholder="19"
                          className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[70px]" />
                      </td>
                      <td className="py-2 px-3">
                        <Input type="number" min="0" value={row.annuallyPrice} onChange={(e) => updateImportRow(idx, 'annuallyPrice', e.target.value)} placeholder="190"
                          className="bg-muted/50 border-border text-foreground h-9 text-sm w-full min-w-[70px]" />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <button type="button" onClick={() => removeImportRow(idx)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center gap-4 pt-1">
                <Button type="button" variant="outline" size="sm" onClick={addImportRow}
                  className="border-dashed border-border text-muted-foreground hover:text-foreground h-8 text-sm">
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> 添加一行
                </Button>
                <span className="text-xs text-muted-foreground">
                  只需输入数字，系统会自动匹配产品配置项
                </span>
              </div>
            </div>
            <DialogFooter className="mt-6 gap-3">
              <Button type="button" variant="ghost" onClick={() => setShowImportDialog(false)}
                className="text-muted-foreground hover:text-foreground">取消</Button>
              <Button type="button" onClick={handleBatchImport} disabled={importingPackages}
                className="bg-success hover:bg-success/90 text-success-foreground px-6">
                {importingPackages ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                导入 {importRows.filter(r => r.monthlyPrice || r.annuallyPrice).length} 个套餐 × 2周期
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 产品排序对话框 */}
        <Dialog open={showGroupSortDialog} onOpenChange={setShowGroupSortDialog}>
          <DialogContent className="border-border bg-card text-foreground sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-primary">产品排序与显示</DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">拖拽调整产品在下拉框中的显示顺序，点击眼睛图标隐藏/显示产品</DialogDescription>
            </DialogHeader>
            <DndContext
              sensors={dragSensors}
              collisionDetection={closestCenter}
              onDragEnd={(event: DragEndEvent) => {
                const { active, over } = event;
                if (over && active.id !== over.id) {
                  const oldIdx = productSortOrder.indexOf(Number(active.id));
                  const newIdx = productSortOrder.indexOf(Number(over.id));
                  if (oldIdx >= 0 && newIdx >= 0) {
                    setProductSortOrder(arrayMove(productSortOrder, oldIdx, newIdx));
                  }
                }
              }}
            >
              <SortableContext items={productSortOrder.map(String)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {productSortOrder.map((pid) => {
                    const pkg = savedPackages.find(p => p.productId === pid);
                    if (!pkg) return null;
                    return (
                      <SortableGroupItem
                        key={pid}
                        id={pid}
                        name={pkg.productName}
                        subCount={0}
                        hidden={hiddenProductIds.includes(pid)}
                        onToggleHidden={(id) => {
                          setHiddenProductIds(prev =>
                            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                          );
                        }}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowGroupSortDialog(false)}
                className="border-border text-muted-foreground">
                取消
              </Button>
              <Button type="button" size="sm" onClick={async () => {
                await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ productSortOrder, hiddenProductIds }),
                });
                setShowGroupSortDialog(false);
                showNotification('success', '产品排序与显示已保存');
              }} className="bg-primary hover:bg-primary/90 text-primary-foreground">
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 编辑套餐对话框 */}
        <Dialog open={showEditPackageDialog} onOpenChange={(open) => { setShowEditPackageDialog(open); if (!open) setEditingPackage(null); }}>
          <DialogContent className="border-border bg-card text-foreground sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Pencil className="w-5 h-5 text-info" />
                编辑套餐
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">修改套餐配置信息</DialogDescription>
            </DialogHeader>
            {editingPackage && (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">套餐名称</Label>
                    <Input
                      value={editingPackage.name}
                      onChange={(e) => setEditingPackage({ ...editingPackage, name: e.target.value })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">产品名称</Label>
                    <Input
                      value={editingPackage.productName}
                      onChange={(e) => setEditingPackage({ ...editingPackage, productName: e.target.value })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">计费周期</Label>
                    <Select
                      value={editingPackage.billingCycle}
                      onValueChange={(val) => setEditingPackage({
                        ...editingPackage,
                        billingCycle: val,
                        billingCycleLabel: val === 'monthly' ? '月付' : val === 'annually' ? '年付' : val,
                      })}
                    >
                      <SelectTrigger className="bg-muted border-border text-foreground text-sm h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        <SelectItem value="monthly" className="text-foreground focus:bg-accent">月付</SelectItem>
                        <SelectItem value="annually" className="text-foreground focus:bg-accent">年付</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">数量</Label>
                    <Input
                      type="number"
                      min={1}
                      value={editingPackage.productQty}
                      onChange={(e) => setEditingPackage({ ...editingPackage, productQty: parseInt(e.target.value) || 1 })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">首次价格</Label>
                    <Input
                      value={editingPackage.firstPrice}
                      onChange={(e) => setEditingPackage({ ...editingPackage, firstPrice: e.target.value })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">续费价格</Label>
                    <Input
                      value={editingPackage.renewPrice}
                      onChange={(e) => setEditingPackage({ ...editingPackage, renewPrice: e.target.value })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <Label className="text-foreground/80 text-xs mb-1 block">支付网关</Label>
                    <Input
                      value={editingPackage.gateway}
                      onChange={(e) => setEditingPackage({ ...editingPackage, gateway: e.target.value })}
                      className="bg-muted border-border text-foreground text-sm h-9"
                    />
                  </div>
                  <div className="flex items-end gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingPackage.useCredit}
                        onChange={(e) => setEditingPackage({ ...editingPackage, useCredit: e.target.checked })}
                        className="rounded border-border bg-accent"
                      />
                      <span className="text-foreground/80 text-xs">使用余额</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingPackage.autoRecharge}
                        onChange={(e) => setEditingPackage({ ...editingPackage, autoRecharge: e.target.checked })}
                        className="rounded border-border bg-accent"
                      />
                      <span className="text-foreground/80 text-xs">自动充余额</span>
                    </label>
                  </div>
                </div>
                {/* 配置项 */}
                <div>
                  <Label className="text-foreground/80 text-xs mb-2 block">配置项</Label>
                  {isLoadingEditConfig ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-xs py-3">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      加载配置选项中...
                    </div>
                  ) : (
                  <div className="bg-muted/50 rounded-lg border border-border p-3 max-h-60 overflow-y-auto">
                    <div className="space-y-2">
                      {(() => {
                        // 收集所有 os_cat_ 对应的 optId，这些纯数字 key 不单独渲染
                        const osCatOptIds = new Set<number>();
                        Object.keys(editingPackage.configValues).forEach(k => {
                          if (k.startsWith('os_cat_')) {
                            osCatOptIds.add(parseInt(k.replace('os_cat_', '')));
                          }
                        });
                        return Object.entries(editingPackage.configValues).filter(([key]) => {
                          // 跳过已被os_cat_合并的纯数字key
                          if (!key.startsWith('os_cat_') && !key.startsWith('qty_')) {
                            const numId = parseInt(key);
                            if (!isNaN(numId) && osCatOptIds.has(numId)) return false;
                            // 也跳过 option_type===5 的纯数字key
                            if (!isNaN(numId)) {
                              const cfg = editConfigOptions.find(o => o.id === numId);
                              if (cfg && cfg.option_type === 5) return false;
                            }
                          }
                          return true;
                        });
                      })().map(([key, value]) => {
                        let optId: number;
                        let optName: string;
                        let displayValue: string = value;
                        if (key.startsWith('os_cat_')) {
                          optId = parseInt(key.replace('os_cat_', ''));
                          const configOpt = editConfigOptions.find(o => o.id === optId);
                          optName = configOpt?.option_name || `配置${optId}`;
                          displayValue = value; // os_cat 的值已经是分类key如 debian
                        } else if (key.startsWith('qty_')) {
                          optId = parseInt(key.replace('qty_', ''));
                          const configOpt = editConfigOptions.find(o => o.id === optId);
                          optName = (configOpt?.option_name || `配置${optId}`) + ' - 数量';
                          displayValue = value;
                        } else {
                          optId = parseInt(key);
                          const configOpt = editConfigOptions.find(o => o.id === optId);
                          optName = configOpt?.option_name || key;
                        }
                        const configOpt = editConfigOptions.find(o => o.id === optId);
                        return (
                          <div key={key} className="flex items-center gap-2">
                            <span className="text-muted-foreground text-xs w-28 shrink-0 truncate" title={optName}>{optName}</span>
                            {key.startsWith('os_cat_') && configOpt && configOpt.option_type === 5 && typeof configOpt.child === 'object' && !Array.isArray(configOpt.child) ? (
                              <div className="flex flex-col sm:flex-row gap-1.5 flex-1">
                                {/* 一级：系统分类 */}
                                <Select
                                  value={String(displayValue)}
                                  onValueChange={(val) => {
                                    const newConfig = { ...editingPackage!.configValues, [key]: val };
                                    // 自动选中该分类下第一个版本
                                    const catData = (configOpt.child as Record<string, { child: Array<{ id: number }> }>)[val];
                                    if (catData?.child?.[0]) {
                                      newConfig[optId] = String(catData.child[0].id);
                                    }
                                    setEditingPackage({ ...editingPackage!, configValues: newConfig });
                                  }}
                                >
                                  <SelectTrigger className="bg-muted border-border text-foreground text-xs h-7 flex-1">
                                    <SelectValue placeholder="选择系统" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-popover border-border max-h-48">
                                    {Object.entries(configOpt.child as Record<string, { system?: string; child: Array<{ id: number }> }>).map(([catKey, cat]) => (
                                      <SelectItem key={catKey} value={catKey} className="text-foreground text-xs">
                                        {cat.system || catKey}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {/* 二级：具体版本 */}
                                {(() => {
                                  const catData = (configOpt.child as Record<string, { system?: string; child: Array<{ id: number; version?: string }> }>)[String(displayValue)];
                                  const versions = catData?.child || [];
                                  const currentVersion = editingPackage!.configValues[optId];
                                  return (
                                    <Select
                                      value={currentVersion ? String(currentVersion) : (versions[0] ? String(versions[0].id) : '')}
                                      onValueChange={(val) => {
                                        const newConfig = { ...editingPackage!.configValues, [optId]: val };
                                        setEditingPackage({ ...editingPackage!, configValues: newConfig });
                                      }}
                                      disabled={!displayValue || versions.length === 0}
                                    >
                                      <SelectTrigger className="bg-muted border-border text-foreground text-xs h-7 flex-1">
                                        <SelectValue placeholder={displayValue ? '选择版本' : '先选系统'} />
                                      </SelectTrigger>
                                      <SelectContent className="bg-popover border-border max-h-48">
                                        {versions.map((item) => (
                                          <SelectItem key={item.id} value={String(item.id)} className="text-foreground text-xs">
                                            {item.version || String(item.id)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  );
                                })()}
                              </div>
                            ) : key.startsWith('os_cat_') ? (
                              <Input
                                value={displayValue}
                                onChange={(e) => {
                                  const newConfig = { ...editingPackage!.configValues, [key]: e.target.value };
                                  setEditingPackage({ ...editingPackage!, configValues: newConfig });
                                }}
                                className="bg-muted border-border text-foreground text-xs h-7 flex-1"
                                placeholder="如: debian, centos, ubuntu"
                              />
                            ) : key.startsWith('qty_') ? (
                              <Input
                                type="number"
                                value={displayValue}
                                onChange={(e) => {
                                  const newConfig = { ...editingPackage!.configValues, [key]: e.target.value };
                                  setEditingPackage({ ...editingPackage!, configValues: newConfig });
                                }}
                                className="bg-muted border-border text-foreground text-xs h-7 flex-1"
                                placeholder="数量"
                              />
                            ) : configOpt && Array.isArray(configOpt.child) && (configOpt.child as ConfigSubItem[]).length > 0 ? (
                              <Select
                                value={String(value)}
                                onValueChange={(val) => {
                                  const newConfig = { ...editingPackage!.configValues, [key]: val };
                                  setEditingPackage({ ...editingPackage!, configValues: newConfig });
                                }}
                              >
                                <SelectTrigger className="bg-muted border-border text-foreground text-xs h-7 flex-1">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border max-h-48">
                                  {(configOpt.child as ConfigSubItem[]).map(sub => (
                                    <SelectItem key={sub.id} value={String(sub.id)} className="text-foreground text-xs">
                                      {sub.option_name || sub.option_name_first || String(sub.id)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                value={value}
                                onChange={(e) => {
                                  const newConfig = { ...editingPackage.configValues, [key]: e.target.value };
                                  setEditingPackage({ ...editingPackage, configValues: newConfig });
                                }}
                                className="bg-muted border-border text-foreground text-xs h-7 flex-1"
                              />
                            )}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive/80 h-7 w-7 p-0 shrink-0"
                              onClick={() => {
                                const newConfig = { ...editingPackage.configValues };
                                delete newConfig[key];
                                setEditingPackage({ ...editingPackage, configValues: newConfig });
                              }}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        );
                      })}
                      {Object.keys(editingPackage.configValues).length === 0 && (
                        <p className="text-muted-foreground text-xs text-center py-2">无配置项</p>
                      )}
                    </div>
                    {/* 添加新配置项 */}
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                      <Input
                        placeholder="Key"
                        className="bg-muted border-border text-foreground text-xs h-7 w-32 font-mono"
                        id="new-config-key"
                      />
                      <Input
                        placeholder="Value"
                        className="bg-muted border-border text-foreground text-xs h-7 flex-1 font-mono"
                        id="new-config-value"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-success hover:text-success/80 h-7 px-2 shrink-0"
                        onClick={() => {
                          const keyInput = document.getElementById('new-config-key') as HTMLInputElement;
                          const valInput = document.getElementById('new-config-value') as HTMLInputElement;
                          if (keyInput?.value && valInput?.value) {
                            setEditingPackage({
                              ...editingPackage,
                              configValues: { ...editingPackage.configValues, [keyInput.value]: valInput.value },
                            });
                            keyInput.value = '';
                            valInput.value = '';
                          }
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  )}
                </div>
                {/* 自定义字段 */}
                <div>
                  <Label className="text-foreground/80 text-xs mb-2 block">自定义字段 (customFieldValues)</Label>
                  <div className="bg-muted/50 rounded-lg border border-border p-3 max-h-40 overflow-y-auto">
                    <div className="space-y-2">
                      {Object.entries(editingPackage.customFieldValues).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <Input
                            value={key}
                            readOnly
                            className="bg-muted border-border text-muted-foreground text-xs h-7 w-32 font-mono"
                          />
                          <Input
                            value={value}
                            onChange={(e) => {
                              const newFields = { ...editingPackage.customFieldValues, [key]: e.target.value };
                              setEditingPackage({ ...editingPackage, customFieldValues: newFields });
                            }}
                            className="bg-muted border-border text-foreground text-xs h-7 flex-1 font-mono"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive/80 h-7 w-7 p-0 shrink-0"
                            onClick={() => {
                              const newFields = { ...editingPackage.customFieldValues };
                              delete newFields[key];
                              setEditingPackage({ ...editingPackage, customFieldValues: newFields });
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="gap-2 shrink-0">
              <Button variant="outline" onClick={() => { setShowEditPackageDialog(false); setEditingPackage(null); }} className="border-border text-foreground/80">取消</Button>
              <Button onClick={saveEditPackage} className="bg-info text-info-foreground hover:bg-info/90">
                <Pencil className="w-4 h-4 mr-1" />保存修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={showCertifiConfirm} onOpenChange={setShowCertifiConfirm}>
          <DialogContent className="border-border bg-card text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                用户未实名认证
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                当前用户实名认证状态异常，请确认是否继续开通
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-warning font-medium">认证状态：</span>
                <span className="text-warning font-bold">{certifiInfo?.msg || '未认证'}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                用户 <span className="text-foreground font-medium">{selectedUser?.username}</span>（ID: {selectedUser?.id}）尚未完成实名认证，继续开通可能存在风险。
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setShowCertifiConfirm(false)} className="border-border text-foreground/80">取消</Button>
              <Button onClick={() => { setShowCertifiConfirm(false); executeProvision(); }} className="bg-warning text-warning-foreground hover:bg-warning/90">
                我已确认，继续开通
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showCreateConfirm} onOpenChange={setShowCreateConfirm}>
          <DialogContent className="border-border bg-card text-foreground sm:!max-w-md max-h-[85vh] flex flex-col p-0">
            <DialogHeader className="px-4 pt-4 pb-1.5 shrink-0">
              <DialogTitle className="text-foreground flex items-center gap-2 text-base">
                <Zap className="w-4 h-4 text-primary" />
                确认开通服务器
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                请确认以下开通信息，避免误操作
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 overflow-y-auto flex-1 px-4 pb-2 min-h-0">
              <div className="rounded-lg border border-border bg-background/60 p-2.5 space-y-1.5">
                <div className="text-xs font-medium text-foreground">基本信息</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="flex justify-between gap-1 col-span-2">
                    <span className="text-muted-foreground">产品名称</span>
                    <span className="text-foreground font-semibold truncate ml-1">{selectedProductDetail?.name || savedPackages.find(p => p.productId === selectedProductId)?.productName || ''}</span>
                  </div>
                  {selectedPackageId && (() => {
                    const pkg = savedPackages.find(p => p.id === selectedPackageId);
                    return pkg ? (
                      <div className="flex justify-between gap-1 col-span-2">
                        <span className="text-muted-foreground">套餐名称</span>
                        <span className="text-primary font-semibold truncate ml-1">{pkg.name}</span>
                      </div>
                    ) : null;
                  })()}
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">套餐类型</span>
                    <span className="text-foreground">{productCycles.find(c => c.value === selectedBillingCycle)?.label || selectedBillingCycle}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">开通数量</span>
                    <span className="text-foreground">{productQty} 台</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">开通价格</span>
                    <span className="text-primary font-bold">¥{firstPrice || '0'}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">续费价格</span>
                    <span className="text-primary font-semibold">¥{renewPrice || '0'}</span>
                  </div>
                </div>
              </div>
              {(() => {
                const isOsOption = (opt: ConfigOption) => opt.option_type === 5;
                const isSnapshotOption = (opt: ConfigOption) => /快照|snapshot/i.test(opt.option_name);
                const isTipOption = (opt: ConfigOption) => /温馨提示|提示|说明|备注|注意/i.test(opt.option_name);
                const isNodeOption = (opt: ConfigOption) => /节点|node/i.test(opt.option_name);
                const isHiddenOption = (opt: ConfigOption) => opt.hidden === 1;
                const visibleOpts = configOptions.filter(o => !isHiddenOption(o) && !isSnapshotOption(o) && !isTipOption(o) && !isNodeOption(o) && !isOsOption(o));
                const osOpts = configOptions.filter(o => !isHiddenOption(o) && !isSnapshotOption(o) && !isTipOption(o) && isOsOption(o));
                const renderOpt = (opt: ConfigOption, highlight?: boolean) => {
                  const val = configValues[String(opt.id)];
                  if (isOsOption(opt) && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
                    const osCatKey = `os_cat_${opt.id}`;
                    const catName = configValues[osCatKey] || '';
                    const osCategories = opt.child as Record<string, { system?: string; child: Array<{ id: number; version?: string; option_name?: string }> }>;
                    const cat = osCategories[catName];
                    const osItem = val && cat?.child?.find(c => String(c.id) === val);
                    const osVersion = osItem && typeof osItem === 'object' ? (osItem.version || osItem.option_name || '') : '';
                    const osDisplay = osVersion ? `${cat?.system || catName} - ${osVersion}` : (cat?.system || catName || val || '');
                    if (!osDisplay) return null;
                    return (
                      <div key={opt.id} className="flex justify-between gap-1">
                        <span className="text-muted-foreground">{opt.option_name}</span>
                        <span className={highlight ? 'text-primary font-semibold' : 'text-foreground'}>{osDisplay}</span>
                      </div>
                    );
                  }
                  const subItems = Array.isArray(opt.child) ? opt.child : [];
                  const selectedItem = subItems.find(s => String(s.id) === val);
                  let displayValue = '';
                  if (opt.option_type === 3) {
                    displayValue = val === '1' ? '是' : '否';
                  } else if ([7, 9, 11, 14, 15].includes(opt.option_type)) {
                    const qtyVal = configValues[`qty_${opt.id}`] || opt.qty_minimum || '0';
                    displayValue = `${qtyVal} ${opt.unit || ''}`;
                  } else if (selectedItem) {
                    const name = selectedItem.option_name || '';
                    const sep = name.includes('^') ? '^' : name.includes('|') ? '|' : null;
                    displayValue = sep ? name.split(sep).pop()!.trim() : name;
                  } else if (val) {
                    displayValue = val;
                  }
                  if (!displayValue) return null;
                  return (
                    <div key={opt.id} className="flex justify-between gap-1">
                      <span className="text-muted-foreground">{opt.option_name}</span>
                      <span className={highlight ? 'text-primary font-semibold' : 'text-foreground'}>{displayValue}</span>
                    </div>
                  );
                };
                const hasContent = selectedNodeName || visibleOpts.length > 0 || osOpts.length > 0;
                return hasContent ? (
                  <div className="rounded-lg border border-border bg-background/60 p-2.5 space-y-1.5">
                    <div className="text-xs font-medium text-foreground">服务器参数</div>
                    <div className="grid grid-cols-1 gap-y-1 text-xs">
                      {selectedNodeName && (
                        <div className="flex justify-between gap-1">
                          <span className="text-muted-foreground">节点</span>
                          <span className="text-primary font-semibold">{selectedNodeName}</span>
                        </div>
                      )}
                      {visibleOpts.map(opt => renderOpt(opt, false))}
                      {osOpts.map(opt => renderOpt(opt, false))}
                    </div>
                  </div>
                ) : null;
              })()}
              {selectedUser && (
                <div className="rounded-lg border border-border bg-background/60 p-2.5 space-y-1 text-xs">
                  <div className="text-xs font-medium text-foreground">开通用户</div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">用户名</span>
                    <span className="text-foreground">{selectedUser.username || '-'}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">UID</span>
                    <span className="text-foreground">{selectedUser.id}</span>
                  </div>
                  <div className="flex justify-between gap-1">
                    <span className="text-muted-foreground">当前余额</span>
                    <span className="text-primary font-bold">¥{selectedUser.credit || '0.00'}</span>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 px-4 pb-4 pt-2 shrink-0 border-t border-border/50">
              <Button variant="outline" onClick={() => setShowCreateConfirm(false)} className="border-border text-foreground/80">取消</Button>
              <Button onClick={confirmAndCreate} className="bg-primary hover:bg-primary/90">
                <Zap className="w-4 h-4 mr-1" />确认开通
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 快速搜索用户弹窗 - 开通时未选用户引导 */}
        <Dialog open={showQuickUserSearch} onOpenChange={(open) => {
          if (!open) { setShowQuickUserSearch(false); setPendingProvision(false); setQuickSearchResults([]); }
        }}>
          <DialogContent className="sm:!max-w-md bg-card border-border text-foreground" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                请先选择用户
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                开通产品前需要先选择一个用户，搜索并选中后自动继续开通
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <select
                  value={quickSearchType}
                  onChange={(e) => setQuickSearchType(e.target.value as typeof quickSearchType)}
                  className="h-9 rounded-md border border-border bg-muted text-sm text-foreground px-2 shrink-0"
                >
                  <option value="auto">自动</option>
                  <option value="uid">UID</option>
                  <option value="username">用户名</option>
                  <option value="email">邮箱</option>
                  <option value="phone">手机号</option>
                  <option value="qq">QQ号</option>
                </select>
                <div className="relative flex-1">
                  <Input
                    placeholder="输入用户名/UID/邮箱搜索"
                    value={quickSearchKeyword}
                    onChange={(e) => { setQuickSearchKeyword(e.target.value); if (!e.target.value) setQuickSearchResults([]); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickSearchUsers()}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-8"
                    autoFocus
                  />
                  {quickSearchKeyword && (
                    <button onClick={() => { setQuickSearchKeyword(''); setQuickSearchResults([]); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <Button onClick={handleQuickSearchUsers} disabled={quickIsSearching} className="bg-primary hover:bg-primary/90 shrink-0">
                  {quickIsSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </Button>
              </div>
              {quickSearchResults.length > 0 && (
                <div className="border border-border rounded-lg overflow-hidden max-h-56 overflow-y-auto">
                  {quickSearchResults.map((user) => (
                    <div key={user.id} onClick={() => handleQuickSelectUser(user)}
                      className="px-3 py-2.5 cursor-pointer transition-colors border-b border-border last:border-b-0 hover:bg-primary/90/20">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-foreground font-medium text-sm truncate">{user.username}</p>
                          <p className="text-muted-foreground text-xs truncate">{user.email || user.phone || user.phonenumber || '无联系方式'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-foreground/80 text-xs">ID: {user.id}</p>
                          <p className="text-success text-xs">余额: ¥{user.credit || '0'}</p>
                          <p className={`text-xs mt-0.5 ${user.person_status === '已认证' ? 'text-success' : user.company_status === '已认证' ? 'text-info' : 'text-destructive'}`}>
                            {user.person_status === '已认证' ? '✓ 个人已认证' : user.company_status === '已认证' ? '✓ 企业已认证' : '✗ 未认证'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowQuickUserSearch(false); setPendingProvision(false); setQuickSearchResults([]); }}
                className="border-border text-foreground/80 hover:text-foreground">取消</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 退款删除确认对话框 */}
        <Dialog open={showRefundConfirm} onOpenChange={(open: boolean) => { if (!isRefundDeleting) { setShowRefundConfirm(open); if (!open) setRefundSteps([]); } }}>
          <DialogContent className="border-border bg-card text-foreground max-w-lg w-[95vw] max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle className="text-foreground flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                退款并终止服务器
              </DialogTitle>
              <DialogDescription className="text-muted-foreground">
                将执行退款、终止云服务器、删除账单操作，此操作不可撤销
              </DialogDescription>
            </DialogHeader>
            <div className="overflow-y-auto flex-1 min-h-0 -mx-6 px-6">
            {refundTarget && (
              <div className="space-y-3">
                {/* 产品信息 */}
                <div className="rounded-lg border border-border bg-muted/50 px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-foreground font-medium">{String(refundTarget.productname || refundTarget.product_name || '未知产品')}</span>
                    <span className="text-primary font-bold text-sm">{String(refundTarget.amount || '0')}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    {String(refundTarget.domain || '') !== '' && <span>主机: {String(refundTarget.domain)}</span>}
                    <span>IP: {String(refundTarget.dedicatedip || '-')}</span>
                    <span>ID: {String(refundTarget.id)}</span>
                  </div>
                </div>

                {/* 退款计算 */}
                {isLoadingRefund ? (
                  <div className="flex items-center justify-center py-4 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />计算退款中...
                  </div>
                ) : refundInfo && (refundInfo as Record<string, unknown>).calculated ? (
                  <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3 space-y-2">
                    <div className="text-info font-medium text-sm mb-1">退款计算</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="text-muted-foreground">续费金额</div>
                      <div className="text-foreground">¥{Number((refundInfo as Record<string, unknown>).periodAmount).toFixed(2)}</div>
                      <div className="text-muted-foreground">当前周期</div>
                      <div className="text-foreground">{String((refundInfo as Record<string, unknown>).periodType)}</div>
                      <div className="text-muted-foreground">订购日期</div>
                      <div className="text-foreground">{String((refundInfo as Record<string, unknown>).orderDate)}</div>
                      <div className="text-muted-foreground">到期时间</div>
                      <div className="text-foreground">{String((refundInfo as Record<string, unknown>).expireDate)}</div>
                      <div className="text-muted-foreground">剩余天数</div>
                      <div className="text-foreground">{String((refundInfo as Record<string, unknown>).remainingDays)} 天</div>
                      <div className="text-muted-foreground">日均价格</div>
                      <div className="text-foreground">¥{Number((refundInfo as Record<string, unknown>).dailyRate).toFixed(2)}</div>
                    </div>
                    <div className="border-t border-info/20 pt-2 mt-2 flex items-center justify-between">
                      <span className="text-info font-medium">退款金额</span>
                      <span className="text-info font-bold text-lg">¥{Number((refundInfo as Record<string, unknown>).refundAmount).toFixed(2)}</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    无法计算退款金额（可能已过期或缺少价格信息）
                  </div>
                )}

                {/* 退款方式选择 */}
                {refundSteps.length === 0 && (
                  <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-2">
                    <div className="text-foreground font-medium text-sm mb-2">退款方式</div>
                    <div className="flex gap-3">
                      <label className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${refundMode === 'credit' ? 'border-info bg-info/10' : 'border-border bg-muted/30 hover:border-border'}`}>
                        <input type="radio" name="refundMode" value="credit" checked={refundMode === 'credit'} onChange={() => setRefundMode('credit')} className="accent-blue-500" />
                        <div>
                          <div className="text-sm text-foreground font-medium">退余额</div>
                          <div className="text-xs text-muted-foreground">将退款金额充入用户余额</div>
                        </div>
                      </label>
                      <label className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${refundMode === 'record' ? 'border-warning bg-warning/10' : 'border-border bg-muted/30 hover:border-border'}`}>
                        <input type="radio" name="refundMode" value="record" checked={refundMode === 'record'} onChange={() => setRefundMode('record')} className="accent-amber-500" />
                        <div>
                          <div className="text-sm text-foreground font-medium">仅记录</div>
                          <div className="text-xs text-muted-foreground">不实际退款，仅记录</div>
                        </div>
                      </label>
                    </div>
                  </div>
                )}

                {/* 执行进度 */}
                {refundSteps.length > 0 && (
                  <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 space-y-2">
                    <div className="text-foreground font-medium text-sm mb-1">执行进度</div>
                    {refundSteps.map(step => (
                      <div key={step.id} className="flex items-center gap-2 text-sm">
                        {step.status === 'done' && <CheckCircle className="w-4 h-4 text-success shrink-0" />}
                        {step.status === 'running' && <Loader2 className="w-4 h-4 animate-spin text-info shrink-0" />}
                        {step.status === 'error' && <XCircle className="w-4 h-4 text-destructive shrink-0" />}
                        {step.status === 'pending' && <div className="w-4 h-4 rounded-full border border-border shrink-0" />}
                        <span className={step.status === 'done' ? 'text-success' : step.status === 'error' ? 'text-destructive' : 'text-foreground/80'}>{step.label}</span>
                        {step.detail && <span className="text-muted-foreground text-xs ml-1">- {step.detail}</span>}
                      </div>
                    ))}
                  </div>
                )}

                {/* 警告 */}
                {refundSteps.length === 0 && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                    <div className="text-sm text-destructive">
                      此操作将：1) {refundMode === 'credit' ? '退款至余额' : '仅记录退款'} → 2) 终止云服务器 → 3) 删除关联账单
                    </div>
                    <div className="text-xs text-destructive/70 mt-1">请确认无误后点击执行，此操作不可撤销！</div>
                  </div>
                )}
              </div>
            )}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setShowRefundConfirm(false); setRefundSteps([]); }} disabled={isRefundDeleting} className="border-border text-foreground/80">关闭</Button>
              {refundSteps.length === 0 && (
                <Button onClick={executeRefundDelete} disabled={isLoadingRefund || isRefundDeleting} className="bg-destructive hover:bg-destructive">
                  {isLoadingRefund ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  确认执行
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 批量删除确认弹窗 */}
        <Dialog open={showBatchDeleteConfirm} onOpenChange={(open) => { if (!open) { if (!isBatchDeleting) setShowBatchDeleteConfirm(false); } }}>
          <DialogContent className="border-border bg-card w-[calc(100vw-1.5rem)] sm:w-full max-h-[85vh] flex flex-col p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-destructive text-base">确认删除产品</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {batchDeleteSteps.length === 0 ? (
                <>
                  <div className="text-sm text-foreground/80">
                    确定要删除选中的 <span className="text-destructive font-bold">{selectedRenewIds.size}</span> 个产品吗？
                  </div>
                  <div className="text-sm text-destructive">
                    此操作将：终止云服务器 → 删除关联账单，此操作不可撤销！
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {filteredProducts.filter((p: Record<string, unknown>) => selectedRenewIds.has(p.id as number)).map((p: Record<string, unknown>) => (
                      <div key={p.id as number} className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="text-destructive">•</span>
                        <span className="truncate">{String(p.productname || p.product_name || '未知产品')}</span>
                        <span className="text-muted-foreground shrink-0">(ID:{String(p.id)})</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="space-y-2 max-h-[40vh] sm:max-h-60 overflow-y-auto">
                  {batchDeleteSteps.map((step) => (
                    <div key={step.id} className="flex items-start gap-2 text-sm">
                      {step.status === 'processing' && <Loader2 className="w-4 h-4 animate-spin text-info shrink-0 mt-0.5" />}
                      {step.status === 'completed' && <CheckCircle className="w-4 h-4 text-success shrink-0 mt-0.5" />}
                      {step.status === 'failed' && <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />}
                      <span className={`min-w-0 ${step.status === 'failed' ? 'text-destructive' : step.status === 'completed' ? 'text-success' : 'text-foreground/80'}`}>
                        {step.name}
                      </span>
                      {step.message && <span className="text-xs text-muted-foreground shrink-0">({step.message})</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button variant="outline" onClick={() => { setShowBatchDeleteConfirm(false); setBatchDeleteSteps([]); }} disabled={isBatchDeleting} className="border-border text-foreground/80 h-9">
                {batchDeleteSteps.length > 0 ? '关闭' : '取消'}
              </Button>
              {batchDeleteSteps.length === 0 && (
                <Button onClick={handleBatchDelete} disabled={isBatchDeleting} className="bg-destructive hover:bg-destructive h-9">
                  {isBatchDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  确认删除
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 批量导出弹窗 */}
        <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
          <DialogContent className="border-border bg-card w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[85vh] flex flex-col p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-success flex items-center gap-2">
                <Download className="w-5 h-5" />
                导出服务器信息
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                已选择 {selectedRenewIds.size} 个产品，每行格式：IP  用户名  密码
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col gap-3">
              {/* 导出文本 */}
              <div className="relative flex-1 min-h-0">
                {isExporting ? (
                  <div className="flex items-center justify-center h-48 sm:h-56 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />正在获取服务器信息...
                  </div>
                ) : (
                  <textarea
                    readOnly
                    value={exportText}
                    className="w-full h-48 sm:h-56 bg-muted/80 border border-border rounded-lg p-3 text-sm text-foreground font-mono resize-none focus:outline-none focus:border-success/50"
                  />
                )}
              </div>
            </div>
            <DialogFooter className="gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowExportDialog(false)} className="border-border text-foreground/80 h-9">
                关闭
              </Button>
              <Button
                onClick={() => {
                  if (exportText) {
                    copyText(exportText);
                    showNotification('success', `已复制 ${selectedRenewIds.size} 个产品的服务器信息`);
                  }
                }}
                disabled={isExporting || !exportText}
                className="bg-success hover:bg-success h-9"
              >
                <Copy className="w-4 h-4 mr-1" />
                一键复制
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 远程连接确认弹窗 */}
        <Dialog open={remoteConnectInfo !== null} onOpenChange={(open) => { if (!open && !remoteConnecting) setRemoteConnectInfo(null); }}>
          <DialogContent className="border-border bg-card w-[calc(100vw-1.5rem)] sm:max-w-md p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-success flex items-center gap-2">
                <TerminalSquare className="w-5 h-5" />
                远程连接确认
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs">
                {remoteConnectInfo?.productName ? `产品：${remoteConnectInfo.productName} — ` : ''}确认以下服务器信息后建立 SSH 连接
              </DialogDescription>
            </DialogHeader>
            {remoteConnectInfo && (
              <div className="space-y-2.5 py-1">
                {([
                  { key: 'ip', label: 'IP 地址', value: remoteConnectInfo.ip },
                  { key: 'username', label: '登录账号', value: remoteConnectInfo.username },
                  { key: 'password', label: '密码', value: remoteConnectInfo.password },
                ] as const).map(field => {
                  const copied = remoteCopiedField === field.key;
                  return (
                    <div key={field.key} className="flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{field.label}</div>
                        <div className="text-sm text-foreground truncate font-mono">
                          {field.value || '-'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyRemoteField(field.key, field.value)}
                        className="shrink-0 p-1.5 rounded text-muted-foreground hover:text-success hover:bg-accent/50 transition-colors"
                        title="复制"
                      >
                        {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {remoteConnectInfo && (
              <Button
                variant="outline"
                size="sm"
                onClick={copyAllRemoteInfo}
                className={`w-full h-8 ${remoteCopiedAll ? 'border-success text-success' : 'border-border text-foreground/80'}`}
              >
                {remoteCopiedAll ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                {remoteCopiedAll ? '已复制全部信息' : '一键复制全部信息'}
              </Button>
            )}
            <DialogFooter className="gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setRemoteConnectInfo(null)}
                disabled={remoteConnecting}
                className="border-border text-foreground/80 h-9"
              >
                取消
              </Button>
              <Button
                onClick={confirmRemoteConnect}
                disabled={remoteConnecting}
                className="bg-success hover:bg-success h-9"
              >
                {remoteConnecting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <ExternalLink className="w-4 h-4 mr-1" />}
                确认连接
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {mainTab === 'renew' && selectedUser && (
          <Card>
            <CardContent className="py-4">
              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-accent2" />
                    <h3 className="text-foreground font-bold text-base sm:text-lg">用户产品管理</h3>
                    {isLoadingUserProducts ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-muted-foreground text-sm">({filteredProducts.length} 个产品)</span>
                    )}
                  </div>
                  {/* 搜索框 */}
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={e => setProductSearch(e.target.value)}
                      placeholder="搜索主机名 / IP地址"
                      className="w-full pl-8 pr-7 py-1.5 bg-muted/80 border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 transition-colors"
                    />
                    {productSearch && (
                      <button
                        onClick={() => setProductSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/80 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {['运行中', '已暂停', '待开通', '已删除', '已取消', '欺诈'].map(status => (
                    <button
                      key={status}
                      onClick={() => {
                        setProductStatusFilters(prev =>
                          prev.includes(status)
                            ? prev.filter(s => s !== status)
                            : [...prev, status]
                        );
                      }}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        productStatusFilters.includes(status)
                          ? 'bg-primary/20 text-primary border border-primary/50'
                          : 'bg-muted/50 text-muted-foreground border border-border/50 hover:text-foreground/80'
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                  {productStatusFilters.length > 0 && (
                    <button
                      onClick={() => setProductStatusFilters([])}
                      className="px-2 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground/80 transition-colors"
                    >
                      清除
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  {filteredProducts.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border bg-muted/50 text-foreground/80 hover:bg-accent hover:text-foreground h-7 text-xs"
                      onClick={() => {
                        if (selectedRenewIds.size === filteredProducts.length) {
                          setSelectedRenewIds(new Set());
                        } else {
                          setSelectedRenewIds(new Set(filteredProducts.map((p: Record<string, unknown>) => p.id as number)));
                        }
                      }}
                    >
                      {selectedRenewIds.size === filteredProducts.length && filteredProducts.length > 0 ? '取消全选' : '全选'}
                    </Button>
                  )}
                  {selectedRenewIds.size > 0 && (
                    <>
                      <span className="text-primary text-xs">已选{selectedRenewIds.size}项</span>
                      <Button size="sm" onClick={() => setShowRenewConfirm(true)} disabled={isRenewing} className="bg-primary hover:bg-primary/90 h-7 text-xs px-2">
                        <RefreshCw className="w-3 h-3 sm:mr-1" />
                        <span className="hidden sm:inline ml-0.5">批量续费</span>
                      </Button>
                      <Button size="sm" onClick={() => setShowExportDialog(true)} className="bg-success hover:bg-success h-7 text-xs px-2">
                        <Download className="w-3 h-3 sm:mr-1" />
                        <span className="hidden sm:inline ml-0.5">导出信息</span>
                      </Button>
                      <Button size="sm" onClick={() => setShowBatchDeleteConfirm(true)} disabled={isBatchDeleting} className="bg-destructive hover:bg-destructive h-7 text-xs px-2">
                        <Trash2 className="w-3 h-3 sm:mr-1" />
                        <span className="hidden sm:inline ml-0.5">批量删除</span>
                      </Button>
                    </>
                  )}
                  <Button variant="outline" size="sm" onClick={() => fetchUserProducts(selectedUser.id)} className="border-border bg-muted/50 text-foreground/80 hover:bg-accent hover:text-foreground h-7 text-xs px-2">
                    <RefreshCw className="w-3 h-3 mr-1" />刷新
                  </Button>
                </div>
              </div>
              <div className="space-y-2">
                {isLoadingUserProducts ? (
                  <div className="flex items-center justify-center py-8 text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mr-2" />加载产品中...
                  </div>
                ) : userProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">该用户暂无活跃产品</div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {productSearch.trim()
                      ? <><p>未找到包含「{productSearch.trim()}」的产品</p><p className="text-xs text-muted-foreground mt-1">尝试搜索主机名或IP地址的部分字符</p></>
                      : '没有符合条件的产品'}
                  </div>
                ) : filteredProducts.map((svc: Record<string, unknown>) => (
                    <ProductCard
                      key={svc.id as number}
                      svc={svc}
                      isSelected={selectedRenewIds.has(svc.id as number)}
                      selectedRenewIds={selectedRenewIds}
                      savedPackages={savedPackages}
                      financeUrl={financeUrl}
                      mfyUrl={mfyUrl}
                      uid={Number(svc.uid || selectedUser?.id || 0)}
                      isAdminUser={isAdminUser}
                      onToggleSelect={toggleRenewSelect}
                      onRenew={handleDirectRenew}
                      onUpgrade={openUpgradeDialog}
                      onModify={openModifyDialog}
                      onRefundDelete={handleRefundDelete}
                      onRemote={handleRemoteConnect}
                      onMfyCloud={handleMfyCloud}
                      onRecycleCheck={handleRecycleCheck}
                      showNotification={showNotification}
                      onCopy={copyText}
                    />
                  ))}
              </div>
              {/* 续费进度弹窗 */}
              <Dialog open={(processingSteps.length > 0 || isProcessing) && mainTab === 'renew'} onOpenChange={(open) => {
                if (!open && !isProcessing) {
                  setProcessingSteps([]);
                  setProgress(0);
                }
              }}>
                <DialogContent className="sm:!max-w-lg bg-card border-border p-4 sm:p-5 w-[calc(100vw-1.5rem)] sm:w-full max-h-[85vh] flex flex-col" showCloseButton={false}>
                  <DialogTitle className="flex items-center justify-between mb-3">
                    <span className="text-foreground text-base font-semibold">续费进度</span>
                    <span className="text-sm text-muted-foreground">{processingSteps.length > 0 ? Math.round(processingSteps.filter(s => s.status === 'completed').length / processingSteps.length * 100) : 0}%</span>
                  </DialogTitle>
                  <div className="overflow-y-auto overscroll-contain -mx-1 px-1 flex-1 min-h-0">
                    {processingSteps.map((step, index) => (
                      <div key={step.id} className="flex items-start gap-2 mb-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          step.status === 'completed' ? 'bg-success/20 text-success' :
                          step.status === 'processing' ? 'bg-primary/20 text-primary' :
                          step.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                          'bg-accent text-muted-foreground'
                        }`}>
                          {step.status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                           step.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                           step.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                           <span className="text-[10px] font-bold">{index + 1}</span>
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={`text-sm ${
                            step.status === 'completed' ? 'text-success' :
                            step.status === 'processing' ? 'text-primary' :
                            step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                          }`}>{step.name}</span>
                          {step.message && (
                            <span className="text-xs text-muted-foreground block truncate">{step.message}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

              {/* 回收站检查弹窗 */}
              <Dialog open={recycleCheckState.open && !isRecycleProcessing} onOpenChange={(open) => {
                if (!open && !isRecycleProcessing) {
                  setRecycleCheckState(prev => ({ ...prev, open: false }));
                }
              }}>
                <DialogContent className="sm:!max-w-lg bg-card border-border p-4 sm:p-5 w-[calc(100vw-1.5rem)] sm:w-full max-h-[85vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-foreground text-base font-semibold">
                      <RotateCcw className="w-4 h-4 text-info" />
                      回收站检查
                    </DialogTitle>
                    <DialogDescription className="text-muted-foreground text-xs">
                      {recycleCheckState.svc ? (() => {
                        const svc = recycleCheckState.svc;
                        const productName = String(svc.productname || svc.product_name || svc.name || '-');
                        const cycleRaw = String(svc.billingcycle || 'monthly');
                        const cycleMap: Record<string, string> = { monthly: '月付', quarterly: '季付', semiannually: '半年付', annually: '年付', biennially: '两年付', triennially: '三年付' };
                        const cycleText = cycleMap[cycleRaw] || cycleRaw;
                        const amount = parseFloat(String(svc.amount || svc.firstpaymentamount || '0').replace(/[^\d.]/g, '')) || 0;
                        return (
                          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>产品名: <span className="text-foreground">{productName}</span></span>
                            <span>套餐周期: <span className="text-foreground">{cycleText}</span></span>
                            <span>续费价格: <span className="text-primary">¥{amount.toFixed(2)}</span></span>
                          </span>
                        );
                      })() : ''}
                    </DialogDescription>
                  </DialogHeader>
                  {recycleCheckState.loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-6 h-6 text-info animate-spin" />
                      <span className="ml-2 text-muted-foreground text-sm">正在查询回收站...</span>
                    </div>
                  ) : recycleCheckState.matches.length === 0 ? (
                    <div className="py-6 text-center">
                      <AlertCircle className="w-10 h-10 mx-auto mb-2 text-warning" />
                      <p className="text-foreground/80 text-sm">回收站未找到该主机</p>
                      <p className="text-muted-foreground text-xs mt-1">可能实例已被彻底删除，无法恢复</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">找到 {recycleCheckState.matches.length} 个匹配实例，请选择要恢复的实例：</p>
                      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                        {recycleCheckState.matches.map((c) => {
                          const instId = Number(c.id);
                          const isSelected = recycleCheckState.selectedInstanceId === instId;
                          const hostname = String(c.hostname || '-');
                          const mainip = String(c.mainip || (Array.isArray(c.ip) && c.ip[0]?.ip) || c.ip || '-');
                          return (
                            <div
                              key={instId}
                              onClick={() => setRecycleCheckState(prev => ({ ...prev, selectedInstanceId: instId }))}
                              className={`w-full text-left p-3 rounded-lg border transition-colors cursor-pointer select-text ${
                                isSelected ? 'border-info bg-info/10' : 'border-border bg-muted/40 hover:border-border'
                              }`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-foreground text-sm font-medium flex items-center gap-1 min-w-0">
                                  <span className="truncate">{hostname}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyInstField(hostname, `hostname-${instId}`); }}
                                    className="p-0.5 text-muted-foreground hover:text-info transition-colors shrink-0"
                                    title="复制主机名"
                                  >
                                    {recycleCheckState.copiedInstField === `hostname-${instId}` ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0">ID: {instId}</span>
                              </div>
                              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-0.5">IP: <span className="text-foreground">{mainip}</span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); copyInstField(mainip, `ip-${instId}`); }}
                                    className="p-0.5 text-muted-foreground hover:text-info transition-colors"
                                    title="复制IP"
                                  >
                                    {recycleCheckState.copiedInstField === `ip-${instId}` ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </span>
                                <span>状态: <span className="text-foreground">{formatCloudStatus(String(c.status || '-'))}</span></span>
                                {String(c.node_name || '') !== '' && <span>节点: <span className="text-foreground">{String(c.node_name)}</span></span>}
                                {c.cpu != null && <span>CPU: <span className="text-foreground">{String(c.cpu)}</span></span>}
                                {c.memory != null && <span>内存: <span className="text-foreground">{String(c.memory)}</span></span>}
                                {String(c.recycle_time || '') !== '' && <span>回收时间: <span className="text-foreground">{String(c.recycle_time)}</span></span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {!recycleCheckState.loading && (
                    <DialogFooter className="gap-2 mt-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => setRecycleCheckState(prev => ({ ...prev, open: false }))}
                        className="border-border text-muted-foreground">
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={recycleCheckState.matches.length === 0 || recycleCheckState.selectedInstanceId == null || isRecycleProcessing}
                        onClick={() => {
                          if (recycleCheckState.svc && recycleCheckState.selectedInstanceId != null) {
                            doRestoreAndRenew(recycleCheckState.svc, recycleCheckState.selectedInstanceId);
                          }
                        }}
                        className="bg-info hover:bg-info/90 text-info-foreground disabled:opacity-50">
                        <RotateCcw className="w-4 h-4 mr-1" />恢复并续费
                      </Button>
                    </DialogFooter>
                  )}
                </DialogContent>
              </Dialog>

              {/* 回收站恢复进度弹窗 */}
              <Dialog open={isRecycleProcessing} onOpenChange={() => { /* 处理中不可关闭 */ }}>
                <DialogContent className="sm:!max-w-lg bg-card border-border p-4 sm:p-5 w-[calc(100vw-1.5rem)] sm:w-full max-h-[85vh] flex flex-col" showCloseButton={false}>
                  <DialogTitle className="flex items-center justify-between mb-3">
                    <span className="text-foreground text-base font-semibold flex items-center gap-2">
                      <RotateCcw className="w-4 h-4 text-info" />
                      恢复与续费进度
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {recycleSteps.length > 0 ? Math.round(recycleSteps.filter(s => s.status === 'completed').length / recycleSteps.length * 100) : 0}%
                    </span>
                  </DialogTitle>
                  <div className="overflow-y-auto overscroll-contain -mx-1 px-1 flex-1 min-h-0">
                    {recycleSteps.map((step, index) => (
                      <div key={step.id} className="flex items-start gap-2 mb-2">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          step.status === 'completed' ? 'bg-success/20 text-success' :
                          step.status === 'processing' ? 'bg-primary/20 text-primary' :
                          step.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                          'bg-accent text-muted-foreground'
                        }`}>
                          {step.status === 'completed' ? <CheckCircle className="w-3 h-3" /> :
                           step.status === 'processing' ? <Loader2 className="w-3 h-3 animate-spin" /> :
                           step.status === 'failed' ? <XCircle className="w-3 h-3" /> :
                           <span className="text-[10px] font-bold">{index + 1}</span>
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={`text-sm ${
                            step.status === 'completed' ? 'text-success' :
                            step.status === 'processing' ? 'text-primary' :
                            step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                          }`}>{step.name}</span>
                          {step.message && (
                            <span className="text-xs text-muted-foreground block truncate">{step.message}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {!isRecycleProcessing && recycleSteps.length > 0 && (
                    <div className="mt-3 flex justify-end">
                      <Button size="sm" onClick={() => setRecycleSteps([])} className="bg-accent hover:bg-accent text-foreground">
                        关闭
                      </Button>
                    </div>
                  )}
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        )}

        {/* 产品管理页 */}
        {mainTab === 'provision' && (
        <>
        {/* 产品选择区域 - 全宽 */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-4">
              {/* 模式切换 + 右侧操作区 */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="inline-flex rounded-lg overflow-hidden border border-border w-fit mx-auto bg-card dark:bg-accent shadow-sm">
                  <button
                    type="button"
                    onClick={() => setConfigMode('package')}
                    className={`py-2 px-3 sm:px-4 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${
                      configMode === 'package'
                        ? 'bg-primary/15 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" />
                    套餐开通
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigMode('custom')}
                    className={`py-2 px-3 sm:px-4 text-xs sm:text-sm font-medium flex items-center gap-1.5 transition-colors ${
                      configMode === 'custom'
                        ? 'bg-primary/15 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    }`}
                  >
                    <Settings className="w-3.5 h-3.5" />
                    弹性开通
                  </button>
                </div>


              </div>

              {/* 套餐模式 - 选择产品后显示该产品的套餐 */}
              {configMode === 'package' && (
                <div className="space-y-3">
                  {savedPackages.length === 0 ? (
                    <div className="text-center py-6 border border-dashed border-border rounded-lg">
                      <Bookmark className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                      <p className="text-muted-foreground text-sm">暂无保存的套餐</p>
                      <p className="text-muted-foreground text-xs mt-1">切换到「弹性开通」配置后保存为套餐</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <Label className="text-foreground/80 text-xs whitespace-nowrap">选择产品</Label>
                        <Select
                          value={selectedProductId?.toString() || ''}
                          onValueChange={(val) => {
                            const pid = parseInt(val);
                            setSelectedProductId(pid);
                            const pkgsForProduct = savedPackages.filter(p => p.productId === pid);
                            if (pkgsForProduct.length > 0) {
                              // 默认选择月付套餐
                              const monthly = pkgsForProduct.find(p => p.billingCycle === 'monthly');
                              handleSelectPackage(monthly ? monthly.id : pkgsForProduct[0].id);
                            }
                          }}
                        >
                          <SelectTrigger className="bg-muted border-border text-foreground h-8 flex-1 min-w-0 text-sm">
                            <SelectValue placeholder="选择产品" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border max-h-80">
                            {(() => {
                              return sortedProductIds.map(pid => {
                                const info = productInfoMap.get(pid);
                                if (!info) return null;
                                return (
                                  <SelectItem key={pid} value={String(pid)} className="text-foreground focus:bg-accent">
                                    {info.name} <span className="text-muted-foreground text-xs ml-1">({info.count}个套餐)</span>
                                  </SelectItem>
                                );
                              });
                            })()}
                          </SelectContent>
                        </Select>
                        {savedPackages.length > 1 && (
                          <Button type="button" variant="ghost" size="sm"
                            onClick={() => setShowGroupSortDialog(true)}
                            className="text-muted-foreground bg-muted/40 hover:text-muted-foreground hover:bg-accent/50 h-7 px-2 text-xs shrink-0">
                            <ArrowUpDown className="w-3 h-3 sm:mr-1" /><span className="hidden sm:inline">排序/隐藏</span>
                          </Button>
                        )}
                      </div>
                      {selectedProductId && (() => {
                        const pkgs = savedPackages.filter(p => p.productId === selectedProductId);
                        if (pkgs.length === 0) return null;
                        // 按配置分组：相同配置的月付/年付合并，只显示一个卡片
                        const getConfigKey = (pkg: PackageConfig) => {
                          // 排除 os_cat_ 开头的键，按 key 排序后拼接
                          const entries = Object.entries(pkg.configValues)
                            .filter(([k]) => !k.startsWith('os_cat_'))
                            .sort(([a], [b]) => a.localeCompare(b));
                          return entries.map(([k, v]) => `${k}:${v}`).join('|');
                        };
                        // 按配置分组
                        const configGroups = new Map<string, PackageConfig[]>();
                        for (const pkg of pkgs) {
                          const key = getConfigKey(pkg);
                          if (!configGroups.has(key)) configGroups.set(key, []);
                          configGroups.get(key)!.push(pkg);
                        }
                        // 每组只显示一个（优先月付），另一个作为 sibling
                        const displayPkgs: PackageConfig[] = [];
                        const siblingMap = new Map<string, PackageConfig | null>();
                        for (const [, group] of configGroups) {
                          const monthly = group.find(p => p.billingCycle === 'monthly');
                          const annually = group.find(p => p.billingCycle === 'annually');
                          const display = monthly || group[0];
                          displayPkgs.push(display);
                          siblingMap.set(display.id, (display.billingCycle === 'monthly' ? annually : monthly) || null);
                          // 如果当前选中的是 sibling，也要标记
                          if (annually && display === monthly) {
                            siblingMap.set(annually.id, monthly);
                          }
                        }
                        // 排序保持原始顺序
                        displayPkgs.sort((a, b) => {
                          const ai = pkgs.findIndex(p => p.id === a.id);
                          const bi = pkgs.findIndex(p => p.id === b.id);
                          return ai - bi;
                        });
                        const handleSwitchCycle = (targetId: string) => {
                          handleSelectPackage(targetId);
                        };
                        return (
                          <DndContext
                            sensors={dragSensors}
                            collisionDetection={closestCenter}
                            onDragEnd={handlePackageDragEnd}
                          >
                            <SortableContext
                              items={displayPkgs.map(p => p.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                {displayPkgs.map(pkg => (
                                  <SortablePackageCard
                                    key={pkg.id}
                                    pkg={pkg}
                                    isSelected={selectedPackageId === pkg.id || selectedPackageId === siblingMap.get(pkg.id)?.id}
                                    onSelect={() => handleSelectPackage(pkg.id)}
                                    onDelete={() => handleDeletePackage(selectedPackageId === siblingMap.get(pkg.id)?.id ? (siblingMap.get(pkg.id)?.id || pkg.id) : pkg.id)}
                                    onEdit={() => openEditPackageDialog(selectedPackageId === siblingMap.get(pkg.id)?.id ? (siblingMap.get(pkg.id)?.id || pkg.id) : pkg.id)}
                                    siblingPkg={siblingMap.get(pkg.id) || null}
                                    onSwitchCycle={handleSwitchCycle}
                                    selectedCycle={selectedPackageId === siblingMap.get(pkg.id)?.id ? 'annually' : 'monthly'}
                                  />
                                ))}
                              </div>
                            </SortableContext>
                          </DndContext>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {/* 套餐模式 - 操作系统+价格+开通按钮（放在套餐选择下方） */}
              {configMode === 'package' && selectedProductId && configOptions.length > 0 && !isLoadingConfig && (
                <div className="space-y-3 mt-3">
                  {/* 付款周期 + 数量 - 始终一排 */}
                  <div className="flex items-center gap-3 flex-nowrap">
                    <div className="flex items-center gap-2 shrink-0">
                      <Label className="text-muted-foreground text-sm whitespace-nowrap">周期</Label>
                      <Select value={selectedBillingCycle} onValueChange={setSelectedBillingCycle}>
                        <SelectTrigger className="bg-muted border-border text-foreground h-8 text-sm w-20 sm:w-24">
                          <SelectValue placeholder="选择" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border">
                          {productCycles.map(c => (
                            <SelectItem key={c.value} value={c.value} className="text-foreground focus:bg-accent">
                              {c.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Label className="text-muted-foreground text-sm whitespace-nowrap">数量</Label>
                      <div className="flex items-center gap-1">
                        <button type="button"
                          className="w-7 h-8 rounded bg-accent border border-border text-foreground flex items-center justify-center hover:bg-accent text-sm shrink-0"
                          onClick={() => setProductQty(prev => Math.max(1, prev - 1))}
                        >-</button>
                        <Input type="number" min={1} value={productQty}
                          onChange={(e) => { let val = parseInt(e.target.value) || 1; val = Math.max(1, val); setProductQty(val); }}
                          className="bg-muted border-border text-foreground text-center h-8 w-14 text-sm" />
                        <button type="button"
                          className="w-7 h-8 rounded bg-accent border border-border text-foreground flex items-center justify-center hover:bg-accent text-sm shrink-0"
                          onClick={() => setProductQty(prev => prev + 1)}
                        >+</button>
                      </div>
                    </div>
                    {/* 操作系统选择 - 桌面端：同行显示；手机端：换行各占一排 */}
                    <div className="hidden sm:flex items-center gap-2 flex-1 min-w-0">
                    {configOptions.filter(opt => opt.option_type === 5).map(opt => <ConfigOptionItem key={opt.id} opt={opt} configValues={configValues} onConfigChange={setConfigValues} compact />)}
                    </div>
                  </div>
                  {/* 手机端操作系统 - 各占一排 */}
                  <div className="sm:hidden flex flex-col gap-2">
                    {configOptions.filter(opt => opt.option_type === 5).map(opt => <ConfigOptionItem key={`m-${opt.id}`} opt={opt} configValues={configValues} onConfigChange={setConfigValues} mobile />)}
                  </div>

                  {/* 价格汇总 */}
                  <div className="bg-muted rounded-lg p-3 space-y-2 min-h-[180px]">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{'产品'}</span>
                      <span className="text-foreground">{selectedProductName}</span>
                    </div>
                    {selectedNodeName && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{'节点'}</span>
                        <span className="text-foreground">{selectedNodeName}</span>
                      </div>
                    )}
                    {firstPrice && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">首次价格</span>
                        <span className="text-primary">¥{parseFloat(firstPrice).toFixed(2)}</span>
                      </div>
                    )}
                    {renewPrice && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">续费价格</span>
                        <span className="text-primary">¥{parseFloat(renewPrice).toFixed(2)}</span>
                      </div>
                    )}
                    {selectedGateway && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">支付方式</span>
                        <span className="text-foreground">{gateways.find(g => g.name === selectedGateway)?.title || selectedGateway}{autoRecharge ? ' + 自动充余额' : useCredit ? ' + 余额抵扣' : ''}</span>
                      </div>
                    )}
                    <div className="border-t border-border pt-2 flex justify-between font-bold">
                      <span className="text-foreground/80">合计</span>
                      <span className="text-primary text-lg">¥{firstPrice ? (parseFloat(firstPrice) * productQty).toFixed(2) : '--'}</span>
                    </div>
                    {productQty > 1 && firstPrice && (
                      <div className="text-right text-xs text-muted-foreground mt-0.5">¥{parseFloat(firstPrice).toFixed(2)} × {productQty}</div>
                    )}
                  </div>

                  {/* 一键开通按钮 */}
                  <Button
                    onClick={handleOneClickOrder}
                    disabled={isProcessing || !selectedProductId}
                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-5 text-base"
                  >
                    {isProcessing ? (
                      <><Loader2 className="w-5 h-5 mr-2 animate-spin" />正在处理...</>
                    ) : (
                      <><Zap className="w-5 h-5 mr-2" />一键开通</>
                    )}
                  </Button>
                  {!selectedUser && selectedProductId && (
                    <p className="text-xs text-primary text-center">点击开通后搜索选择用户</p>
                  )}
                </div>
              )}

              {/* 弹性模式 - 产品选择 */}
              {configMode === 'custom' && (
                <div className="space-y-3">
                  <div className="flex-1">
                    <Label className="text-foreground/80 text-xs mb-1 block">选择产品</Label>
                    {productGroups.length === 0 ? (
                      <Button variant="outline" onClick={loadProducts} disabled={isLoadingProducts}
                        className="w-full border-border text-muted-foreground hover:text-foreground h-9">
                        {isLoadingProducts ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Package className="w-4 h-4 mr-2" />}
                        {isLoadingProducts ? '加载中...' : '点击加载产品列表'}
                      </Button>
                    ) : (
                      <Select value={selectedProductId?.toString() || ''} onValueChange={(val) => { setSelectedPackageId(''); handleSelectProduct(parseInt(val)); }}>
                        <SelectTrigger className="bg-muted border-border text-foreground h-9 w-full max-w-md">
                          <SelectValue placeholder="选择要开通的产品" />
                        </SelectTrigger>
                        <SelectContent className="bg-popover border-border max-h-80">
                          {(sortedProductGroups || []).filter(g => Array.isArray(g.groups)).flatMap(firstGroup =>
                            (firstGroup.groups || []).filter(sg => Array.isArray(sg.products) && sg.products.length > 0).flatMap(subGroup => [
                              <SelectItem key={`group-${subGroup.id}`} value={`__group_${subGroup.id}`} disabled className="text-primary font-semibold text-xs">
                                {firstGroup.name} / {subGroup.name}
                              </SelectItem>,
                              ...(subGroup.products || []).map(p => (
                                <SelectItem key={p.id} value={String(p.id)} className="text-foreground focus:bg-accent pl-8">
                                  {p.name}{p.hidden ? ' (隐藏)' : ''}
                                </SelectItem>
                              )),
                            ])
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* 保存为套餐入口 */}
                  {selectedProductId && configOptions.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { setShowSaveDialog(true); setPackageNameInput(''); }}
                        className="border-primary/30 text-primary hover:bg-primary/90/10 hover:text-primary h-8"
                      >
                        <Bookmark className="w-3.5 h-3.5 mr-1.5" />
                        保存为套餐
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={openImportDialog}
                        disabled={importingPackages}
                        className="border-success/30 text-success hover:bg-success/10 hover:text-success/80 h-8"
                      >
                        {importingPackages ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
                        批量导入套餐
                      </Button>
                      {showSaveDialog && (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            ref={saveInputRef}
                            value={packageNameInput}
                            onChange={(e) => setPackageNameInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSavePackage()}
                            placeholder="输入套餐名称，如：香港云-标准版"
                            className="flex-1 max-w-xs bg-muted border-border text-foreground placeholder:text-muted-foreground text-sm h-8"
                            autoFocus
                          />
                          <Button type="button" size="sm" onClick={handleSavePackage}
                            className="bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 h-8">
                            保存
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)}
                            className="text-muted-foreground hover:text-foreground shrink-0 h-8">
                            取消
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 sm:gap-6">
          {/* 左侧 - 配置选项 & 开通 */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-foreground text-base flex items-center gap-2">
                  <Settings className="w-4 h-4 text-primary" />
                  开通配置
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* 价格覆盖 */}
                {selectedProductId && (
                  <div className="space-y-2">
                    <Label className="text-foreground/80 text-sm">内部价格(首次)</Label>
                    <div className="space-y-1">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={firstPrice}
                        onChange={(e) => setFirstPrice(e.target.value)}
                        placeholder="请输入内部价格"
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                      <p className="text-xs text-muted-foreground">(只有手动输入价格才能替换默认的价格)</p>
                    </div>
                  </div>
                )}
                {selectedProductId && (
                  <div className="space-y-2">
                    <Label className="text-foreground/80 text-sm">内部价格(续费)</Label>
                    <div className="space-y-1">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={renewPrice}
                        onChange={(e) => setRenewPrice(e.target.value)}
                        placeholder="请输入内部价格"
                        className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                      />
                      <p className="text-xs text-muted-foreground">(只有手动输入价格才能替换默认的价格)</p>
                    </div>
                  </div>
                )}

                {/* 支付方式 */}
                {selectedProductId && gateways.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-foreground/80 text-sm">支付方式</Label>
                    <Select value={selectedGateway} onValueChange={setSelectedGateway}>
                      <SelectTrigger className="bg-muted border-border text-foreground">
                        <SelectValue placeholder="选择支付方式" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {gateways.filter(g => g.status === 1).map(g => (
                          <SelectItem key={g.id} value={g.name} className="text-foreground focus:bg-accent">
                            {g.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedUser && (
                      <div className="space-y-1.5 mt-1">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="autoRecharge"
                            checked={autoRecharge}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                              setAutoRecharge(e.target.checked);
                              if (e.target.checked) setUseCredit(true);
                            }}
                            className="rounded border-border bg-muted"
                          />
                          <label htmlFor="autoRecharge" className="text-sm text-foreground/80 cursor-pointer">
                            自动充余额后开通 {firstPrice && (
                              <span className="text-primary text-xs">(充值 ¥{parseFloat(firstPrice).toFixed(2)})</span>
                            )}
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="useCredit"
                            checked={useCredit}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUseCredit(e.target.checked)}
                            disabled={autoRecharge}
                            className="rounded border-border bg-muted disabled:opacity-50"
                          />
                          <label htmlFor="useCredit" className={`text-sm cursor-pointer ${autoRecharge ? 'text-muted-foreground' : 'text-foreground/80'}`}>
                            使用余额抵扣 (余额: ¥{Number(selectedUser.credit).toFixed(2)})
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 配置选项加载中 */}
                {isLoadingConfig && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    加载配置选项中...
                  </div>
                )}

                {/* 可配置选项 */}
                {configOptions.length > 0 && !isLoadingConfig && (
                  <div className="space-y-3">
                    <Label className="text-foreground/80 text-sm font-bold flex items-center gap-1">
                      <Settings className="w-3.5 h-3.5" />
                      可配置选项
                    </Label>
                    {configMode === 'package' ? (
                      <>
                        {/* 套餐模式：节点选择/优先级/分组始终显示，其余配置项折叠 */}
                        {(() => {
                          const allOpts = configOptions.filter(opt => opt.option_type !== 5);
                          const nodeOpts = allOpts.filter(opt => isCoreOptionInPackageMode(opt));
                          const extraOpts = allOpts.filter(opt => !isCoreOptionInPackageMode(opt));
                          return (
                            <>
                              {/* 节点相关选项始终显示 */}
                              {nodeOpts.length > 0 && (
                                <div className="space-y-3">
                                  {nodeOpts.map(opt => <ConfigOptionItem key={opt.id} opt={opt} configValues={configValues} onConfigChange={setConfigValues} />)}
                                </div>
                              )}
                              {/* 其他配置项折叠 */}
                              {extraOpts.length > 0 && (
                                <div className="border border-border rounded-lg overflow-hidden">
                                  <button
                                    type="button"
                                    onClick={() => setPackageExtraExpanded(!packageExtraExpanded)}
                                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground/80 hover:bg-accent/30 transition-colors"
                                  >
                                    <span className="flex items-center gap-1.5">
                                      {packageExtraExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                      配置项 ({extraOpts.length}项)
                                    </span>
                                    <span className="text-xs text-muted-foreground">套餐已保存，通常无需修改</span>
                                  </button>
                                  {packageExtraExpanded && (
                                    <div className="px-3 pb-3 space-y-3 border-t border-border pt-3">
                                      {extraOpts.map(opt => <ConfigOptionItem key={opt.id} opt={opt} configValues={configValues} onConfigChange={setConfigValues} />)}
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </>
                    ) : (
                      /* 弹性模式：周期+数量+配置项 */
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex items-center gap-2">
                            <Label className="text-muted-foreground text-xs sm:text-sm whitespace-nowrap">付款周期</Label>
                            <Select value={selectedBillingCycle} onValueChange={setSelectedBillingCycle}>
                              <SelectTrigger className="bg-muted border-border text-foreground h-8 flex-1 text-sm">
                                <SelectValue placeholder="选择" />
                              </SelectTrigger>
                              <SelectContent className="bg-popover border-border">
                                {productCycles.map(c => (
                                  <SelectItem key={c.value} value={c.value} className="text-foreground focus:bg-accent">
                                    {c.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex items-center gap-2">
                            <Label className="text-muted-foreground text-xs sm:text-sm whitespace-nowrap">数量</Label>
                            <div className="flex items-center gap-1 flex-1">
                              <button type="button"
                                className="w-7 h-7 rounded bg-accent border border-border text-foreground flex items-center justify-center hover:bg-accent text-sm shrink-0"
                                onClick={() => setProductQty(prev => Math.max(1, prev - 1))}
                              >-</button>
                              <Input type="number" min={1} value={productQty}
                                onChange={(e) => { let val = parseInt(e.target.value) || 1; val = Math.max(1, val); setProductQty(val); }}
                                className="bg-muted border-border text-foreground text-center w-14 h-7 text-sm" />
                              <button type="button"
                                className="w-7 h-7 rounded bg-accent border border-border text-foreground flex items-center justify-center hover:bg-accent text-sm shrink-0"
                                onClick={() => setProductQty(prev => prev + 1)}
                              >+</button>
                            </div>
                          </div>
                        </div>
                        {/* 所有配置项（含操作系统） */}
                        {configOptions.map(opt => <ConfigOptionItem key={opt.id} opt={opt} configValues={configValues} onConfigChange={setConfigValues} />)}
                      </>
                    )}
                  </div>
                )}



                {/* 价格汇总 - 仅弹性模式显示（套餐模式在上方套餐区域显示） */}
                {selectedProductId && configMode !== 'package' && (
                  <div className="bg-muted rounded-lg p-3 space-y-2 min-h-[180px]">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{'产品'}</span>
                      <span className="text-foreground">{selectedProductName}</span>
                    </div>
                    {selectedNodeName && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{'节点'}</span>
                        <span className="text-foreground">{selectedNodeName}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">计费周期</span>
                      <span className="text-foreground">{selectedBillingCycle}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">数量</span>
                      <span className="text-foreground">{productQty}</span>
                    </div>
                    {firstPrice && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">首次价格</span>
                        <span className="text-primary">¥{parseFloat(firstPrice).toFixed(2)}</span>
                      </div>
                    )}
                    {renewPrice && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">续费价格</span>
                        <span className="text-primary">¥{parseFloat(renewPrice).toFixed(2)}</span>
                      </div>
                    )}
                    {selectedGateway && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">支付方式</span>
                        <span className="text-foreground">{gateways.find(g => g.name === selectedGateway)?.title || selectedGateway}{autoRecharge ? ' + 自动充余额' : useCredit ? ' + 余额抵扣' : ''}</span>
                      </div>
                    )}
                    <div className="border-t border-border pt-2 flex justify-between font-bold">
                      <span className="text-foreground/80">合计</span>
                      <span className="text-primary text-lg">¥{firstPrice ? (parseFloat(firstPrice) * productQty).toFixed(2) : '--'}</span>
                    </div>
                    {productQty > 1 && firstPrice && (
                      <div className="text-right text-xs text-muted-foreground mt-0.5">¥{parseFloat(firstPrice).toFixed(2)} × {productQty}</div>
                    )}
                  </div>
                )}

                {/* 一键开通按钮 - 仅弹性模式显示（套餐模式在上方套餐区域显示） */}
                {configMode !== 'package' && (
                <Button
                  onClick={handleOneClickOrder}
                  disabled={isProcessing || !selectedProductId}
                  className="w-full bg-gradient-to-b from-primary to-primary/90 hover:from-primary/95 hover:to-primary/85 text-primary-foreground font-bold py-5 text-base shadow-lg shadow-primary/30 border border-primary/20"
                >
                  {isProcessing ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" />正在处理...</>
                  ) : (
                    <><Zap className="w-5 h-5 mr-2" />一键开通</>
                  )}
                </Button>
                )}
                {!selectedUser && selectedProductId && configMode !== 'package' && (
                  <p className="text-xs text-destructive text-center">请先在上方搜索并选择用户</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 右侧 - 配置摘要 & 结果 */}
          <div className="space-y-4">
            {/* 已选配置摘要 */}
            {selectedProductId && configOptions.length > 0 && !isLoadingConfig && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-foreground text-base flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    当前配置摘要
                    {selectedPackageId && (() => {
                      const pkg = savedPackages.find(p => p.id === selectedPackageId);
                      return pkg ? (
                        <Badge variant="outline" className="border-primary/50 text-primary bg-primary/10 text-xs ml-2">
                          <Star className="w-3 h-3 mr-1" />{pkg.name}
                        </Badge>
                      ) : null;
                    })()}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="divide-y divide-slate-700/50">
                    {configOptions.map(opt => {
                      const selectedVal = configValues[opt.id];
                      let selectedName = '';
                      if (opt.option_type === 3) {
                        selectedName = selectedVal === '1' ? '是' : '否';
                      } else if ([7, 9, 11, 14, 15].includes(opt.option_type)) {
                        const qty = configValues[`qty_${opt.id}`] || opt.qty_minimum || 0;
                        selectedName = `${qty}${opt.unit || ''}`;
                      } else if (opt.option_type === 5 && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
                        const osCat = configValues[`os_cat_${opt.id}`] || '';
                        const catData = (opt.child as Record<string, { system?: string; child: Array<{ id: number; version: string }> }>)[osCat];
                        if (catData?.child) {
                          const found = catData.child.find(c => String(c.id) === selectedVal);
                          if (found) selectedName = `${catData.system || osCat} - ${found.version}`;
                        }
                      } else if (Array.isArray(opt.child)) {
                        const found = opt.child.find(c => String(c.id) === selectedVal);
                        if (found) {
                          const name = found.option_name;
                          const sep = name.includes('^') ? '^' : name.includes('|') ? '|' : null;
                          selectedName = sep ? name.split(sep).pop()!.trim() : name;
                        }
                      } else {
                        selectedName = selectedVal || '-';
                      }
                      return (
                        <div key={opt.id} className="flex justify-between items-center py-1.5">
                          <span className="text-muted-foreground text-xs">{opt.option_name}</span>
                          <span className="text-foreground text-xs font-medium">{selectedName || '-'}</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* 开通进度 & 结果弹窗 */}
            <Dialog open={(processingSteps.length > 0 || isProcessing || !!orderResult) && mainTab === 'provision'} onOpenChange={(open) => {
              if (!open && !isProcessing) {
                setOrderResult(null);
                setResultData(null);
                setProcessingSteps([]);
                setProgress(0);
                setSelectedProductId(null);
                setSelectedProductDetail(null);
                setSelectedBillingCycle('monthly');
                setSelectedPackageId('');
                setConfigOptions([]);
                setConfigValues({});
                setCustomFieldValues({});
                setProductQty(1);
                setFirstPrice('');
                setRenewPrice('');
                setProductGroups([]);
                setProductCycles([]);
              }
            }}>
              <DialogContent className="sm:!max-w-lg bg-card border-border p-0 gap-0 max-h-[85vh] flex flex-col w-[calc(100vw-1.5rem)]" showCloseButton={false}>
                {/* 进度部分 - 结果出来后隐藏 */}
                {((processingSteps.length > 0 || isProcessing) && !orderResult) && (
                  <div className="p-3 sm:p-5 sm:pb-3 pb-2 shrink-0">
                    <DialogTitle className="flex items-center justify-between mb-2 sm:mb-3">
                      <span className="text-foreground text-sm sm:text-base font-semibold">开通进度</span>
                      <span className="text-xs sm:text-sm text-muted-foreground">{progress}%</span>
                    </DialogTitle>
                    <Progress value={progress} className="h-1.5 sm:h-2 bg-accent mb-2 sm:mb-4" />
                    <div className="space-y-1.5 sm:space-y-2">
                      {processingSteps.map((step, index) => (
                        <div key={step.id} className="flex items-center gap-1.5 sm:gap-2">
                          <div className={`w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center shrink-0 ${
                            step.status === 'completed' ? 'bg-success/20 text-success' :
                            step.status === 'processing' ? 'bg-primary/20 text-primary' :
                            step.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                            'bg-accent text-muted-foreground'
                          }`}>
                            {step.status === 'completed' ? <CheckCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> :
                             step.status === 'processing' ? <Loader2 className="w-2.5 h-2.5 sm:w-3 sm:h-3 animate-spin" /> :
                             step.status === 'failed' ? <XCircle className="w-2.5 h-2.5 sm:w-3 sm:h-3" /> :
                             <span className="text-[8px] sm:text-[10px] font-bold">{index + 1}</span>
                            }
                          </div>
                          <span className={`text-xs sm:text-sm ${
                            step.status === 'completed' ? 'text-success' :
                            step.status === 'processing' ? 'text-primary' :
                            step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'
                          }`}>{step.name}</span>
                          {step.message && (
                            <span className="text-[10px] sm:text-xs text-muted-foreground truncate">{step.message}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 结果部分 */}
                {orderResult && (
                  <div className={`${processingSteps.length > 0 ? 'border-t border-border' : ''} flex flex-col min-h-0 flex-1`}>
                    {/* 标题 */}
                    <div className="shrink-0 px-3 sm:px-5 pt-3 sm:pt-5">
                      <h3 className={`text-base sm:text-lg flex items-center gap-2 ${orderResult.success ? 'text-success' : 'text-destructive'}`}>
                        {orderResult.success ? <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" /> : <XCircle className="w-4 h-4 sm:w-5 sm:h-5" />}
                        {orderResult.success ? '开通成功' : '开通失败'}
                      </h3>
                    </div>
                    {/* 可滚动的产品信息区域 */}
                    {orderResult.success && resultData && (
                      <div className="overflow-y-auto min-h-0 flex-1 px-3 sm:px-5 py-3 space-y-2 sm:space-y-3">
                        {Array.isArray(resultData) && resultData.length > 1 && (
                          <p className="text-muted-foreground text-[10px] sm:text-xs text-center">共开通 {resultData.length} 台服务器</p>
                        )}
                        {/* 多台时订单ID只显示一次 */}
                        {Array.isArray(resultData) && resultData.length > 1 && resultData[0]?.orderId && (
                          <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                            <span className="text-muted-foreground text-xs">订单ID</span>
                            <div className="flex items-center gap-2">
                              <span className="text-foreground font-mono text-xs">{resultData[0].orderId}</span>
                              <button onClick={() => copyText(resultData[0].orderId)} className="text-muted-foreground hover:text-foreground">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                        {(Array.isArray(resultData) ? resultData : [resultData]).map((item, idx) => {
                          const isMulti = Array.isArray(resultData) && resultData.length > 1;
                          return (
                            <div key={item.hostId || idx} className={`${isMulti ? 'bg-muted/30 rounded-lg p-2 border border-border/50' : 'space-y-2'}`}>
                              {isMulti && (
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-info text-xs font-medium">第 {idx + 1} 台</span>
                                  {item.hostId && (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-muted-foreground text-xs">ID:{item.hostId}</span>
                                      <button onClick={() => copyText(item.hostId)} className="text-muted-foreground hover:text-foreground">
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className="space-y-1.5">
                                {/* 单台时显示订单ID和服务ID */}
                                {!isMulti && item.orderId && (
                                  <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs">订单ID</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-foreground font-mono text-xs">{item.orderId}</span>
                                      <button onClick={() => copyText(item.orderId)} className="text-muted-foreground hover:text-foreground">
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {!isMulti && item.hostId && (
                                  <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs">服务ID</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-foreground font-mono text-xs">{item.hostId}</span>
                                      <button onClick={() => copyText(item.hostId)} className="text-muted-foreground hover:text-foreground">
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {item.ip && (
                                  <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs">IP地址</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-success font-mono font-bold text-xs break-all">{item.ip}</span>
                                      <button onClick={() => copyText(item.ip)} className="text-muted-foreground hover:text-foreground shrink-0">
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {item.username && (
                                  <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs">用户名</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-foreground font-mono text-xs break-all">{item.username}</span>
                                      <button onClick={() => copyText(item.username)} className="text-muted-foreground hover:text-foreground shrink-0">
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                                {item.password && (
                                  <div className="bg-muted/50 rounded-lg p-2 flex items-center justify-between">
                                    <span className="text-muted-foreground text-xs">密码</span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-foreground font-mono text-xs break-all">{item.password}</span>
                                      <button onClick={() => copyText(item.password)} className="text-muted-foreground hover:text-foreground shrink-0">
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* 话术预览区 */}
                    {orderResult.success && resultData && templates.length > 0 && (() => {
                      const osName = getCurrentOsName();
                      const items = Array.isArray(resultData) ? resultData : [resultData];
                      const matchedTmpl = matchTemplate(osName, selectedProductId, templates);
                      if (!matchedTmpl) return null;
                      const buildVars = (item: typeof items[0]) => ({
                        ip: item.ip || '',
                        username: item.username || '',
                        password: item.password || '',
                        nextduedate: item.nextduedate || '',
                        amount: item.amount || '',
                        billingcycle: item.billingcycle || '',
                        product_name: item.productName || '',
                        os_name: osName,
                      });
                      let renderedText = '';
                      if (matchedTmpl.perServer && items.length > 1) {
                        // 按台数生成话术
                        renderedText = items.map((item, i) => `[第${i + 1}台]\n${renderTemplate(matchedTmpl, buildVars(item))}`).join('\n\n');
                      } else {
                        // 只生成一份，取第一台信息
                        renderedText = renderTemplate(matchedTmpl, buildVars(items[0]));
                      }
                      return (
                        <div className="border-t border-border/50 px-3 sm:px-5 py-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-primary" />
                              <span className="text-primary text-xs font-medium">交付话术</span>
                              <span className="text-muted-foreground text-[10px]">({matchedTmpl.name})</span>
                            </div>
                            <Button size="sm" variant="ghost"
                              className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
                              onClick={() => {
                                copyText(renderedText);
                                showNotification('success', '话术已复制');
                              }}>
                              <Copy className="w-3 h-3 mr-1" />复制话术
                            </Button>
                          </div>
                          <div className="bg-muted/60 rounded-lg p-2.5 max-h-40 overflow-y-auto">
                            <pre className="text-foreground text-xs whitespace-pre-wrap break-all font-sans leading-relaxed">{renderedText}</pre>
                          </div>
                        </div>
                      );
                    })()}
                    {/* 底部固定按钮区域 */}
                    {orderResult.success && resultData && (() => {
                      const first = Array.isArray(resultData) ? resultData[0] : resultData;
                      if (!first) return null;
                      return (
                        <div className="shrink-0 border-t border-border/50 px-3 sm:px-5 py-2 space-y-1.5">
                          <div className="grid grid-cols-4 gap-1.5">
                            <Button size="sm" className="bg-info hover:bg-info/90 text-info-foreground border-0 text-[11px] h-7 px-1"
                              onClick={() => {
                                const items = Array.isArray(resultData) ? resultData : [resultData];
                                const text = items.map((it, i) => {
                                  const prefix = items.length > 1 ? `第${i + 1}台 ` : '';
                                  return `${prefix}IP：${it.ip}  用户名：${it.username}  密码：${it.password}`;
                                }).join('\n');
                                copyText(text);
                              }}>
                              <Copy className="w-3 h-3 mr-0.5" />复制信息
                            </Button>
                            <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground border-0 text-[11px] h-7 px-1"
                              onClick={() => {
                                const items = Array.isArray(resultData) ? resultData : [resultData];
                                const osName = getCurrentOsName();
                                const matchedTmpl = matchTemplate(osName, selectedProductId, templates);
                                const infoText = items.map((it, i) => {
                                  const prefix = items.length > 1 ? `第${i + 1}台 ` : '';
                                  return `${prefix}IP：${it.ip}  用户名：${it.username}  密码：${it.password}`;
                                }).join('\n');
                                let templateText = '';
                                if (matchedTmpl) {
                                  if (matchedTmpl.perServer && items.length > 1) {
                                    templateText = items.map((item, i) => `[第${i + 1}台]\n${renderTemplate(matchedTmpl, {
                                      ip: item.ip || '', username: item.username || '', password: item.password || '',
                                      nextduedate: item.nextduedate || '', amount: item.amount || '', billingcycle: item.billingcycle || '',
                                      product_name: item.productName || '', os_name: osName,
                                    })}`).join('\n\n');
                                  } else {
                                    templateText = renderTemplate(matchedTmpl, {
                                      ip: items[0].ip || '', username: items[0].username || '', password: items[0].password || '',
                                      nextduedate: items[0].nextduedate || '', amount: items[0].amount || '',
                                      billingcycle: items[0].billingcycle || '', product_name: items[0].productName || '',
                                      os_name: osName,
                                    });
                                  }
                                }
                                const combined = templateText ? `${infoText}\n\n${templateText}` : infoText;
                                copyText(combined);
                                showNotification('success', '信息与话术已复制');
                              }}>
                              <Copy className="w-3 h-3 mr-0.5" />复制全部
                            </Button>
                            {isAdminUser && financeUrl && (
                            <a
                              href={`${financeUrl}/#/customer-view/product-innerpage?id=${first.uid || selectedUser?.id || ''}&hid=${first.hostId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1 text-[11px] text-success-foreground bg-success hover:bg-success/90 px-1 py-1 h-7 rounded-md"
                            >
                              <ExternalLink className="w-3 h-3" />财务
                            </a>
                            )}
                            {isAdminUser && mfyUrl && (
                            <Button size="sm" className="bg-warning text-warning-foreground hover:bg-warning/90 border-0 text-[11px] h-7 px-1"
                              onClick={async () => {
                                try {
                                  if (first.dcimid) {
                                    window.open(`${mfyUrl}/#/cloudsHome?id=${first.dcimid}`, '_blank');
                                  } else {
                                    const detail = await callIdcApi('getServiceDetail', { hostid: first.hostId, uid: first.uid || selectedUser?.id || '' });
                                    const dcimid = detail?.data?.dcimid;
                                    if (dcimid) {
                                      window.open(`${mfyUrl}/#/cloudsHome?id=${dcimid}`, '_blank');
                                    } else {
                                      showNotification('error', '未找到云主机ID，无法跳转魔方云');
                                    }
                                  }
                                } catch {
                                  showNotification('error', '获取云主机ID失败');
                                }
                              }}>
                              <ExternalLink className="w-3 h-3 mr-0.5" />魔方云
                            </Button>
                            )}
                          </div>
                          <div className="flex justify-center">
                            <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 px-8 py-2"
                              onClick={() => {
                                setOrderResult(null); setResultData(null); setProcessingSteps([]); setProgress(0);
                                setSelectedProductId(null); setSelectedProductDetail(null); setSelectedBillingCycle('monthly'); setSelectedPackageId('');
                                setConfigOptions([]); setConfigValues({}); setCustomFieldValues({}); setProductQty(1); setFirstPrice(''); setRenewPrice(''); setProductGroups([]); setProductCycles([]);
                              }}>
                              关闭
                            </Button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </DialogContent>
            </Dialog>

          </div>
        </div>
        </>
        )}


      {/* 续费完成话术弹窗 - 放在条件块外，确保续费时也能渲染 */}
      <Dialog open={showRenewResult} onOpenChange={setShowRenewResult}>
        <DialogContent className="sm:!max-w-md bg-card border-border p-0 gap-0 max-h-[85vh] flex flex-col w-[calc(100vw-1.5rem)]" showCloseButton={false}>
          {/* 标题 */}
          <div className="shrink-0 px-3 sm:px-5 pt-3 sm:pt-5">
            <DialogTitle className="text-base sm:text-lg flex items-center gap-2 text-success">
              <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              续费完成
            </DialogTitle>
          </div>
          {/* 产品信息列表 - 多台时每行一条 */}
          <div className="overflow-y-auto min-h-0 flex-1 px-3 sm:px-5 py-3 space-y-2">
            {renewResultData?.map((item, idx) => (
              <div key={item.hostId || idx} className="bg-muted/50 rounded-lg p-2.5">
                <div className="text-foreground text-xs font-medium truncate mb-1">{item.productName}</div>
                <div className="text-muted-foreground text-xs flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>IP：<span className="text-foreground font-mono">{item.ip || '-'}</span></span>
                  <span>到期：<span className="text-foreground">{item.nextduedate || '-'}</span></span>
                </div>
              </div>
            ))}
          </div>
          {/* 话术预览区 - 按 scene='renew' 匹配模板渲染 */}
          {renewResultData && renewResultData.length > 0 && templates.length > 0 && (() => {
            const items = renewResultData;
            const matchedTmpl = matchTemplate('', null, templates, 'renew');
            if (!matchedTmpl) return null;
            const buildVars = (it: typeof items[0]) => ({
              ip: it.ip || '',
              username: '',
              password: '',
              nextduedate: it.nextduedate || '',
              amount: it.amount || '',
              billingcycle: it.billingcycle || '',
              product_name: it.productName || '',
              os_name: '',
            });
            let renderedText = '';
            if (matchedTmpl.perServer && items.length > 1) {
              renderedText = items.map((it, i) => `[第${i + 1}台]\n${renderTemplate(matchedTmpl, buildVars(it))}`).join('\n\n');
            } else {
              renderedText = renderTemplate(matchedTmpl, buildVars(items[0]));
            }
            return (
              <div className="border-t border-border/50 px-3 sm:px-5 py-2">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    <span className="text-primary text-xs font-medium">续费话术</span>
                    <span className="text-muted-foreground text-[10px]">({matchedTmpl.name})</span>
                  </div>
                  <Button size="sm" variant="ghost"
                    className="text-muted-foreground hover:text-foreground h-6 px-2 text-xs"
                    onClick={() => {
                      copyText(renderedText);
                      showNotification('success', '话术已复制');
                    }}>
                    <Copy className="w-3 h-3 mr-1" />复制话术
                  </Button>
                </div>
                <div className="bg-muted/60 rounded-lg p-2.5 max-h-40 overflow-y-auto">
                  <pre className="text-foreground text-xs whitespace-pre-wrap break-all font-sans leading-relaxed">{renderedText}</pre>
                </div>
              </div>
            );
          })()}
          {/* 底部按钮区 - 与开通弹窗一致的三按钮 grid 布局 */}
          <div className="shrink-0 border-t border-border/50 px-3 sm:px-5 py-2 space-y-1.5">
            <div className="grid grid-cols-3 gap-1.5">
              <Button size="sm" className="bg-info hover:bg-info/90 text-info-foreground border-0 text-[11px] h-7 px-1"
                onClick={() => {
                  const items = renewResultData || [];
                  const text = items.map((it, i) => {
                    const prefix = items.length > 1 ? `第${i + 1}台 ` : '';
                    return `${prefix}IP：${it.ip}  到期：${it.nextduedate}`;
                  }).join('\n');
                  copyText(text);
                }}>
                <Copy className="w-3 h-3 mr-0.5" />复制信息
              </Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground border-0 text-[11px] h-7 px-1"
                onClick={() => {
                  const items = renewResultData || [];
                  // 信息部分：IP + 到期时间
                  const infoText = items.map((it, i) => {
                    const prefix = items.length > 1 ? `第${i + 1}台 ` : '';
                    return `${prefix}IP：${it.ip}  到期：${it.nextduedate}`;
                  }).join('\n');
                  // 话术部分：匹配续费模板渲染
                  const matchedTmpl = matchTemplate('', null, templates, 'renew');
                  let templateText = '';
                  if (matchedTmpl) {
                    const buildVars = (it: typeof items[0]) => ({
                      ip: it.ip || '',
                      username: '',
                      password: '',
                      nextduedate: it.nextduedate || '',
                      amount: it.amount || '',
                      billingcycle: it.billingcycle || '',
                      product_name: it.productName || '',
                      os_name: '',
                    });
                    if (matchedTmpl.perServer && items.length > 1) {
                      templateText = items.map((it, i) => `[第${i + 1}台]\n${renderTemplate(matchedTmpl, buildVars(it))}`).join('\n\n');
                    } else {
                      templateText = renderTemplate(matchedTmpl, buildVars(items[0]));
                    }
                  }
                  const combined = templateText ? `${infoText}\n\n${templateText}` : infoText;
                  copyText(combined);
                  showNotification('success', '信息与话术已复制');
                }}>
                <Copy className="w-3 h-3 mr-0.5" />复制全部
              </Button>
              <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 text-[11px] h-7 px-1"
                onClick={() => setShowRenewResult(false)}>
                关闭
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      </main>
    </div>
  );
}
