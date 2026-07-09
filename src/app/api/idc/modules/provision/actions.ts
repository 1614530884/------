import { ApiActionDef } from '../../shared/types';

export const provisionActions: Record<string, ApiActionDef> = {
  'provisionStatus': { path: '/provision/default', method: 'POST' },
  'provisionOn': { path: '/provision/default', method: 'POST' },
  'provisionOff': { path: '/provision/default', method: 'POST' },
  'provisionReboot': { path: '/provision/default', method: 'POST' },
  'provisionHardOff': { path: '/provision/default', method: 'POST' },
  'provisionHardReboot': { path: '/provision/default', method: 'POST' },
  'provisionVnc': { path: '/provision/default', method: 'POST' },
  'provisionReinstall': { path: '/provision/default', method: 'POST' },
  'provisionCrackPass': { path: '/provision/default', method: 'POST' },
  'provisionSuspend': { path: '/provision/default', method: 'POST' },
  'provisionUnsuspend': { path: '/provision/default', method: 'POST' },
  'provisionSync': { path: '/provision/default', method: 'POST' },
};
