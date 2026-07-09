import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { MonitorConfig, MonitorLog } from './node-monitor-types';

const DATA_DIR = join(process.cwd());
const CONFIG_PATH = join(DATA_DIR, 'node-monitor-config.json');
const LOGS_PATH = join(DATA_DIR, 'node-monitor-logs.json');

const MAX_LOGS = 1000;
const FLUSH_DELAY = 2000;

const DEFAULT_CONFIG: MonitorConfig = {
  globalEnabled: false,
  rules: [],
};

let logCache: MonitorLog[] | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function ensureLogCacheLoaded(): void {
  if (logCache !== null) return;
  try {
    if (existsSync(LOGS_PATH)) {
      const raw = readFileSync(LOGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      logCache = Array.isArray(parsed) ? parsed : [];
    } else {
      logCache = [];
    }
  } catch {
    logCache = [];
  }
}

function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushLogs();
  }, FLUSH_DELAY);
}

export function flushLogs(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (logCache === null) return;
  try {
    writeFileSync(LOGS_PATH, JSON.stringify(logCache, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

export function readConfig(): MonitorConfig {
  try {
    if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      globalEnabled: parsed.globalEnabled ?? false,
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: MonitorConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function readLogs(): MonitorLog[] {
  ensureLogCacheLoaded();
  return [...logCache!];
}

export function appendLog(log: MonitorLog): void {
  ensureLogCacheLoaded();
  logCache!.unshift(log);
  if (logCache!.length > MAX_LOGS) {
    logCache! = logCache!.slice(0, MAX_LOGS);
  }
  scheduleFlush();
}

export function clearLogs(): void {
  logCache = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  writeFileSync(LOGS_PATH, '[]', 'utf-8');
}
