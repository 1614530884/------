/**
 * 智能带宽管理 - 类型定义
 */

/** 带宽监控指标：上行 / 下行（保留用于 getNodeBandwidth 查询） */
export type BandwidthMetric = 'bandwidth_up' | 'bandwidth_down';

/** 限速模式：按当前带宽百分比 / 固定 Mbps */
export type BandwidthLimitMode = 'percent' | 'fixed';

/** 惩罚模式：multiply=时长/降低比例翻倍, add_extra=额外增加分钟数/降低比例 */
export type BandwidthPenaltyMode = 'multiply' | 'add_extra';

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

  // ── 惩罚机制 ──
  /** 是否启用惩罚机制（时间+带宽双重惩罚） */
  penaltyEnabled: boolean;
  /** 惩罚统计窗口（分钟） */
  penaltyWindowMin: number;
  /** 惩罚触发阈值：实例在窗口内被限速次数达到此值后开始惩罚 */
  penaltyThreshold: number;
  /** 惩罚模式（时间惩罚） */
  penaltyMode: BandwidthPenaltyMode;
  /** 时间惩罚值：multiply=倍数, add_extra=额外分钟数 */
  penaltyValue: number;
  /** 带宽惩罚模式（独立于时间惩罚，基于当前实际带宽单步降低） */
  penaltyBwMode: BandwidthPenaltyMode;
  /** 带宽惩罚值：multiply=除数(当前÷N), add_extra=减数(当前-N Mbps) */
  penaltyBwValue: number;
  /** 最低带宽保留（Mbps）：惩罚后带宽不低于此值，达到后不再降低 */
  minBandwidthMbps: number;
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
  reason: 'top_n' | 'continuous_filtered' | 'already_limited' | 'at_min_limit' | 'in_cooldown' | 'error' | 'no_data';
  /** 错误信息（reason=error 时） */
  error?: string;
  /** 是否触发惩罚（惩罚时长/降低比例与规则基础值不同） */
  penalized?: boolean;
  /** 实际限速时长（分钟），惩罚时可能与规则 durationMin 不同 */
  actualDurationMin?: number;
  /** 实际带宽降低比例（%），惩罚时可能与规则 reducePercent 不同 */
  actualReducePercent?: number;
  /** 限速到期时间戳（事件跟踪用） */
  expireTime?: number;
  /** 被替代的旧事件 ID（限速时间内再次限速时，旧事件需标记 superseded） */
  supersededEventId?: string;
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
  /** 到期恢复调度器是否运行 */
  releaseSchedulerRunning: boolean;
  /** 当前活跃限速事件数 */
  activeEventCount: number;
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
  /** 当前活跃限制事件（key=cloudId），用于限速内再惩罚 + 原始带宽继承 */
  activeLimits?: Map<number, {
    inBw: number; outBw: number; expireTime: number; eventId: string;
    actualDurationMin?: number; limitDirection?: 'in' | 'out' | 'both';
    originalInBw?: number; originalOutBw?: number;
  }>;
}

/** 限速执行器输出结果 */
export interface LimitExecutorOutput {
  success: boolean;
  affectedCount: number;
  instances: BandwidthInstanceResult[];
  error?: string;
  /** 新建的活跃事件列表（限速成功的实例，service 写入 DB 供 release-scheduler 跟踪） */
  newEvents?: Array<Omit<BandwidthLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>>;
  /** 被替代的旧事件 ID 列表（service 标记为 superseded） */
  supersededEventIds?: string[];
}

// ─── 告警系统类型 ──────────────────────────────────────────

/** 告警级别 */
export type BandwidthAlertLevel = 'instance' | 'node';

/** 告警配置 */
export interface BandwidthAlertConfig {
  /** 是否启用告警 */
  enabled: boolean;
  /** 统计时间窗口（分钟），如 60 表示最近60分钟内 */
  windowMin: number;
  /** 实例触发限速次数阈值（时间窗口内同一实例被限速达此次数则告警） */
  instanceThreshold: number;
  /** 节点触发限速次数阈值（时间窗口内同一节点下所有实例被限速达此次数则告警） */
  nodeThreshold: number;
}

/** 告警记录 */
export interface BandwidthAlertLog {
  id: string;
  /** 告警生成时间戳 */
  ts: number;
  /** 告警级别：instance=实例级, node=节点级 */
  level: BandwidthAlertLevel;
  /** 关联的规则名称 */
  ruleName: string;
  /** 节点 ID */
  nodeId: number;
  /** 节点名称 */
  nodeName: string;
  /** 实例 ID（instance 级别时有值） */
  cloudId?: number;
  /** 实例名称（instance 级别时有值） */
  cloudName?: string;
  /** 时间窗口内实际触发次数 */
  triggerCount: number;
  /** 配置的阈值 */
  threshold: number;
  /** 时间窗口（分钟） */
  windowMin: number;
  /** 是否已读 */
  read: boolean;
}

/** 限速事件状态（与 CPU 限制事件对齐） */
export type BandwidthEventStatus = 'active' | 'released' | 'superseded' | 'failed';

/** 限速事件记录（用于跟踪活跃限制 + 到期自动恢复 + 告警统计） */
export interface BandwidthLimitEvent {
  id: string;
  /** 事件时间戳（兼容旧字段，新事件=start_time） */
  ts: number;
  /** 规则 ID */
  ruleId: string;
  /** 规则名称 */
  ruleName: string;
  /** 节点 ID */
  nodeId: number;
  /** 节点名称 */
  nodeName: string;
  /** 实例 ID */
  cloudId: number;
  /** 实例名称 */
  cloudName: string;
  // ── 新增字段（直接调控 + 到期恢复） ──
  /** 事件状态 */
  status?: BandwidthEventStatus;
  /** 限速开始时间戳 */
  startTime?: number;
  /** 限速到期时间戳（release-scheduler 拾取） */
  expireTime?: number;
  /** 原始入站带宽（Mbps），到期恢复用 */
  originalInBw?: number | null;
  /** 原始出站带宽（Mbps），到期恢复用 */
  originalOutBw?: number | null;
  /** 限速后入站带宽（Mbps） */
  newInBw?: number | null;
  /** 限速后出站带宽（Mbps） */
  newOutBw?: number | null;
  /** 限速方向：in=入站, out=出站, both=双向 */
  limitDirection?: 'in' | 'out' | 'both' | null;
  /** 实际限速时长（分钟），惩罚时可能与规则 durationMin 不同 */
  actualDurationMin?: number | null;
  /** 是否触发惩罚 */
  penalized?: boolean;
  /** 解除重试次数（API 失败时指数退避） */
  releaseRetryCount?: number;
  /** 解除时间戳 */
  releasedAt?: number | null;
  /** 解除错误信息 */
  releaseError?: string | null;
}
