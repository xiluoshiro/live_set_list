import { useEffect, useState } from "react";
import { getLiveDetail, type LiveDetailResponse, type PerformanceGroupRef, type TourRef } from "../api";
import { logError } from "../logger";
import { LiveDetailContent, type LiveDetailFallback } from "./LiveDetailContent";

interface LiveDetailPageProps {
  liveId: number;
  fallback: LiveDetailFallback;
  onBack: () => void;
  onOpenTour: (tour: TourRef) => void;
  onOpenPerformanceGroup?: (group: PerformanceGroupRef, sourceLiveId: number) => void;
}

export function LiveDetailPage({ liveId, fallback, onBack, onOpenTour, onOpenPerformanceGroup }: LiveDetailPageProps) {
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

  return (
    <div className="detail-page">
      <LiveDetailContent
        detailData={detailData}
        detailLoading={detailLoading}
        detailError={detailError}
        fallback={fallback}
        onOpenTour={onOpenTour}
        onOpenPerformanceGroup={onOpenPerformanceGroup}
        headerAction={<button type="button" className="detail-back-btn" onClick={onBack} aria-label="返回"><span className="modal-action-glyph close">✕</span></button>}
      />
    </div>
  );
}
