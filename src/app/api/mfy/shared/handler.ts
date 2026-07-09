import { MfyService, MfyCredentials } from '@/lib/services/mfy-service';
import { actionMap, MfyActionDef, UNSUPPORTED_BATCH_ACTIONS } from './actions';

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

  if (UNSUPPORTED_BATCH_ACTIONS.has(action)) {
    return { success: false, msg: `操作 ${action} 不支持批量调用` };
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
