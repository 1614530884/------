export function transformGetTotalParams(params: Record<string, unknown>): Record<string, unknown> {
  const getTotalParams: Record<string, unknown> = {
    uid: params.uid || 0,
  };

  const pid = params.pid;
  const billingcycle = params.billingcycle;

  if (Array.isArray(pid)) {
    pid.forEach((p: unknown, i: number) => {
      getTotalParams[`pid[${i}]`] = p;
    });
  } else {
    getTotalParams['pid[0]'] = pid || 0;
  }

  if (Array.isArray(billingcycle)) {
    billingcycle.forEach((b: unknown, i: number) => {
      getTotalParams[`billingcycle[${i}]`] = b;
    });
  } else {
    getTotalParams['billingcycle[0]'] = billingcycle || 'monthly';
  }

  const configoption = params.configoption as Record<string, string> | undefined;
  if (configoption && typeof configoption === 'object') {
    for (const [key, value] of Object.entries(configoption)) {
      getTotalParams[`configoption[0][${key}]`] = value;
    }
  }

  getTotalParams['qty[0]'] = params.qty || 1;

  const interiorPrice = params.interior_price;
  const interiorPriceRenew = params.interior_price_renew;
  if (typeof interiorPrice === 'number' && interiorPrice > 0) {
    getTotalParams['interior_price[0]'] = interiorPrice;
  }
  if (typeof interiorPriceRenew === 'number' && interiorPriceRenew > 0) {
    getTotalParams['interior_price_renew[0]'] = interiorPriceRenew;
  }
  getTotalParams['os[0]'] = 0;

  return getTotalParams;
}

export function transformCreateOrderParams(params: Record<string, unknown>): Record<string, unknown> {
  const pid = params.pid as number | undefined;
  const billingcycle = (params.billingcycle as string) || 'monthly';
  const qty = (params.qty as number) || 1;
  const interiorPrice = params.interior_price as number | undefined;
  const interiorPriceRenew = params.interior_price_renew as number | undefined;
  const configoptions = params.configoptions as Record<string, unknown> | undefined;
  const customfield = params.customfield as Record<string, unknown> | undefined;
  const payment = (params.payment as string) || 'E007alipay';

  const opsEntry: Record<string, unknown> = {
    pid: String(pid || ''),
    billingcycle,
    qty,
  };

  if (typeof interiorPrice === 'number' && interiorPrice > 0) {
    opsEntry.interior_price = interiorPrice;
  }
  if (typeof interiorPriceRenew === 'number' && interiorPriceRenew > 0) {
    opsEntry.interior_price_renew = interiorPriceRenew;
  }
  if (configoptions && typeof configoptions === 'object') {
    opsEntry.configoptions = configoptions;
  }
  if (customfield && typeof customfield === 'object') {
    opsEntry.customfield = customfield;
  }

  return {
    uid: params.uid,
    payment,
    status: 'Active',
    adminorderconf: 1,
    admingenerateinvoice: 1,
    adminsendinvoice: 0,
    use_credit: params.use_credit ?? 1,
    ops: { "0": opsEntry },
  };
}
