import { ModuleHandler } from '../../shared/types';
import { orderActions } from './actions';
import { transformGetTotalParams, transformCreateOrderParams } from './transformers';

export class OrderModule implements ModuleHandler {
  getActions() {
    return orderActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'getTotal':
        return transformGetTotalParams(params);
      case 'createOrder':
        return transformCreateOrderParams(params);
      default:
        return params;
    }
  }
}
