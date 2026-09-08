import { NextResponse } from 'next/server';
import { ModuleHandler, IdcRequestContext } from '../../shared/types';
import { orderActions } from './actions';
import { transformGetTotalParams, transformCreateOrderParams } from './transformers';
import { handleOneClickProvision } from './one-click';

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

  async handleSpecialAction(action: string, params: Record<string, unknown>, ctx: IdcRequestContext): Promise<NextResponse | null> {
    if (action === 'oneClickProvision') {
      return handleOneClickProvision(params, ctx);
    }
    return null;
  }
}
