'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Copy, RefreshCw, Package, Trash2, ExternalLink, Cloud, Sliders, Settings2, Monitor, Activity, Loader2, RotateCcw } from 'lucide-react';
import { getStatusLabel, getStatusClass, formatDueDate, CYCLE_MAP } from '@/lib/product-utils';

interface PingResult {
  reachable: boolean;
  avgLatency: number | null;
  minLatency: number | null;
  maxLatency: number | null;
  packetLoss: number;
  error?: string;
}

export interface ProductCardProps {
  svc: Record<string, unknown>;
  isSelected: boolean;
  selectedRenewIds: Set<number>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  savedPackages: any[];
  financeUrl: string;
  mfyUrl: string;
  uid: string | number | null | undefined;
  isAdminUser: boolean;
  onToggleSelect: (id: number) => void;
  onRenew: (id: number) => void;
  onUpgrade: (svc: Record<string, unknown>) => void;
  onModify: (svc: Record<string, unknown>) => void;
  onRefundDelete: (svc: Record<string, unknown>) => void;
  onRemote: (svc: Record<string, unknown>) => void;
  onMfyCloud: (svc: Record<string, unknown>) => void;
  onRecycleCheck: (svc: Record<string, unknown>) => void;
  onCopy: (text: string) => void;
  showNotification: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const ProductCard = React.memo(function ProductCard({
  svc,
  isSelected,
  savedPackages,
  financeUrl,
  mfyUrl,
  uid,
  isAdminUser,
  onToggleSelect,
  onRenew,
  onUpgrade,
  onModify,
  onRefundDelete,
  onRemote,
  onMfyCloud,
  onRecycleCheck,
  onCopy,
  showNotification,
}: ProductCardProps) {
  const [pingLoading, setPingLoading] = useState(false);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);

  const sLabel = getStatusLabel(svc.domainstatus);
  const sClass = getStatusClass(sLabel);
  const productName = String(svc.productname || svc.product_name || svc.name || '未知产品');
  const ip = String(svc.dedicatedip || svc.ip || '-');
  const dueDate = formatDueDate(svc.nextduedate as string | number | undefined);
  const hostname = String(svc.domain || svc.hostname || svc.host_name || '-');

  const handlePing = async () => {
    if (ip === '-' || pingLoading) return;
    setPingLoading(true);
    setPingResult(null);
    try {
      const res = await fetch('/api/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: ip }),
      });
      const data = await res.json();
      if (data.success) {
        setPingResult({
          reachable: data.reachable,
          avgLatency: data.avgLatency,
          minLatency: data.minLatency,
          maxLatency: data.maxLatency,
          packetLoss: data.packetLoss,
          error: data.error,
        });
      } else {
        setPingResult({ reachable: false, avgLatency: null, minLatency: null, maxLatency: null, packetLoss: 100, error: data.message });
      }
    } catch {
      setPingResult({ reachable: false, avgLatency: null, minLatency: null, maxLatency: null, packetLoss: 100, error: '请求失败' });
    } finally {
      setPingLoading(false);
    }
  };
  const regDate = svc.regdate
    ? formatDueDate(svc.regdate as string | number | undefined)
    : (svc.create_time
      ? (typeof svc.create_time === 'number'
        ? new Date((svc.create_time as number) * 1000).toLocaleDateString()
        : String(svc.create_time))
      : '-');
  const cycle = CYCLE_MAP[String(svc.billingcycle || '')] || String(svc.billingcycle || '-');
  const amount = String(svc.amount || svc.firstpaymentamount || '0.00');
  const svcBillingCycle = String(svc.billingcycle || 'monthly');
  const svcAmount = parseFloat(amount.replace(/[¥元,]/g, ''));
  const svcCycleLabel = CYCLE_MAP[svcBillingCycle] || svcBillingCycle;

  let matchedPackage = savedPackages.find((pkg) => {
    if (String(pkg.productName) !== productName) return false;
    if (String(pkg.billingCycle) !== svcBillingCycle) return false;
    return Math.abs(parseFloat(String(pkg.renewPrice)) - svcAmount) < 0.01;
  });
  if (!matchedPackage) {
    matchedPackage = savedPackages.find((pkg) => {
      if (String(pkg.productName) !== productName) return false;
      return Math.abs(parseFloat(String(pkg.renewPrice)) - svcAmount) < 0.01;
    });
  }
  if (!matchedPackage) {
    matchedPackage = savedPackages.find((pkg) => {
      return String(pkg.productName) === productName && String(pkg.billingCycle) === svcBillingCycle;
    });
  }
  const pkgLabel = matchedPackage ? `${matchedPackage.name} ${svcCycleLabel}` : svcCycleLabel;

  const svcId = svc.id as number;

  return (
    <div className={`p-2.5 sm:p-3 rounded-lg border transition-colors cursor-pointer ${
      isSelected ? 'border-accent2/50 bg-accent2/5' : 'border-border bg-card hover:border-accent2/40'
    }`} onClick={() => onToggleSelect(svcId)}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        {/* 左侧：信息区域 */}
        <div className="flex-1 min-w-0">
          {/* 第一行：复选框 + 产品名 + 标签 + 价格 */}
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(svcId)} onClick={(e) => e.stopPropagation()} className="accent-accent2 w-4 h-4 shrink-0" />
            <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
              <span className="text-foreground font-medium text-sm truncate">{productName}</span>
              {pkgLabel && <span className="text-xs px-1.5 py-0.5 rounded bg-info/15 text-info whitespace-nowrap">{pkgLabel}</span>}
              <span className={`text-xs px-1.5 py-0.5 rounded whitespace-nowrap ${sClass}`}>{sLabel}</span>
              <span className={`whitespace-nowrap ${sLabel === '已删除' || sLabel === '待开通' ? 'text-primary/50 font-medium text-xs' : 'text-primary font-bold text-sm'}`}>{amount}</span>
            </div>
          </div>
          {/* 第二行：详细信息 */}
          <div className="mt-1.5 ml-6 grid grid-cols-2 sm:flex sm:flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {hostname !== '-' && <span>主机: {hostname}</span>}
            <span className="col-span-2 sm:col-span-1 flex items-center gap-0.5">IP: {ip}{ip !== '-' && <>
              <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); onCopy(ip); showNotification('success', '已复制IP: ' + ip); }} className="text-muted-foreground hover:text-foreground"><Copy className="w-3 h-3" /></button>
              <button onClick={(e: React.MouseEvent) => { e.stopPropagation(); handlePing(); }} className="text-muted-foreground hover:text-success" title="Ping" disabled={pingLoading}>
                {pingLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              </button>
              {pingResult && (
                <span className={`text-[10px] font-mono ${pingResult.reachable ? 'text-success' : 'text-destructive'}`}>
                  {pingResult.reachable ? `${pingResult.avgLatency}ms` : (pingResult.error || '超时')}
                </span>
              )}
            </>}</span>
            <span>订购: {regDate}</span>
            <span>到期: {dueDate}</span>
            <span>周期: {cycle}</span>
          </div>
        </div>
        {/* 右侧：操作按钮 */}
        {sLabel !== '已删除' && sLabel !== '待开通' && (
        <div className="flex flex-wrap gap-[1px] shrink-0 ml-6 sm:ml-0">
            <Button variant="ghost" size="sm" className="text-primary hover:bg-primary/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRenew(svcId); }}><RefreshCw className="w-3 h-3 mr-0.5" />续费</Button>
            <Button variant="ghost" size="sm" className="text-accent2 hover:bg-accent2/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onUpgrade(svc); }}><Package className="w-3 h-3 mr-0.5" />升级</Button>
            <Button variant="ghost" size="sm" className="text-info hover:bg-info/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onModify(svc); }}><Sliders className="w-3 h-3 mr-0.5" />改配</Button>
            <a href={`/manage?hostid=${svcId}&uid=${uid}`} target="_blank" rel="noopener noreferrer" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="text-info hover:bg-info/10 h-6 px-0.5 text-xs"><Settings2 className="w-3 h-3 mr-0.5" />管理</Button>
            </a>
            <a href={`/advanced?hostid=${svcId}&uid=${uid}`} target="_blank" rel="noopener noreferrer" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <Button variant="ghost" size="sm" className="text-accent2 hover:bg-accent2/10 h-6 px-0.5 text-xs"><Monitor className="w-3 h-3 mr-0.5" />实例</Button>
            </a>
            {isAdminUser && financeUrl && (
              <a href={`${financeUrl}/#/customer-view/product-innerpage?id=${uid}&hid=${svcId}`} target="_blank" rel="noopener noreferrer" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="text-success hover:bg-success/10 h-6 px-0.5 text-xs"><ExternalLink className="w-3 h-3 mr-0.5" />财务</Button>
              </a>
            )}
            {isAdminUser && mfyUrl && (
              <Button variant="ghost" size="sm" className="text-info hover:bg-info/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onMfyCloud(svc); }}><Cloud className="w-3 h-3 mr-0.5" />魔方云</Button>
            )}
            {ip && ip !== '-' && (
              <Button variant="ghost" size="sm" className="text-warning hover:bg-warning/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRemote(svc); }}><Monitor className="w-3 h-3 mr-0.5" />远程</Button>
            )}
            <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRefundDelete(svc); }}><Trash2 className="w-3 h-3 mr-0.5" />退款删除</Button>
        </div>
        )}
        {/* 已删除状态：仅显示回收站检查按钮 */}
        {sLabel === '已删除' && (
        <div className="flex flex-wrap gap-[1px] shrink-0 ml-6 sm:ml-0">
            <Button variant="ghost" size="sm" className="text-info hover:bg-info/10 h-6 px-0.5 text-xs" onClick={(e: React.MouseEvent) => { e.stopPropagation(); onRecycleCheck(svc); }}><RotateCcw className="w-3 h-3 mr-0.5" />回收站检查</Button>
        </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return prevProps.isSelected === nextProps.isSelected
    && prevProps.svc === nextProps.svc
    && prevProps.savedPackages === nextProps.savedPackages
    && prevProps.financeUrl === nextProps.financeUrl
    && prevProps.mfyUrl === nextProps.mfyUrl
    && prevProps.isAdminUser === nextProps.isAdminUser;
});

export default ProductCard;
