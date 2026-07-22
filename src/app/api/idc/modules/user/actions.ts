import { ApiActionDef } from '../../shared/types';

export const userActions: Record<string, ApiActionDef> = {
  'searchUser': { path: '/client_list', method: 'POST' },
  'addBalance': { path: '/credit', method: 'POST' },
  'deductBalance': { path: '/credit/reduce', method: 'POST' },
  'getUserDetail': { path: '/summary', method: 'GET' },
  'certifiPerson': { path: '/certifi_person_detail/:client_id', method: 'GET' },
};
