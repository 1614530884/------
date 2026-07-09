# 项目上下文

## 项目简介

淘宝店铺订单开通系统 - 连接 IDCSmart 后台管理系统，实现一键开通云服务器。
前端通过 Next.js API Route (`/api/idc`) 代理所有 IDCSmart 后台 API 请求。

### 核心业务流程

1. 登录 IDCSmart 后台（获取 PHPSESSID + server_name_session cookie）
2. 搜索/选择用户（支持用户名、邮箱、手机号、QQ号、UID）
3. 选择产品套餐（从后台 product_list_page API 获取）
4. 加载产品配置选项（从后台 orders/set_config API 获取）
5. 一键开通：创建订单 → 获取 host_id → 获取详情
6. 产品续费：选择产品 → 续费 → 余额支付
7. 退款删除：计算退款金额 → 退款至余额 → 删除产品 → 删除账单

### 关键技术发现

- **configoptions vs configoption**: 创建订单时，`ops` 内部必须使用 `configoptions`（复数）而非 `configoption`（单数），否则配置不会保存到 `host_configoptions` 表
- **ops 格式**: 必须作为 JSON 对象传递（非字符串），格式为 `ops: { "0": { pid, billingcycle, qty, configoptions, customfield } }`
- **开通流程**: adminorderconf=1 时后台自动开通，无需再调 provision/default，直接获取详情
- **退款计算**: 按天计算，退款金额 = 剩余天数 × (续费金额 / 周期天数)，月付按当月天数
- **退款API**: GET /admin/clients_services/refund_page?hid=X 获取退款信息，POST /admin/clients_services/refund 执行退款
- **退余额**: POST /admin/credit (uid, amount, description) 直接充值用户余额
- **产品账单**: GET /admin/user_productinvoice?hostid=X 获取产品关联账单
- **终止云服务器**: POST /provision/default (hostid, func=terminate) 调用模块terminate，实际删除对接的云服务器
- **删除产品记录**: DELETE /clients_services/host (body: {hostid[]: [ids]}) - form-urlencoded格式，仅删除数据库记录
- **删除账单**: DELETE /invoice/delete (body: {ids[]: [invoiceIds]}) - form-urlencoded格式
- **删除流程**: 调用 provision/default (func=terminate, 参数名是id而非hostid) 终止云服务器，产品状态会自动变为"被删除"，无需再调 deleteHost。最后删除关联账单
- **账单获取**: refund_page API 返回 data.invoices 数组（含账单ID），用于删除关联账单；user_productinvoice API 不可用（返回ID_ERROR）
- **API路径注意**: 基础URL中JUzi2458AdMIn=admin，API路径不要重复加/admin/前缀
- **provision/default参数**: 参数名是 `id`（整型，非 `hostid`），配合 `func` 参数（terminate/delete/suspend/create等）
- **退款计算**: 月付按自然月计算，使用订购时间(regdate)作为周期起始；所有日期比较需截断到日期级别避免时分秒精度问题
- **修改续费价格(保存用户产品)**: `POST /admin/clients_services/info` — 必须**先GET获取完整host_data**（`GET /admin/clients_services?uid=X&hostselect=X`），把所有字段原样展平为form-urlencoded（跳过数组/对象/None），只改`amount`字段，再加`Referer`头POST提交。仅传部分必填字段会500！`host_data.id`需映射为`hostid`。前端只需传`hostid`、`uid`、`amount`三个参数，API route内部自动GET+POST
- **获取产品完整详情**: `getServiceDetail` action → API route内部GET `/clients_services?uid=X&hostselect=X`，返回完整`host_data`
- **保存产品信息**: `saveServiceInfo` action → API route内部先GET获取完整host_data，用`updateFields`覆盖指定字段，展平为form-urlencoded后POST保存

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
