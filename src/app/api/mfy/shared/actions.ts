export interface MfyActionDef {
  path: string;
  method: string;
  pathHasId?: boolean;
}

export const actionMap: Record<string, MfyActionDef> = {
  // 实例管理
  'cloudDetail': { path: 'clouds/{id}', method: 'GET', pathHasId: true },
  'cloudStatus': { path: 'clouds/{id}/status', method: 'GET', pathHasId: true },
  'cloudList': { path: 'clouds', method: 'GET' },
  'globalSearch': { path: 'global_search', method: 'GET' },
  'userCloudList': { path: 'clouds', method: 'GET' },

  // 电源操作
  'cloudOn': { path: 'clouds/{id}/on', method: 'POST', pathHasId: true },
  'cloudOff': { path: 'clouds/{id}/off', method: 'POST', pathHasId: true },
  'cloudHardOff': { path: 'clouds/{id}/hardoff', method: 'POST', pathHasId: true },
  'cloudReboot': { path: 'clouds/{id}/reboot', method: 'POST', pathHasId: true },
  'cloudHardReboot': { path: 'clouds/{id}/hard_reboot', method: 'POST', pathHasId: true },
  'cloudSuspend': { path: 'clouds/{id}/suspend', method: 'POST', pathHasId: true },
  'cloudUnsuspend': { path: 'clouds/{id}/unsuspend', method: 'POST', pathHasId: true },

  // VNC
  'cloudVnc': { path: 'clouds/{id}/vnc', method: 'POST', pathHasId: true },

  // 密码与重装
  'cloudResetPassword': { path: 'clouds/{id}/password', method: 'PUT', pathHasId: true },
  'cloudReinstall': { path: 'clouds/{id}/reinstall', method: 'PUT', pathHasId: true },

  // 救援模式
  'cloudRescue': { path: 'clouds/{id}/rescue', method: 'POST', pathHasId: true },
  'cloudRescueExit': { path: 'clouds/{id}/rescue', method: 'DELETE', pathHasId: true },

  // 配置修改
  'cloudUpdate': { path: 'clouds/{id}', method: 'PUT', pathHasId: true },
  'cloudUpdateBw': { path: 'clouds/{id}/bw', method: 'PUT', pathHasId: true },
  'cloudUpdateIp': { path: 'clouds/{id}/ip', method: 'PUT', pathHasId: true },
  'cloudUpdateIpv6': { path: 'clouds/{id}/ipv6', method: 'PUT', pathHasId: true },
  'cloudSetMainIp': { path: 'clouds/{id}/mainip', method: 'POST', pathHasId: true },

  // 流量统计
  'cloudTraffic': { path: 'clouds/{id}/flow', method: 'GET', pathHasId: true },
  'cloudFlowData': { path: 'clouds/{id}/flow_data', method: 'GET', pathHasId: true },

  // IP管理
  'cloudIpv6': { path: 'clouds/{id}/ipv6', method: 'GET', pathHasId: true },
  'cloudIpMac': { path: 'clouds/{id}/ip_mac', method: 'GET', pathHasId: true },
  'cloudAddFloatIp': { path: 'clouds/{id}/floatip', method: 'POST', pathHasId: true },
  'cloudIpDelete': { path: 'clouds/{id}/floatip', method: 'DELETE', pathHasId: true },
  'cloudNetworkType': { path: 'clouds/{id}/network_type', method: 'PUT', pathHasId: true },
  'cloudVpcNetworks': { path: 'clouds/{id}/vpc_networks', method: 'PUT', pathHasId: true },
  'vpcNetworkList': { path: 'vpc_networks', method: 'GET' },

  // 磁盘管理
  'diskList': { path: 'clouds/{id}', method: 'GET', pathHasId: true },
  'diskCreate': { path: 'clouds/{id}/disks', method: 'POST', pathHasId: true },
  'diskDelete': { path: 'disks/{diskId}', method: 'DELETE' },
  'diskUpdate': { path: 'disks/{diskId}', method: 'PUT' },
  'diskMount': { path: 'disks/{diskId}/mount', method: 'POST' },
  'diskUnmount': { path: 'clouds/{id}/disks/{diskId}', method: 'DELETE', pathHasId: true },
  'diskStores': { path: 'disk_cleaner/stores', method: 'GET' },
  'netInfo': { path: 'net_info', method: 'GET' },
  'cloudRebuild': { path: 'clouds/{id}/rebuild', method: 'PUT', pathHasId: true },
  'cloudChartTotal': { path: 'clouds/{id}/chart_total', method: 'GET', pathHasId: true },

  // 监控图表
  'statistics': { path: 'statistics', method: 'GET' },
  'realDataList': { path: 'clouds/real_data', method: 'POST' },

  // RDP下载
  'downloadRdp': { path: 'clouds/{id}/download_rdp', method: 'GET', pathHasId: true },

  // 镜像管理
  'imageList': { path: 'image', method: 'GET' },
  'imageNewList': { path: 'images/new_list', method: 'GET' },
  'systemImages': { path: 'images/system', method: 'GET' },
  'customImages': { path: 'images/custom', method: 'GET' },
  'imageGroupList': { path: 'imageGroup', method: 'GET' },

  // 快照/备份
  'snapshotList': { path: 'clouds/{id}/snapshots', method: 'GET', pathHasId: true },
  'snapshotCreate': { path: 'disks/{diskId}/snapshots', method: 'POST' },
  'snapshotRestore': { path: 'snapshots/{snapshotId}/restore', method: 'POST' },
  'snapshotDelete': { path: 'snapshots/{snapshotId}', method: 'DELETE' },

  // 安全组
  'securityGroupList': { path: 'security_groups', method: 'GET' },
  'securityGroupCreate': { path: 'security_groups', method: 'POST' },
  'securityGroupDetail': { path: 'security_groups/{id}', method: 'GET', pathHasId: true },
  'securityGroupLink': { path: 'security_groups/{id}/links', method: 'POST', pathHasId: true },
  'securityGroupUnlink': { path: 'clouds/{id}/security_groups', method: 'DELETE', pathHasId: true },
  'securityGroupRules': { path: 'security_groups/{id}/rules', method: 'GET', pathHasId: true },
  'securityGroupRuleCreate': { path: 'security_groups/{id}/rules', method: 'POST', pathHasId: true },
  'securityGroupRuleUpdate': { path: 'security_group_rules/{ruleId}', method: 'PUT' },
  'securityGroupRuleDelete': { path: 'security_group_rules/{ruleId}', method: 'DELETE' },

  // 带宽限速组
  'bwGroupList': { path: 'bws', method: 'GET' },

  // IP池
  'ipFreeList': { path: 'ip/free', method: 'GET' },

  // 日志
  'cloudLog': { path: 'clouds/{id}/log', method: 'GET', pathHasId: true },

  // 任务列表
  'taskList': { path: 'tasks', method: 'GET' },

  // 创建页面参数
  'createPageParams': { path: 'clouds/create_page', method: 'GET' },

  // 节点管理
  'nodeList': { path: 'nodes', method: 'GET' },
  'nodeDetail': { path: 'nodes/{id}', method: 'GET', pathHasId: true },
  'nodeUpdate': { path: 'nodes/{id}', method: 'PUT', pathHasId: true },
  'nodeStatus': { path: 'nodes/{id}/status', method: 'GET', pathHasId: true },
  'nodeRealData': { path: 'nodes/{id}/real_data', method: 'GET', pathHasId: true },

  // IP段管理
  'ipSegmentList': { path: 'ipSegment', method: 'GET' },

  // 回收站
  'restoreRecycleBin': { path: 'recycle_bin', method: 'DELETE' },
};

export const UNSUPPORTED_BATCH_ACTIONS = new Set([
  'testConnection',
  'downloadRdp',
  'diskList',
  'diskStores',
]);
