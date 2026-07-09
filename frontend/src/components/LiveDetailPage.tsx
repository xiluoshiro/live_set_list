import { useEffect, useState } from "react";
import { getLiveDetail, type LiveDetailResponse } from "../api";
import { logError } from "../logger";
import { MemberStatusTable } from "./DetailMemberTable";
import { formatLiveType } from "./console/constants";

interface LiveDetailFallback {
  liveTitle: string;
  liveDate: string;
  url: string | null;
}

interface LiveDetailPageProps {
  liveId: number;
  fallback: LiveDetailFallback;
  onBack: () => void;
}

function formatTimedLabel(value: string | null | undefined): string {
  const raw = value?.trim();
  if (!raw) return "-";

  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;

  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;

  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  const timezoneLabelMap: Record<string, string> = {
    "+08:00": "CN",
    "+09:00": "JP",
  };
  const timezoneLabel = timezoneLabelMap[normalizedOffset] ?? `UTC${normalizedOffset}`;
  return `${timePart}(${timezoneLabel})`;
}

export function LiveDetailPage({ liveId, fallback, onBack }: LiveDetailPageProps) {
  const [detailData, setDetailData] = useState<LiveDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      setDetailData(null);
      try {
        const data = await getLiveDetail(liveId);
        if (!canceled) {
          setDetailData(data);
        }
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        logError("load_live_detail_failed", {
          liveId,
          message,
        });
        setDetailError(message);
      } finally {
        if (!canceled) {
          setDetailLoading(false);
        }
      }
    };

    fetchDetail();
    return () => {
      canceled = true;
    };
  }, [liveId]);

  const bandNamesText = detailData
    ? detailData.band_names.filter((name) => name.trim() !== "").join(" / ") || "-"
    : detailLoading
      ? "加载中..."
      : "-";
  const venueText = detailData?.venue?.trim() ? detailData.venue : "-";
  const openingTimeText = formatTimedLabel(detailData?.opening_time);
  const startTimeText = formatTimedLabel(detailData?.start_time);
  const detailUrl = detailData?.url ?? fallback.url ?? null;

  return (
    <div className="detail-page">
      <div className="detail-page-head">
        <button type="button" className="detail-back-btn" onClick={onBack} aria-label="返回">
          <span className="detail-back-glyph">←</span>
          <span>返回</span>
        </button>
        <h2>
          {detailUrl ? (
            <a href={detailUrl} target="_blank" rel="noreferrer" className="detail-title-link">
              <span>{detailData?.live_title ?? fallback.liveTitle}</span>
              <span className="detail-title-link-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" focusable="false">
                  <path
                    d="M6 3.5H3.5v9h9V10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M8 3.5h4.5V8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M7.5 8.5 12.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </a>
          ) : (
            detailData?.live_title ?? fallback.liveTitle
          )}
        </h2>
      </div>
      <div className="detail-meta-line">
        <p className="detail-inline-item detail-inline-item-date">
          <strong>日期：</strong>
          <span>{detailData?.live_date ?? fallback.liveDate}</span>
        </p>
        <p className="detail-inline-item">
          <strong>开场：</strong>
          <span>{openingTimeText}</span>
        </p>
        <p className="detail-inline-item">
          <strong>开演：</strong>
          <span>{startTimeText}</span>
        </p>
        <p className="detail-inline-item detail-inline-item-venue">
          <strong>场地：</strong>
          <span>{venueText}</span>
        </p>
        <p className="detail-inline-item detail-inline-item-type">
          <strong>类型：</strong>
          <span>{formatLiveType(detailData?.live_type ?? "")}</span>
        </p>
      </div>
      <p className="detail-row">
        <strong>乐队：</strong>
        <span>{bandNamesText}</span>
      </p>

      <div className="detail-table-wrap">
        <MemberStatusTable
          rows={detailData?.detail_rows}
          loading={detailLoading}
          error={detailError}
        />
      </div>
    </div>
  );
}
