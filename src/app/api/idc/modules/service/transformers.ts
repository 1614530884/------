export function transformGetServiceInfoParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  if (!result.uid && result.client_id) {
    result.uid = result.client_id;
    delete result.client_id;
  }
  if (!result.page) result.page = 1;
  if (!result.pagecount) result.pagecount = 100;
  return result;
}

export function transformSearchHostParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  if (result.hostname && !result.domain) {
    result.domain = result.hostname;
    delete result.hostname;
  }
  if (!result.page) result.page = 1;
  if (!result.pagecount) result.pagecount = 10;
  return result;
}

export function transformGetHostDetailParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  if (!result.uid && result.client_id) {
    result.uid = result.client_id;
    delete result.client_id;
  }
  if (result.hostid && !result.hostselect) {
    result.hostselect = result.hostid;
    delete result.hostid;
  }
  return result;
}

export function transformServiceDetailParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  if (!result.uid && result.client_id) {
    result.uid = result.client_id;
    delete result.client_id;
  }
  if (result.hostid && !result.hostselect) {
    result.hostselect = result.hostid;
    delete result.hostid;
  }
  return result;
}

export function transformHostRenewPageParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  if (!result.hostid && result.id) {
    result.hostid = result.id;
    delete result.id;
  }
  return result;
}

export function transformHostRenewParams(params: Record<string, unknown>): Record<string, unknown> {
  const result = { ...params };
  // payment 不再写死兜底：由前端调用方（续费流程）实时校验财务侧网关列表后传入，
  // 避免财务更换支付接口后旧值失效导致续费失败。未传时 GET query 自动省略该字段
  return result;
}

export function transformProductActiveParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: params.host_id || params.id,
    func: 'create',
  };
}

export function transformProvisionTerminateParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: params.id || params.hostid,
    func: 'terminate',
  };
}

export function transformUpgradeConfigPageParams(params: Record<string, unknown>): Record<string, unknown> {
  return { ...params };
}

export function transformUpgradeConfigCalcParams(params: Record<string, unknown>): Record<string, unknown> {
  return { ...params };
}

export function transformUpgradeConfigCheckoutParams(params: Record<string, unknown>): Record<string, unknown> {
  return { ...params };
}

export function transformAdminUpgradeConfigParams(params: Record<string, unknown>): Record<string, unknown> {
  return { ...params };
}
