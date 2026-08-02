import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type MutableRefObject } from "react";

import type {
  LiveDetailBandMember,
  LiveDetailEventAttendee,
  LiveDetailResponse,
  LiveDetailRow,
  PerformanceGroupRef,
  TourRef,
} from "../api";
import { getBandRepresentativeColor } from "./BandIconsCell";
import { Collapsible } from "./ui/Collapsible";
import { DropdownMenu } from "./ui/DropdownMenu";
import { Popover } from "./ui/Popover";
import { formatLiveType } from "./console/constants";
import { getLiveStatusPresentation } from "../liveStatus";

export type LiveDetailFallback = {
  liveTitle: string;
  liveDate: string;
  url: string | null;
};

export type StageLedgerContentProps = {
  detailData: LiveDetailResponse | null;
  detailLoading: boolean;
  detailError: string | null;
  detailNotFound?: boolean;
  fallback: LiveDetailFallback;
  onRetry?: () => void;
  onBack?: () => void;
  onOpenTour?: (tour: TourRef) => void;
  onOpenPerformanceGroup?: (group: PerformanceGroupRef, sourceLiveId: number) => void;
  onOpenBand?: (bandId: number) => void;
  canFavorite?: boolean;
  isFavorite?: boolean;
  isFavoriteSyncing?: boolean;
  onToggleFavorite?: () => void;
  onRequestLogin?: () => void;
  showTourReference?: boolean;
  embedded?: boolean;
};

type StageRow = LiveDetailRow & {
  absolute_order: number;
  segment_type: string;
  sub_order: number;
  song_id: number;
  band_members: LiveDetailBandMember[];
  other_members: NonNullable<LiveDetailRow["other_members"]>;
  comments: string[];
};

type StageSegment = {
  code: string;
  rows: StageRow[];
};

type StageActBlock = {
  key: string;
  rows: StageRow[];
  bands: LiveDetailBandMember[];
};

const SEGMENT_LABELS: Record<string, string> = {
  M: "Main Set",
  OP: "Opening Act",
  EN: "Encore",
  WEN: "W Encore",
  RH: "Rehearsal",
};

const EXTRA_CATEGORY_LABELS: Record<string, string> = {
  former: "前成员",
  incoming: "新成员",
  guest: "嘉宾",
  support: "支援",
};

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "未记录";
  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;
  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;
  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  const timezoneLabelMap: Record<string, string> = { "+08:00": "CN", "+09:00": "JP" };
  return `${timePart} (${timezoneLabelMap[normalizedOffset] ?? `UTC${normalizedOffset}`})`;
}

function getCanonicalPath(liveId: number): string {
  return `/lives/${liveId}`;
}

function getCanonicalUrl(liveId: number): string {
  if (typeof window === "undefined") return getCanonicalPath(liveId);
  return `${window.location.origin}${getCanonicalPath(liveId)}`;
}

function parseRowPosition(rowId: string): { absoluteOrder: number; segmentType: string; subOrder: number } {
  const match = rowId.match(/^([A-Za-z]+)(\d+)$/);
  if (!match) return { absoluteOrder: 1, segmentType: rowId || "M", subOrder: 1 };
  const subOrder = Number(match[2]);
  return { absoluteOrder: subOrder, segmentType: match[1], subOrder };
}

function normalizeRows(rows: LiveDetailRow[] | undefined): StageRow[] {
  return (rows ?? [])
    .map((row, index) => {
      const rowId = String(row.row_id);
      const fallback = parseRowPosition(rowId);
      return {
        ...row,
        row_id: rowId,
        absolute_order: row.absolute_order ?? (fallback.absoluteOrder > 0 ? fallback.absoluteOrder : index + 1),
        segment_type: row.segment_type ?? fallback.segmentType,
        sub_order: row.sub_order ?? fallback.subOrder,
        song_id: row.song_id ?? index + 1,
        band_members: Array.isArray(row.band_members) ? row.band_members : [],
        other_members: Array.isArray(row.other_members) ? row.other_members : [],
        comments: Array.isArray(row.comments) ? row.comments : [],
      };
    })
    .sort((a, b) => a.absolute_order - b.absolute_order);
}

function getBandKey(member: Pick<LiveDetailBandMember, "band_id" | "band_name">): string {
  return `${member.band_id ?? "unknown"}:${member.band_name}`;
}

function getBandColor(member: Pick<LiveDetailBandMember, "band_id" | "band_name">): string {
  const representativeColor = getBandRepresentativeColor(member.band_id ?? 0);
  return representativeColor ?? "var(--stage-rail-neutral)";
}

function uniqueBandMembers(members: LiveDetailBandMember[]): LiveDetailBandMember[] {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = getBandKey(member);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSegments(rows: StageRow[]): StageSegment[] {
  const segments: StageSegment[] = [];
  rows.forEach((row) => {
    const current = segments[segments.length - 1];
    if (current?.code === row.segment_type) {
      current.rows.push(row);
    } else {
      segments.push({ code: row.segment_type, rows: [row] });
    }
  });
  return segments;
}

function buildActBlocks(rows: StageRow[]): StageActBlock[] {
  const blocks: StageActBlock[] = [];
  rows.forEach((row) => {
    const bands = uniqueBandMembers(row.band_members);
    const key = bands.map(getBandKey).join("|") || "unrecorded";
    const previous = blocks[blocks.length - 1];
    if (previous?.key === key) {
      previous.rows.push(row);
      return;
    }
    blocks.push({ key, rows: [row], bands });
  });
  return blocks;
}

function segmentLabel(code: string): string {
  return SEGMENT_LABELS[code] ?? code;
}

function attendanceStatus(member: LiveDetailBandMember): string {
  return member.attendance_status ?? (member.is_full ? "full" : "partial");
}

function attendanceText(member: LiveDetailBandMember): string {
  const status = attendanceStatus(member);
  const expected = member.expected_count ?? member.total_count ?? 0;
  const present = member.present_count ?? member.present_members.length;
  const extras = member.extra_members?.length ?? 0;
  if (status === "unknown") return `阵容基准未知，实际出演 ${present} 人`;
  if (status === "full_plus") return `全员 ${expected}/${expected}，特别出演 ${extras} 人`;
  if (status === "full") return `全员 ${expected}/${expected}`;
  return `部分成员 ${present}/${expected}`;
}

function formatScheduleHistoryParts(
  history: NonNullable<LiveDetailResponse["schedule_history"]>[number],
  nextHistory: NonNullable<LiveDetailResponse["schedule_history"]>[number] | undefined,
  detail: LiveDetailResponse,
): string[] {
  const parts: string[] = [];
  const nextTitle = nextHistory?.previous_live_title ?? detail.live_title;
  const nextDate = nextHistory?.previous_live_date ?? detail.live_date;
  const nextOpeningTime = nextHistory?.previous_opening_time ?? detail.opening_time;
  const nextStartTime = nextHistory?.previous_start_time ?? detail.start_time;
  const nextVenue = nextHistory?.previous_venue ?? detail.venue;
  if (history.previous_live_title && history.previous_live_title !== nextTitle) {
    parts.push(`名称 ${history.previous_live_title}`);
  }
  if (history.previous_live_date !== nextDate) parts.push(`日期 ${history.previous_live_date}`);
  if (formatTimedLabel(history.previous_opening_time) !== formatTimedLabel(nextOpeningTime)) {
    parts.push(`开场 ${formatTimedLabel(history.previous_opening_time)}`);
  }
  if (formatTimedLabel(history.previous_start_time) !== formatTimedLabel(nextStartTime)) {
    parts.push(`开演 ${formatTimedLabel(history.previous_start_time)}`);
  }
  if ((history.previous_venue ?? null) !== (nextVenue ?? null)) {
    parts.push(`场地 ${history.previous_venue ?? "未记录"}`);
  }
  if (history.note) parts.push(history.note);
  return parts;
}

function StatusLine({ detail }: { detail: LiveDetailResponse }) {
  const status = getLiveStatusPresentation(
    detail.event_status ?? "scheduled",
    detail.date_phase ?? "past",
    detail.was_rescheduled ?? false,
  );
  return (
    <div className="stage-status-line" data-status-tone={status.tone}>
      <span>{status.primary}</span>
      {status.secondary && <span>{status.secondary}</span>}
    </div>
  );
}

function BandNameList({
  detail,
  onOpenBand,
}: {
  detail: LiveDetailResponse;
  onOpenBand?: (bandId: number) => void;
}) {
  if (detail.band_names.length === 0) return <span className="stage-muted">未记录</span>;
  return (
    <ul className="stage-band-list">
      {detail.band_names.map((bandName, index) => {
        const bandId = detail.bands[index];
        return (
          <li key={`${bandName}-${bandId ?? index}`}>
            {onOpenBand && typeof bandId === "number" ? (
              <button type="button" className="stage-inline-link" onClick={() => onOpenBand(bandId)}>
                {bandName}
              </button>
            ) : (
              <span>{bandName}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StageSummary({ detail, rows }: { detail: LiveDetailResponse; rows: StageRow[] }) {
  const isEvent = detail.live_type === "event";
  const isCancelled = detail.event_status === "cancelled";
  const actCount = new Set(
    rows.flatMap((row) => row.band_members.map((member) => getBandKey(member))),
  ).size || detail.band_names.length;
  const segmentCount = new Set(rows.map((row) => row.segment_type)).size;
  const hasPerTrackAttendance = rows.some((row) => row.band_members.length > 0);
  const cells = isCancelled
    ? [
        { value: "已取消", label: "当前状态" },
        { value: "未形成", label: "演出流程" },
        { value: "可用", label: "官方资料" },
      ]
    : isEvent
      ? [
          { value: String(detail.event_attendees.length || detail.band_names.length), label: "BANDS" },
          { value: detail.event_attendees.length > 0 ? "已记录" : "暂无记录", label: "出席阵容" },
          { value: rows.length > 0 ? String(rows.length) : "暂无", label: "演出曲目" },
        ]
      : [
          { value: String(rows.length), label: "TRACKS" },
          { value: String(actCount), label: "ACTS" },
          { value: String(segmentCount), label: "段落" },
          { value: hasPerTrackAttendance ? "已记录" : "未记录", label: "逐曲出演" },
        ];
  return (
    <section className="stage-summary-ruler" aria-label="档案摘要">
      {cells.map((cell) => (
        <div key={cell.label} className="stage-summary-cell">
          <strong>{cell.value}</strong>
          <span>{cell.label}</span>
        </div>
      ))}
    </section>
  );
}

function StageTrackInspector({ row, onClose }: { row: StageRow; onClose?: () => void }) {
  return (
    <div className="stage-inspector-body">
      <div className="stage-inspector-heading">
        <div>
          <span className="stage-inspector-index">{row.row_id}</span>
          <h3>{row.song_name}</h3>
        </div>
        {onClose && (
          <button type="button" className="stage-iconless-button" onClick={onClose} aria-label="关闭逐曲检查器">
            关闭
          </button>
        )}
      </div>
      <div className="stage-inspector-stack">
        <div className="stage-inspector-group">
          <h4>实际出演</h4>
          {row.band_members.length === 0 ? (
            <p className="stage-muted">本曲暂无版本化出演记录。</p>
          ) : (
            <ul className="stage-member-list">
              {row.band_members.map((member) => (
                <li key={getBandKey(member)} className="stage-member-record">
                  <div className="stage-member-title">
                    <span className="stage-band-mark" style={{ backgroundColor: getBandColor(member) }} aria-hidden="true" />
                    <strong>{member.band_name}</strong>
                    <span className="stage-attendance-label" data-attendance={attendanceStatus(member)}>
                      {attendanceText(member)}
                    </span>
                  </div>
                  {member.lineup_version && (
                    <p>
                      阵容版本：{member.lineup_version.version_label}
                      {member.next_lineup_version && ` 至 ${member.next_lineup_version.version_label}`}
                    </p>
                  )}
                  {member.lineup_usage === "handover" && (
                    <p>
                      交接共演，正式满员基准：{member.handover_baseline === "next" ? "新阵容" : member.handover_baseline === "base" ? "旧阵容" : "阵容基准未知"}
                    </p>
                  )}
                  <p>实到成员：{member.present_members.length > 0 ? member.present_members.join(" / ") : "未记录"}</p>
                  {member.missing_members && member.missing_members.length > 0 && (
                    <p>缺席成员：{member.missing_members.join(" / ")}</p>
                  )}
                  {member.extra_members && member.extra_members.length > 0 && (
                    <p>
                      额外出演：{member.extra_members.map((extra) => `${extra.member_name}（${EXTRA_CATEGORY_LABELS[extra.category] ?? extra.category}）`).join(" / ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {(row.other_members.length > 0 || row.comments.length > 0) && (
          <div className="stage-inspector-group">
            <h4>资料标记</h4>
            <ul className="stage-detail-list">
              {row.comments.map((comment) => (
                <li key={comment}>{comment === "翻唱" && row.cover_band ? `翻唱自 ${row.cover_band.band_name}` : comment}</li>
              ))}
              {row.other_members.map((other) => (
                <li key={other.key}>{other.key}：{other.value.join(" / ") || "未记录"}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function StageColorRail({ bands }: { bands: LiveDetailBandMember[] }) {
  const colors = uniqueBandMembers(bands);
  return (
    <span className="stage-color-rail" aria-hidden="true">
      {(colors.length > 0 ? colors : [{ band_id: null, band_name: "未记录" }]).map((band, index) => (
        <span key={`${getBandKey(band)}-${index}`} style={{ backgroundColor: colors.length > 0 ? getBandColor(band) : "var(--stage-rail-neutral)" }} />
      ))}
    </span>
  );
}

function StageFlow({
  rows,
  selectedTrackId,
  setSelectedTrackId,
  mobileExpandedTrackId,
  setMobileExpandedTrackId,
  triggerRefs,
}: {
  rows: StageRow[];
  selectedTrackId: string | null;
  setSelectedTrackId: (value: string | null) => void;
  mobileExpandedTrackId: string | null;
  setMobileExpandedTrackId: (value: string | null) => void;
  triggerRefs: MutableRefObject<Record<string, HTMLButtonElement | null>>;
}) {
  const segments = buildSegments(rows);
  const bandAnchors = new Set<string>();
  return (
    <div className="stage-flow-list">
      {segments.map((segment) => (
        <section key={segment.code} className="stage-segment" aria-labelledby={`stage-segment-${segment.code}`}>
          <header className="stage-segment-heading">
            <h3 id={`stage-segment-${segment.code}`} tabIndex={-1}>{segmentLabel(segment.code)}</h3>
            <span>{segment.code}</span>
          </header>
          {buildActBlocks(segment.rows).map((block, blockIndex) => {
            const firstBand = block.bands[0];
            const bandKey = firstBand ? getBandKey(firstBand) : null;
            const bandAnchor = bandKey && !bandAnchors.has(bandKey)
              ? `stage-band-${encodeURIComponent(bandKey)}`
              : undefined;
            if (bandKey) bandAnchors.add(bandKey);
            return (
            <div id={bandAnchor} tabIndex={bandAnchor ? -1 : undefined} key={`${segment.code}-${block.key}-${blockIndex}`} className="stage-act-block">
              <StageColorRail bands={block.bands} />
              <div className="stage-act-heading">
                <span>{block.bands.length > 0 ? block.bands.map((band) => band.band_name).join(" × ") : "出演关系未记录"}</span>
              </div>
              <ol className="stage-track-list" start={block.rows[0]?.absolute_order ?? 1}>
                {block.rows.map((row) => {
                  const isSelected = row.row_id === selectedTrackId;
                  const isMobileExpanded = row.row_id === mobileExpandedTrackId;
                  const inlineInspectorId = `stage-inline-${row.row_id}`;
                  return (
                    <li key={row.row_id} className={`stage-track-item${isSelected ? " is-selected" : ""}`}>
                      <Collapsible.Root
                        open={isMobileExpanded}
                        onOpenChange={(open) => setMobileExpandedTrackId(open ? row.row_id : null)}
                      >
                        <Collapsible.Trigger asChild>
                          <button
                            ref={(element) => {
                              triggerRefs.current[row.row_id] = element;
                            }}
                            type="button"
                            className="stage-track-trigger"
                            aria-expanded={isMobileExpanded}
                            aria-controls={inlineInspectorId}
                            onClick={() => setSelectedTrackId(row.row_id)}
                          >
                            <span className="stage-track-number">{String(row.absolute_order).padStart(2, "0")}</span>
                            <span className="stage-track-copy">
                              <strong>{row.song_name}</strong>
                              {row.band_members.length > 0 && (
                                <span>{row.band_members.map((band) => band.band_name).join(" × ")}</span>
                              )}
                            </span>
                            <span className="stage-track-meta">
                              {row.comments.length > 0 && <span>{row.comments.join(" / ")}</span>}
                              <span aria-hidden="true">{isMobileExpanded ? "收起" : "查看"}</span>
                            </span>
                          </button>
                        </Collapsible.Trigger>
                        <Collapsible.Content id={inlineInspectorId} className="stage-inline-inspector">
                          <StageTrackInspector row={row} />
                        </Collapsible.Content>
                      </Collapsible.Root>
                    </li>
                  );
                })}
              </ol>
            </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function EventAttendees({ attendees }: { attendees: LiveDetailEventAttendee[] }) {
  const [expandedBandId, setExpandedBandId] = useState<number | null>(null);
  return (
    <section className="stage-attendance-section" id="stage-attendance" tabIndex={-1} aria-labelledby="stage-attendance-title">
      <div className="stage-section-heading">
        <div>
          <h2 id="stage-attendance-title">出演阵容</h2>
          <p>按活动记录展开每个 Band 的出席成员。</p>
        </div>
        <span>{attendees.length} BANDS</span>
      </div>
      <ul className="stage-attendee-list">
        {attendees.map((attendee) => {
          const isExpanded = expandedBandId === attendee.band_id;
          const contentId = `stage-attendee-${attendee.band_id}`;
          return (
            <li key={attendee.band_id} className="stage-attendee-item">
              <Collapsible.Root open={isExpanded} onOpenChange={(open) => setExpandedBandId(open ? attendee.band_id : null)}>
                <Collapsible.Trigger asChild>
                  <button type="button" className="stage-attendee-trigger" aria-expanded={isExpanded} aria-controls={contentId}>
                    <span className="stage-attendee-name">{attendee.band_name}</span>
                    <span>{attendee.mode === "full" ? "全员出席" : `部分成员，已记录 ${attendee.members.length} 人`}</span>
                    <span aria-hidden="true">{isExpanded ? "收起" : "展开"}</span>
                  </button>
                </Collapsible.Trigger>
                <Collapsible.Content id={contentId} className="stage-attendee-content">
                  <p>已记录成员：{attendee.members.join(" / ") || "未记录"}</p>
                </Collapsible.Content>
              </Collapsible.Root>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LineupSummary({ rows }: { rows: StageRow[] }) {
  const summaries = useMemo(() => {
    const byBand = new Map<string, { member: LiveDetailBandMember; members: Set<string>; statuses: Set<string> }>();
    rows.forEach((row) => row.band_members.forEach((member) => {
      const key = getBandKey(member);
      const current = byBand.get(key) ?? { member, members: new Set<string>(), statuses: new Set<string>() };
      member.present_members.forEach((name) => current.members.add(name));
      current.statuses.add(attendanceStatus(member));
      byBand.set(key, current);
    }));
    return [...byBand.values()];
  }, [rows]);
  if (summaries.length === 0) return null;
  return (
    <section className="stage-lineup-summary" id="stage-lineup" tabIndex={-1} aria-labelledby="stage-lineup-title">
      <div className="stage-section-heading">
        <div>
          <h2 id="stage-lineup-title">阵容摘要</h2>
          <p>摘要只汇总逐曲出演记录，具体交接和缺席成员请查看曲目。</p>
        </div>
        <span>{summaries.length} ACTS</span>
      </div>
      <ul className="stage-lineup-list">
        {summaries.map(({ member, members, statuses }) => (
          <li key={getBandKey(member)}>
            <span className="stage-band-mark" style={{ backgroundColor: getBandColor(member) }} aria-hidden="true" />
            <strong>{member.band_name}</strong>
            <span>{statuses.has("unknown") ? "阵容基准未知" : "逐曲记录"}</span>
            <span>{members.size > 0 ? `${members.size} 名成员有出演记录` : "成员未记录"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScheduleHistory({ detail }: { detail: LiveDetailResponse }) {
  const histories = detail.schedule_history ?? [];
  if (histories.length === 0) return null;
  return (
    <section className="stage-history-section" id="stage-history" tabIndex={-1} aria-labelledby="stage-history-title">
      <div className="stage-section-heading">
        <div>
          <h2 id="stage-history-title">改期记录</h2>
          <p>只列出相邻版本之间实际发生变化的字段。</p>
        </div>
      </div>
      <ol className="stage-history-list">
        {histories.map((history, index) => {
          const parts = formatScheduleHistoryParts(history, histories[index + 1], detail);
          return (
            <li key={`${history.changed_at}-${index}`}>
              <time dateTime={history.changed_at}>{history.changed_at}</time>
              <span>{parts.length > 0 ? parts.join("；") : "排期发生变化"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RelatedArchives({
  detail,
  onOpenTour,
  onOpenPerformanceGroup,
  showTourReference,
}: {
  detail: LiveDetailResponse;
  onOpenTour?: (tour: TourRef) => void;
  onOpenPerformanceGroup?: (group: PerformanceGroupRef, sourceLiveId: number) => void;
  showTourReference: boolean;
}) {
  if ((!detail.tour || !showTourReference || !onOpenTour) && (!detail.performance_group || !onOpenPerformanceGroup)) return null;
  return (
    <section className="stage-related-section" id="stage-related" tabIndex={-1} aria-labelledby="stage-related-title">
      <div className="stage-section-heading">
        <div>
          <h2 id="stage-related-title">关联档案</h2>
          <p>Tour 表示巡演连续关系，Performance Group 表示活动集合。</p>
        </div>
      </div>
      <div className="stage-related-list">
        {showTourReference && detail.tour && onOpenTour && (
          <div className="stage-related-row">
            <span>Tour</span>
            <button type="button" className="stage-inline-link" onClick={() => onOpenTour(detail.tour as TourRef)}>
              {detail.tour.tour_title}
            </button>
          </div>
        )}
        {detail.performance_group && onOpenPerformanceGroup && (
          <div className="stage-related-row">
            <span>Performance Group</span>
            <button type="button" className="stage-inline-link" onClick={() => onOpenPerformanceGroup(detail.performance_group as PerformanceGroupRef, detail.live_id)}>
              {detail.performance_group.group_title}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function SharePopover({
  liveId,
  title,
  onShare,
  onCopy,
}: {
  liveId: number;
  title: string;
  onShare: () => void;
  onCopy: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="stage-action-button stage-share-action">分享</button>
      </Popover.Trigger>
      <Popover.Content className="stage-share-popover" sideOffset={8} align="end">
        <span>永久地址</span>
        <code>{getCanonicalPath(liveId)}</code>
        <div className="stage-share-actions">
          <button type="button" className="stage-inline-action" onClick={onShare}>分享</button>
          <button type="button" className="stage-inline-action" onClick={onCopy}>复制地址</button>
        </div>
        <span className="stage-sr-only">{title}</span>
      </Popover.Content>
    </Popover.Root>
  );
}

function StageSkeleton({ fallback }: { fallback: LiveDetailFallback }) {
  return (
    <div className="stage-ledger-page stage-ledger-loading" data-stage-ledger>
      <div className="stage-breadcrumb-skeleton" />
      <article className="stage-ledger-article">
        <header className="stage-masthead">
          <div className="stage-masthead-main">
            <span className="stage-skeleton-line stage-skeleton-short" />
            <h1 className="stage-skeleton-title">{fallback.liveTitle || "演出资料"}</h1>
            <span className="stage-skeleton-line stage-skeleton-medium" />
          </div>
          <div className="stage-skeleton-schedule">
            <span className="stage-skeleton-line" />
            <span className="stage-skeleton-line" />
            <span className="stage-skeleton-line" />
          </div>
        </header>
        <div className="stage-summary-ruler stage-skeleton-summary">
          <span /><span /><span /><span />
        </div>
        <div className="stage-skeleton-content">
          <span /><span /><span /><span />
        </div>
      </article>
    </div>
  );
}

function buildStructuredData(detail: LiveDetailResponse): Record<string, unknown> {
  const statusMap: Record<string, string> = {
    scheduled: "https://schema.org/EventScheduled",
    postponed: "https://schema.org/EventPostponed",
    cancelled: "https://schema.org/EventCancelled",
  };
  const startDate = detail.start_time ? `${detail.live_date}T${detail.start_time}` : detail.live_date;
  return {
    "@context": "https://schema.org",
    "@type": detail.live_type === "event" ? "Event" : "MusicEvent",
    name: detail.live_title,
    startDate,
    eventStatus: statusMap[detail.event_status ?? "scheduled"],
    location: detail.venue ? { "@type": "Place", name: detail.venue } : undefined,
    performer: detail.band_names.map((name) => ({ "@type": "PerformingGroup", name })),
    url: getCanonicalUrl(detail.live_id),
  };
}

export function StageLedgerContent({
  detailData,
  detailLoading,
  detailError,
  detailNotFound = false,
  fallback,
  onRetry,
  onBack,
  onOpenTour,
  onOpenPerformanceGroup,
  onOpenBand,
  canFavorite = false,
  isFavorite = false,
  isFavoriteSyncing = false,
  onToggleFavorite,
  onRequestLogin,
  showTourReference = true,
  embedded = false,
}: StageLedgerContentProps) {
  const rows = useMemo(() => normalizeRows(detailData?.detail_rows), [detailData?.detail_rows]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [mobileExpandedTrackId, setMobileExpandedTrackId] = useState<string | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const detailTitle = detailData?.live_title ?? fallback.liveTitle;
  const detailUrl = detailData?.url ?? fallback.url;
  const isCancelled = detailData?.event_status === "cancelled";
  const visibleRows = isCancelled ? [] : rows;
  const selectedRow = visibleRows.find((row) => row.row_id === selectedTrackId) ?? null;
  const shouldShowJump = visibleRows.length > 20
    || (new Set(visibleRows.flatMap((row) => row.band_members.map((member) => getBandKey(member)))).size > 3)
    || (new Set(visibleRows.map((row) => row.segment_type)).size > 2);

  const clearSelection = useCallback(() => {
    const previousId = selectedTrackId ?? mobileExpandedTrackId;
    setSelectedTrackId(null);
    setMobileExpandedTrackId(null);
    if (previousId) triggerRefs.current[previousId]?.focus();
  }, [mobileExpandedTrackId, selectedTrackId]);

  useEffect(() => {
    const hashId = decodeURIComponent(window.location.hash.replace(/^#track-/, ""));
    if (hashId && visibleRows.some((row) => row.row_id === hashId)) {
      setSelectedTrackId(hashId);
      setMobileExpandedTrackId(hashId);
    }
  }, [visibleRows]);

  useEffect(() => {
    if (detailLoading) return;
    if (!selectedTrackId) {
      if (window.location.hash.startsWith("#track-")) {
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
      }
      return;
    }
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}#track-${encodeURIComponent(selectedTrackId)}`,
    );
  }, [detailLoading, selectedTrackId]);

  useEffect(() => {
    if (embedded || !detailData) return undefined;
    const previousTitle = document.title;
    const descriptionMeta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = descriptionMeta?.content ?? null;
    const createdDescriptionMeta = descriptionMeta ?? document.head.appendChild(document.createElement("meta"));
    if (!descriptionMeta) createdDescriptionMeta.name = "description";

    document.title = `${detailData.live_title} · LiveSetList`;
    createdDescriptionMeta.content = [
      detailData.live_date,
      detailData.venue,
      detailData.band_names.join(" / "),
    ].filter(Boolean).join(" · ");

    return () => {
      document.title = previousTitle;
      if (descriptionMeta) {
        descriptionMeta.content = previousDescription ?? "";
      } else {
        createdDescriptionMeta.remove();
      }
    };
  }, [detailData, embedded]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (selectedTrackId !== null || mobileExpandedTrackId !== null)) {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, mobileExpandedTrackId, selectedTrackId]);

  const copyPermanentUrl = useCallback(async () => {
    const url = getCanonicalUrl(detailData?.live_id ?? 0);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.setAttribute("readonly", "true");
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      setShareMessage("永久地址已复制");
    } catch {
      setShareMessage("复制失败，请手动复制地址");
    }
  }, [detailData?.live_id]);

  const shareLive = useCallback(async () => {
    const url = getCanonicalUrl(detailData?.live_id ?? 0);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: detailTitle, text: detailTitle, url });
        setShareMessage("已打开分享");
      } else {
        await copyPermanentUrl();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyPermanentUrl();
    }
  }, [copyPermanentUrl, detailTitle, detailData?.live_id]);

  const focusAnchor = useCallback((event: MouseEvent<HTMLAnchorElement>, targetId: string) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${targetId}`);
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({ behavior: "auto", block: "start" });
  }, []);

  if (detailNotFound) {
    return (
      <div className={`stage-ledger-page${embedded ? " is-embedded" : ""}`} data-stage-ledger>
        <article className="stage-error-article" role="alert">
          <p className="stage-error-kicker">404</p>
          <h1>未找到这场 Live</h1>
          <p>这条演出资料不存在，或已经从公开资料中移除。</p>
          {onBack && <button type="button" className="stage-primary-button" onClick={onBack}>返回演出资料</button>}
        </article>
      </div>
    );
  }

  if (detailLoading && !detailData) return <StageSkeleton fallback={fallback} />;

  if (!detailData) {
    return (
      <div className={`stage-ledger-page${embedded ? " is-embedded" : ""}`} data-stage-ledger>
        <article className="stage-ledger-article">
          <header className="stage-masthead stage-masthead-fallback">
            <div className="stage-masthead-main">
              <div className="stage-title-meta"><span>演出资料</span></div>
              <h1>{fallback.liveTitle || "演出资料"}</h1>
              <p className="stage-fallback-date">{fallback.liveDate || "日期未记录"}</p>
            </div>
            {onBack && <button type="button" className="stage-action-button" aria-label="返回" onClick={onBack}>返回资料</button>}
          </header>
          <section className="stage-error-section" role="alert">
            <h2>详情读取失败</h2>
            <p>{detailError || "暂时无法读取这场 Live 的详细资料。"}</p>
            <div className="stage-error-actions">
              {onRetry && <button type="button" className="stage-primary-button" onClick={onRetry}>重试</button>}
              {onBack && <button type="button" className="stage-secondary-button" onClick={onBack}>返回演出资料</button>}
            </div>
          </section>
        </article>
      </div>
    );
  }

  const showAttendance = detailData.live_type === "event" && detailData.event_attendees.length > 0;
  const showFlow = visibleRows.length > 0;
  const hasLineupSummary = visibleRows.some((row) => row.band_members.length > 0);
  const hasRelated = Boolean(detailData.tour || detailData.performance_group);
  const hasSources = Boolean(detailUrl || detailData.schedule_history?.length);
  const titleId = `stage-ledger-title-${detailData.live_id}`;
  const structuredData = buildStructuredData(detailData);

  return (
    <div className={`stage-ledger-page${embedded ? " is-embedded" : ""}`} data-stage-ledger>
      {!embedded && (
        <nav className="stage-breadcrumb" aria-label="面包屑">
          <button type="button" className="stage-inline-link" onClick={onBack}>演出档案</button>
          {detailData.tour && <span aria-hidden="true">/</span>}
          {detailData.tour && <span>{detailData.tour.tour_title}</span>}
          {!detailData.tour && detailData.performance_group && <span aria-hidden="true">/</span>}
          {!detailData.tour && detailData.performance_group && <span>{detailData.performance_group.group_title}</span>}
        </nav>
      )}
      <article className="stage-ledger-article" aria-labelledby={titleId}>
        <header className="stage-masthead">
          <div className="stage-masthead-main">
            <div className="stage-title-meta">
              <StatusLine detail={detailData} />
              <span className="stage-type-label">{formatLiveType(detailData.live_type)}</span>
            </div>
            {embedded ? <h2 id={titleId}>{detailTitle}</h2> : <h1 id={titleId}>{detailTitle}</h1>}
            <div className="stage-masthead-bands">
              <span className="stage-field-label">出演</span>
              <BandNameList detail={detailData} onOpenBand={onOpenBand} />
            </div>
            {detailData.status_note && (
              <p className="stage-status-note" role="note">
                {detailData.event_status === "cancelled" ? "取消说明" : "延期说明"}：{detailData.status_note}
              </p>
            )}
          </div>
          <div className="stage-masthead-side">
            <dl className="stage-schedule-list">
              <div><dt>日期</dt><dd>{detailData.live_date}</dd></div>
              <div><dt>开场</dt><dd>{formatTimedLabel(detailData.opening_time)}</dd></div>
              <div><dt>开演</dt><dd>{formatTimedLabel(detailData.start_time)}</dd></div>
              <div><dt>场馆</dt><dd>{detailData.venue?.trim() || "未记录"}</dd></div>
            </dl>
            <div className="stage-actions" aria-label="演出操作">
              {onBack && <button type="button" className="stage-action-button stage-back-action" aria-label="返回" onClick={onBack}>返回资料</button>}
              {detailData.event_status !== "cancelled" && canFavorite && onToggleFavorite && (
                <button
                  type="button"
                  className={`stage-action-button${isFavorite ? " is-active" : ""}`}
                  aria-pressed={isFavorite}
                  aria-busy={isFavoriteSyncing}
                  onClick={onToggleFavorite}
                >
                  {isFavorite ? "已收藏" : "收藏"}
                </button>
              )}
              {detailData.event_status !== "cancelled" && !canFavorite && onRequestLogin && (
                <button type="button" className="stage-action-button" onClick={onRequestLogin}>登录后收藏</button>
              )}
              <SharePopover liveId={detailData.live_id} title={detailTitle} onShare={() => void shareLive()} onCopy={() => void copyPermanentUrl()} />
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="stage-action-button stage-more-action" aria-label="更多操作">更多</button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="stage-dropdown-content" sideOffset={6} align="end">
                    <DropdownMenu.Item className="stage-dropdown-item" onSelect={() => void shareLive()}>分享或复制地址</DropdownMenu.Item>
                    {detailUrl && (
                      <DropdownMenu.Item className="stage-dropdown-item" asChild>
                        <a href={detailUrl} target="_blank" rel="noreferrer">打开官方来源</a>
                      </DropdownMenu.Item>
                    )}
                    <DropdownMenu.Separator className="stage-dropdown-separator" />
                    <DropdownMenu.Item className="stage-dropdown-item" onSelect={() => clearSelection()}>关闭逐曲检查器</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {detailUrl && (
              <a className="stage-official-link stage-official-action" href={detailUrl} target="_blank" rel="noreferrer">官方来源</a>
            )}
          </div>
        </header>

        <StageSummary detail={detailData} rows={visibleRows} />

        <nav className="stage-anchor-nav" aria-label="页内导航">
          {showFlow && <a href="#stage-flow" onClick={(event) => focusAnchor(event, "stage-flow")}>演出流程</a>}
          {showAttendance && <a href="#stage-attendance" onClick={(event) => focusAnchor(event, "stage-attendance")}>出演阵容</a>}
          {hasLineupSummary && <a href="#stage-lineup" onClick={(event) => focusAnchor(event, "stage-lineup")}>阵容摘要</a>}
          {hasRelated && <a href="#stage-related" onClick={(event) => focusAnchor(event, "stage-related")}>关联档案</a>}
          {hasSources && <a href="#stage-sources" onClick={(event) => focusAnchor(event, "stage-sources")}>资料来源</a>}
        </nav>

        {detailError && detailData && (
          <div className="stage-inline-error" role="alert">
            <span>详情读取曾失败，页面保留已确认资料。</span>
            {onRetry && <button type="button" className="stage-inline-action" onClick={onRetry}>重试</button>}
          </div>
        )}

        {isCancelled ? (
          <section className="stage-status-body" id="stage-status" aria-labelledby="stage-status-title">
            <div className="stage-status-mark" aria-hidden="true">取消</div>
            <div>
              <h2 id="stage-status-title">本场 Live 已取消</h2>
              <p>{detailData.status_note || "当前资料没有形成公开演出流程。"}</p>
              <p className="stage-muted">保留当前日期、场馆和官方来源，供资料核对和分享使用。</p>
            </div>
          </section>
        ) : (
          <div className="stage-content-grid">
            <div className="stage-primary-column">
              {detailData.live_type === "event" && showAttendance && <EventAttendees attendees={detailData.event_attendees} />}
              {detailData.live_type === "event" && !showAttendance && !showFlow && (
                <section className="stage-empty-section" id="stage-attendance">
                  <h2>本页目前只收录演出基本资料</h2>
                  <p>暂无出席阵容或演出曲目记录。</p>
                </section>
              )}
              {showFlow ? (
                <section className="stage-flow-section" id="stage-flow" tabIndex={-1} aria-labelledby="stage-flow-title">
                  <div className="stage-section-heading">
                    <div>
                      <h2 id="stage-flow-title">演出流程</h2>
                      <p>按原始段落和绝对顺序排列，实际出演关系在曲目中展开。</p>
                    </div>
                    <span>{visibleRows.length} TRACKS</span>
                  </div>
                  {shouldShowJump && (
                    <nav className="stage-jump-nav" aria-label="演出流程跳转">
                      {buildSegments(visibleRows).map((segment) => (
                        <a key={segment.code} href={`#stage-segment-${segment.code}`} onClick={(event) => focusAnchor(event, `stage-segment-${segment.code}`)}>{segmentLabel(segment.code)}</a>
                      ))}
                        {uniqueBandMembers(visibleRows.flatMap((row) => row.band_members)).slice(0, 10).map((band) => (
                          <a key={getBandKey(band)} href={`#stage-band-${encodeURIComponent(getBandKey(band))}`} onClick={(event) => focusAnchor(event, `stage-band-${encodeURIComponent(getBandKey(band))}`)}>{band.band_name}</a>
                        ))}
                    </nav>
                  )}
                  <StageFlow
                    rows={visibleRows}
                    selectedTrackId={selectedTrackId}
                    setSelectedTrackId={setSelectedTrackId}
                    mobileExpandedTrackId={mobileExpandedTrackId}
                    setMobileExpandedTrackId={setMobileExpandedTrackId}
                    triggerRefs={triggerRefs}
                  />
                </section>
              ) : detailData.live_type !== "event" && (
                <section className="stage-empty-section" id="stage-flow" tabIndex={-1}>
                  <h2>演出流程尚未记录</h2>
                  <p>本页目前只收录演出基本资料，暂无演出曲目记录。</p>
                </section>
              )}
              {hasLineupSummary && <LineupSummary rows={visibleRows} />}
              <ScheduleHistory detail={detailData} />
              <RelatedArchives
                detail={detailData}
                onOpenTour={onOpenTour}
                onOpenPerformanceGroup={onOpenPerformanceGroup}
                showTourReference={showTourReference}
              />
              {hasSources && (
                <section className="stage-sources-section" id="stage-sources" tabIndex={-1} aria-labelledby="stage-sources-title">
                  <div className="stage-section-heading">
                    <div><h2 id="stage-sources-title">资料来源</h2><p>本站只展示当前接口可以确认的资料。</p></div>
                  </div>
                  {detailUrl && <a className="stage-source-link" href={detailUrl} target="_blank" rel="noreferrer">打开官方来源</a>}
                  {detailData.schedule_history && detailData.schedule_history.length > 0 && <a className="stage-source-link" href="#stage-history">查看改期记录</a>}
                </section>
              )}
            </div>
            <aside className="stage-inspector-column" aria-label="逐曲检查器">
              {selectedRow ? (
                <div className="stage-inspector-panel">
                  <StageTrackInspector row={selectedRow} onClose={clearSelection} />
                </div>
              ) : (
                <div className="stage-inspector-empty">
                  <span>逐曲检查器</span>
                  <p>选择一首歌曲查看实际出演、阵容版本和资料标记。</p>
                </div>
              )}
            </aside>
          </div>
        )}

        <div className="stage-mobile-action-bar" aria-label="移动端操作">
          {onBack && <button type="button" className="stage-mobile-action" aria-label="返回" onClick={onBack}>返回</button>}
          {detailData.event_status !== "cancelled" && canFavorite && onToggleFavorite && (
            <button type="button" className="stage-mobile-action" aria-pressed={isFavorite} onClick={onToggleFavorite}>
              {isFavorite ? "已收藏" : "收藏"}
            </button>
          )}
          {detailData.event_status !== "cancelled" && !canFavorite && onRequestLogin && (
            <button type="button" className="stage-mobile-action" onClick={onRequestLogin}>登录后收藏</button>
          )}
          <button type="button" className="stage-mobile-action" onClick={() => void shareLive()}>分享</button>
          {detailUrl && <a className="stage-mobile-action" href={detailUrl} target="_blank" rel="noreferrer">官方来源</a>}
        </div>
        <p className="stage-share-feedback" aria-live="polite">{shareMessage}</p>
        <script type="application/ld+json" data-stage-ledger-jsonld dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </article>
    </div>
  );
}
