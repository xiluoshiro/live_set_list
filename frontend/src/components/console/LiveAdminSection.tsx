import { useMemo, type RefObject } from "react";
import { ConfigProvider, DatePicker, Select, TimePicker } from "antd";
import zhCN from "antd/locale/zh_CN";
import dayjs, { type Dayjs } from "dayjs";
import "dayjs/locale/zh-cn";

import type { Position, VenueOption } from "./types";

type LiveAdminSectionProps = {
  liveDate: string;
  liveTitle: string;
  liveType: string;
  liveUrl: string;
  openingTime: string;
  startTime: string;
  timezone: string;
  selectedVenueId: number;
  venueQueryText: string;
  venues: VenueOption[];
  liveTypeOptions: string[];
  venueOpen: boolean;
  venueMenuPos: Position | null;
  venueTriggerRef: RefObject<HTMLButtonElement>;
  venueMenuRef: RefObject<HTMLDivElement>;
  insertedLives: Array<{
    live_id: number;
    live_date: string;
    live_title: string;
    type: string;
    url: string | null;
    opening_time: string;
    start_time: string;
    timezone: string;
    venue_id: number;
  }>;
  onLiveDateChange: (value: string) => void;
  onLiveTitleChange: (value: string) => void;
  onLiveTypeChange: (value: string) => void;
  onLiveUrlChange: (value: string) => void;
  onOpeningTimeChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
  onVenueQueryTextChange: (value: string) => void;
  onOpenVenueMenu: () => void;
  onSelectVenue: (venueId: number) => void;
  onQueryVid: () => void;
  onInsertLive: () => void;
  onSubmitInsertLive: () => void;
  queryInsertDisabled: boolean;
  submitInsertDisabled: boolean;
};

type TimezoneOption = {
  value: string;
  label: string;
  offsetMinutes: number;
};

function getSupportedTimeZones(): string[] {
  const intlWithSupportedValues = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  const supported = intlWithSupportedValues.supportedValuesOf?.("timeZone");
  if (supported && supported.length > 0) {
    return supported;
  }
  return ["UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York"];
}

function getUtcOffsetInfo(timeZone: string): { label: string; minutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const rawOffset = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = rawOffset.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
    if (!match) return { label: "UTC+00:00", minutes: 0 };
    const [, sign, hourText, minuteText] = match;
    const hour = hourText.padStart(2, "0");
    const minute = (minuteText ?? "00").padStart(2, "0");
    const offsetMinutes = Number(hour) * 60 + Number(minute);
    const minutes = sign === "-" ? -offsetMinutes : offsetMinutes;
    return { label: `UTC${sign}${hour}:${minute}`, minutes };
  } catch {
    return { label: "UTC+00:00", minutes: 0 };
  }
}

function formatTimezoneLabel(timeZone: string): string {
  const offsetLabel = getUtcOffsetInfo(timeZone).label;
  const zoneLabel = timeZone.replace(/_/g, " ").replace("/", "，");
  return `(${offsetLabel}) ${zoneLabel}`;
}

dayjs.locale("zh-cn");

export function LiveAdminSection({
  liveDate,
  liveTitle,
  liveType,
  liveUrl,
  openingTime,
  startTime,
  timezone,
  selectedVenueId,
  venueQueryText,
  venues,
  liveTypeOptions,
  venueOpen,
  venueMenuPos,
  venueTriggerRef,
  venueMenuRef,
  insertedLives,
  onLiveDateChange,
  onLiveTitleChange,
  onLiveTypeChange,
  onLiveUrlChange,
  onOpeningTimeChange,
  onStartTimeChange,
  onTimezoneChange,
  onVenueQueryTextChange,
  onOpenVenueMenu,
  onSelectVenue,
  onQueryVid,
  onInsertLive,
  onSubmitInsertLive,
  queryInsertDisabled,
  submitInsertDisabled,
}: LiveAdminSectionProps) {
  const parseDateValue = (value: string): Dayjs | null => {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const parsed = dayjs(trimmed);
    return parsed.isValid() ? parsed : null;
  };

  const parseTimeValue = (value: string): Dayjs | null => {
    const trimmed = value.trim();
    if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
    const [hours, minutes] = trimmed.split(":").map((part) => Number(part));
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return dayjs().hour(hours).minute(minutes).second(0).millisecond(0);
  };

  const dateValue = parseDateValue(liveDate);

  const timezoneOptions = useMemo<TimezoneOption[]>(() => {
    const zones = getSupportedTimeZones();
    if (timezone.trim() !== "" && !zones.includes(timezone)) {
      zones.push(timezone);
    }
    return zones
      .map((zone) => {
        const offsetInfo = getUtcOffsetInfo(zone);
        return {
          value: zone,
          label: formatTimezoneLabel(zone),
          offsetMinutes: offsetInfo.minutes,
        };
      })
      .sort((a, b) => {
        if (a.offsetMinutes !== b.offsetMinutes) {
          return a.offsetMinutes - b.offsetMinutes;
        }
        return a.value.localeCompare(b.value, "zh-Hans-CN");
      });
  }, [timezone]);

  const selectedVenueText = (() => {
    const selected = venues.find((venue) => venue.venue_id === selectedVenueId);
    if (!selected) return "请选择 venue";
    return `${selected.venue_id} - ${selected.venue_name}`;
  })();

  return (
    <ConfigProvider locale={zhCN}>
      <div className="live-id-selector live-create-query-row">
        <label htmlFor="venue-query-input">查询 venue</label>
        <input
          id="venue-query-input"
          className="venue-query-input"
          value={venueQueryText}
          onChange={(e) => onVenueQueryTextChange(e.target.value)}
          placeholder="输入 venue 关键词"
        />
        <button type="button" className="console-ghost-btn" onClick={onQueryVid}>
          查询
        </button>
        <button type="button" className="console-submit-btn" onClick={onInsertLive} disabled={queryInsertDisabled}>
          插入
        </button>
      </div>
      <p className="console-admin-hint">TODO: 查询结果与“选择 venue”联动（当前仅保留输入与按钮位）。</p>

      <div className="live-id-selector live-create-tools">
        <label>选择 venue</label>
        <button
          ref={venueTriggerRef}
          type="button"
          className="bands-picker-trigger venue-picker-trigger"
          onClick={onOpenVenueMenu}
          title={selectedVenueText}
        >
          {selectedVenueText}
        </button>
      </div>

      <div className="console-table-wrap">
        <table className="console-admin-table live-admin-form-table">
          <thead>
            <tr>
              <th>live_date</th>
              <th>live_title</th>
              <th>type</th>
              <th>url</th>
              <th>opening_time</th>
              <th>start_time</th>
              <th>timezone</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <DatePicker
                  className="console-antd-picker"
                  value={dateValue}
                  format="YYYY-MM-DD"
                  inputReadOnly
                  allowClear={false}
                  onChange={(_, dateString) => onLiveDateChange(typeof dateString === "string" ? dateString : "")}
                />
              </td>
              <td>
                <input value={liveTitle} onChange={(e) => onLiveTitleChange(e.target.value)} placeholder="请输入Live标题" />
              </td>
              <td>
                <select value={liveType} onChange={(e) => onLiveTypeChange(e.target.value)}>
                  {liveTypeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input value={liveUrl} onChange={(e) => onLiveUrlChange(e.target.value)} placeholder="https://..." />
              </td>
              <td>
                <TimePicker
                  className="console-antd-picker"
                  value={parseTimeValue(openingTime)}
                  format="HH:mm"
                  allowClear={false}
                  onChange={(_, timeString) =>
                    onOpeningTimeChange(typeof timeString === "string" ? timeString : "")
                  }
                />
              </td>
              <td>
                <TimePicker
                  className="console-antd-picker"
                  value={parseTimeValue(startTime)}
                  format="HH:mm"
                  allowClear={false}
                  onChange={(_, timeString) => onStartTimeChange(typeof timeString === "string" ? timeString : "")}
                />
              </td>
              <td>
                <Select
                  className="console-antd-select"
                  value={timezone}
                  showSearch
                  optionFilterProp="label"
                  popupMatchSelectWidth={false}
                  classNames={{ popup: { root: "console-timezone-dropdown" } }}
                  styles={{ popup: { root: { minWidth: 320, maxWidth: 420 } } }}
                  onChange={(value) => onTimezoneChange(value)}
                  options={timezoneOptions.map((option) => ({ value: option.value, label: option.label }))}
                  placeholder="选择时区"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="console-submit-row live-admin-insert-row">
        <button type="button" className="console-submit-btn" onClick={onSubmitInsertLive} disabled={submitInsertDisabled}>
          提交插入
        </button>
      </div>

      {venueOpen && venueMenuPos && (
        <div
          className="bands-floating-menu"
          ref={venueMenuRef}
          style={{ top: venueMenuPos.top, left: venueMenuPos.left, width: venueMenuPos.width }}
        >
          {venues.map((venue) => (
            <label key={venue.venue_id}>
              <input
                type="radio"
                name="live-venue-picker"
                checked={selectedVenueId === venue.venue_id}
                onChange={() => onSelectVenue(venue.venue_id)}
              />
              <span>
                {venue.venue_id} - {venue.venue_name}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="console-table-wrap live-history-wrap">
        <table className="console-admin-table live-history-table">
          <thead>
            <tr>
              <th>live_id</th>
              <th>live_date</th>
              <th>live_title</th>
              <th>type</th>
              <th>url</th>
              <th>opening_time</th>
              <th>start_time</th>
              <th>timezone</th>
              <th>venue_id</th>
            </tr>
          </thead>
          <tbody>
            {insertedLives.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-cell">暂无新增Live记录</td>
              </tr>
            ) : (
              insertedLives.map((row) => (
                <tr key={row.live_id}>
                  <td>{row.live_id}</td>
                  <td>{row.live_date}</td>
                  <td>{row.live_title}</td>
                  <td>{row.type}</td>
                  <td>{row.url ?? "-"}</td>
                  <td>{row.opening_time}</td>
                  <td>{row.start_time}</td>
                  <td>{row.timezone}</td>
                  <td>{row.venue_id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ConfigProvider>
  );
}
