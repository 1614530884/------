import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createSessionToken, SESSION_COOKIE_NAME, getSessionCookieOptions } from '@/lib/auth-server';

// 读取后台基础URL配置（从文件读取，安全且可修改）
function getBaseUrl(urlFromFrontend?: string): string {
  // 如果前端传了url（用于更新配置），优先使用
  if (urlFromFrontend) {
    const trimmed = urlFromFrontend.replace(/\/+$/, '');
    // 保存到配置文件
    try {
      const configPath = join(process.cwd(), 'idc-config.json');
      writeFileSync(configPath, JSON.stringify({ baseUrl: trimmed }, null, 2), 'utf-8');
    } catch { /* 写入失败忽略 */ }
    return trimmed;
  }
  // 否则从配置文件读取
  try {
    const configPath = join(process.cwd(), 'idc-config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    if (config.baseUrl) return config.baseUrl;
  } catch { /* 配置文件读取失败，使用默认值 */ }
  return '';
}

// 辅助函数：安全读取响应文本，处理gzip压缩
async function safeResponseText(resp: Response): Promise<string> {
  const arrayBuffer = await resp.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  let text = buffer.toString('utf-8');
  try {
    JSON.parse(text);
  } catch {
    // JSON解析失败，检查是否是gzip压缩数据（magic number: 0x1f8b）
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      try {
        text = await new Promise<string>((resolve, reject) => {
          const { createUnzip } = require('zlib');
          const unzip = createUnzip();
          const chunks: Buffer[] = [];
          unzip.on('data', (chunk: Buffer) => chunks.push(chunk));
          unzip.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
          unzip.on('error', reject);
          unzip.write(buffer);
          unzip.end();
        });
      } catch {
        // 解压失败，使用原始文本
      }
    }
  }
  return text;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, url, username, password, captcha, code, cookie } = body;

    const baseUrl = getBaseUrl(url);
    if (!baseUrl) {
      return NextResponse.json({ success: false, message: '未配置后台地址，请在 idc-config.json 中设置 baseUrl' });
    }

    const defaultHeaders: Record<string, string> = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `${baseUrl}/`,
      'Origin': baseUrl,
    };

    if (cookie) {
      defaultHeaders['Cookie'] = cookie;
    }

    // 辅助函数：从响应中收集cookie
    const collectCookies = (resp: Response, existingCookie?: string) => {
      const newCookies: string[] = [];
      const rawSetCookie = resp.headers.get('set-cookie');
      if (rawSetCookie) {
        const cookieParts = rawSetCookie.split(', ');
        for (const part of cookieParts) {
          if (part.includes('=')) {
            newCookies.push(part.split(';')[0]);
          }
        }
      }
      return [existingCookie, ...newCookies].filter(Boolean).join('; ');
    };

    // ========== 测试连接 + 获取session + 自动检测验证码 ==========
    if (action === 'test') {
      // Step 1: 访问首页获取session
      const resp = await fetch(`${baseUrl}/`, {
        headers: { 'User-Agent': defaultHeaders['User-Agent'] },
        redirect: 'manual',
      });

      let sessionCookie = collectCookies(resp);

      // Step 2: 获取登录页面配置（检测二次验证等）
      let loginPageConfig: Record<string, unknown> = {};
      try {
        const configResp = await fetch(`${baseUrl}/login_page`, {
          headers: { ...defaultHeaders, Cookie: sessionCookie },
        });
        sessionCookie = collectCookies(configResp, sessionCookie);
        const configText = await safeResponseText(configResp);
        const configResult = JSON.parse(configText);
        if (configResult.status === 200) {
          loginPageConfig = configResult.data || {};
        }
      } catch {
        // 忽略配置获取失败
      }

      // Step 3: 尝试获取验证码图片
      let captchaEnabled = false;
      let captchaImage: string | null = null;
      let captchaPath = '';

      const imageHeaders: Record<string, string> = {
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': defaultHeaders['User-Agent'],
        'Referer': `${baseUrl}/`,
        'Cookie': sessionCookie,
      };

      // 验证码接口：/verify?name=allow_login_admin_captcha
      // 智简魔方系统前端代码分析确认：
      // - 后台管理员验证码路径是 /verify（不是 /captcha）
      // - 必须传 name 参数指定验证码场景
      // - name=allow_login_admin_captcha 表示后台管理员登录验证码
      // - 响应是 arraybuffer 格式的 PNG 图片
      const captchaPaths = [
        { path: '/verify', params: 'name=allow_login_admin_captcha' },
        { path: '/captcha', params: '' },
      ];

      for (const cp of captchaPaths) {
        try {
          const captchaUrl = cp.params
            ? `${baseUrl}${cp.path}?${cp.params}`
            : `${baseUrl}${cp.path}`;
          const captchaResp = await fetch(captchaUrl, {
            headers: imageHeaders,
            redirect: 'manual',
          });
          sessionCookie = collectCookies(captchaResp, sessionCookie);
          const contentType = captchaResp.headers.get('content-type') || '';

          if (contentType.includes('image') || contentType.includes('octet-stream')) {
            // 返回了验证码图片！
            const arrayBuffer = await captchaResp.arrayBuffer();
            captchaImage = Buffer.from(arrayBuffer).toString('base64');
            captchaEnabled = true;
            captchaPath = cp.path;
            break;
          }

          // /captcha 返回500错误（PHP GD库缺失），路由存在但图片生成失败
          if (captchaResp.status === 500 && cp.path === '/captcha') {
            captchaEnabled = true;
            captchaPath = cp.path;
            break;
          }

          // 返回了JSON，检查是否"未开启"
          const text = await safeResponseText(captchaResp);
          try {
            const result = JSON.parse(text);
            if (result.status === 400 && result.msg?.includes('未开启')) {
              // 该路径未开启验证码，继续尝试下一个
              continue;
            }
          } catch {
            // 非JSON响应，继续尝试
            continue;
          }
        } catch {
          continue;
        }
      }

      // 解析 loginPageConfig 中的二次验证配置
      const secondVerifyEnabled = !!(loginPageConfig as Record<string, unknown>)?.second_verify_admin;

      return NextResponse.json({
        success: resp.ok || resp.status === 302,
        message: resp.ok ? '连接成功' : `HTTP ${resp.status}`,
        cookie: sessionCookie || undefined,
        loginPageConfig,
        captchaEnabled,
        captchaImage,
        captchaPath,
        secondVerifyEnabled,
      });
    }

    // ========== 获取/刷新验证码 ==========
    if (action === 'captcha') {
      const imageHeaders: Record<string, string> = {
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': defaultHeaders['User-Agent'],
        'Referer': `${baseUrl}/`,
      };
      if (cookie) {
        imageHeaders['Cookie'] = cookie;
      }

      // 验证码接口优先级：
      // 1. /verify?name=allow_login_admin_captcha（智简魔方标准后台验证码）
      // 2. /captcha（ThinkPHP think-captcha组件路径，部分版本使用）
      const captchaPaths = [
        { path: '/verify', params: 'name=allow_login_admin_captcha' },
        { path: '/captcha', params: '' },
      ];
      let captchaServerError = false;

      for (const cp of captchaPaths) {
        try {
          const captchaUrl = cp.params
            ? `${baseUrl}${cp.path}?${cp.params}`
            : `${baseUrl}${cp.path}`;
          const resp = await fetch(captchaUrl, {
            headers: imageHeaders,
            redirect: 'manual',
          });

          const mergedCookie = collectCookies(resp, cookie);
          const contentType = resp.headers.get('content-type') || '';

          // /captcha 返回500错误（服务器端PHP生成验证码失败）
          if (resp.status === 500 && cp.path === '/captcha') {
            captchaServerError = true;
            continue;
          }

          // 返回了图片
          if (contentType.includes('image') || contentType.includes('octet-stream')) {
            const arrayBuffer = await resp.arrayBuffer();
            const captchaImage = Buffer.from(arrayBuffer).toString('base64');
            return NextResponse.json({
              success: true,
              captchaImage,
              captchaEnabled: true,
              captchaPath: cp.path,
              cookie: mergedCookie,
            });
          }

          // 返回了JSON
          const text = await safeResponseText(resp);
          try {
            const result = JSON.parse(text);
            if (result.status === 400 && result.msg?.includes('未开启')) {
              continue;
            }
            return NextResponse.json({
              success: false,
              captchaEnabled: false,
              message: result.msg || '验证码获取失败',
              cookie: mergedCookie,
            });
          } catch {
            continue;
          }
        } catch {
          continue;
        }
      }

      // /captcha 返回500错误，说明验证码功能可能已开启但图片生成失败
      if (captchaServerError) {
        return NextResponse.json({
          success: false,
          captchaEnabled: true,
          captchaPath: '/captcha',
          cookie: cookie,
          message: '验证码图片获取失败，请检查后台PHP环境是否安装了GD库',
        });
      }

      // 所有路径都未开启验证码
      return NextResponse.json({
        success: true,
        captchaEnabled: false,
        cookie: cookie,
        message: '后台未开启图形验证码，可直接登录',
      });
    }

    // ========== 后台管理员登录 ==========
    if (action === 'login') {
      const loginData: Record<string, unknown> = { username, password };
      // 后台登录接口始终检查验证码，如果有的话就带上
      if (captcha) {
        loginData.captcha = captcha;
      }
      // 二次验证码（如果有的话）
      if (code) {
        loginData.code = code;
      }

      // 后台管理员登录API路径是 /login
      const resp = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(loginData),
        redirect: 'manual',
      });

      const mergedCookie = collectCookies(resp, cookie);
      const text = await safeResponseText(resp);

      // 检查WAF/安全拦截
      if (text.includes('弱密码') || text.includes('防火墙') || text.includes('拦截')) {
        const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return NextResponse.json({
          success: false,
          message: '后台安全拦截: ' + cleanText.substring(0, 300),
        });
      }

      try {
        const result = JSON.parse(text);

        // 检查是否需要二次验证
        if (result.status === 406 || result.second_verify) {
          return NextResponse.json({
            success: false,
            needSecondVerify: true,
            message: result.msg || '需要二次验证，请输入短信/邮件验证码',
            cookie: mergedCookie,
          });
        }

        if (result.status === 200) {
          // 登录成功 - 提取PHPSESSID（HttpOnly cookie，JS读不到，需要后端提取后返回）
          const phpSessId = mergedCookie
            .split('; ')
            .find(c => c.startsWith('PHPSESSID='))
            ?.split('=')[1] || '';
          const token = result.data?.token || result.data?.jwt || '';
          const userInfo = result.data || {};
          const response = NextResponse.json({
            success: true,
            token,
            cookie: mergedCookie,
            phpSessId, // 返回PHPSESSID供后续API调用使用
            userInfo,
          });
          // 设置 httpOnly session cookie 供 middleware/layout 验证身份
          response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(username), getSessionCookieOptions(request));
          return response;
        }

        // 登录失败 - 检查是否需要验证码
        if (result.msg?.includes('验证码')) {
          return NextResponse.json({
            success: false,
            needCaptcha: true,
            captchaEnabled: true,
            message: result.msg,
            cookie: mergedCookie,
          });
        }

        return NextResponse.json({
          success: false,
          message: result.msg || '登录失败',
        });
      } catch {
        return NextResponse.json({
          success: false,
          message: `服务器返回非JSON响应 (HTTP ${resp.status})`,
        });
      }
    }

    // ========== 发送二次验证码 ==========
    if (action === 'second_verify') {
      // 后台管理员二次验证发送API路径: /second_verify_send
      // 参数: action=login, username, password, captcha(图形验证码)
      // IDCSmart要求先验证图形验证码正确后才会发送短信/邮件验证码
      const sendData: Record<string, unknown> = { action: 'login', username, password };
      if (captcha) {
        sendData.captcha = captcha;
      }
      const resp = await fetch(`${baseUrl}/second_verify_send`, {
        method: 'POST',
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sendData),
        redirect: 'manual',
      });

      const text = await safeResponseText(resp);
      try {
        const result = JSON.parse(text);
        return NextResponse.json({
          success: result.status === 200,
          message: result.msg || '验证码已发送',
        });
      } catch {
        return NextResponse.json({ success: false, message: '发送验证码失败' });
      }
    }

    // ========== 二次验证登录 ==========
    if (action === 'second_verify_login') {
      const resp = await fetch(`${baseUrl}/second_verify_login`, {
        method: 'POST',
        headers: {
          ...defaultHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'login', username, password, code: body.code }),
        redirect: 'manual',
      });

      const mergedCookie = collectCookies(resp, cookie);
      const text = await safeResponseText(resp);

      try {
        const result = JSON.parse(text);
        if (result.status === 200) {
          const token = result.data?.token || result.data?.jwt || '';
          const userInfo = result.data || {};
          const response = NextResponse.json({
            success: true,
            token,
            cookie: mergedCookie,
            userInfo,
          });
          // 设置 httpOnly session cookie 供 middleware/layout 验证身份
          response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(username), getSessionCookieOptions(request));
          return response;
        }
        return NextResponse.json({
          success: false,
          message: result.msg || '二次验证失败',
        });
      } catch {
        return NextResponse.json({
          success: false,
          message: '二次验证请求失败',
        });
      }
    }

    // ========== 验证 token/cookie 是否有效 ==========
    if (action === 'validate') {
      const validateHeaders: Record<string, string> = {
        ...defaultHeaders,
        'Content-Type': 'application/json',
      };
      if (body.token) {
        validateHeaders['Authorization'] = `Bearer ${body.token}`;
      }
      if (cookie) {
        validateHeaders['Cookie'] = cookie;
      }

      // 用一个轻量级接口来验证身份是否有效
      // 尝试 /product/index（需要登录权限）
      try {
        const resp = await fetch(`${baseUrl}/product/index`, {
          method: 'POST',
          headers: validateHeaders,
          body: JSON.stringify({ page: 1, limit: 1 }),
        });

        const text = await safeResponseText(resp);

        // 检查是否被重定向到登录页
        if (resp.status === 401 || text.includes('请先登录') || text.includes('未登录')) {
          return NextResponse.json({
            success: false,
            message: 'Token/Cookie 已失效，请重新登录获取',
          });
        }

        try {
          const result = JSON.parse(text);
          if (result.status === 200 || result.status === 1) {
            return NextResponse.json({
              success: true,
              message: '连接成功，身份验证通过',
              cookie: cookie || undefined,
            });
          }
          // 可能是参数错误但身份已验证（说明token有效）
          if (result.status === 400 || result.status === 422) {
            return NextResponse.json({
              success: true,
              message: '连接成功，身份验证通过',
              cookie: cookie || undefined,
            });
          }
          // 401 类错误
          if (result.status === 401) {
            return NextResponse.json({
              success: false,
              message: 'Token/Cookie 已失效，请重新登录获取',
            });
          }
          return NextResponse.json({
            success: false,
            message: result.msg || '身份验证失败',
          });
        } catch {
          // 非JSON响应，可能是登录页HTML
          return NextResponse.json({
            success: false,
            message: 'Token/Cookie 无效，请重新登录获取',
          });
        }
      } catch (validateError: unknown) {
        const errMsg = validateError instanceof Error ? validateError.message : '未知错误';
        return NextResponse.json({
          success: false,
          message: `验证请求失败: ${errMsg}`,
        });
      }
    }

    return NextResponse.json({ success: false, message: '未知操作' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '未知错误';
    return NextResponse.json({
      success: false,
      message: `请求失败: ${message}`,
    });
  }
}
