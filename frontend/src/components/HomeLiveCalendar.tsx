import { useCallback, useEffect, useMemo, useState } from "react";

import type { CatalogCalendarLiveItem, CatalogCalendarResponse } from "../api";
import { getCatalogCalendar } from "../api";
import {
  formatIsoDate,
  getCurrentMonthKey,
  monthKeyToLabel,
  shiftMonthKey,
} from "../calendarMonth";
import { CalendarDayDetail } from "./CalendarDayDetail";
import { CalendarGrid } from "./CalendarGrid";
import type { HomeLiveRow } from "./HomeDashboard";

type HomeLiveCalendarProps = {
  onOpenLive: (row: HomeLiveRow) => void;
  onShowAll: () => void;
  refreshKey?: number;
};

function chooseDefaultDate(
  monthKey: string,
  items: CatalogCalendarLiveItem[],
  today: Date,
): string {
  const dates = [...new Set(items.map((item) => item.live_date))].sort();
  if (dates.length === 0) {
    const todayIso = formatIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
    return todayIso.startsWith(monthKey) ? todayIso : `${monthKey}-01`;
  }
  const todayIso = formatIsoDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (dates.includes(todayIso)) return todayIso;
  const upcoming = dates.find((date) => date > todayIso);
  return upcoming ?? dates[dates.length - 1];
}

export function HomeLiveCalendar({ onOpenLive, onShowAll, refreshKey = 0 }: HomeLiveCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => getCurrentMonthKey());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthData, setMonthData] = useState<Record<string, CatalogCalendarResponse>>({});
  const [loadingMonth, setLoadingMonth] = useState<string | null>(visibleMonth);
  const [errorMonth, setErrorMonth] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const currentMonth = useMemo(() => getCurrentMonthKey(), []);

  useEffect(() => {
    let canceled = false;
    setLoadingMonth(visibleMonth);
    setErrorMonth(null);
    getCatalogCalendar(visibleMonth)
      .then((payload) => {
        if (canceled) return;
        setMonthData((previous) => ({ ...previous, [payload.month]: payload }));
      })
      .catch(() => {
        if (canceled) return;
        setErrorMonth(visibleMonth);
      })
      .finally(() => {
        if (canceled) return;
        setLoadingMonth((month) => (month === visibleMonth ? null : month));
      });
    return () => {
      canceled = true;
    };
  }, [visibleMonth, refreshKey, retryKey]);

  const month = monthData[visibleMonth];

  useEffect(() => {
    if (month && (!selectedDate || !selectedDate.startsWith(visibleMonth))) {
      setSelectedDate(chooseDefaultDate(visibleMonth, month.items, new Date()));
    }
  }, [month, selectedDate, visibleMonth]);

  const changeMonth = useCallback((delta: number) => {
    setVisibleMonth((current) => shiftMonthKey(current, delta));
    setSelectedDate(null);
  }, []);

  const goToCurrentMonth = useCallback(() => {
    setVisibleMonth(currentMonth);
    setSelectedDate(null);
  }, [currentMonth]);

  const isLoading = loadingMonth === visibleMonth && month === undefined;
  const hasError = errorMonth === visibleMonth && month === undefined;
  const isEmptyMonth = month !== undefined && month.items.length === 0;

  return (
    <section className="calendar-section" data-home-calendar aria-labelledby="home-calendar-title">
      <header className="calendar-header">
        <div className="calendar-heading">
          <h2 id="home-calendar-title">Live 日历</h2>
        </div>
      </header>

      <div className="status-legend" aria-label="Live 状态图例">
        <span>
          <i className="legend-rail past" aria-hidden="true" />
          已结束
        </span>
        <span>
          <i className="legend-rail upcoming" aria-hidden="true" />
          待举行
        </span>
        <span>
          <i className="legend-rail today" aria-hidden="true" />
          进行中
        </span>
        <span>
          <i className="legend-rail postponed" aria-hidden="true" />
          延期
        </span>
        <span>
          <i className="legend-rail cancelled" aria-hidden="true" />
          已取消
        </span>
      </div>

      <div className="month-navigation" aria-label="月份导航">
        <button type="button" className="month-button" onClick={() => changeMonth(-1)}>
          上个月
        </button>
        <strong className="month-label" aria-live="polite">
          {monthKeyToLabel(visibleMonth)}
        </strong>
        <button type="button" className="month-button" onClick={() => changeMonth(1)}>
          下个月
        </button>
        <button type="button" className="current-month-button" onClick={goToCurrentMonth}>
          回到本月
        </button>
      </div>

      {isLoading && (
        <div className="calendar-loading" aria-busy="true" role="status">
          <div className="calendar-loading-skeleton calendar-loading-calendar" />
          <div className="calendar-loading-skeleton calendar-loading-detail" />
        </div>
      )}

      {hasError && (
        <div className="calendar-error" role="alert">
          <span>Live 日历加载失败</span>
          <button type="button" className="calendar-retry-button" onClick={() => setRetryKey((key) => key + 1)}>
            重试
          </button>
        </div>
      )}

      {month && (
        <div className="calendar-workspace">
          <div className="calendar-pane">
            <CalendarGrid
              monthKey={visibleMonth}
              items={month.items}
              selectedDate={selectedDate ?? ""}
              onSelect={setSelectedDate}
            />
            {isEmptyMonth && <p className="calendar-month-empty">本月暂无已收录 Live</p>}
          </div>
          {selectedDate && (
            <CalendarDayDetail
              selectedDate={selectedDate}
              items={month.items}
              onOpenLive={onOpenLive}
              onShowAll={onShowAll}
            />
          )}
        </div>
      )}
    </section>
  );
}

export type { HomeLiveCalendarProps };
