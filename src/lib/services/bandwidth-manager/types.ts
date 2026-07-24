/**
 * 智能带宽管理 - 类型定义
 */

/** 带宽监控指标：上行 / 下行（保留用于 getNodeBandwidth 查询） */
export type BandwidthMetric = 'bandwidth_up' | 'bandwidth_down';

/** 限速模式：按当前带宽百分比 / 固定 Mbps */
export type BandwidthLimitMode = 'percent' | 'fixed';

/** 日志事件类型 */
export type BandwidthEventType =
  | 'rule_create'
  | 'rule_update'
  | 'rule_delete'
  | 'limit_trigger'   // 触发限速（已派发任务）
  | 'limit_execute'   // 限速执行结果
  | 'limit_release'   // 限速解除（到期自动恢复时记录）
  | 'limit_skip';     // 跳过限速（冷却中/无实例/持续过滤后为空）

export type BandwidthResult = 'success' | 'failed' | 'skipped';

/** 智能带宽规则 */
export interface BandwidthRule {
  id: string;
  name: string;
  /** 目标节点 ID 列表 */
  nodeIds: number[];
  /** 上行（出站）带宽阈值，单位 bps。undefined = 不监控上行 */
  thresholdUp?: number;
  /** 下行（入站）带宽阈值，单位 bps。undefined = 不监控下行 */
  thresholdDown?: number;
  /** 限速的实例数量（Top N） */
  topN: number;
  /** 限速模式 */
  limitMode: BandwidthLimitMode;
  /** 限速值：percent 模式为百分比(1-100)，fixed 模式为 Mbps */
  limitValue: number;
  /** 是否开启持续监控二次过滤 */
  continuousEnabled: boolean;
  /** 持续监控时间窗口（分钟） */
  continuousWindowMin?: number;
  /** 持续监控带宽使用率百分比（0-100） */
  continuousPercent?: number;
  /** 临时限速持续时间（分钟），到期自动恢复 */
  durationMin: number;
  /** 带宽降低比例（1-100），用于日志审计 */
  reducePercent: number;
  /** 检查间隔（秒） */
  interval: number;
  /** 冷却时间（秒） */
  cooldown: number;
  /** 连续触发次数 */
  triggerCount: number;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳 */
  createdAt: number;
}

/** 限速执行器：单台实例的处理结果 */
export interface BandwidthInstanceResult {
  cloudId: number;
  cloudName: string;
  /** 限速前带宽（Mbps）— 兼容字段，同 realtimeBwMbps */
  bandwidthBefore: number;
  /** 限速后带宽（Mbps） */
  bandwidthAfter: number;
  /** 触发限速时的实时带宽值（Mbps） */
  realtimeBwMbps: number;
  /** 原始入站带宽配置 */
  originalInBw?: number;
  /** 原始出站带宽配置 */
  originalOutBw?: number;
  /** 限速后的入站带宽配置 */
  newInBw?: number;
  /** 限速后的出站带宽配置 */
  newOutBw?: number;
  /** 限速方向：in=入站, out=出站, both=双向 */
  limitDirection?: 'in' | 'out' | 'both';
  /** 是否实际执行了限速 */
  limited: boolean;
  /** 处理原因 */
  reason: 'top_n' | 'continuous_filtered' | 'already_limited' | 'in_cooldown' | 'error' | 'no_data';
  /** 错误信息（reason=error 时） */
  error?: string;
}

/** 智能带宽管理日志 */
export interface BandwidthLog {
  id: string;
  /** 时间戳 */
  ts: number;
  ruleId: string;
  ruleName: string;
  nodeId: number;
  nodeName: string;
  eventType: BandwidthEventType;
  /** 触发时的节点带宽数值（bps），兼容旧日志 */
  metricValue?: number;
  /** 触发时的节点上行带宽数值（bps） */
  metricValueUp?: number;
  /** 触发时的节点下行带宽数值（bps） */
  metricValueDown?: number;
  /** Top N 配置 */
  topN?: number;
  /** 实际限速实例数 */
  affectedCount?: number;
  /** 详细信息（实例限速前后对比等） */
  details?: {
    instances?: BandwidthInstanceResult[];
    /** 关联的 task ID（limit_execute 事件） */
    taskId?: string;
    /** 触发时规则的上行阈值（bps），历史快照 */
    thresholdUp?: number;
    /** 触发时规则的下行阈值（bps），历史快照 */
    thresholdDown?: number;
    /** 触发方向标识：up/down/both */
    triggerDirection?: 'up' | 'down' | 'both';
  };
  result: BandwidthResult;
  error?: string;
}

/** 服务状态 */
export interface BandwidthServiceStatus {
  running: boolean;
  isChecking: boolean;
  checkIntervalMs: number;
  nextCheckAt: number | null;
  ruleCount: number;
  activeRuleCount: number;
  lastCheckAt: number | null;
  /** 正在执行的限速任务数 */
  activeTasks: number;
}

/** 限速执行器输入参数（由 service 派发给 limit-executor） */
export interface LimitExecutorInput {
  rule: BandwidthRule;
  nodeId: number;
  nodeName: string;
  /** 上行是否触发 */
  triggerUp: boolean;
  /** 下行是否触发 */
  triggerDown: boolean;
  /** 触发时的节点上行带宽数值（bps） */
  metricValueUp: number;
  /** 触发时的节点下行带宽数值（bps） */
  metricValueDown: number;
  /** 登录用户（用于解析魔方云账号） */
  loginUser?: string;
  /** 每台机器的最近限速时间戳（用于 per-machine 冷却判断），key=cloudId */
  machineLimitTime?: Map<number, number>;
}

/** 限速执行器输出结果 */
export interface LimitExecutorOutput {
  success: boolean;
  affectedCount: number;
  instances: BandwidthInstanceResult[];
  error?: string;
}
