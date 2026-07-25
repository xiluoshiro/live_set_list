import type { RefObject } from "react";

import type { ConsoleLiveCandidate, DatePhase, EventStatus } from "../../api";
import { DATE_PHASE_LABELS } from "../../liveStatus";
import { formatLiveType } from "./constants";
import type { BandOption, Position, VenueOption } from "./types";

type LiveAdminSectionProps = {
  variant: "create" | "edit";
  liveDate: string;
  liveTitle: string;
  liveType: string;
  eventStatus?: EventStatus;
  statusNote?: string;
  datePhase?: DatePhase;
  hasScheduleChanges?: boolean;
  scheduleChangeKind?: "correction" | "reschedule" | null;
  scheduleChangeNote?: string;
  liveUrl: string;
  openingTime: string;
  startTime: string;
  timezoneHour: string;
  timezoneMinute: string;
  timezoneMinuteDisabled: boolean;
  selectedVenueId: number;
  defaultBandIds: number[];
  eventAttendees: Record<number, string[]>;
  bandOptions: BandOption[];
  venueQueryText: string;
  liveCandidateQuery: string;
  liveCandidateType: string;
  liveCandidateEventStatus?: string;
  liveCandidates: ConsoleLiveCandidate[];
  liveCandidatePage: number;
  liveCandidateTotal: number;
  liveCandidateTotalPages: number;
  liveCandidateLoading: boolean;
  editingLiveId: number | null;
  isLiveDirty: boolean;
  clearAfterCreate: boolean;
  venues: VenueOption[];
  timezoneHourOptions: string[];
  liveTypeOptions: { value: string; label: string }[];
  venueOpen: boolean;
  venueMenuPos: Position | null;
  defaultBandOpen: boolean;
  defaultBandMenuPos: Position | null;
  venueTriggerRef: RefObject<HTMLButtonElement>;
  venueMenuRef: RefObject<HTMLDivElement>;
  defaultBandTriggerRef: RefObject<HTMLButtonElement>;
  defaultBandMenuRef: RefObject<HTMLDivElement>;
  venueQueryInputRef: RefObject<HTMLInputElement>;
  insertedLives: Array<{
    history_entry_id: number;
    action: "create" | "update";
    live_id: number;
    live_date: string;
    live_title: string;
    live_type: string;
    url: string | null;
    opening_time: string;
    start_time: string;
    timezone: string;
    venue_id: number;
    default_band_ids: number[];
    event_attendees: Array<{ band_id: number; mode: "partial" | "full"; members: string[] }>;
    event_status?: EventStatus;
    status_note?: string | null;
  }>;
  onLiveDateChange: (value: string) => void;
  onLiveTitleChange: (value: string) => void;
  onLiveTypeChange: (value: string) => void;
  onEventStatusChange?: (value: EventStatus) => void;
  onStatusNoteChange?: (value: string) => void;
  onScheduleChangeKindChange?: (value: "correction" | "reschedule" | null) => void;
  onScheduleChangeNoteChange?: (value: string) => void;
  onLiveUrlChange: (value: string) => void;
  onOpeningTimeChange: (value: string) => void;
  onStartTimeChange: (value: string) => void;
  onTimezoneHourChange: (value: string) => void;
  onCycleTimezoneMinute: () => void;
  onVenueQueryTextChange: (value: string) => void;
  onLiveCandidateQueryChange: (value: string) => void;
  onLiveCandidateTypeChange: (value: string) => void;
  onLiveCandidateEventStatusChange?: (value: string) => void;
  onQueryLiveCandidates: () => void;
  onLiveCandidatePageChange: (page: number) => void;
  onSelectLiveForEdit: (liveId: number) => void;
  onClearAfterCreateChange: (checked: boolean) => void;
  onOpenVenueMenu: () => void;
  onOpenDefaultBandMenu: () => void;
  onSelectVenue: (venueId: number) => void;
  onToggleDefaultBand: (bandId: number) => void;
  onToggleEventAttendee: (bandId: number, memberName: string) => void;
  onQueryVid: () => void;
  onInsertVenue: () => void;
  onClearInsertLive: () => void;
  onSubmitInsertLive: () => void;
  queryInsertDisabled: boolean;
  submitInsertDisabled: boolean;
};

export function LiveAdminSection({
  variant,
  liveDate,
  liveTitle,
  liveType,
  eventStatus = "scheduled",
  statusNote = "",
  datePhase = "past",
  hasScheduleChanges = false,
  scheduleChangeKind = null,
  scheduleChangeNote = "",
  liveUrl,
  openingTime,
  startTime,
  timezoneHour,
  timezoneMinute,
  timezoneMinuteDisabled,
  selectedVenueId,
  defaultBandIds,
  eventAttendees,
  bandOptions,
  venueQueryText,
  liveCandidateQuery,
  liveCandidateType,
  liveCandidateEventStatus = "",
  liveCandidates,
  liveCandidatePage,
  liveCandidateTotal,
  liveCandidateTotalPages,
  liveCandidateLoading,
  editingLiveId,
  isLiveDirty,
  clearAfterCreate,
  venues,
  timezoneHourOptions,
  liveTypeOptions,
  venueOpen,
  venueMenuPos,
  defaultBandOpen,
  defaultBandMenuPos,
  venueTriggerRef,
  venueMenuRef,
  defaultBandTriggerRef,
  defaultBandMenuRef,
  venueQueryInputRef,
  insertedLives,
  onLiveDateChange,
  onLiveTitleChange,
  onLiveTypeChange,
  onEventStatusChange = () => undefined,
  onStatusNoteChange = () => undefined,
  onScheduleChangeKindChange = () => undefined,
  onScheduleChangeNoteChange = () => undefined,
  onLiveUrlChange,
  onOpeningTimeChange,
  onStartTimeChange,
  onTimezoneHourChange,
  onCycleTimezoneMinute,
  onVenueQueryTextChange,
  onLiveCandidateQueryChange,
  onLiveCandidateTypeChange,
  onLiveCandidateEventStatusChange = () => undefined,
  onQueryLiveCandidates,
  onLiveCandidatePageChange,
  onSelectLiveForEdit,
  onClearAfterCreateChange,
  onOpenVenueMenu,
  onOpenDefaultBandMenu,
  onSelectVenue,
  onToggleDefaultBand,
  onToggleEventAttendee,
  onQueryVid,
  onInsertVenue,
  onClearInsertLive,
  onSubmitInsertLive,
  queryInsertDisabled,
  submitInsertDisabled,
}: LiveAdminSectionProps) {
  const selectedVenueText = (() => {
    const selected = venues.find((venue) => venue.venue_id === selectedVenueId);
    if (!selected) return "请选择 venue";
    return `${selected.venue_id} - ${selected.venue_name}`;
  })();
  const selectableBands = bandOptions.filter((band) => band.band_id > 0);
  const selectedDefaultBandText = (() => {
    const selected = selectableBands.filter((band) => defaultBandIds.includes(band.band_id));
    if (selected.length === 0) return "请选择默认 Band";
    return selected.map((band) => band.band_name).join("、");
  })();
  const selectedCandidateMissing = editingLiveId !== null && !liveCandidates.some((live) => live.live_id === editingLiveId);
  const normalizedLiveCandidateTotalPages = Math.max(1, liveCandidateTotalPages);
  const visibleHistory = insertedLives.filter((row) => row.action === (variant === "create" ? "create" : "update"));
  const showEditor = variant === "create" || editingLiveId !== null;

  return (
    <>
      {variant === "edit" && (
        <div className="tour-admin-toolbar live-admin-toolbar">
          <label className="live-management-label" htmlFor="live-admin-query">已有 Live</label>
          <input
            id="live-admin-query"
            className="venue-query-input live-management-primary-control"
            value={liveCandidateQuery}
            onChange={(event) => onLiveCandidateQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onQueryLiveCandidates(); }}
            placeholder="输入 Live ID 或标题"
          />
          <button type="button" className="console-ghost-btn" onClick={onQueryLiveCandidates} disabled={liveCandidateLoading}>查询</button>
          <select
            className="live-type-filter"
            aria-label="按 Live 类型筛选"
            value={liveCandidateType}
            onChange={(event) => onLiveCandidateTypeChange(event.target.value)}
          >
            <option value="">全部类型</option>
            {liveTypeOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="live-type-filter"
            aria-label="按演出状态筛选"
            value={liveCandidateEventStatus}
            onChange={(event) => onLiveCandidateEventStatusChange(event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="scheduled">按计划</option>
            <option value="postponed">延期</option>
            <option value="cancelled">已取消</option>
          </select>
          <select
            aria-label="选择要编辑的 Live"
            value={editingLiveId ?? ""}
            disabled={liveCandidateLoading || liveCandidates.length === 0}
            onChange={(event) => {
              const liveId = Number(event.target.value);
              if (liveId > 0) onSelectLiveForEdit(liveId);
            }}
          >
            <option value="">选择要编辑的 Live</option>
            {selectedCandidateMissing && <option value={editingLiveId ?? ""}>#{editingLiveId} {liveTitle}</option>}
            {liveCandidates.map((live) => (
              <option key={live.live_id} value={live.live_id}>
                #{live.live_id} {live.live_date} {formatLiveType(live.live_type)} {live.live_title}
              </option>
            ))}
          </select>
          <button type="button" className="console-ghost-btn" onClick={() => onLiveCandidatePageChange(Math.max(1, liveCandidatePage - 1))} disabled={liveCandidateLoading || liveCandidatePage <= 1}>上一页</button>
          <span>第 {liveCandidatePage} / {normalizedLiveCandidateTotalPages} 页，共 {liveCandidateTotal} 条</span>
          <button type="button" className="console-ghost-btn" onClick={() => onLiveCandidatePageChange(Math.min(normalizedLiveCandidateTotalPages, liveCandidatePage + 1))} disabled={liveCandidateLoading || liveCandidatePage >= normalizedLiveCandidateTotalPages}>下一页</button>
        </div>
      )}

      {!showEditor && <p className="console-admin-hint">请先选择要编辑的 Live。</p>}
      {showEditor && (
        <>

      <div className="live-id-selector live-create-query-row">
        <label className="live-management-label" htmlFor="venue-query-input">查询 venue</label>
        <input
          id="venue-query-input"
          ref={venueQueryInputRef}
          className="venue-query-input live-management-primary-control"
          value={venueQueryText}
          onChange={(e) => onVenueQueryTextChange(e.target.value)}
          placeholder="输入 venue 关键词"
        />
        <button type="button" className="console-ghost-btn" onClick={onQueryVid}>
          查询
        </button>
        <button type="button" className="console-submit-btn" onClick={onInsertVenue} disabled={queryInsertDisabled}>
          插入
        </button>
      </div>
      <div className="live-id-selector live-create-tools">
        <label className="live-management-label">选择 venue</label>
        <button
          ref={venueTriggerRef}
          type="button"
          className="bands-picker-trigger venue-picker-trigger live-management-primary-control"
          onClick={onOpenVenueMenu}
          title={selectedVenueText}
        >
          {selectedVenueText}
        </button>
      </div>

      <div className="live-id-selector live-create-tools live-default-bands-row">
        <span className="live-default-bands-label live-management-label">默认 Band</span>
        <button
          ref={defaultBandTriggerRef}
          type="button"
          className="bands-picker-trigger default-band-picker-trigger live-management-primary-control"
          onClick={onOpenDefaultBandMenu}
          title={selectedDefaultBandText}
          aria-expanded={defaultBandOpen}
          disabled={selectableBands.length === 0}
        >
          {selectableBands.length === 0 ? "暂无可选 Band" : selectedDefaultBandText}
        </button>
      </div>

      <div className="console-table-wrap">
        <table className="console-admin-table live-admin-form-table">
          <thead>
            <tr>
              <th>live_date</th>
              <th>live_title</th>
              <th>live_type</th>
              <th>url</th>
              <th>opening_time</th>
              <th>start_time</th>
              <th>timezone</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <input
                  type="date"
                  aria-label="live_date"
                  min="2015-01-01"
                  value={liveDate}
                  onChange={(e) => onLiveDateChange(e.target.value)}
                />
              </td>
              <td>
                <input value={liveTitle} onChange={(e) => onLiveTitleChange(e.target.value)} placeholder="请输入Live标题" />
              </td>
              <td>
                <select className="live-type-input" value={liveType} onChange={(e) => onLiveTypeChange(e.target.value)}>
                  {liveTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input value={liveUrl} onChange={(e) => onLiveUrlChange(e.target.value)} placeholder="https://..." />
              </td>
              <td>
                <input type="time" aria-label="opening_time" value={openingTime} onChange={(e) => onOpeningTimeChange(e.target.value)} />
              </td>
              <td>
                <input type="time" aria-label="start_time" value={startTime} onChange={(e) => onStartTimeChange(e.target.value)} />
              </td>
              <td>
                <div className="timezone-input-group">
                  <select
                    aria-label="timezone"
                    value={timezoneHour}
                    onChange={(e) => onTimezoneHourChange(e.target.value)}
                  >
                    {timezoneHourOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="timezone-minute-btn"
                    aria-label="timezone minute offset"
                    title="每次增加 15 分钟"
                    disabled={timezoneMinuteDisabled}
                    onClick={onCycleTimezoneMinute}
                  >
                    {timezoneMinute}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section className="live-admin-status-section" aria-labelledby="live-admin-status-title">
        <div className="live-admin-status-head">
          <h3 id="live-admin-status-title">演出状态</h3>
          <span>人工状态与日期进度分开维护</span>
        </div>
        <div className="live-admin-status-fields">
          <label htmlFor="live-event-status">
            <span>人工状态</span>
            <select
              id="live-event-status"
              value={eventStatus}
              onChange={(event) => onEventStatusChange(event.target.value as EventStatus)}
            >
              <option value="scheduled">按计划</option>
              <option value="postponed">延期</option>
              <option value="cancelled">已取消</option>
            </select>
          </label>
          <div className="live-admin-readonly-field" aria-label={`日期阶段：${DATE_PHASE_LABELS[datePhase]}（只读）`}>
            <span>日期阶段</span>
            <strong>{DATE_PHASE_LABELS[datePhase]}</strong>
            <small>按演出日期自动判断</small>
          </div>
          {eventStatus !== "scheduled" && (
            <label className="live-admin-status-note">
              <span>{eventStatus === "cancelled" ? "取消说明" : "延期说明"}</span>
              <input
                aria-label="状态说明"
                value={statusNote}
                onChange={(event) => onStatusNoteChange(event.target.value)}
                placeholder="填写对外说明（可选）"
              />
              <small>将显示在公开演出详情的状态栏中</small>
            </label>
          )}
        </div>
      </section>

      {variant === "edit" && hasScheduleChanges && (
        <div className="live-id-selector live-schedule-change-editor">
          <span className="live-management-label">本次排期变化</span>
          <label>
            <input
              type="radio"
              name="schedule-change-kind"
              checked={scheduleChangeKind === "correction"}
              onChange={() => onScheduleChangeKindChange("correction")}
            />
            资料修正
          </label>
          <label>
            <input
              type="radio"
              name="schedule-change-kind"
              checked={scheduleChangeKind === "reschedule"}
              onChange={() => onScheduleChangeKindChange("reschedule")}
            />
            主办方正式改期
          </label>
          <input
            aria-label="排期变化说明"
            value={scheduleChangeNote}
            onChange={(event) => onScheduleChangeNoteChange(event.target.value)}
            placeholder="说明（可选）"
          />
        </div>
      )}

      <div className="console-submit-row live-admin-insert-row">
        {variant === "create" && (
          <label className="live-clear-after-create-option">
            <input
              type="checkbox"
              checked={clearAfterCreate}
              onChange={(event) => onClearAfterCreateChange(event.target.checked)}
            />
            新增后清空录入数据
          </label>
        )}
        <button
          type="button"
          className="console-ghost-btn"
          onClick={onClearInsertLive}
          disabled={variant === "edit" && editingLiveId === null}
        >
          {variant === "create" ? "清空数据" : "恢复原值"}
        </button>
        <button type="button" className="console-submit-btn" onClick={onSubmitInsertLive} disabled={submitInsertDisabled}>
          {variant === "create" ? "提交插入" : "保存修改"}
        </button>
      </div>
      {variant === "edit" && editingLiveId !== null && isLiveDirty && (
        <p className="console-admin-hint" role="status">
          Live #{editingLiveId} 有未保存修改
        </p>
      )}

      {venueOpen && venueMenuPos && (
        <div
          className="bands-floating-menu"
          ref={venueMenuRef}
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
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

      {defaultBandOpen && defaultBandMenuPos && (
        <div
          className="bands-floating-menu"
          ref={defaultBandMenuRef}
          role="group"
          aria-label="default_band_ids"
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          style={{
            top: defaultBandMenuPos.top,
            left: defaultBandMenuPos.left,
            width: defaultBandMenuPos.width,
          }}
        >
          {selectableBands.map((band) => {
            const selected = defaultBandIds.includes(band.band_id);
            const selectedMembers = eventAttendees[band.band_id] ?? [];
            const memberOptions = band.band_members ?? [];
            return (
              <div key={band.band_id} className="band-member-block">
                <label className="band-member-main">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleDefaultBand(band.band_id)}
                  />
                  <span>{band.band_id} - {band.band_name}</span>
                </label>
                {liveType === "event" && selected && memberOptions.length > 0 && (
                  <div className="band-member-sub-list" role="group" aria-label={`${band.band_name} 出演成员`}>
                    {memberOptions.map((memberName) => (
                      <label key={memberName}>
                        <input
                          type="checkbox"
                          checked={selectedMembers.includes(memberName)}
                          onChange={() => onToggleEventAttendee(band.band_id, memberName)}
                        />
                        <span>{memberName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      <div className="console-table-wrap live-history-wrap">
        <table className="console-admin-table live-history-table">
          <thead>
            <tr>
              <th>live_id</th>
              <th>操作</th>
              <th>live_date</th>
              <th>live_title</th>
              <th>live_type</th>
              <th>url</th>
              <th>opening_time</th>
              <th>start_time</th>
              <th>timezone</th>
              <th>venue_id</th>
              <th>default_band_ids</th>
              <th>event_attendees</th>
              <th>event_status</th>
              <th>status_note</th>
            </tr>
          </thead>
          <tbody>
            {visibleHistory.length === 0 ? (
              <tr>
                <td colSpan={14} className="empty-cell">暂无 Live {variant === "create" ? "新增" : "更新"}记录</td>
              </tr>
            ) : (
              visibleHistory.map((row) => (
                <tr key={row.history_entry_id}>
                  <td>{row.live_id}</td>
                  <td>{row.action === "create" ? "新增" : "更新"}</td>
                  <td>{row.live_date}</td>
                  <td>{row.live_title}</td>
                  <td>{formatLiveType(row.live_type)}</td>
                  <td>{row.url ?? "-"}</td>
                  <td>{row.opening_time}</td>
                  <td>{row.start_time}</td>
                  <td>{row.timezone}</td>
                  <td>{row.venue_id}</td>
                  <td>{(row.default_band_ids ?? []).join(", ") || "-"}</td>
                  <td>{row.event_attendees.map((item) => `${item.band_id}:${item.mode}(${item.members.join("/")})`).join("; ") || "-"}</td>
                  <td>{!row.event_status || row.event_status === "scheduled" ? "按计划" : row.event_status === "postponed" ? "延期" : "已取消"}</td>
                  <td>{row.status_note ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
