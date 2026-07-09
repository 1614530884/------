import { NextResponse } from 'next/server';
import { ModuleHandler, IdcRequestContext } from '../../shared/types';
import { serviceActions } from './actions';
import {
  transformGetServiceInfoParams,
  transformSearchHostParams,
  transformGetHostDetailParams,
  transformServiceDetailParams,
  transformHostRenewPageParams,
  transformHostRenewParams,
  transformProductActiveParams,
  transformProvisionTerminateParams,
} from './transformers';

const FRONTEND_UPGRADE_ACTIONS = new Set(['upgradeConfigPage', 'upgradeConfigCalc', 'upgradeConfigCheckout']);

function flattenHostData(hostData: Record<string, unknown>): Record<string, string> {
  const postParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(hostData)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) continue;
    if (typeof v === 'object') {
      // 对象字段：尝试提取标量value属性（如auto_terminate_end_cycle可能是{value:1,text:"开启"}）
      const obj = v as Record<string, unknown>;
    if (obj.value !== undefined && obj.value !== null && typeof obj.value !== 'object') {
        postParams[k] = String(obj.value);
      }
      continue;
    }
    if (k === 'id') {
      postParams['hostid'] = String(v);
    } else {
      postParams[k] = String(v);
    }
  }
  return postParams;
}

function appendConfigOptions(
  postParams: Record<string, string>,
  hostOptionConfig: Array<Record<string, unknown>>
): void {
  for (const opt of hostOptionConfig) {
    const configId = String(opt.configid || '');
    const optionId = String(opt.optionid || '');
    const qty = Number(opt.qty || 0);
    if (!configId) continue;
    if (qty > 0) {
      // 数量型配置：configoption提交数量值（与adminUpgradeConfig一致）
      // 不提交optionid，否则后台会把optionid当作配置值
      postParams[`configoption[${configId}]`] = String(qty);
    } else if (optionId && optionId !== '0') {
      postParams[`configoption[${configId}]`] = optionId;
    }
  }
}

function buildFormBody(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

function parseSaveResponse(saveText: string, status: number, cookie: string): NextResponse {
  try {
    const result = JSON.parse(saveText);
    return NextResponse.json({
      success: result.status === 200 || result.msg === '更改保存成功！',
      ...result,
      cookie,
    });
  } catch {
    if (status >= 200 && status < 400) {
      return NextResponse.json({ success: true, message: '操作成功', cookie });
    }
    return NextResponse.json({
      success: false,
      message: `保存失败 (HTTP ${status})`,
      rawResponse: saveText.substring(0, 500),
      cookie,
    });
  }
}

export class ServiceModule implements ModuleHandler {
  getActions() {
    return serviceActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'getServiceInfo':
        return transformGetServiceInfoParams(params);
      case 'searchHost':
        return transformSearchHostParams(params);
      case 'getHostDetail':
        return transformGetHostDetailParams(params);
      case 'serviceDetail':
        return transformServiceDetailParams(params);
      case 'hostRenewPage':
        return transformHostRenewPageParams(params);
      case 'hostRenew':
        return transformHostRenewParams(params);
      case 'product/active':
        return transformProductActiveParams(params);
      case 'provisionCreate':
        return transformProductActiveParams(params);
      case 'provisionTerminate':
        return transformProvisionTerminateParams(params);
      default:
        return params;
    }
  }

  isFrontendApi(action: string): boolean {
    return FRONTEND_UPGRADE_ACTIONS.has(action);
  }

  async handleSpecialAction(action: string, params: Record<string, unknown>, ctx: IdcRequestContext): Promise<NextResponse | null> {
    switch (action) {
      case 'updateHostAmount':
        return this.handleUpdateHostAmount(params, ctx);
      case 'getServiceDetail':
        return this.handleGetServiceDetail(params, ctx);
      case 'saveServiceInfo':
        return this.handleSaveServiceInfo(params, ctx);
      default:
        return null;
    }
  }

  private async handleUpdateHostAmount(params: Record<string, unknown>, ctx: IdcRequestContext): Promise<NextResponse> {
    const targetHostid = String(params.hostid || params.id || '');
    const targetUid = String(params.uid || '');
    const newAmount = String(params.amount || '');
    const newBillingCycle = String(params.billingcycle || '');
    const skipNextDueDate = String(params.skipNextDueDate || '') === 'true';

    if (!targetHostid || !newAmount) {
      return NextResponse.json({ success: false, message: '缺少 hostid 或 amount 参数' });
    }

    try {
      // Step 1: GET获取产品完整信息（含配置项）
      const detailUrl = `${ctx.baseUrl}/clients_services?uid=${encodeURIComponent(targetUid)}&hostselect=${encodeURIComponent(targetHostid)}`;
      const detailResp = await fetch(detailUrl, { method: 'GET', headers: ctx.headers });
      const detailText = await detailResp.text();
      let hostData: Record<string, unknown> = {};
      let hostOptionConfig: Array<Record<string, unknown>> = [];

      try {
        const detailResult = JSON.parse(detailText);
        hostData = detailResult?.data?.host_data || {};
        hostOptionConfig = Array.isArray(detailResult?.data?.host_option_config)
          ? detailResult.data.host_option_config
          : [];
      } catch {
        return NextResponse.json({ success: false, message: '获取产品详情失败，无法更新续费价格' });
      }

      if (!hostData.id) {
        return NextResponse.json({ success: false, message: `未找到产品信息(hostid=${targetHostid})` });
      }

      // Step 2: 构建POST参数（展平标量字段 + 配置项）
      const postParams = flattenHostData(hostData);
      appendConfigOptions(postParams, hostOptionConfig);
      postParams['amount'] = newAmount;

      // auto_terminate_end_cycle：完全模仿财务后台提交"false"，后台会保留原值不修改
      postParams['auto_terminate_end_cycle'] = 'false';

      if (newBillingCycle) {
        postParams['billingcycle'] = newBillingCycle;
        const currentCycle = String(hostData.billingcycle || '');
        if (currentCycle !== newBillingCycle && !skipNextDueDate) {
          const currentNextDue = Number(hostData.nextduedate) || 0;
          if (currentNextDue) {
            const dueDate = new Date(currentNextDue * 1000);
            let newDueDate: Date;
            if (newBillingCycle === 'annually') { newDueDate = new Date(dueDate); newDueDate.setFullYear(newDueDate.getFullYear() + 1); }
            else if (newBillingCycle === 'monthly') { newDueDate = new Date(dueDate); newDueDate.setMonth(newDueDate.getMonth() + 1); }
            else if (newBillingCycle === 'quarterly') { newDueDate = new Date(dueDate); newDueDate.setMonth(newDueDate.getMonth() + 3); }
            else if (newBillingCycle === 'semiannually') { newDueDate = new Date(dueDate); newDueDate.setMonth(newDueDate.getMonth() + 6); }
            else if (newBillingCycle === 'biennially') { newDueDate = new Date(dueDate); newDueDate.setFullYear(newDueDate.getFullYear() + 2); }
            else if (newBillingCycle === 'triennially') { newDueDate = new Date(dueDate); newDueDate.setFullYear(newDueDate.getFullYear() + 3); }
            else { newDueDate = dueDate; }
            postParams['nextduedate'] = String(Math.floor(newDueDate.getTime() / 1000));
            postParams['nextinvoicedate'] = postParams['nextduedate'];
          }
        }
      }

      // Step 3: POST保存
      const saveUrl = `${ctx.baseUrl}/clients_services/info`;
      const formBody = buildFormBody(postParams);

      const saveResp = await fetch(saveUrl, {
        method: 'POST',
        headers: {
          ...ctx.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${ctx.baseUrl}/clients_services/info?hostid=${targetHostid}`,
        },
        body: formBody,
      });

      const saveText = await saveResp.text();
      return parseSaveResponse(saveText, saveResp.status, ctx.cookie);
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : '未知错误';
      return NextResponse.json({ success: false, message: `请求失败: ${errMsg}` });
    }
  }

  private async handleGetServiceDetail(params: Record<string, unknown>, ctx: IdcRequestContext): Promise<NextResponse> {
    const targetHostid = String(params.hostid || '');
    const targetUid = String(params.uid || '');
    if (!targetHostid || !targetUid) {
      return NextResponse.json({ success: false, message: '缺少 hostid 或 uid 参数' });
    }
    try {
      const detailUrl = `${ctx.baseUrl}/clients_services?uid=${encodeURIComponent(targetUid)}&hostselect=${encodeURIComponent(targetHostid)}`;
      const detailResp = await fetch(detailUrl, { method: 'GET', headers: ctx.headers });
      const detailText = await detailResp.text();
      const detailResult = JSON.parse(detailText);
      const hostData = detailResult?.data?.host_data || null;
      const configArray = detailResult?.data?.config_array || null;
      const hostOptionConfig = detailResult?.data?.host_option_config || null;
      if (!hostData) {
        return NextResponse.json({ success: false, message: '未找到产品详情', rawResponse: detailText.substring(0, 300) });
      }
      return NextResponse.json({ success: true, data: hostData, config_array: configArray, host_option_config: hostOptionConfig, cookie: ctx.cookie });
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : '未知错误';
      return NextResponse.json({ success: false, message: `获取详情失败: ${errMsg}` });
    }
  }

  private async handleSaveServiceInfo(params: Record<string, unknown>, ctx: IdcRequestContext): Promise<NextResponse> {
    const targetHostid = String(params.hostid || '');
    const targetUid = String(params.uid || '');
    const updateFields = (params.updateFields as Record<string, unknown>) || {};

    if (!targetHostid || !targetUid) {
      return NextResponse.json({ success: false, message: '缺少 hostid 或 uid 参数' });
    }
    try {
      // Step 1: GET获取当前完整信息（含配置项）
      const detailUrl = `${ctx.baseUrl}/clients_services?uid=${encodeURIComponent(targetUid)}&hostselect=${encodeURIComponent(targetHostid)}`;
      const detailResp = await fetch(detailUrl, { method: 'GET', headers: ctx.headers });
      const detailText = await detailResp.text();
      const detailResult = JSON.parse(detailText);
      const hostData = detailResult?.data?.host_data || {};
      const hostOptionConfig = Array.isArray(detailResult?.data?.host_option_config)
        ? detailResult.data.host_option_config
        : [];

      if (!hostData.id) {
        return NextResponse.json({ success: false, message: '未找到产品信息' });
      }

      // Step 2: 展平所有字段（递归展平，保留对象/数组字段）
      const postParams = flattenHostData(hostData);
      // 补充配置项
      appendConfigOptions(postParams, hostOptionConfig);

      // auto_terminate_end_cycle：完全模仿财务后台提交"false"，后台会保留原值不修改
      postParams['auto_terminate_end_cycle'] = 'false';

      // Step 3: 覆盖用户修改的字段
      for (const [k, v] of Object.entries(updateFields)) {
        if (v !== undefined && v !== null) {
          postParams[k] = String(v);
        }
      }

      // Step 4: POST保存
      const saveUrl = `${ctx.baseUrl}/clients_services/info`;
      const formBody = buildFormBody(postParams);

      const saveResp = await fetch(saveUrl, {
        method: 'POST',
        headers: {
          ...ctx.headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': `${ctx.baseUrl}/clients_services/info?hostid=${targetHostid}`,
        },
        body: formBody,
      });

      const saveText = await saveResp.text();
      return parseSaveResponse(saveText, saveResp.status, ctx.cookie);
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : '未知错误';
      return NextResponse.json({ success: false, message: `请求失败: ${errMsg}` });
    }
  }
}
