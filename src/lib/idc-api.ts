// IDC后台API服务 - 智简魔方(IDCSmart)系统
// 后台管理员API路径规范（基于前端源码分析确认）：
// - 验证码接口：/verify?name=allow_login_admin_captcha（不是 /captcha）
// - 登录相关：/login, /login_page, /verify, /second_verify_send, /second_verify_login, /logout
// - 管理接口：直接路径（不需要再加 /admin/ 前缀）

export interface ApiResponse {
  status: number;
  msg: string;
  data?: Record<string, unknown>;
}

// 验证码场景名称常量
export const CAPTCHA_NAMES = {
  /** 后台管理员登录验证码 */
  ADMIN_LOGIN: 'allow_login_admin_captcha',
  /** 前台用户注册验证码（手机） */
  REGISTER_PHONE: 'allow_register_phone_captcha',
  /** 前台用户注册验证码（邮箱） */
  REGISTER_EMAIL: 'allow_register_email_captcha',
  /** 前台用户登录验证码 */
  USER_LOGIN: 'allow_login_code_captcha',
} as const;

// 完整的后台管理员API路径
export const ADMIN_API = {
  // 登录相关（无需登录）
  LOGIN_PAGE: '/login_page',           // GET  - 登录页面配置
  VERIFY: '/verify',                   // GET  - 验证码接口（需传 name 参数）
  CAPTCHA: '/captcha',                 // GET  - 备用验证码（部分版本）
  LOGIN: '/login',                     // POST - 登录
  SECOND_VERIFY_SEND: '/second_verify_send', // POST - 二次验证发送验证码
  SECOND_VERIFY_LOGIN: '/second_verify_login', // POST - 二次验证登录
  LOGOUT: '/logout',                   // POST - 退出

  // 管理接口（需要登录session）
  // 路径基于官方API文档：https://w2.test.idcsmart.com/doc/
  USER_LIST: '/client_list',                          // POST - 用户列表
  USER_DETAIL: '/getClient',                         // POST - 获取用户详情
  ADD_BALANCE: '/admin/add_recharge_invoice/:uid',   // POST - 添加余额（强制充值）
  ORDER_CREATE: '/order/create',                      // POST - 创建订单
  ORDER_LIST: '/order/index',                        // POST - 订单列表
  PRODUCT_LIST: '/product/index',                     // POST - 产品列表
  PRODUCT_ACTIVE: '/product/active',                  // POST - 开通产品
  PRODUCT_CONFIG: '/product/config',                // POST - 产品配置
} as const;

// 构建完整URL
export function buildApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  // 如果path已经以http开头，直接返回
  if (path.startsWith('http')) return path;
  // 确保path以/开头
  const apiPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${apiPath}`;
}
