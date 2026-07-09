export function transformProductListParams(): Record<string, unknown> {
  return {};
}

export function transformProductCyclesParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    ...params,
    uid: params.uid || 0,
    pid: params.pid || 0,
    flag: 1,
  };
}

export function transformProductConfigParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    ...params,
    pid: params.pid || 0,
    billingcycle: params.billingcycle || 'monthly',
  };
}
