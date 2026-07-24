/**
 * 智能带宽管理 - 模块导出
 */
export { bandwidthManagerService } from './service';
export { bandwidthRuleStore, bandwidthLogStore } from './store';
export { executeBandwidthLimit } from './limit-executor';
export type {
  BandwidthRule,
  BandwidthLog,
  BandwidthMetric,
  BandwidthLimitMode,
  BandwidthEventType,
  BandwidthResult,
  BandwidthServiceStatus,
  BandwidthInstanceResult,
  LimitExecutorInput,
  LimitExecutorOutput,
} from './types';
