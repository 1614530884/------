import { NextResponse } from 'next/server';
import { ModuleHandler, IdcRequestContext } from '../../shared/types';
import { userActions } from './actions';
import { transformSearchParams, transformAddBalanceParams, filterSearchResultByUid } from './transformers';

export class UserModule implements ModuleHandler {
  getActions() {
    return userActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'searchUser':
        return transformSearchParams(params);
      case 'addBalance':
        return transformAddBalanceParams(params);
      default:
        return params;
    }
  }

  handleResponse(action: string, result: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
    if (action === 'searchUser' && params.searchParams) {
      return filterSearchResultByUid(result, params);
    }
    return result;
  }
}
