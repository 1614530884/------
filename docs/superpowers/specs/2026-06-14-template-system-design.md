# 产品开通话术自动生成与管理系统 - 设计文档

## 概述

在产品开通成功后，根据操作系统版本自动匹配话术模板，填充服务器信息变量，生成完整客户通知话术，支持一键复制。

## 数据模型

### 模板结构 (`data/templates.json`)

```typescript
interface Template {
  id: string;              // 唯一ID (uuid)
  name: string;            // 模板名称，如 "Linux标准交付话术"
  content: string;         // 话术内容，支持变量占位符 {{ip}}、{{username}} 等
  osFilters: string[];     // 匹配的OS版本名称列表（如 ["CentOS - 7.9", "CentOS - 8.0"]）
  productIds: number[];    // 关联的产品ID列表（空=通用）
  isDefault: boolean;      // 是否为默认模板（无匹配时使用）
  createdAt: number;       // 创建时间戳
  updatedAt: number;       // 更新时间戳
}
```

### 变量系统

| 变量 | 说明 | 数据来源 |
|------|------|----------|
| `{{ip}}` | 服务器IP地址 | host_data.dedicatedip 或 host_data.assignedips[0] |
| `{{username}}` | 登录账号 | host_data.username |
| `{{password}}` | 登录密码 | host_data.password |
| `{{nextduedate}}` | 服务到期时间 | host_data.nextduedate |
| `{{amount}}` | 续费金额 | host_data.amount |
| `{{billingcycle}}` | 计费周期 | host_data.billingcycle |
| `{{product_name}}` | 产品名称 | 产品列表中的 name |
| `{{os_name}}` | 操作系统名称 | 当前选择的 OS 分类名+版本名 |

## API Route

### `/api/templates`

- **GET** — 读取所有模板，返回 `{ templates: Template[] }`
- **POST** — 保存所有模板（整体覆盖），body 为 `{ templates: Template[] }`

数据文件路径：`data/templates.json`，与套餐管理 `data/packages.json` 同级。

## 话术管理页面 `/templates`

独立页面 (`src/app/templates/page.tsx`)，功能：

1. **模板列表**：展示所有模板卡片，显示名称、匹配规则摘要、是否默认
2. **新建/编辑模板**：弹窗表单
   - 模板名称输入
   - 话术内容 textarea（支持变量快捷插入按钮）
   - OS版本匹配多选（从后台动态加载 option_type=5 的选项，显示为 "分类 - 版本" 格式）
   - 产品关联多选（从后台动态加载产品列表）
   - 设为默认模板开关
3. **删除模板**：确认弹窗后删除
4. **变量快捷插入**：点击变量按钮在 textarea 光标位置插入 `{{变量名}}`

### 页面导航

在开通页面 (`/`) 顶部导航栏增加"话术管理"链接，指向 `/templates`。

## 开通结果弹窗集成

在现有"开通成功"弹窗底部增加话术预览区：

1. 获取开通产品的 OS 版本名称（从 configValues 中 option_type=5 的选中值，格式为 "分类 - 版本"）
2. 获取产品 ID
3. 按优先级匹配模板：OS版本精确匹配 > 产品ID匹配 > 默认模板
4. 替换模板中的 `{{变量}}` 为实际值
5. 展示填充后的完整话术
6. 提供一键复制话术按钮
7. 多台服务器时，每台独立生成话术，可单独复制也可一键复制全部

### 匹配逻辑

```
function matchTemplate(osName, productId, templates):
  1. 精确匹配: templates.filter(t => t.osFilters.includes(osName))
  2. 产品匹配: templates.filter(t => t.productIds.includes(productId))
  3. 默认模板: templates.filter(t => t.isDefault)
  返回第一个匹配结果，无匹配则返回 null
```

## 技术要点

- 存储方案：服务端 JSON 文件，与套餐管理一致
- OS 版本匹配使用名称字符串（如 "CentOS - 7.9"），而非 ID，因为不同产品的 OS 选项 ID 不同
- 变量替换时需清理换行符（密码字段可能包含 \r\n）
- 话术管理页面需要登录后才能访问（复用 idc_auth 认证）
