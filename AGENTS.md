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

## 服务器管理工具模块 (Server Tools)

独立的服务器管理子系统，位于 `src/lib/services/server-tools/`，提供 SSH 终端、后台任务、文件管理、脚本管理、宝塔面板安装、数据清理等功能。

### 架构

- **存储**: better-sqlite3 (WAL 模式)，DB 文件 `server-tools.db`，6 张表
- **实时通信**: WebSocket (ws 库)，3 个 WS 路由 (`/ws/ssh`, `/ws/tasks`, `/ws/sftp`)
- **终端**: @xterm/xterm + addon-fit + addon-web-links
- **SSH/SFTP**: ssh2 库，SshClientManager / SftpClientManager 单例
- **加密**: AES-256-GCM (复用 `src/lib/crypto.ts`)
- **用户隔离**: owner 字段 + admin 可见全部 (adminUsernames 从 idc-config.json 读取)
- **自定义服务端**: `src/server.ts` 扩展 Next.js，集成 WebSocketServer

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/lib/services/server-tools/db.ts` | SQLite 单例，WAL 模式，自动建表 |
| `src/lib/services/server-tools/types.ts` | 全部类型定义（含 WS 消息协议） |
| `src/lib/services/server-tools/store.ts` | 6 个 store，强制 owner 隔离，Internal 方法供后台任务用 |
| `src/lib/services/server-tools/ssh-client.ts` | SSH 客户端管理（连接/shell/exec） |
| `src/lib/services/server-tools/sftp-client.ts` | SFTP 客户端管理（5min 连接缓存） |
| `src/lib/services/server-tools/auth.ts` | 鉴权辅助（session token 优先，fallback _loginUser） |
| `src/lib/services/server-tools/task-runner.ts` | 后台任务执行器（4 种任务类型，WS 订阅推送） |
| `src/lib/services/server-tools/bt-capture.ts` | 宝塔安装输出解析（中英文正则） |
| `src/lib/services/server-tools/script-engine.ts` | 脚本模板渲染（`{{param}}` + 单引号转义） |
| `src/lib/services/server-tools/builtin-scripts.ts` | 11 个内置脚本 seed（维护/安装/检查） |
| `src/lib/services/server-tools/cleanup-scheduler.ts` | 清理调度器（每 6 小时执行） |
| `src/lib/services/server-tools/service.ts` | 主服务单例（Token/DB/TaskRunner/Cleanup 管理） |
| `src/ws-handlers/ssh.ts` | SSH WebSocket 处理器 |
| `src/ws-handlers/tasks.ts` | 任务 WebSocket 处理器 |
| `src/server.ts` | 自定义服务端（WebSocketServer + Origin/Token 校验） |

### API 路由

所有 API 位于 `/api/server-tools/` 下，统一认证模式：`verifySessionToken` → `getCurrentUser` → owner 隔离。

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/server-tools/connections` | GET/POST | 服务器连接列表/创建 |
| `/api/server-tools/connections/[id]` | GET/PATCH/DELETE | 连接详情/更新/软删除 |
| `/api/server-tools/tasks` | GET/POST | 任务列表/创建（异步启动） |
| `/api/server-tools/tasks/[id]` | GET/DELETE | 任务详情/删除 |
| `/api/server-tools/tasks/[id]/cancel` | POST | 取消运行中任务 |
| `/api/server-tools/tasks/[id]/logs` | GET | 分页查询日志（afterSeq/beforeSeq） |
| `/api/server-tools/bt-panels` | GET | 宝塔信息列表 |
| `/api/server-tools/bt-panels/[id]` | DELETE | 软删除宝塔信息 |
| `/api/server-tools/sftp` | GET/POST/DELETE | 文件列表/读取/下载/mkdir/rename/删除 |
| `/api/server-tools/sftp/upload` | POST | 文件上传（multipart, 50MB 上限） |
| `/api/server-tools/scripts` | GET/POST | 脚本列表/创建 |
| `/api/server-tools/scripts/[id]` | GET/PATCH/DELETE | 脚本详情/更新/删除（内置不可改删） |
| `/api/server-tools/cleanup` | GET/PATCH/POST | 清理规则/更新/立即清理 |
| `/api/server-tools/stats` | GET | 仪表盘统计 |
| `/api/ws-token` | GET | 签发 WS Token（24h TTL） |

### 页面

| 路径 | 说明 |
|------|------|
| `/server-tools` | 仪表盘（服务器列表 + 统计） |
| `/server-tools/[id]` | 详情页（SSH 终端 + 任务面板 + 宝塔信息 + 文件管理 + 脚本选择器） |
| `/server-tools/scripts` | 脚本管理（CRUD + 参数编辑器） |
| `/server-tools/cleanup` | 清理规则配置（开关 + 保留天数 + 立即清理） |

### 关键技术发现

- **WS Token**: 24h TTL，通过 `/api/ws-token` 签发，WS 连接时 query 参数 `token` 校验
- **任务执行**: 任务在 server 进程内运行（非 HTTP 请求生命周期），关闭页面后继续运行
- **WS 日志推送**: task_log 消息含 seq 序号，前端按 seq 去重 + 向上分页（beforeSeq）
- **脚本渲染**: `{{param}}` 模板，值用单引号包裹（`'value'\''`）防 shell 注入
- **SFTP 缓存**: 连接缓存 5min TTL，1min 清理过期连接
- **服务重启**: running 任务自动标记为 interrupted，内置脚本 INSERT OR IGNORE（幂等 seed）
- **清理调度**: 每 6 小时执行，启动后 1 分钟首次执行，按 retainDays 删除过期数据
- **认证模式**: 所有 API 必须先 `verifySessionToken(sessionCookie)` 再 `getCurrentUser`，防止 `x-current-user` 头伪造
- **开发启动**: Windows 下用 `pnpm tsx watch src/server.ts`（bash 脚本不可用），端口 5000

