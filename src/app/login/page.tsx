'use client';

import { Suspense, useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Zap, User, CreditCard, Eye, EyeOff, LogIn, RefreshCw,
  Loader2, CheckCircle, XCircle, AlertCircle,
} from 'lucide-react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { saveAuth } from '@/lib/auth-client';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaImage, setCaptchaImage] = useState<string | null>(null);
  const [captchaEnabled, setCaptchaEnabled] = useState(false);
  const [sessionCookie, setSessionCookie] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isCaptchaLoading, setIsCaptchaLoading] = useState(false);
  const [needSecondVerify, setNeedSecondVerify] = useState(false);
  const [secondVerifyCode, setSecondVerifyCode] = useState('');
  const [isSendingSmsCode, setIsSendingSmsCode] = useState(false);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const showNotification = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  }, []);

  // 根据 reason 参数显示提示
  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason === 'unauthenticated') {
      showNotification('info', '请先登录');
    } else if (reason === 'session_expired') {
      showNotification('error', '登录已过期，请重新登录');
    }
  }, [searchParams, showNotification]);

  // 自动加载验证码和检测二次验证
  const autoLoadCaptcha = useCallback(async () => {
    setIsCaptchaLoading(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      });
      const data = await response.json();
      if (data.cookie) {
        setSessionCookie(data.cookie);
      }
      if (data.captchaEnabled) {
        setCaptchaEnabled(true);
        if (data.captchaImage) {
          setCaptchaImage(`data:image/png;base64,${data.captchaImage}`);
        }
      } else {
        setCaptchaEnabled(false);
      }
      if (data.secondVerifyEnabled) {
        setNeedSecondVerify(true);
      }
    } catch {
      // 自动加载失败，用户可手动刷新
    } finally {
      setIsCaptchaLoading(false);
    }
  }, []);

  useEffect(() => {
    autoLoadCaptcha();
  }, [autoLoadCaptcha]);

  // 获取/刷新验证码
  const fetchCaptcha = useCallback(async () => {
    setIsCaptchaLoading(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'captcha', cookie: sessionCookie }),
      });
      const data = await response.json();
      if (data.success && data.captchaImage) {
        setCaptchaImage(`data:image/png;base64,${data.captchaImage}`);
        if (data.cookie) {
          setSessionCookie(prev => [prev, data.cookie].filter(Boolean).join('; '));
        }
      } else {
        showNotification('info', data.message || '验证码获取失败，可直接尝试登录');
      }
    } catch {
      showNotification('info', '验证码获取失败，可直接尝试登录');
    } finally {
      setIsCaptchaLoading(false);
    }
  }, [sessionCookie, showNotification]);

  // 登录
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminUsername || !adminPassword) { showNotification('error', '请输入用户名和密码'); return; }
    if (captchaEnabled && !captchaCode) { showNotification('error', '请输入图形验证码'); return; }
    if (needSecondVerify && !secondVerifyCode) { showNotification('error', '请输入二次验证码'); return; }

    setIsLoggingIn(true);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login',
          username: adminUsername,
          password: adminPassword,
          captcha: captchaEnabled ? captchaCode : undefined,
          code: needSecondVerify && secondVerifyCode ? secondVerifyCode : undefined,
          cookie: sessionCookie,
        }),
      });
      const data = await response.json();
      if (data.success) {
        const token = data.token || 'authenticated';
        const cookie = data.cookie || '';
        // 保存凭证到 localStorage（httpOnly cookie 已由 API 设置）
        saveAuth({ token, cookie, username: adminUsername, password: adminPassword });
        showNotification('success', '登录成功，正在跳转...');
        // 延迟跳转让用户看到提示
        setTimeout(() => router.replace('/'), 500);
      } else if (data.needSecondVerify) {
        setNeedSecondVerify(true);
        if (data.cookie) setSessionCookie(data.cookie);
        showNotification('info', '需要二次验证，请输入收到的验证码');
      } else if (data.needCaptcha) {
        setCaptchaEnabled(true);
        fetchCaptcha();
        showNotification('info', data.message || '请输入验证码');
      } else {
        let errorMsg = data.message || '登录失败';
        if (errorMsg.includes('弱密码')) errorMsg = '后台弱密码拦截，请在后台全局设置中关闭';
        showNotification('error', errorMsg);
        if (captchaEnabled) fetchCaptcha();
        setCaptchaCode('');
      }
    } catch (error) {
      showNotification('error', `登录失败: ${error instanceof Error ? error.message : '未知错误'}`);
      if (captchaEnabled) fetchCaptcha();
      setCaptchaCode('');
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-muted/50 to-background flex items-center justify-center p-4">
      {notification && (
        <div className={`fixed top-3 right-3 sm:top-4 sm:right-4 z-50 flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-3 rounded-lg shadow-lg text-primary-foreground text-xs sm:text-sm animate-in slide-in-from-top-2 max-w-[calc(100vw-24px)] ${
          notification.type === 'success' ? 'bg-success' :
          notification.type === 'error' ? 'bg-destructive' : 'bg-info'
        }`}>
          {notification.type === 'success' ? <CheckCircle className="w-4 h-4" /> :
           notification.type === 'error' ? <XCircle className="w-4 h-4" /> :
           <AlertCircle className="w-4 h-4" />}
          {notification.message}
        </div>
      )}

      <Card className="w-full max-w-lg border-border bg-card/80 backdrop-blur">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="w-7 h-7 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold text-foreground">淘宝订单一键开通</CardTitle>
          <CardDescription className="text-muted-foreground">
            连接财务后台，输入用户名和套餐即可一键开通
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-foreground text-sm">管理员账号</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={adminUsername} onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="请输入用户名" className="pl-10 bg-muted border-border text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-foreground text-sm">管理员密码</Label>
              <div className="relative">
                <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input type={showPassword ? 'text' : 'password'} value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)} placeholder="请输入密码"
                  className="pl-10 pr-10 bg-muted border-border text-foreground placeholder:text-muted-foreground" />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {captchaEnabled && (
              <div className="space-y-2">
                <Label className="text-foreground text-sm">图形验证码</Label>
                <div className="flex gap-2 items-center">
                  <Input value={captchaCode} onChange={(e) => setCaptchaCode(e.target.value)}
                    placeholder="请输入图片中的验证码" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" autoComplete="off" />
                  <div className="shrink-0 flex items-center gap-2">
                    {captchaImage ? (
                      <>
                        <img src={captchaImage} alt="验证码" className="h-9 w-24 rounded border border-border cursor-pointer"
                          onClick={fetchCaptcha} title="点击刷新验证码" />
                        <Button type="button" variant="ghost" size="sm" onClick={fetchCaptcha} disabled={isCaptchaLoading}
                          className="h-9 px-2 text-muted-foreground hover:text-foreground">
                          <RefreshCw className={`w-4 h-4 ${isCaptchaLoading ? 'animate-spin' : ''}`} />
                        </Button>
                      </>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={fetchCaptcha} disabled={isCaptchaLoading}
                        className="h-9 border-border text-muted-foreground hover:text-foreground">
                        {isCaptchaLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : '获取验证码'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {needSecondVerify && (
              <div className="space-y-2">
                <Label className="text-foreground text-sm">二次验证码（短信/邮件）</Label>
                <div className="flex gap-2 items-center">
                  <Input value={secondVerifyCode} onChange={(e) => setSecondVerifyCode(e.target.value)}
                    placeholder="请输入收到的验证码" className="bg-muted border-border text-foreground placeholder:text-muted-foreground" autoComplete="off" />
                  <Button type="button" variant="outline" size="sm"
                    disabled={(captchaEnabled && !captchaCode) || isSendingSmsCode}
                    onClick={async () => {
                      if (captchaEnabled && !captchaCode) {
                        showNotification('error', '请先输入图形验证码');
                        return;
                      }
                      setIsSendingSmsCode(true);
                      try {
                        const resp = await fetch('/api/login', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'second_verify', username: adminUsername, password: adminPassword,
                            captcha: captchaEnabled ? captchaCode : undefined, cookie: sessionCookie,
                          }),
                        });
                        const data = await resp.json();
                        if (data.success) {
                          showNotification('success', data.message || '验证码已发送');
                        } else {
                          showNotification('error', data.message || '发送失败');
                          if (captchaEnabled) { setCaptchaCode(''); fetchCaptcha(); }
                        }
                      } catch { showNotification('error', '发送验证码失败'); }
                      finally { setIsSendingSmsCode(false); }
                    }}
                    className="h-9 border-border text-foreground hover:text-foreground shrink-0">
                    {isSendingSmsCode ? (<><Loader2 className="w-4 h-4 mr-1 animate-spin" />发送中...</>) : '获取验证码'}
                  </Button>
                </div>
              </div>
            )}

            <Button type="submit" disabled={isLoggingIn}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium">
              {isLoggingIn ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />正在登录...</>) : (<><LogIn className="w-4 h-4 mr-2" />登录后台</>)}
            </Button>
          </form>

          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">请使用您的财务后台管理员账号登录。点击「获取验证码」会自动获取验证码。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
