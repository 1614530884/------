/**
 * 服务器管理工具 - 脚本引擎
 *
 * 职责：
 * 1. `{{param}}` 模板渲染（支持默认值、必填校验）
 * 2. Shell 安全转义（单引号包裹 + 内部单引号转义）
 * 3. 参数校验
 */
import type { ScriptParam } from './types';

export interface RenderResult {
  ok: boolean;
  rendered?: string;
  error?: string;
}

/**
 * Shell 安全转义：用单引号包裹，内部单引号转为 '\'' 
 * 这样可以安全地插入到 bash 脚本中
 */
export function escapeShellValue(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * 校验参数：必填项不能为空
 */
export function validateParams(paramDefs: ScriptParam[], values: Record<string, string>): string | null {
  for (const def of paramDefs) {
    if (def.required) {
      const v = values[def.name];
      if (v === undefined || v === null || v === '') {
        return `参数 "${def.label}" 为必填项`;
      }
    }
  }
  return null;
}

/**
 * 渲染脚本模板
 * - 支持 `{{paramName}}` 占位符
 * - 必填参数缺失返回错误
 * - 可选参数缺失时使用 defaultValue（若有）或空字符串
 * - 值用单引号包裹以避免 shell 注入（注意：脚本中需要裸值时可用 $() 解包）
 */
export function renderScript(
  content: string,
  paramDefs: ScriptParam[],
  values: Record<string, string>,
): RenderResult {
  const err = validateParams(paramDefs, values);
  if (err) return { ok: false, error: err };

  let rendered = content;
  for (const def of paramDefs) {
    const raw = values[def.name] ?? def.defaultValue ?? '';
    // 统一转义：单引号包裹
    const safe = escapeShellValue(raw);
    rendered = rendered.replace(new RegExp(`\\{\\{${escapeRegExp(def.name)}\\}\\}`, 'g'), safe);
  }
  // 清理未匹配的 {{xxx}}（防止残留占位符）
  rendered = rendered.replace(/\{\{[^}]+\}\}/g, "''");
  return { ok: true, rendered };
}

/**
 * 从参数定义生成默认值表（用于 UI 预填）
 */
export function getDefaultValues(paramDefs: ScriptParam[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const def of paramDefs) {
    if (def.defaultValue !== undefined) result[def.name] = def.defaultValue;
  }
  return result;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
