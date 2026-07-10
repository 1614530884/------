'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Plus, Loader2, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { loadAuth } from '@/lib/auth-client';
import { toast } from 'sonner';

type MfyAccountMapping = { loginUser: string; mfyUrl: string; mfyUsername: string; mfyPassword: string };

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdminUser, setIsAdminUser] = useState(false);

  const [financeUrl, setFinanceUrl] = useState('');
  const [mfyUrl, setMfyUrl] = useState('');
  const [mfyUsername, setMfyUsername] = useState('');
  const [mfyPassword, setMfyPassword] = useState('');
  const [mfyAccounts, setMfyAccounts] = useState<MfyAccountMapping[]>([]);
  const [adminUsernames, setAdminUsernames] = useState('');
  const [productSortOrder, setProductSortOrder] = useState<number[]>([]);
  const [hiddenProductIds, setHiddenProductIds] = useState<number[]>([]);

  const [floatingUserPanelEnabled, setFloatingUserPanelEnabled] = useState(true);
  const [autoClearSearch, setAutoClearSearch] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then(res => res.ok ? res.json() : {})
      .then((data: Record<string, unknown>) => {
        setFinanceUrl((data.financeUrl as string) || '');
        setMfyUrl((data.mfyUrl as string) || '');
        setMfyUsername((data.mfyUsername as string) || '');
        setMfyPassword((data.mfyPassword as string) || '');
        setMfyAccounts(Array.isArray(data.mfyAccounts) ? data.mfyAccounts as MfyAccountMapping[] : []);
        setAdminUsernames((data.adminUsernames as string) || '');
        setProductSortOrder(Array.isArray(data.productSortOrder) ? data.productSortOrder as number[] : []);
        setHiddenProductIds(Array.isArray(data.hiddenProductIds) ? data.hiddenProductIds as number[] : []);

        const auth = loadAuth();
        const currentUsername = auth?.username || '';
        const adminList = (data.adminUsernames as string || '').trim()
          ? (data.adminUsernames as string).split(',').map(s => s.trim()).filter(Boolean)
          : [];
        setIsAdminUser(adminList.includes(currentUsername));
      })
      .finally(() => setLoading(false));

    if (typeof window !== 'undefined') {
      setFloatingUserPanelEnabled(localStorage.getItem('idcsmart_floating_user_panel_enabled') !== 'false');
      setAutoClearSearch(localStorage.getItem('idcsmart_auto_clear_search') === 'true');
    }
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ financeUrl, mfyUrl, mfyUsername, mfyPassword, mfyAccounts, adminUsernames, productSortOrder, hiddenProductIds }),
      });
      localStorage.setItem('idcsmart_finance_url', financeUrl);
      localStorage.setItem('idcsmart_mfy_url', mfyUrl);
      localStorage.setItem('idcsmart_floating_user_panel_enabled', String(floatingUserPanelEnabled));
      localStorage.setItem('idcsmart_auto_clear_search', String(autoClearSearch));
      toast.success('设置已保存，返回首页后生效');
    } catch {
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const inputClass = 'w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm text-foreground focus:border-primary focus:outline-none transition-colors';

  return (
    <div>
      <PageHeader
        title="系统设置"
        titleIcon={Settings}
        actions={
          <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90 h-8 px-3">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span className="ml-1 hidden sm:inline">保存设置</span>
          </Button>
        }
      />
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-6">
        {isAdminUser && (
          <section className="bg-card rounded-xl border border-border p-4 space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">管理员配置</h2>
            <div>
              <label className="text-sm text-foreground mb-1 block">财务后台地址</label>
              <input type="text" value={financeUrl} onChange={e => setFinanceUrl(e.target.value)} placeholder="https://your-idc-admin-url" className={inputClass} />
              <p className="text-xs text-muted-foreground mt-1">跳转路径: /#/customer-view/product-innerpage?id=&amp;hid=</p>
            </div>
            <div>
              <label className="text-sm text-foreground mb-1 block">魔方云地址</label>
              <input type="text" value={mfyUrl} onChange={e => setMfyUrl(e.target.value)} placeholder="https://your-mfy-url" className={inputClass} />
              <p className="text-xs text-muted-foreground mt-1">跳转路径: /#/cloudsHome?id=</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-foreground mb-1 block">魔方云账号</label>
                <input type="text" value={mfyUsername} onChange={e => setMfyUsername(e.target.value)} placeholder="admin" className={inputClass} />
              </div>
              <div>
                <label className="text-sm text-foreground mb-1 block">魔方云密码</label>
                <input type="password" value={mfyPassword} onChange={e => setMfyPassword(e.target.value)} placeholder="••••••••" className={inputClass} />
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground mb-1 block">魔方云账号映射</label>
              <p className="text-xs text-muted-foreground mb-2">为不同登录用户配置专属魔方云账号，未匹配时使用上方默认账号</p>
              <div className="space-y-2">
                {mfyAccounts.map((account, idx) => (
                  <div key={idx} className="flex flex-wrap gap-2 items-end p-2 bg-muted/50 rounded-lg border border-border">
                    <div className="flex-1 min-w-[100px]">
                      <label className="text-xs text-muted-foreground mb-0.5 block">登录用户名</label>
                      <input type="text" value={account.loginUser} onChange={e => { const next = [...mfyAccounts]; next[idx] = { ...next[idx], loginUser: e.target.value }; setMfyAccounts(next); }} placeholder="用户名" className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs text-foreground focus:border-primary focus:outline-none" />
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-xs text-muted-foreground mb-0.5 block">魔方云地址</label>
                      <input type="text" value={account.mfyUrl} onChange={e => { const next = [...mfyAccounts]; next[idx] = { ...next[idx], mfyUrl: e.target.value }; setMfyAccounts(next); }} placeholder="https://mfy..." className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs text-foreground focus:border-primary focus:outline-none" />
                    </div>
                    <div className="flex-1 min-w-[80px]">
                      <label className="text-xs text-muted-foreground mb-0.5 block">账号</label>
                      <input type="text" value={account.mfyUsername} onChange={e => { const next = [...mfyAccounts]; next[idx] = { ...next[idx], mfyUsername: e.target.value }; setMfyAccounts(next); }} placeholder="账号" className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs text-foreground focus:border-primary focus:outline-none" />
                    </div>
                    <div className="flex-1 min-w-[80px]">
                      <label className="text-xs text-muted-foreground mb-0.5 block">密码</label>
                      <input type="password" value={account.mfyPassword} onChange={e => { const next = [...mfyAccounts]; next[idx] = { ...next[idx], mfyPassword: e.target.value }; setMfyAccounts(next); }} placeholder="••••••" className="w-full px-2 py-1.5 bg-muted border border-border rounded text-xs text-foreground focus:border-primary focus:outline-none" />
                    </div>
                    <button type="button" onClick={() => setMfyAccounts(mfyAccounts.filter((_, i) => i !== idx))} className="px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded transition-colors shrink-0"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => setMfyAccounts([...mfyAccounts, { loginUser: '', mfyUrl: '', mfyUsername: '', mfyPassword: '' }])} className="w-full py-1.5 text-xs text-info hover:bg-info/10 rounded-lg border border-dashed border-border hover:border-info transition-colors flex items-center justify-center gap-1"><Plus className="w-3 h-3" />添加映射</button>
              </div>
            </div>
            <div>
              <label className="text-sm text-foreground mb-1 block">管理权限用户名</label>
              <input type="text" value={adminUsernames} onChange={e => setAdminUsernames(e.target.value)} placeholder="如: admin,lengling,user3" className={inputClass} />
              <p className="text-xs text-muted-foreground mt-1">多个用户名用英文逗号分隔，列表中的用户可见财务/魔方云相关功能，为空则所有人不可见</p>
            </div>
          </section>
        )}

        <section className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">通用设置</h2>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-foreground">右侧悬浮用户管理</label>
              <p className="text-xs text-muted-foreground">页面下滑时显示用户搜索、选择和信息查看窗口</p>
            </div>
            <Switch checked={floatingUserPanelEnabled} onCheckedChange={setFloatingUserPanelEnabled} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-foreground">搜索后清空输入框</label>
              <p className="text-xs text-muted-foreground">选中用户后自动清空搜索关键词</p>
            </div>
            <Switch checked={autoClearSearch} onCheckedChange={setAutoClearSearch} />
          </div>
        </section>

        {!isAdminUser && (
          <div className="bg-card rounded-xl border border-border p-8 text-center text-muted-foreground">
            <Settings className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>非管理员用户，无可配置项</p>
          </div>
        )}
      </div>
    </div>
  );
}
