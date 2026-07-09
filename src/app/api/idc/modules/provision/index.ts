import { ModuleHandler } from '../../shared/types';
import { provisionActions } from './actions';
import { isProvisionAction, transformProvisionParams } from './transformers';

export class ProvisionModule implements ModuleHandler {
  getActions() {
    return provisionActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    if (isProvisionAction(action)) {
      return transformProvisionParams(action, params);
    }
    return params;
  }
}
