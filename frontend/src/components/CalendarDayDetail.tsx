import { useMemo } from "react";

import type { CatalogCalendarLiveItem } from "../api";
import { getBandIconSrc } from "./BandIconsCell";
import type { HomeLiveRow } from "./HomeDashboard";
import { formatLiveStatusText, getLiveStatusPresentation } from "../liveStatus";

export const MAX_VISIBLE_BAND_ICONS = 2;

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

type CalendarDayDetailProps = {
  selectedDate: string;
  items: CatalogCalendarLiveItem[];
  onOpenLive: (row: HomeLiveRow) => void;
  onShowAll: () => void;
};

function formatStartTime(value: string | null): string {
  if (!value) return "时间未定";
  const match = value.match(/^(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function toHomeLiveRow(item: CatalogCalendarLiveItem): HomeLiveRow {
  return {
    liveId: item.live_id,
    liveDate: item.live_date,
    liveTitle: item.live_title,
    icons: item.bands,
    eventStatus: item.event_status,
    datePhase: item.date_phase,
    wasRescheduled: item.was_rescheduled,
  };
}

function formatDateHeading(isoDate: string): { weekday: string; dateLabel: string } {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return {
    weekday: WEEKDAYS[date.getDay()],
    dateLabel: `${month} 月 ${day} 日`,
  };
}

export function CalendarDayDetail({
  selectedDate,
  items,
  onOpenLive,
  onShowAll,
}: CalendarDayDetailProps) {
  const dayItems = useMemo(
    () => items.filter((item) => item.live_date === selectedDate),
    [items, selectedDate],
  );
  const { weekday, dateLabel } = formatDateHeading(selectedDate);

  return (
    <aside className="day-detail" aria-labelledby="selected-date-title" aria-live="polite">
      <div className="day-detail-heading">
        <div>
          <p className="selected-date-weekday">{weekday}</p>
          <h3 id="selected-date-title">{dateLabel}</h3>
        </div>
        <strong className="selected-count">{dayItems.length} 场</strong>
      </div>

      <div className="event-list">
        {dayItems.length === 0 ? (
          <p className="empty-day">这一天没有已收录的 Live。</p>
        ) : (
          dayItems.map((item) => {
            const status = getLiveStatusPresentation(
              item.event_status,
              item.date_phase,
              item.was_rescheduled,
            );
            const visibleBands = item.bands.slice(0, MAX_VISIBLE_BAND_ICONS);
            const hiddenBandCount = item.bands.length - visibleBands.length;
            const bandTitle = item.bands.length > 0 ? item.bands.join(" / ") : undefined;
            return (
              <button
                key={item.live_id}
                type="button"
                className="event-row"
                aria-label={item.live_title}
                onClick={() => onOpenLive(toHomeLiveRow(item))}
              >
                <span className="event-time">{formatStartTime(item.start_time)}</span>
                <span className="event-copy">
                  <strong className="event-title">{item.live_title}</strong>
                  {item.bands.length > 0 && (
                    <span className="event-bands" title={bandTitle}>
                      {visibleBands.map((bandId) => {
                        const src = getBandIconSrc(bandId);
                        if (!src) return null;
                        return (
                          <img
                            key={bandId}
                            className="band-icon"
                            src={src}
                            alt={`Band ${bandId}`}
                            width={20}
                            height={20}
                          />
                        );
                      })}
                      {hiddenBandCount > 0 && (
                        <span className="band-overflow">+{hiddenBandCount}</span>
                      )}
                    </span>
                  )}
                </span>
                <span className="event-status" data-tone={status.tone}>
                  {formatLiveStatusText(item.event_status, item.date_phase, item.was_rescheduled)}
                </span>
              </button>
            );
          })
        )}
      </div>

      <button type="button" className="all-lives-button" onClick={onShowAll}>
        查看全部 Live <span aria-hidden="true">→</span>
      </button>
    </aside>
  );
}

export type { CalendarDayDetailProps };
export { formatStartTime };
