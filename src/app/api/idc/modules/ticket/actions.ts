import { ApiActionDef } from '../../shared/types';

export const ticketActions: Record<string, ApiActionDef> = {
  'ticketList':           { path: '/list_ticket',             method: 'GET'  },
  'ticketDetail':         { path: '/list_ticket/:id',         method: 'GET'  },
  'ticketReply':          { path: '/reply_ticket',            method: 'POST' },
  'ticketClose':          { path: '/close_ticket',            method: 'POST' },
  'ticketTransfer':       { path: '/ticket_transfer',         method: 'PUT'  },
  'ticketTransferList':   { path: '/ticket_transfer_list',    method: 'GET'  },
  'ticketReceive':        { path: '/ticket_receive',          method: 'PUT'  },
  'ticketSave':           { path: '/save_ticket',             method: 'POST' },
  'ticketAddNote':        { path: '/add_ticket_note',         method: 'POST' },
  'ticketDelete':         { path: '/delete_ticket',           method: 'POST' },
  'ticketDetailHost':     { path: '/ticket_detail_host',      method: 'GET'  },
  'ticketStatistics':     { path: '/ticket_statistics',       method: 'GET'  },
  'clientTicketList':     { path: '/client_ticket',           method: 'GET'  },
  'ticketStatusList':     { path: '/list_ticket_status',      method: 'GET'  },
  'ticketDepartmentList': { path: '/list_ticket_department',  method: 'GET'  },
};
