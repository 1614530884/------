import { ModuleHandler } from '../../shared/types';
import { ticketActions } from './actions';
import {
  transformTicketListParams,
  transformTicketCloseParams,
  transformTicketDeleteParams,
} from './transformers';

export class TicketModule implements ModuleHandler {
  getActions() {
    return ticketActions;
  }

  transformParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
    switch (action) {
      case 'ticketList':
        return transformTicketListParams(params);
      case 'ticketClose':
        return transformTicketCloseParams(params);
      case 'ticketDelete':
        return transformTicketDeleteParams(params);
      default:
        return params;
    }
  }
}
