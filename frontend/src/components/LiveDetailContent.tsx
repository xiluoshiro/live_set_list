import type { ReactNode } from "react";

import type { LiveDetailResponse, PerformanceGroupRef, TourRef } from "../api";
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
      {detailData?.performance_group && onOpenPerformanceGroup && (
        <p className="detail-row">
          <strong>活动组：</strong>
          <button type="button" className="detail-tour-link" onClick={() => onOpenPerformanceGroup(detailData.performance_group as PerformanceGroupRef, detailData.live_id)}>查看活动组: {detailData.performance_group.group_title}</button>
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
