import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface OsVersion {
  id: number;
  version: string;
  monthly?: string;
  [key: string]: unknown;
}

interface OsCategory {
  system: string;
  ico_url?: string;
  child: OsVersion[];
  [key: string]: unknown;
}

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

interface ConfigOptionItemProps {
  opt: ConfigOption;
  configValues: Record<string, string>;
  onConfigChange: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  compact?: boolean;
  mobileWrap?: boolean;
  mobile?: boolean;
}

const RADIO_TYPES = [2, 6, 8, 10, 12];
const RANGE_TYPES = [7, 9, 11, 14, 15];
const NAME_CLEANUP_TYPES = [10, 13];

const getDisplayName = (name: string): string => {
  const sep = name.includes('^') ? '^' : name.includes('|') ? '|' : null;
  return sep ? name.split(sep).pop()!.trim() : name;
};

const ConfigOptionItem: React.FC<ConfigOptionItemProps> = React.memo(({ opt, configValues, onConfigChange, compact, mobileWrap, mobile }) => {
  const isHidden = opt.hidden === 1;

  if (opt.option_type === 5 && typeof opt.child === 'object' && !Array.isArray(opt.child)) {
    const osCategories = Object.entries(opt.child as Record<string, OsCategory>);
    const selectedOsCategory = configValues[`os_cat_${opt.id}`] || '';
    const currentVersions = selectedOsCategory
      ? (opt.child as Record<string, OsCategory>)[selectedOsCategory]?.child || []
      : [];

    return (
      <div className={`flex items-center gap-1.5 ${mobile ? 'w-full flex-col gap-1' : compact ? 'flex-1 min-w-0' : ''}${mobileWrap ? ' w-full sm:flex-1 sm:min-w-0' : ''}${isHidden ? ' opacity-60' : ''}`}>
        <Label className={`whitespace-nowrap shrink-0 ${compact || mobileWrap ? 'text-sm' : 'text-sm'} ${mobile ? 'text-sm w-full' : ''} ${isHidden ? 'text-slate-500' : 'text-slate-300'}`}>
          {compact || mobileWrap || mobile ? '系统' : opt.option_name}
          {isHidden && <span className="text-xs text-slate-600">(自动)</span>}
        </Label>
        <div className={`flex gap-1.5 ${mobile ? 'w-full flex-col gap-1' : mobileWrap ? 'w-full flex-col sm:flex-row sm:flex-1 sm:min-w-0' : compact ? 'flex-1 min-w-0' : 'flex-col sm:flex-row'}`}>
          <Select
            value={selectedOsCategory}
            onValueChange={(val) => {
              onConfigChange(prev => {
                const newVals = { ...prev, [`os_cat_${opt.id}`]: val };
                const catData = (opt.child as Record<string, { child: OsVersion[] }>)[val];
                if (catData?.child?.[0]) {
                  newVals[opt.id] = String(catData.child[0].id);
                } else {
                  newVals[opt.id] = '';
                }
                return newVals;
              });
            }}
          >
            <SelectTrigger className={`bg-slate-700/50 border-slate-600 text-white ${mobile ? 'h-8 text-sm w-full' : compact ? 'h-8 text-sm flex-1 min-w-0' : mobileWrap ? 'h-8 text-sm w-full sm:flex-1 sm:min-w-0' : 'w-full'}`}>
              <SelectValue placeholder="选择" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {osCategories.map(([key, cat]) => (
                <SelectItem key={key} value={key} className="text-white focus:bg-slate-700">
                  {cat.system || key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={configValues[opt.id] || ''}
            onValueChange={(val) => onConfigChange(prev => ({ ...prev, [opt.id]: val }))}
            disabled={!selectedOsCategory}
          >
            <SelectTrigger className={`bg-slate-700/50 border-slate-600 text-white ${mobile ? 'h-8 text-sm w-full' : compact ? 'h-8 text-sm flex-1 min-w-0' : mobileWrap ? 'h-8 text-sm w-full sm:flex-1 sm:min-w-0' : 'w-full'}`}>
              <SelectValue placeholder={selectedOsCategory ? '版本' : '先选系统'} />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {currentVersions.map((item) => (
                <SelectItem key={item.id} value={String(item.id)} className="text-white focus:bg-slate-700">
                  {item.version}
                  {item.monthly && parseFloat(item.monthly) > 0 && (
                    <span className="text-orange-400 text-xs ml-2">+¥{item.monthly}</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (opt.option_type === 3) {
    const checked = configValues[opt.id] === '1';
    return (
      <div className={`flex items-center justify-between gap-3${isHidden ? ' opacity-60' : ''}`}>
        <Label className={`text-sm flex items-center gap-1 ${isHidden ? 'text-slate-500' : 'text-slate-300'}`}>
          {opt.option_name}
          {isHidden && <span className="text-xs text-slate-600">(自动)</span>}
        </Label>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onConfigChange(prev => ({ ...prev, [opt.id]: checked ? '0' : '1' }))}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
            checked ? 'bg-orange-500' : 'bg-slate-600'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              checked ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    );
  }

  if (RANGE_TYPES.includes(opt.option_type) && Array.isArray(opt.child) && opt.child.length > 0) {
    const qtyMin = opt.qty_minimum || 0;
    const qtyMax = opt.qty_maximum || 999;
    const currentQty = Number(configValues[`qty_${opt.id}`]) || qtyMin;
    const freeQty = Number((opt as Record<string, unknown>).free_qty || (opt as Record<string, unknown>).free_range || 0);
    const showFreeRange = freeQty > 0;
    return (
      <div className="space-y-1.5">
        <Label className="text-slate-300 text-sm flex items-center gap-1">
          {opt.option_name}
          {opt.unit && <span className="text-slate-500 text-xs">({opt.unit})</span>}
          <span className="text-slate-500 text-xs">({qtyMin}-{qtyMax}{opt.unit})</span>
          {showFreeRange && <span className="text-emerald-400/80 text-xs ml-1">(前{freeQty}{opt.unit}免费)</span>}
        </Label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="w-8 h-8 rounded bg-slate-700 border border-slate-600 text-white flex items-center justify-center hover:bg-slate-600"
            onClick={() => {
              const newQty = Math.max(qtyMin, currentQty - 1);
              onConfigChange(prev => ({ ...prev, [`qty_${opt.id}`]: String(newQty) }));
            }}
          >-</button>
          <Input
            type="number"
            min={qtyMin}
            max={qtyMax}
            value={configValues[`qty_${opt.id}`] ?? String(qtyMin)}
            onChange={(e) => {
              onConfigChange(prev => ({ ...prev, [`qty_${opt.id}`]: e.target.value }));
            }}
            onBlur={() => {
              const raw = configValues[`qty_${opt.id}`];
              let val = parseInt(String(raw)) || qtyMin;
              val = Math.max(qtyMin, Math.min(qtyMax, val));
              onConfigChange(prev => ({ ...prev, [`qty_${opt.id}`]: String(val) }));
            }}
            className="bg-slate-700/50 border-slate-600 text-white text-center w-20"
          />
          <span className="text-slate-400 text-sm">{opt.unit}</span>
          <button
            type="button"
            className="w-8 h-8 rounded bg-slate-700 border border-slate-600 text-white flex items-center justify-center hover:bg-slate-600"
            onClick={() => {
              const newQty = Math.min(qtyMax, currentQty + 1);
              onConfigChange(prev => ({ ...prev, [`qty_${opt.id}`]: String(newQty) }));
            }}
          >+</button>
        </div>
      </div>
    );
  }

  if (RADIO_TYPES.includes(opt.option_type) && Array.isArray(opt.child) && opt.child.length > 0) {
    const selectedVal = configValues[opt.id] || '';
    const needsCleanup = NAME_CLEANUP_TYPES.includes(opt.option_type);
    return (
      <div className={`space-y-1.5${isHidden ? ' opacity-60' : ''}`}>
        <Label className={`text-sm flex items-center gap-1 ${isHidden ? 'text-slate-500' : 'text-slate-300'}`}>
          {opt.option_name}
          {isHidden && <span className="text-xs text-slate-600">(自动)</span>}
          {opt.unit && <span className="text-slate-500 text-xs">({opt.unit})</span>}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {opt.child.map((item) => {
            const isSelected = String(item.id) === selectedVal;
            const displayName = needsCleanup ? getDisplayName(item.option_name) : item.option_name;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onConfigChange(prev => ({ ...prev, [opt.id]: String(item.id) }))}
                className={`px-2.5 py-1 rounded text-xs border transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                }`}
              >
                {displayName}
                {'show_pricing' in item && item.show_pricing && (
                  <span className="text-orange-400/70 ml-1">{item.show_pricing}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const isNodeOption = ['节点'].some(k => opt.option_name.includes(k)) && !opt.option_name.includes('分组') && !opt.option_name.includes('优先级');
  if (isNodeOption && Array.isArray(opt.child) && opt.child.length > 0) {
    const selectedVal = configValues[opt.id] || '';
    return (
      <div className={`space-y-1.5${isHidden ? ' opacity-60' : ''}`}>
        <Label className={`text-sm flex items-center gap-1 ${isHidden ? 'text-slate-500' : 'text-slate-300'}`}>
          {opt.option_name}
          {isHidden && <span className="text-xs text-slate-600">(自动)</span>}
        </Label>
        <div className="flex flex-wrap gap-1.5">
          {opt.child.map((item) => {
            const isSelected = String(item.id) === selectedVal;
            const displayName = getDisplayName(item.option_name);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onConfigChange(prev => ({ ...prev, [opt.id]: String(item.id) }))}
                className={`px-2.5 py-1 rounded text-xs border transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                    : 'bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                }`}
              >
                {displayName}
                {'show_pricing' in item && item.show_pricing && (
                  <span className="text-orange-400/70 ml-1">{item.show_pricing}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (Array.isArray(opt.child) && opt.child.length > 0) {
    const needsNameCleanup = NAME_CLEANUP_TYPES.includes(opt.option_type);
    return (
      <div className={`space-y-1.5${isHidden ? ' opacity-60' : ''}`}>
        <Label className={`text-sm flex items-center gap-1 ${isHidden ? 'text-slate-500' : 'text-slate-300'}`}>
          {opt.option_name}
          {isHidden && <span className="text-xs text-slate-600">(自动)</span>}
          {opt.unit && <span className="text-slate-500 text-xs">({opt.unit})</span>}
        </Label>
        <Select
          value={configValues[opt.id] || ''}
          onValueChange={(val) => onConfigChange(prev => ({ ...prev, [opt.id]: val }))}
        >
          <SelectTrigger className="bg-slate-700/50 border-slate-600 text-white">
            <SelectValue placeholder={`选择${opt.option_name}`} />
          </SelectTrigger>
          <SelectContent className="bg-slate-800 border-slate-700">
            {opt.child.map((item) => (
              <SelectItem key={item.id} value={String(item.id)} className="text-white focus:bg-slate-700">
                {needsNameCleanup ? getDisplayName(item.option_name) : item.option_name}
                {'show_pricing' in item && item.show_pricing && (
                  <span className="text-orange-400 text-xs ml-2">{item.show_pricing}</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-slate-300 text-sm flex items-center gap-1">
        {opt.option_name}
        {opt.unit && <span className="text-slate-500 text-xs">({opt.unit})</span>}
      </Label>
      <Input
        value={configValues[opt.id] || ''}
        onChange={(e) => onConfigChange(prev => ({ ...prev, [opt.id]: e.target.value }))}
        placeholder={`输入${opt.option_name}`}
        className="bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500"
      />
    </div>
  );
});

ConfigOptionItem.displayName = 'ConfigOptionItem';

export default ConfigOptionItem;
export type { ConfigOption, ConfigSubItem, OsCategory, OsVersion };
export { RADIO_TYPES, RANGE_TYPES, NAME_CLEANUP_TYPES };
