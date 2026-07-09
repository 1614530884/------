import { ModuleHandler } from '../../shared/types';
import { productActions } from './actions';
import { transformProductListParams, transformProductCyclesParams, transformProductConfigParams } from './transformers';

export class ProductModule implements ModuleHandler {
  getActions() {
    return productActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'getProductList':
        return transformProductListParams();
      case 'getProductCycles':
        return transformProductCyclesParams(params);
      case 'getProductConfig':
        return transformProductConfigParams(params);
      default:
        return params;
    }
  }
}
