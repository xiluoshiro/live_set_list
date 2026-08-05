import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { CatalogCalendarLiveItem } from "../api";
import {
  formatIsoDate,
  getDaysInMonth,
  getFirstWeekdayOffset,
  getMonthParts,
} from "../calendarMonth";
import { CALENDAR_STATUS_LABELS, CALENDAR_STATUS_ORDER } from "../calendarStatus";
import { getLiveStatusPresentation } from "../liveStatus";

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type CalendarGridProps = {
  monthKey: string;
  items: CatalogCalendarLiveItem[];
  selectedDate: string;
  onSelect: (date: string) => void;
};

function toneOf(item: CatalogCalendarLiveItem): (typeof CALENDAR_STATUS_ORDER)[number] {
  return getLiveStatusPresentation(
    item.event_status,
    item.date_phase,
    item.was_rescheduled,
  ).tone;
}

function buildDayLabel(
  year: number,
  month: number,
  day: number,
  items: CatalogCalendarLiveItem[],
): string {
  if (items.length === 0) return `${month} 月 ${day} 日，没有 Live`;
  const counts: Partial<Record<(typeof CALENDAR_STATUS_ORDER)[number], number>> = {};
  items.forEach((item) => {
    const tone = toneOf(item);
    counts[tone] = (counts[tone] ?? 0) + 1;
  });
  const parts = CALENDAR_STATUS_ORDER.filter((tone) => counts[tone]).map(
    (tone) => `${CALENDAR_STATUS_LABELS[tone]} ${counts[tone]}`,
  );
  return `${month} 月 ${day} 日，${items.length} 场 Live，${parts.join("，")}`;
}

export function CalendarGrid({ monthKey, items, selectedDate, onSelect }: CalendarGridProps) {
  const { year, month } = getMonthParts(monthKey);
  const daysInMonth = getDaysInMonth(monthKey);
  const firstWeekdayOffset = getFirstWeekdayOffset(monthKey);
  const today = new Date();
  const todayIso = formatIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const [focusedDate, setFocusedDate] = useState(selectedDate);
  const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setFocusedDate(selectedDate);
  }, [selectedDate, monthKey]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CatalogCalendarLiveItem[]>();
    items.forEach((item) => {
      const list = map.get(item.live_date) ?? [];
      list.push(item);
      map.set(item.live_date, list);
    });
    return map;
  }, [items]);

  const moveFocus = (offset: number) => {
    const [focusedYear, focusedMonth, focusedDay] = focusedDate.split("-").map(Number);
    const target = new Date(focusedYear, focusedMonth - 1, focusedDay + offset);
    const targetIso = formatIsoDate(
      target.getFullYear(),
      target.getMonth() + 1,
      target.getDate(),
    );
    if (!targetIso.startsWith(monthKey)) return;
    setFocusedDate(targetIso);
    dayRefs.current[targetIso]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const offsets: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    moveFocus(offsets[event.key]);
  };

  const cells: React.ReactNode[] = [];
  for (let cell = 0; cell < 42; cell += 1) {
    const day = cell - firstWeekdayOffset + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push(<span key={`blank-${cell}`} className="calendar-blank" aria-hidden="true" />);
      continue;
    }

    const isoDate = formatIsoDate(year, month, day);
    const dayItems = itemsByDate.get(isoDate) ?? [];
    const isToday = isoDate === todayIso;
    const isSelected = isoDate === selectedDate;
    const isFocused = isoDate === focusedDate;
    const tones = CALENDAR_STATUS_ORDER.filter((tone) => dayItems.some((item) => toneOf(item) === tone));

    cells.push(
      <button
        key={isoDate}
        ref={(element) => {
          dayRefs.current[isoDate] = element;
        }}
        type="button"
        className={`calendar-day${dayItems.length > 0 ? " has-events" : ""}`}
        data-date={isoDate}
        data-today={isToday ? "true" : "false"}
        aria-pressed={isSelected}
        aria-current={isToday ? "date" : undefined}
        tabIndex={isFocused ? 0 : -1}
        aria-label={buildDayLabel(year, month, day, dayItems)}
        onClick={() => onSelect(isoDate)}
        onKeyDown={handleKeyDown}
      >
        <span className="day-topline">
          <span className="day-number">{String(day).padStart(2, "0")}</span>
          {dayItems.length > 0 && <span className="event-count">{dayItems.length}场</span>}
        </span>
        <span className="marker-track" aria-hidden="true">
          {tones.map((tone) => (
            <i key={tone} className={`event-marker ${tone}`} />
          ))}
        </span>
      </button>,
    );
  }

  return (
    <div className="calendar-grid" role="grid" aria-label={`${year} 年 ${month} 月 Live 日历`}>
      <div className="weekday-row" role="row" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label} role="columnheader">
            {label}
          </span>
        ))}
      </div>
      {cells}
    </div>
  );
}
