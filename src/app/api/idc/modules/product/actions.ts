import { ApiActionDef } from '../../shared/types';

export const productActions: Record<string, ApiActionDef> = {
  'getProductConfig': { path: '/orders/set_config', method: 'GET' },
  'getProductList': { path: '/product_list_page', method: 'GET' },
  'getProductCycles': { path: '/order/create_page', method: 'GET' },
  'getGateways': { path: '/common/get_getways', method: 'GET' },
  'product/list': { path: '/product/index', method: 'POST' },
  'product/detail': { path: '/product/detail', method: 'POST' },
  'product/config': { path: '/product/config', method: 'POST' },
};
