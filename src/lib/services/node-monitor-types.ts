export type MonitorMetric = 'cpu' | 'memory' | 'disk';
export type MonitorOperator = 'above' | 'below' | 'range';
export type MonitorAction = 'enable' | 'disable';

export interface MonitorRule {
  id: string;
  name: string;
  nodeIds: number[];
  metric: MonitorMetric;
  operator: MonitorOperator;
  threshold: number;
  action: MonitorAction;
  // 区间模式: 低于此阈值时触发 actionLow
  thresholdLow?: number;
  actionLow?: MonitorAction;
  interval: number;
  cooldown: number;
  triggerCount: number;
  enabled: boolean;
  createdAt: number;
}

export interface MonitorConfig {
  globalEnabled: boolean;
  rules: MonitorRule[];
}

export type MonitorActionResult = 'success' | 'failed' | 'skipped';

export interface MonitorLog {
  id: string;
  timestamp: number;
  ruleId: string;
  ruleName: string;
  nodeId: number;
  nodeName: string;
  metric: MonitorMetric;
  metricValue: number;
  operator: MonitorOperator;
  threshold: number;
  thresholdLow?: number;
  action: MonitorAction;
  triggerCount: number;
  consecutiveHits: number;
  triggerSide?: 'high' | 'low';
  actionResult: MonitorActionResult;
  actionError?: string;
}

export interface MonitorServiceStatus {
  running: boolean;
  isChecking: boolean;
  checkIntervalMs: number;
  nextCheckAt: number | null;
  ruleCount: number;
  activeRuleCount: number;
  lastCheckAt: number | null;
}
