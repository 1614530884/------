export function transformSearchParams(params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...params };

  if (params.searchParams && typeof params.searchParams === 'object') {
    const sp = params.searchParams as Record<string, unknown>;
    result.page = sp.page || 1;
    result.limit = sp.limit || 20;
    Object.assign(result, sp);
  } else if (params.keyword) {
    const kw = String(params.keyword).trim();
    if (kw.includes('@')) {
      result.email = kw;
    } else if (/^\d{11}$/.test(kw)) {
      result.phonenumber = kw;
    } else if (/^\d{5,10}$/.test(kw)) {
      result.qq = kw;
    } else {
      result.username = kw;
    }
  }

  delete result.keyword;
  delete result.searchParams;
  return result;
}

export function transformAddBalanceParams(params: Record<string, unknown>): Record<string, unknown> {
  return {
    uid: params.uid,
    amount: params.amount,
    type: 'recharge',
    description: params.description || '后台充值',
  };
}

export function filterSearchResultByUid(result: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
  const searchParams = params.searchParams as Record<string, unknown> | undefined;
  const uid = searchParams?.id;
  const data = result.data as Record<string, unknown> | undefined;
  if (uid && data?.list && Array.isArray(data.list)) {
    const targetId = Number(uid);
    const list = (result.data as Record<string, unknown>).list as Record<string, unknown>[];
    const matched = list.find((item) => Number(item.id) === targetId);
    if (matched) {
      result.data = { list: [matched], total: 1, page: 1, page_total: 1 };
    } else {
      result.data = { list: [], total: 0, page: 1, page_total: 0 };
    }
  }
  return result;
}
