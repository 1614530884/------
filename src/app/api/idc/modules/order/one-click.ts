import { NextResponse } from 'next/server';
import { IdcRequestContext } from '../../shared/types';
import { executeIdcRequest } from '../../shared/client';
import { transformCreateOrderParams } from './transformers';
import { transformAddBalanceParams, transformDeductBalanceParams } from '../user/transformers';
import { transformGetServiceInfoParams, transformGetHostDetailParams } from '../service/transformers';

// ===== 一键开通服务端编排 =====
// 充值→建单→轮询服务→取详情 在服务端一次跑完：
// - 浏览器回退/刷新/关闭均不影响流程，充值与订单必然配对
// - 幂等锁：同 uid 运行中拒绝新请求；完成后短时间内重复请求返回上次结果，不重复充值/开通
// - 失败回滚：充值成功但建单明确失败时，自动调用 /credit/reduce 扣回充值金额

interface StepInfo {
  id: number;
  status: 'completed' | 'failed';
  message: string;
}

interface ProvisionResultItem {
  orderId: string;
  ip: string;
  username: string;
  password: string;
  hostId: string;
  uid: string;
  dcimid: string;
  nextduedate: string;
  amount: string;
  billingcycle: string;
}

interface ProvisionLockRecord {
  status: 'running' | 'done';
  startedAt: number;
  finishedAt?: number;
  response?: Record<string, unknown>;
}

const provisionLocks = new Map<string, ProvisionLockRecord>();
const RUNNING_LOCK_TTL_MS = 5 * 60 * 1000; // 运行锁兜底超时：流程意外中断时自动失效，防止死锁
const RESULT_TTL_MS = 90 * 1000; // 完成结果保留时长：期间同 uid 重复提交幂等返回同一结果

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function callIdc(
  action: string,
  apiPath: string,
  method: string,
  params: Record<string, unknown>,
  ctx: IdcRequestContext
): Promise<Record<string, unknown>> {
  const resp = await executeIdcRequest(action, apiPath, method, params, ctx);
  return (await resp.json()) as Record<string, unknown>;
}

function extractHostData(res: Record<string, unknown>): Record<string, unknown> {
  const data = (res.data || {}) as Record<string, unknown>;
  if (data.host_data && typeof data.host_data === 'object') {
    return data.host_data as Record<string, unknown>;
  }
  return {};
}

function pickServerIp(hostData: Record<string, unknown>): string {
  const dedicatedIp = String(hostData.dedicatedip || '');
  if (dedicatedIp) return dedicatedIp;
  const assigned = Array.isArray(hostData.assignedips)
    ? (hostData.assignedips as unknown[]).filter((ip): ip is string => typeof ip === 'string' && ip !== '')
    : [];
  return assigned[0] || '';
}

export async function handleOneClickProvision(
  params: Record<string, unknown>,
  ctx: IdcRequestContext
): Promise<NextResponse> {
  const uid = toNum(params.uid);
  const pid = toNum(params.pid);
  const qty = Math.max(1, Math.floor(toNum(params.qty, 1)));
  const billingcycle = String(params.billingcycle || 'monthly');
  const autoRecharge = params.autoRecharge === true || params.autoRecharge === 1;
  const rechargeAmount = Math.max(0, toNum(params.rechargeAmount));

  if (!uid || !pid) {
    return NextResponse.json({ success: false, message: '缺少 uid 或 pid 参数' });
  }
  if (autoRecharge && rechargeAmount <= 0) {
    return NextResponse.json({ success: false, message: '自动充值已开启但充值金额无效' });
  }

  // ===== 幂等锁检查（同步段，无 await，不会产生竞态） =====
  const lockKey = `provision:${uid}`;
  const now = Date.now();
  const existing = provisionLocks.get(lockKey);
  if (existing) {
    if (existing.status === 'running') {
      if (now - existing.startedAt < RUNNING_LOCK_TTL_MS) {
        return NextResponse.json({
          success: false,
          message: '该用户已有开通流程正在执行中，请等待完成后再操作（勿重复点击或刷新重试）',
        });
      }
    } else if (existing.finishedAt && now - existing.finishedAt < RESULT_TTL_MS && existing.response) {
      // 浏览器回退/刷新后短时间内重复提交：幂等返回上次结果，不再充值/开通
      return NextResponse.json({ ...existing.response, replayed: true });
    }
    provisionLocks.delete(lockKey);
  }
  provisionLocks.set(lockKey, { status: 'running', startedAt: now });

  let result: Record<string, unknown>;
  try {
    result = await runProvision(params, ctx, { uid, pid, qty, billingcycle, autoRecharge, rechargeAmount });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    result = { success: false, message: `开通流程异常: ${message}` };
  }

  // 释放运行锁；仅"已产生副作用"的结果保留供幂等重放（防止短时间内重复开通/重复充值）：
  // - success / partial：订单已创建
  // - needManualFix：余额多充且回滚失败，重试会叠加充值
  // 干净失败（未充值或已自动回滚）直接放行，允许用户修正后立即重试
  const record = provisionLocks.get(lockKey);
  if (record && record.status === 'running') {
    const resultData = (result.data || {}) as Record<string, unknown>;
    const keepResult = result.success === true || result.partial === true || resultData.needManualFix === true;
    if (keepResult) {
      record.status = 'done';
      record.finishedAt = Date.now();
      record.response = result;
    } else {
      provisionLocks.delete(lockKey);
    }
  }
  // 顺带清理过期记录，防止 Map 无限增长
  for (const [key, rec] of provisionLocks) {
    const expired =
      (rec.status === 'done' && rec.finishedAt !== undefined && Date.now() - rec.finishedAt > RESULT_TTL_MS) ||
      (rec.status === 'running' && Date.now() - rec.startedAt > RUNNING_LOCK_TTL_MS);
    if (expired) provisionLocks.delete(key);
  }

  return NextResponse.json(result);
}

interface ProvisionArgs {
  uid: number;
  pid: number;
  qty: number;
  billingcycle: string;
  autoRecharge: boolean;
  rechargeAmount: number;
}

async function runProvision(
  params: Record<string, unknown>,
  ctx: IdcRequestContext,
  args: ProvisionArgs
): Promise<Record<string, unknown>> {
  const { uid, pid, qty, billingcycle, autoRecharge, rechargeAmount } = args;
  const steps: StepInfo[] = [];
  let recharged = 0;

  // ===== Step 3: 自动充余额 =====
  if (autoRecharge && rechargeAmount > 0) {
    let addRes: Record<string, unknown>;
    try {
      addRes = await callIdc('addBalance', '/credit', 'POST', transformAddBalanceParams({
        uid,
        amount: rechargeAmount,
        description: `一键开通充值 - 产品ID:${pid} - ${billingcycle}`,
      }), ctx);
    } catch {
      // 请求超时/网络中断：充值是否实际到账未知，中止并要求先核对，防止重复充值
      // needManualFix=true 让锁保留90秒，阻止立即重试叠加充值
      steps.push({ id: 3, status: 'failed', message: '充值请求异常（网络/超时）' });
      return { success: false, message: '充值请求异常，实际到账状态未知，请先到后台核对用户余额后再操作，勿直接重试', data: { steps, needManualFix: true } };
    }
    if (addRes.success) {
      recharged = rechargeAmount;
      steps.push({ id: 3, status: 'completed', message: `已充值 ¥${rechargeAmount.toFixed(2)}` });
    } else {
      const errMsg = String(addRes.msg || addRes.message || '余额充值失败');
      steps.push({ id: 3, status: 'failed', message: errMsg });
      return { success: false, message: `余额充值失败: ${errMsg}`, data: { steps } };
    }
  } else {
    steps.push({ id: 3, status: 'completed', message: '未启用自动充值' });
  }

  // ===== Step 4: 创建订单（充值成功后的关键步骤） =====
  let orderRes: Record<string, unknown>;
  try {
    orderRes = await callIdc('createOrder', '/order/create', 'POST', transformCreateOrderParams(params), ctx);
  } catch (error) {
    // 建单请求超时/网络中断：订单是否实际生成未知，此时不能自动回滚充值
    // （若订单实际已创建并余额扣款，回滚会造成订单欠费），交给人工核对最稳
    const errMsg = `订单创建请求异常（${error instanceof Error ? error.message : '网络错误'}），订单是否生成未知`;
    steps.push({ id: 4, status: 'failed', message: errMsg });
    const manualNote = recharged > 0
      ? `若未生成订单，需手动处理多充的 ¥${recharged.toFixed(2)}（用页面"扣减余额"功能）；若已生成则无需处理`
      : '请到后台核对该用户订单';
    return {
      success: false,
      message: `${errMsg}；${manualNote}`,
      data: { steps, rechargedAmount: recharged, refunded: false, needManualFix: recharged > 0 },
    };
  }
  const orderData = (orderRes.data || {}) as Record<string, unknown>;
  const orderIdRaw = orderData.orderid ?? orderData.order_id ?? orderData.id;
  const orderId = orderIdRaw === undefined || orderIdRaw === null ? '' : String(orderIdRaw);

  if (!orderRes.success) {
    const errMsg = String(orderRes.msg || orderRes.message || '订单创建失败');
    // 失败回滚：把刚充进去的余额扣回去，保证"没开机器就不动余额"
    let refunded = false;
    if (recharged > 0) {
      try {
        const deductRes = await callIdc('deductBalance', '/credit/reduce', 'POST', transformDeductBalanceParams({
          uid,
          amount: recharged,
          description: `一键开通失败自动回退充值 - 产品ID:${pid} - ${billingcycle}`,
        }), ctx);
        refunded = deductRes.success === true;
      } catch {
        refunded = false;
      }
    }
    const refundNote = recharged <= 0
      ? ''
      : refunded
        ? `；已自动回退充值 ¥${recharged.toFixed(2)}，用户余额已恢复`
        : `；自动回退失败，请手动处理：用户余额多充了 ¥${recharged.toFixed(2)}`;
    steps.push({ id: 4, status: 'failed', message: errMsg });
    return {
      success: false,
      message: `订单创建失败: ${errMsg}${refundNote}`,
      data: { steps, rechargedAmount: recharged, refunded, needManualFix: recharged > 0 && !refunded },
    };
  }
  steps.push({ id: 4, status: 'completed', message: orderId ? `订单号: ${orderId}` : '订单已创建' });

  // ===== Step 5: 轮询获取服务（adminorderconf=1 后台自动开通） =====
  const maxWaitMs = Math.min(3000 + qty * 2000, 30000); // 基础3秒 + 每台2秒，上限30秒
  const retryBudgetMs = Math.min(qty * 3000, 30000); // 详情重试独立预算：每台3秒，上限30秒
  const pollInterval = 3000;
  const startTime = Date.now();
  let hostItems: Record<string, unknown>[] = [];

  // 注意：此处订单已创建（机器会开通），任何异常都不能让整体判定为"失败"，
  // 否则操作员重试会导致重复开机器。异常时用已获取的部分数据继续。
  try {
    while (Date.now() - startTime < maxWaitMs) {
      const serviceRes = await callIdc('getServiceInfo', '/host/list', 'GET', transformGetServiceInfoParams({ uid }), ctx);
      const data = (serviceRes.data || {}) as Record<string, unknown>;
      const hostList = Array.isArray(data.list) ? (data.list as Record<string, unknown>[]) : [];
      hostItems = orderId
        ? hostList.filter((h) => String(h.orderid) === orderId)
        : [];
      if (hostItems.length === 0) {
        const sorted = [...hostList].sort((a, b) => toNum(b.id) - toNum(a.id));
        hostItems = sorted.slice(0, qty);
      }
      if (hostItems.length >= qty) break;
      await sleep(pollInterval);
    }
  } catch {
    // 轮询请求异常：跳出循环，hostItems 保持已获取的数据（可能为空 → partial）
  }

  if (hostItems.length === 0) {
    // 注意：订单已创建成功，后台会自动开通机器，此分支不能回滚余额
    steps.push({ id: 5, status: 'failed', message: '服务信息获取超时' });
    return {
      success: true,
      partial: true,
      message: '订单已创建（扣款正常），但服务信息获取超时，请稍后在管理页核对开通结果，切勿立即重复开通',
      data: { orderId, results: [] as ProvisionResultItem[], steps, rechargedAmount: recharged },
    };
  }

  // ===== 逐台获取详情（IP、账号、密码） =====
  const results: ProvisionResultItem[] = [];
  for (const hostItem of hostItems) {
    const hid = toNum(hostItem.id);
    const base: ProvisionResultItem = {
      orderId, ip: '', username: '', password: '',
      hostId: String(hid), uid: String(uid), dcimid: '',
      nextduedate: '', amount: '', billingcycle: '',
    };
    try {
      const d = extractHostData(await callIdc('getHostDetail', '/clients_services', 'GET', transformGetHostDetailParams({ uid, hostid: hid }), ctx));
      results.push({
        ...base,
        ip: pickServerIp(d),
        username: String(d.username || ''),
        password: String(d.password || ''),
        dcimid: String(d.dcimid || ''),
        nextduedate: d.nextduedate === undefined || d.nextduedate === null ? '' : String(d.nextduedate),
        amount: d.amount === undefined || d.amount === null ? '' : String(d.amount),
        billingcycle: String(d.billingcycle || ''),
      });
    } catch {
      results.push(base);
    }
  }

  // 对缺少IP或用户名的产品重试获取详情（财务系统可能还在处理）
  let incomplete = results.map((r, i) => (!r.ip || !r.username ? i : -1)).filter((i) => i >= 0);
  if (incomplete.length > 0) {
    const retryStart = Date.now();
    for (let retry = 0; retry < 4 && incomplete.length > 0 && Date.now() - retryStart < retryBudgetMs; retry++) {
      await sleep(pollInterval);
      const still: number[] = [];
      for (const idx of incomplete) {
        const cur = results[idx];
        try {
          const d = extractHostData(await callIdc('getHostDetail', '/clients_services', 'GET', transformGetHostDetailParams({ uid, hostid: cur.hostId }), ctx));
          const ip = pickServerIp(d);
          if (ip && d.username) {
            results[idx] = {
              ...cur,
              ip,
              username: String(d.username || cur.username),
              password: String(d.password || cur.password),
              dcimid: String(d.dcimid || cur.dcimid),
              nextduedate: cur.nextduedate || String(d.nextduedate || ''),
              amount: cur.amount || String(d.amount || ''),
              billingcycle: cur.billingcycle || String(d.billingcycle || ''),
            };
          } else {
            still.push(idx);
          }
        } catch {
          still.push(idx);
        }
      }
      incomplete = still;
    }
  }

  const ips = results.map((r) => r.ip).filter(Boolean);
  const incompleteCount = results.filter((r) => !r.ip || !r.username).length;
  if (incompleteCount > 0) {
    steps.push({ id: 5, status: 'completed', message: `已获取 ${ips.length}/${results.length} 台信息，${incompleteCount}台仍在开通中` });
  } else {
    steps.push({ id: 5, status: 'completed', message: ips.length > 0 ? `服务已开通 IP:${ips.join(', ')}` : `服务已开通(${results.length}台)` });
  }

  return {
    success: true,
    message: incompleteCount > 0
      ? `${incompleteCount}台服务器信息暂未就绪，可稍后在管理页查看`
      : '一键开通成功！云服务器已自动开通',
    data: { orderId, results, steps, rechargedAmount: recharged },
  };
}
