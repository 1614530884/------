export function transformTicketListParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      result[k] = v;
    }
  }
  if (!result.limit) result.limit = 10;
  if (!result.page) result.page = 1;
  if (!result.status) result.status = 'all';
  return result;
}

function toIdArray(ids: unknown): number[] {
  if (Array.isArray(ids)) {
    return ids.map((v) => Number(v)).filter((n) => n > 0);
  }
  const n = Number(ids);
  return n > 0 ? [n] : [];
}

export function transformTicketCloseParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: toIdArray(params.id),
    status: params.status,
  };
}

export function transformTicketDeleteParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: toIdArray(params.id),
  };
}
