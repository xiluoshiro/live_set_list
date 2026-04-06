export type LogLevel = "info" | "warn" | "error";

export type LogPayload = Record<string, unknown>;

export type FrontendLogEntry = {
  timestamp: string;
  level: LogLevel;
  event: string;
  payload: LogPayload;
};

export const FRONTEND_LOG_STORAGE_KEY = "live-set-list-logs";
const MAX_LOG_ENTRIES = 200;

function getStoredLogs(): FrontendLogEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(FRONTEND_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FrontendLogEntry[]) : [];
  } catch {
    return [];
  }
}

function persistLog(entry: FrontendLogEntry): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    // 维持一个很小的本地环形日志，方便现场排查。
    const logs = getStoredLogs();
    const nextLogs = [...logs, entry].slice(-MAX_LOG_ENTRIES);
    window.localStorage.setItem(FRONTEND_LOG_STORAGE_KEY, JSON.stringify(nextLogs));
  } catch {
    // 日志系统本身不应影响页面主流程。
  }
}

function writeLog(level: LogLevel, event: string, payload: LogPayload = {}): void {
  const entry: FrontendLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    payload,
  };

  try {
    // 第一版优先保证开发时可见性，直接复用浏览器控制台。
    const consoleMethod = level === "info" ? console.info : level === "warn" ? console.warn : console.error;
    consoleMethod("[live-set-list]", event, payload);
  } catch {
    // 控制台打印失败时也不阻断主流程。
  }

  persistLog(entry);
}

export function logInfo(event: string, payload: LogPayload = {}): void {
  writeLog("info", event, payload);
}

export function logWarn(event: string, payload: LogPayload = {}): void {
  writeLog("warn", event, payload);
}

export function logError(event: string, payload: LogPayload = {}): void {
  writeLog("error", event, payload);
}
