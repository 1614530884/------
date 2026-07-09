import { NextResponse } from 'next/server';
import { ModuleHandler, IdcRequestContext, ApiActionDef } from '../shared/types';
import { executeIdcRequest } from '../shared/client';
import { UserModule } from './user';
import { ProductModule } from './product';
import { OrderModule } from './order';
import { ServiceModule } from './service';
import { ProvisionModule } from './provision';

const modules: ModuleHandler[] = [
  new UserModule(),
  new ProductModule(),
  new OrderModule(),
  new ServiceModule(),
  new ProvisionModule(),
];

// 构建 action -> module 索引
const actionModuleMap = new Map<string, ModuleHandler>();
for (const mod of modules) {
  for (const action of Object.keys(mod.getActions())) {
    actionModuleMap.set(action, mod);
  }
}

export function resolveModule(action: string): ModuleHandler | null {
  return actionModuleMap.get(action) ?? null;
}

export function getAllActionDefs(): Record<string, ApiActionDef> {
  const all: Record<string, ApiActionDef> = {};
  for (const mod of modules) {
    Object.assign(all, mod.getActions());
  }
  return all;
}

export async function dispatchAction(
  action: string,
  params: Record<string, unknown>,
  ctx: IdcRequestContext
): Promise<NextResponse> {
  const mod = resolveModule(action);
  if (!mod) {
    return NextResponse.json({ success: false, message: `未知操作: ${action}` });
  }

  // 1. 参数转换
  const transformedParams = mod.transformParams(action, params);

  // 2. 检查是否有特殊处理
  if (mod.handleSpecialAction) {
    const specialResult = await mod.handleSpecialAction(action, transformedParams, ctx);
    if (specialResult) return specialResult;
  }

  // 3. 获取API定义
  const actions = mod.getActions();
  const apiDef = actions[action];
  if (!apiDef) {
    return NextResponse.json({ success: false, message: `未知操作: ${action}` });
  }

  // 4. 判断是否是前台API
  const isFrontend = mod.isFrontendApi ? mod.isFrontendApi(action) : false;

  // 5. 执行请求
  const response = await executeIdcRequest(action, apiDef.path, apiDef.method, transformedParams, ctx, isFrontend);

  // 6. 后置响应处理
  if (mod.handleResponse) {
    // 从response中提取JSON进行处理
    try {
      const json = await response.json();
      const processed = mod.handleResponse(action, json, params);
      return NextResponse.json(processed);
    } catch {
      return response;
    }
  }

  return response;
}
