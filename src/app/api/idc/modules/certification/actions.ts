import { ApiActionDef } from '../../shared/types';

export const certificationActions: Record<string, ApiActionDef> = {
  'certifiLogList':       { path: '/cerify_log_list',                   method: 'GET'  },
  'certifiHistoryLog':    { path: '/cerify_history_log',                method: 'GET'  },
  'certifiStatus':        { path: '/certifi_status',                    method: 'POST' },
  'certifiPersonDetail':  { path: '/certifi_person_detail/:client_id',  method: 'GET'  },
  'certifiCompanyDetail': { path: '/certifi_company_detail/:client_id', method: 'GET'  },
};
