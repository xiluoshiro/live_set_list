import type { DatePhase, EventStatus } from "./api";

export type LiveStatusPresentation = {
  primary: string;
  secondary: string | null;
  tone: "past" | "upcoming" | "today" | "postponed" | "cancelled";
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  scheduled: "按计划",
  postponed: "延期",
  cancelled: "已取消",
};

export const DATE_PHASE_LABELS: Record<DatePhase, string> = {
  upcoming: "待举行",
  today: "进行中",
  past: "已结束",
};

export type PerformanceGroupStatusPresentation = {
  primary: "未开始" | "进行中" | "已结束" | "已取消";
  tone: LiveStatusPresentation["tone"];
};

function toLocalIsoDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getPerformanceGroupStatusPresentation(
  startDate: string | null,
  endDate: string | null,
  cancelledLiveCount: number,
  liveCount: number,
  now = new Date(),
): PerformanceGroupStatusPresentation {
  if (liveCount > 0 && cancelledLiveCount >= liveCount) {
    return { primary: "已取消", tone: "cancelled" };
  }
  const today = toLocalIsoDate(now);
  const normalizedStart = startDate || endDate || today;
  const normalizedEnd = endDate || startDate || normalizedStart;
  if (today < normalizedStart) return { primary: "未开始", tone: "upcoming" };
  if (today > normalizedEnd) return { primary: "已结束", tone: "past" };
  return { primary: "进行中", tone: "today" };
}

export function getLiveStatusPresentation(
  eventStatus: EventStatus,
  datePhase: DatePhase,
  wasRescheduled: boolean,
): LiveStatusPresentation {
  if (eventStatus === "cancelled") {
    return { primary: EVENT_STATUS_LABELS.cancelled, secondary: null, tone: "cancelled" };
  }
  if (eventStatus === "postponed") {
    return {
      primary: DATE_PHASE_LABELS[datePhase],
      secondary: EVENT_STATUS_LABELS.postponed,
      tone: "postponed",
    };
  }
  return {
    primary: DATE_PHASE_LABELS[datePhase],
    secondary: wasRescheduled ? (datePhase === "past" ? "曾改期" : "已改期") : null,
    tone: datePhase === "today" ? "today" : datePhase === "upcoming" ? "upcoming" : "past",
  };
}

export function formatLiveStatusText(
  eventStatus: EventStatus,
  datePhase: DatePhase,
  wasRescheduled: boolean,
): string {
  const status = getLiveStatusPresentation(eventStatus, datePhase, wasRescheduled);
  return status.secondary ? `${status.secondary} · ${status.primary}` : status.primary;
}
