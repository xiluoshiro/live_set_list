import type { LiveStatusPresentation } from "./liveStatus";

export const CALENDAR_STATUS_ORDER: LiveStatusPresentation["tone"][] = [
  "cancelled",
  "postponed",
  "today",
  "upcoming",
  "past",
];

export const CALENDAR_STATUS_LABELS: Record<LiveStatusPresentation["tone"], string> = {
  past: "已结束",
  upcoming: "待举行",
  today: "进行中",
  postponed: "延期",
  cancelled: "已取消",
};
