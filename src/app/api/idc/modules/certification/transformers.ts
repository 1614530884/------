export function transformCertifiLogListParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      result[k] = v;
    }
  }
  if (!result.limit) result.limit = 10;
  if (!result.page) result.page = 1;
  return result;
}

export function transformCertifiStatusParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    uid: Number(params.uid) || 0,
    type: Number(params.type) || 0,
    status: Number(params.status) || 0,
  };
  if (params.error && typeof params.error === 'string') {
    result.error = params.error;
  }
  return result;
}
