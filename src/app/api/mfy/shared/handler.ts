import { MfyService, MfyCredentials } from '@/lib/services/mfy-service';
import { actionMap, MfyActionDef, UNSUPPORTED_BATCH_ACTIONS, WRITE_BATCH_BLOCKED_ACTIONS } from './actions';

export interface MfyRequestParams {
  id?: string | number;
  diskId?: string | number;
  snapshotId?: string | number;
  ruleId?: string;
  [key: string]: unknown;
}

export function buildApiPath(actionDef: MfyActionDef, params: MfyRequestParams): string {
  let apiPath = actionDef.path;
  if (actionDef.pathHasId && params.id != null) {
    apiPath = apiPath.replace('{id}', String(params.id));
  }
  if (params.diskId != null) {
    apiPath = apiPath.replace('{diskId}', String(params.diskId));
  }
  if (params.snapshotId != null) {
    apiPath = apiPath.replace('{snapshotId}', String(params.snapshotId));
  }
  if (params.ruleId != null) {
    apiPath = apiPath.replace('{ruleId}', String(params.ruleId));
  }
  return apiPath;
}

export async function executeMfyAction(
  account: MfyCredentials,
  action: string,
  rawParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const apiDef = actionMap[action];
  if (!apiDef) {
    return { success: false, msg: `未知魔方云操作: ${action}` };
  }

  const params: MfyRequestParams = { ...rawParams };
  const apiPath = buildApiPath(apiDef, params);

  if (action === 'snapshotList' && !params.type) {
    params.type = 'snap';
  }

  if (action === 'realDataList' && params.ids) {
    params.id = params.ids as string | number;
    delete params.ids;
  }

  return MfyService.request(account, apiPath, params as Record<string, unknown>, apiDef.method);
}

/**
 * 供 /api/mfy/batch 使用的入口：额外拦截有副作用的操作，
 * 这些操作必须走各自的专用路由（内部做串行与去重），避免并发直调。
 * 服务端内部编排（如批量 IP 任务）请直接用 executeMfyAction。
 */
export async function executeMfyBatchAction(
  account: MfyCredentials,
  action: string,
  rawParams: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (UNSUPPORTED_BATCH_ACTIONS.has(action) || WRITE_BATCH_BLOCKED_ACTIONS.has(action)) {
    return { success: false, msg: `操作 ${action} 不支持批量调用` };
  }
  return executeMfyAction(account, action, rawParams);
}
