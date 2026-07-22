import type { ReactNode } from "react";

import type { LiveDetailResponse, PerformanceGroupRef, TourRef } from "../api";
import { getBandIconSrc } from "./BandIconsCell";
import { MemberStatusTable } from "./DetailMemberTable";
import { DetailTitleLink } from "./DetailTitleLink";
import { formatLiveType } from "./console/constants";

export type LiveDetailFallback = {
  liveTitle: string;
  liveDate: string;
  url: string | null;
};

type LiveDetailContentProps = {
  detailData: LiveDetailResponse | null;
  detailLoading: boolean;
  detailError: string | null;
  fallback: LiveDetailFallback;
  headerAction?: ReactNode;
  onOpenTour?: (tour: TourRef) => void;
  onOpenPerformanceGroup?: (group: PerformanceGroupRef, sourceLiveId: number) => void;
  showTourReference?: boolean;
};

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "-";

  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;

  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;

  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  const timezoneLabelMap: Record<string, string> = { "+08:00": "CN", "+09:00": "JP" };
  return `${timePart}(${timezoneLabelMap[normalizedOffset] ?? `UTC${normalizedOffset}`})`;
}

function EventAttendeesLine({ attendees }: { attendees: LiveDetailResponse["event_attendees"] }) {
  const tokens = attendees.flatMap((attendee) => {
    const labels = attendee.mode === "full" ? ["全员"] : attendee.members;
    return labels.map((label) => ({
      bandId: attendee.band_id,
      bandName: attendee.band_name,
      label,
    }));
  });

  if (tokens.length === 0) return null;

  return (
    <p className="detail-row event-attendees-row">
      <strong>出演成员：</strong>
      <span className="event-attendee-list">
        {tokens.map((token, index) => {
          const iconSrc = getBandIconSrc(token.bandId);
          return (
            <span key={`${token.bandId}-${token.label}-${index}`} className="event-attendee-item">
              {index > 0 && <span className="event-attendee-separator">/</span>}
              <span className="event-attendee-token" title={`${token.bandName} ${token.label}`}>
                {iconSrc && <img src={iconSrc} alt={token.bandName} className="event-attendee-icon" />}
                <span>{token.label}</span>
              </span>
            </span>
          );
        })}
      </span>
    </p>
  );
}

export function LiveDetailContent({
  detailData,
  detailLoading,
  detailError,
  fallback,
  headerAction,
  onOpenTour,
  onOpenPerformanceGroup,
  showTourReference = true,
}: LiveDetailContentProps) {
  const bandNamesText = detailData
    ? detailData.band_names.filter((name) => name.trim() !== "").join(" / ") || "-"
    : detailLoading ? "加载中..." : "-";
  const detailUrl = detailData?.url ?? fallback.url ?? null;

  return (
    <>
      <div className="detail-page-head">
        <h2>
          {detailUrl ? (
            <DetailTitleLink href={detailUrl}>{detailData?.live_title ?? fallback.liveTitle}</DetailTitleLink>
          ) : detailData?.live_title ?? fallback.liveTitle}
        </h2>
        {headerAction}
      </div>
      <div className="detail-meta-line">
        <p className="detail-inline-item detail-inline-item-date"><strong>日期：</strong><span>{detailData?.live_date ?? fallback.liveDate}</span></p>
        <p className="detail-inline-item"><strong>开场：</strong><span>{formatTimedLabel(detailData?.opening_time)}</span></p>
        <p className="detail-inline-item"><strong>开演：</strong><span>{formatTimedLabel(detailData?.start_time)}</span></p>
        <p className="detail-inline-item detail-inline-item-venue"><strong>场地：</strong><span>{detailData?.venue?.trim() ? detailData.venue : "-"}</span></p>
        <p className="detail-inline-item detail-inline-item-type"><strong>类型：</strong><span>{formatLiveType(detailData?.live_type ?? "")}</span></p>
      </div>
      <p className="detail-row"><strong>乐队：</strong><span>{bandNamesText}</span></p>
      {detailData?.live_type === "event" && (
        <EventAttendeesLine attendees={detailData.event_attendees ?? []} />
      )}
      {detailData?.performance_group && onOpenPerformanceGroup && (
        <p className="detail-row">
          <strong>活动组：</strong>
          <button type="button" className="detail-tour-link" onClick={() => onOpenPerformanceGroup(detailData.performance_group as PerformanceGroupRef, detailData.live_id)}>{detailData.performance_group.group_title}</button>
        </p>
      )}
      {showTourReference && detailData?.tour && onOpenTour && (
        <p className="detail-row">
          <strong>巡演：</strong>
          <button type="button" className="detail-tour-link" onClick={() => onOpenTour(detailData.tour as TourRef)}>{detailData.tour.tour_title}</button>
        </p>
      )}
      <div className="detail-table-wrap">
        <MemberStatusTable rows={detailData?.detail_rows} loading={detailLoading} error={detailError} />
      </div>
    </>
  );
}
