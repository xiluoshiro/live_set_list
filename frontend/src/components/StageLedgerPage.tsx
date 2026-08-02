import { useEffect, useState } from "react";

import { ApiError, getLiveDetail, type LiveDetailResponse, type PerformanceGroupRef, type TourRef } from "../api";
import { logError } from "../logger";
import { StageLedgerContent, type LiveDetailFallback, type StageLedgerContentProps } from "./StageLedgerContent";

export type StageLedgerPageProps = Omit<StageLedgerContentProps, "detailData" | "detailLoading" | "detailError" | "detailNotFound" | "onRetry"> & {
  liveId: number;
  fallback: LiveDetailFallback;
  onOpenTour: (tour: TourRef) => void;
  onOpenPerformanceGroup?: (group: PerformanceGroupRef, sourceLiveId: number) => void;
};

export function StageLedgerPage({ liveId, fallback, onOpenTour, onOpenPerformanceGroup, ...contentProps }: StageLedgerPageProps) {
  const [detailData, setDetailData] = useState<LiveDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNotFound, setDetailNotFound] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let canceled = false;
    const fetchDetail = async () => {
      setDetailLoading(true);
      setDetailError(null);
      setDetailNotFound(false);
      setDetailData(null);
      try {
        const data = await getLiveDetail(liveId);
        if (!canceled) setDetailData(data);
      } catch (error) {
        if (canceled) return;
        const rawMessage = error instanceof Error ? error.message : "未知错误";
        const message = rawMessage === "Request timeout" ? "请求超时，请稍后重试" : rawMessage;
        const notFound = error instanceof ApiError && error.status === 404;
        logError("load_live_detail_failed", { liveId, message, notFound });
        setDetailNotFound(notFound);
        setDetailError(message);
      } finally {
        if (!canceled) setDetailLoading(false);
      }
    };

    void fetchDetail();
    return () => {
      canceled = true;
    };
  }, [liveId, retryKey]);

  return (
    <StageLedgerContent
      {...contentProps}
      detailData={detailData}
      detailLoading={detailLoading}
      detailError={detailError}
      detailNotFound={detailNotFound}
      fallback={fallback}
      onOpenTour={onOpenTour}
      onOpenPerformanceGroup={onOpenPerformanceGroup}
      onRetry={() => setRetryKey((value) => value + 1)}
    />
  );
}
