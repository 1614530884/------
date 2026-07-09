const provisionFuncMap: Record<string, string> = {
  provisionStatus: 'status',
  provisionOn: 'on',
  provisionOff: 'off',
  provisionReboot: 'reboot',
  provisionHardOff: 'hard_off',
  provisionHardReboot: 'hard_reboot',
  provisionVnc: 'vnc',
  provisionReinstall: 'reinstall',
  provisionCrackPass: 'crack_pass',
  provisionSuspend: 'suspend',
  provisionUnsuspend: 'unsuspend',
  provisionSync: 'sync',
};

export function isProvisionAction(action: string): boolean {
  return action in provisionFuncMap;
}

export function transformProvisionParams(action: string, params: Record<string, unknown>): Record<string, unknown> {
  const func = provisionFuncMap[action];
  if (!func) return params;

  const extraParams = { ...params };
  delete extraParams.id;
  delete extraParams.hostid;

  return {
    id: params.id || params.hostid,
    func,
    ...extraParams,
  };
}
