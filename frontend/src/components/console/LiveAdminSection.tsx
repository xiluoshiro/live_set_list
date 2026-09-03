import type { RefObject } from "react";

import type {
  ConsoleBandHistory,
  ConsoleLiveBandLineupContext,
  ConsoleLiveCandidate,
  DatePhase,
  EventStatus,
} from "../../api";
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
  venueAnnounced?: boolean;
  openingTimeAnnounced?: boolean;
  startTimeAnnounced?: boolean;
  timezoneHour: string;
  timezoneMinute: string;
  timezoneMinuteDisabled: boolean;
  selectedVenueId: number;
  defaultBandIds: number[];
  defaultBandLineupContexts: Record<number, ConsoleLiveBandLineupContext>;
  bandHistories: Record<number, ConsoleBandHistory>;
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
    opening_time: string | null;
    start_time: string | null;
    timezone: string;
    venue_id: number | null;
    default_band_ids: number[];
    event_attendees: Array<{ band_id: number; mode: "partial" | "full"; members: string[] }>;
    event_status?: EventStatus;
    status_note?: string | null;
  }>;
  scheduleAttentionItems?: ConsoleLiveCandidate[];
  scheduleAttentionCounts?: { upcoming: number; today: number; overdue: number };
  scheduleAttentionFilter?: "" | "upcoming" | "today" | "overdue";
  scheduleAttentionLoading?: boolean;
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
  onVenueAnnouncedChange?: (announced: boolean) => void;
  onOpeningTimeAnnouncedChange?: (announced: boolean) => void;
  onStartTimeAnnouncedChange?: (announced: boolean) => void;
  onTimezoneHourChange: (value: string) => void;
  onCycleTimezoneMinute: () => void;
  onVenueQueryTextChange: (value: string) => void;
  onLiveCandidateQueryChange: (value: string) => void;
  onLiveCandidateTypeChange: (value: string) => void;
  onLiveCandidateEventStatusChange?: (value: string) => void;
  onQueryLiveCandidates: () => void;
  onLiveCandidatePageChange: (page: number) => void;
  onSelectLiveForEdit: (liveId: number) => void;
  onScheduleAttentionFilterChange?: (value: "" | "upcoming" | "today" | "overdue") => void;
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
  venueAnnounced = true,
  openingTimeAnnounced = true,
  startTimeAnnounced = true,
  timezoneHour,
  timezoneMinute,
  timezoneMinuteDisabled,
  selectedVenueId,
  defaultBandIds,
  defaultBandLineupContexts,
  bandHistories,
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
  scheduleAttentionItems = [],
  scheduleAttentionCounts = { upcoming: 0, today: 0, overdue: 0 },
  scheduleAttentionFilter = "",
  scheduleAttentionLoading = false,
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
  onVenueAnnouncedChange = () => undefined,
  onOpeningTimeAnnouncedChange = () => undefined,
  onStartTimeAnnouncedChange = () => undefined,
  onTimezoneHourChange,
  onCycleTimezoneMinute,
  onVenueQueryTextChange,
  onLiveCandidateQueryChange,
  onLiveCandidateTypeChange,
  onLiveCandidateEventStatusChange = () => undefined,
  onQueryLiveCandidates,
  onLiveCandidatePageChange,
  onSelectLiveForEdit,
  onScheduleAttentionFilterChange = () => undefined,
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
    if (!venueAnnounced) return "未公布";
    const selected = venues.find((venue) => venue.venue_id === selectedVenueId);
    if (!selected) return "请选择 venue";
    return `${selected.venue_id} - ${selected.venue_name}`;
  })();
  const selectableBands = bandOptions.filter((band) => band.band_id > 0);
  const selectedDefaultBandText = (() => {
    const selected = selectableBands.filter((band) => defaultBandIds.includes(band.band_id));
    if (selected.length === 0) return "请选择默认 Band";
    return selected.map((band) => {
      const context = defaultBandLineupContexts[band.band_id];
      const history = bandHistories[band.band_id];
      return history?.name_versions.find(
        (version) => version.name_version_id === context?.band_name_version_id,
      )?.band_name ?? band.band_name;
    }).join("、");
  })();
  const selectedCandidateMissing = editingLiveId !== null && !liveCandidates.some((live) => live.live_id === editingLiveId);
  const normalizedLiveCandidateTotalPages = Math.max(1, liveCandidateTotalPages);
  const visibleHistory = insertedLives.filter((row) => row.action === (variant === "create" ? "create" : "update"));
  const showEditor = variant === "create" || editingLiveId !== null;

  return (
    <>
      <section className="live-admin-status-section live-schedule-attention" aria-labelledby="live-schedule-attention-title">
        <div className="live-admin-status-head">
          <h3 id="live-schedule-attention-title">待补排期资料</h3>
          <span>补全最后一项后自动移出</span>
        </div>
        <div className="live-schedule-attention-counts" role="group" aria-label="待补排期资料分类">
          {([
            ["today", "今日未公布", scheduleAttentionCounts.today],
            ["overdue", "已结束仍缺失", scheduleAttentionCounts.overdue],
            ["upcoming", "未来待公布", scheduleAttentionCounts.upcoming],
          ] as const).map(([attention, label, count]) => (
            <button
              key={attention}
              type="button"
              className="console-ghost-btn"
              data-attention={attention}
              data-active={scheduleAttentionFilter === attention || undefined}
              data-empty={count === 0 || undefined}
              disabled={scheduleAttentionLoading}
              onClick={() => onScheduleAttentionFilterChange(scheduleAttentionFilter === attention ? "" : attention)}
            >
              <span>{label}</span><strong>{count}</strong>
            </button>
          ))}
        </div>
        {scheduleAttentionItems.length === 0 ? (
          <p className="console-admin-hint">当前筛选下没有待补活动。</p>
        ) : (
          <div className="live-schedule-attention-list">
            {scheduleAttentionItems.map((live) => (
              <article key={live.live_id} data-attention={live.schedule_attention}>
                <div>
                  <time>{live.live_date}</time>
                  <strong>{live.live_title}</strong>
                  <span className="live-schedule-missing-tags">
                    {(live.missing_schedule_fields ?? []).map((field) => (
                      <small key={field}>{field === "venue" ? "场馆" : field === "opening_time" ? "开场" : "开演"}未公布</small>
                    ))}
                  </span>
                  {live.schedule_attention === "today" && <em>今日活动仍有资料未公布</em>}
                  {live.schedule_attention === "overdue" && <em>活动已结束，资料仍未补全</em>}
                </div>
                <button type="button" className="console-ghost-btn" onClick={() => onSelectLiveForEdit(live.live_id)}>编辑</button>
              </article>
            ))}
          </div>
        )}
      </section>

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
          disabled={!venueAnnounced}
        />
        <button type="button" className="console-ghost-btn" onClick={onQueryVid} disabled={!venueAnnounced}>
          查询
        </button>
        <button type="button" className="console-submit-btn" onClick={onInsertVenue} disabled={!venueAnnounced || queryInsertDisabled}>
          插入
        </button>
      </div>
      <div className="live-id-selector live-create-tools">
        <label className="live-management-label">选择 venue</label>
        <select aria-label="场馆公布状态" value={venueAnnounced ? "announced" : "unannounced"} onChange={(event) => onVenueAnnouncedChange(event.target.value === "announced")}>
          <option value="announced">已确定</option>
          <option value="unannounced">暂未公布</option>
        </select>
        <button
          ref={venueTriggerRef}
          type="button"
          className="bands-picker-trigger venue-picker-trigger live-management-primary-control"
          onClick={onOpenVenueMenu}
          title={selectedVenueText}
          disabled={!venueAnnounced}
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
                <select aria-label="开场公布状态" value={openingTimeAnnounced ? "announced" : "unannounced"} onChange={(event) => onOpeningTimeAnnouncedChange(event.target.value === "announced")}>
                  <option value="announced">已确定</option>
                  <option value="unannounced">暂未公布</option>
                </select>
                <input type="time" aria-label="opening_time" value={openingTime} disabled={!openingTimeAnnounced} onChange={(e) => onOpeningTimeChange(e.target.value)} />
              </td>
              <td>
                <select aria-label="开演公布状态" value={startTimeAnnounced ? "announced" : "unannounced"} onChange={(event) => onStartTimeAnnouncedChange(event.target.value === "announced")}>
                  <option value="announced">已确定</option>
                  <option value="unannounced">暂未公布</option>
                </select>
                <input type="time" aria-label="start_time" value={startTime} disabled={!startTimeAnnounced} onChange={(e) => onStartTimeChange(e.target.value)} />
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
          <div
            className="live-admin-readonly-field"
            data-status-tone={datePhase}
            aria-label={`日期阶段：${DATE_PHASE_LABELS[datePhase]}（只读）`}
          >
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
        {variant === "edit" && hasScheduleChanges && (
          <div className="live-schedule-change-editor">
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
              className="venue-query-input"
              aria-label="排期变化说明"
              value={scheduleChangeNote}
              onChange={(event) => onScheduleChangeNoteChange(event.target.value)}
              placeholder="说明（可选）"
            />
          </div>
        )}
      </section>

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
            const history = bandHistories[band.band_id];
            const context = defaultBandLineupContexts[band.band_id];
            const displayName = history?.name_versions.find(
              (version) => version.name_version_id === context?.band_name_version_id,
            )?.band_name ?? band.band_name;
            const memberOptions = history && context
              ? history.lineup_versions.find(
                  (version) => version.lineup_version_id === context.base_lineup_version_id,
                )?.members ?? []
              : band.band_members ?? [];
            return (
              <div key={band.band_id} className="band-member-block">
                <label className="band-member-main">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleDefaultBand(band.band_id)}
                  />
                  <span>{band.band_id} - {displayName}</span>
                </label>
                {selected && history && context && (
                  <p className="console-admin-hint">
                    {history.lineup_versions.find(
                      (version) => version.lineup_version_id === context.base_lineup_version_id,
                    )?.version_label ?? "加载中"}
                  </p>
                )}
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
                  <td>{row.opening_time ?? "未公布"}</td>
                  <td>{row.start_time ?? "未公布"}</td>
                  <td>{row.timezone}</td>
                  <td>{row.venue_id ?? "未公布"}</td>
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
