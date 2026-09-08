import { ApiActionDef } from '../../shared/types';

export const orderActions: Record<string, ApiActionDef> = {
  'getTotal': { path: '/get_total', method: 'POST' },
  'createOrder': { path: '/order/create', method: 'POST' },
  // 一键开通编排入口：实际由 OrderModule.handleSpecialAction 短路处理，此定义仅用于路由注册
  'oneClickProvision': { path: '/order/create', method: 'POST' },
  'order/list': { path: '/order/index', method: 'POST' },
  'order/pay': { path: '/order/pay', method: 'POST' },
  'order/detail': { path: '/order/detail', method: 'POST' },
};
