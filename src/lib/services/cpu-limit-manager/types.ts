/**
 * CPU 限制管理 - 类型定义
 *
 * 设计参考 bandwidth-manager，但与带宽限制的关键差异：
 * - CPU 限制接口 (clouds/:id/cpu_limit) 无 temp_expire_time 参数
 * - 需自建时间监控（cpu_limit_events 表）+ 到期自动解除调度器
 * - 排序指标为实例实时 CPU 使用率（cpu_usage，0-100）
 */

/** 节点监控指标（复用 node-monitor 定义） */
export type CpuLimitMetric = 'cpu' | 'memory' | 'disk';

/** 日志事件类型 */
export type CpuLimitEventType =
  | 'rule_create'
  | 'rule_update'
  | 'rule_delete'
  | 'limit_trigger'    // 触发限制（已派发任务）
  | 'limit_execute'    // 限制执行结果
  | 'limit_release'    // 限制解除（到期自动/手动）
  | 'limit_skip';      // 跳过（冷却中/无实例/已在限制中）

export type CpuLimitResult = 'success' | 'failed' | 'skipped';

/** 活跃事件状态
 *  - active: 限制生效中
 *  - released: 已正常解除（调用了 release API 设为 100%）
 *  - superseded: 被新的限制事件替代（不调 release API，避免覆盖新限制值）
 *  - failed: 解除失败（超过最大重试次数）
 */
export type CpuLimitEventStatus = 'active' | 'released' | 'superseded' | 'failed';

/** 惩罚模式：multiply=时长翻倍, add_extra=额外增加分钟数 */
export type CpuLimitPenaltyMode = 'multiply' | 'add_extra';

/** 告警级别 */
export type CpuLimitAlertLevel = 'instance' | 'node';

/** CPU 限制规则 */
export interface CpuLimitRule {
  id: string;
  name: string;
  /** 目标节点 ID 列表 */
  nodeIds: number[];
  /** 节点监控指标 */
  metric: CpuLimitMetric;
  /** 节点指标触发上限（百分比，0-100） */
  threshold: number;
  /** 限制的实例数量（Top N） */
  topN: number;
  /** CPU 限制百分比（1-100，100=无限制） */
  cpuLimitPercent: number;
  /** 限制持续时间（分钟），到期自动解除 */
  durationMin: number;
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
  /** 节点并发限制上限：该规则对节点当前正在限制的实例数上限（0=不限制）
   *  统计的是 status='active' 的事件数，防止 CPU 持续超阈值时无限制限制实例 */
  maxActiveInstances: number;
  /** 是否启用惩罚机制 */
  penaltyEnabled: boolean;
  /** 惩罚统计窗口（分钟） */
  penaltyWindowMin: number;
  /** 惩罚触发阈值：实例在窗口内被限制次数达到此值后开始惩罚 */
  penaltyThreshold: number;
  /** 惩罚模式（时间惩罚） */
  penaltyMode: CpuLimitPenaltyMode;
  /** 惩罚值：multiply=倍数, add_extra=额外分钟数 */
  penaltyValue: number;
  /** CPU 限制值惩罚模式：multiply=每次降低到 1/value, add_extra=每次降低 value% */
  penaltyCpuLimitMode: CpuLimitPenaltyMode;
  /** CPU 限制值惩罚值：multiply=除数(2=每次减半), add_extra=每次降低的百分比 */
  penaltyCpuLimitValue: number;
  /** CPU 限制最低百分比（1-100）：惩罚后至少保留此 CPU 限制值，防止实例卡死 */
  minCpuLimitPercent: number;
}

/** 单台实例的处理结果 */
export interface CpuInstanceResult {
  cloudId: number;
  cloudName: string;
  /** 实例实时 CPU 使用率（0-100） */
  cpuUsage: number;
  /** 限制前的 CPU 限制值（从实例详情获取，可能为空） */
  cpuLimitBefore?: number;
  /** 限制后的 CPU 限制值 */
  cpuLimitAfter: number;
  /** 是否实际执行了限制 */
  limited: boolean;
  /** 处理原因 */
  reason: 'top_n' | 'already_limited' | 'in_cooldown' | 'error' | 'no_data' | 'at_min_limit';
  /** 错误信息 */
  error?: string;
  /** 是否触发了惩罚（基于当前值单步降低或首次达阈值） */
  penalized?: boolean;
  /** 实际限制时长（分钟），惩罚时可能与规则 durationMin 不同 */
  actualDurationMin?: number;
}

/** CPU 限制活跃事件 */
export interface CpuLimitEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  nodeId: number;
  nodeName: string;
  cloudId: number;
  cloudName: string;
  /** 限制时的百分比 */
  cpuLimitPercent: number;
  /** 限制开始时间戳 */
  startTime: number;
  /** 限制到期时间戳 */
  expireTime: number;
  /** 状态 */
  status: CpuLimitEventStatus;
  /** 解除时间戳 */
  releasedAt?: number;
  /** 解除失败原因 */
  releaseError?: string;
  /** 实际限制时长（分钟），惩罚时可能与规则 durationMin 不同 */
  actualDurationMin?: number;
  /** 是否为惩罚限制（记录用于审计） */
  penalized?: boolean;
  /** 解除重试次数 */
  releaseRetryCount?: number;
}

/** CPU 限制操作日志 */
export interface CpuLimitLog {
  id: string;
  ts: number;
  ruleId: string;
  ruleName: string;
  nodeId: number;
  nodeName: string;
  eventType: CpuLimitEventType;
  /** 触发时的节点指标值 */
  metricValue?: number;
  /** 规则阈值 */
  threshold?: number;
  topN?: number;
  affectedCount?: number;
  /** 详细信息（JSON 字符串：实例列表等） */
  details?: string;
  result: CpuLimitResult;
  error?: string;
}

/** 服务状态 */
export interface CpuLimitServiceStatus {
  running: boolean;
  isChecking: boolean;
  checkIntervalMs: number;
  nextCheckAt: number | null;
  ruleCount: number;
  activeRuleCount: number;
  lastCheckAt: number | null;
  /** 正在执行的限速任务数 */
  activeTasks: number;
  /** 当前活跃的 CPU 限制事件数 */
  activeEventCount: number;
  /** 自动解除调度器运行状态 */
  releaseSchedulerRunning: boolean;
}

/** 限速执行器输入参数 */
export interface CpuLimitExecutorInput {
  rule: CpuLimitRule;
  nodeId: number;
  nodeName: string;
  /** 触发时的节点指标值 */
  metricValue: number;
  /** 当前活跃限制的实例信息：key=cloudId, value=当前CPU限制值/到期时间/事件ID
   *  用于实现"限速时间内再次触发则惩罚"：基于当前实际限制值进一步降低 */
  activeLimits: Map<number, { cpuLimit: number; expireTime: number; eventId: string; actualDurationMin?: number }>;
}

/** 限速执行器输出结果 */
export interface CpuLimitExecutorOutput {
  success: boolean;
  affectedCount: number;
  instances: CpuInstanceResult[];
  /** 新创建的活跃事件（写入 cpu_limit_events 表） */
  newEvents: Array<Omit<CpuLimitEvent, 'id' | 'status' | 'releasedAt' | 'releaseError' | 'releaseRetryCount'>>;
  /** 被新限制替代的旧事件 ID 列表（需标记为 superseded，不调用 release API） */
  supersededEventIds: string[];
  error?: string;
  /** 是否因节点实例上限跳过 */
  skippedByNodeLimit?: boolean;
}

// ─── 告警系统类型 ──────────────────────────────────────────

/** CPU 限制告警配置（单行配置） */
export interface CpuLimitAlertConfig {
  /** 是否启用告警 */
  enabled: boolean;
  /** 统计时间窗口（分钟） */
  windowMin: number;
  /** 实例触发限制次数阈值 */
  instanceThreshold: number;
  /** 节点触发限制次数阈值 */
  nodeThreshold: number;
}

/** CPU 限制告警记录 */
export interface CpuLimitAlertLog {
  id: string;
  ts: number;
  level: CpuLimitAlertLevel;
  ruleName: string;
  nodeId: number;
  nodeName: string;
  cloudId?: number;
  cloudName?: string;
  triggerCount: number;
  threshold: number;
  windowMin: number;
  read: boolean;
}
