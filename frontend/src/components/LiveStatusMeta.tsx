import { formatCompactDate } from "../dateFormat";
import type { LiveStatusPresentation } from "../liveStatus";

type LiveStatusMetaProps = {
  date: string;
  statusText: string;
  tone: LiveStatusPresentation["tone"];
  className?: string;
};

export function LiveStatusMeta({
  date,
  statusText,
  tone,
  className,
}: LiveStatusMetaProps) {
  return (
    <span
      className={["live-status-meta", className].filter(Boolean).join(" ")}
      data-status-tone={tone}
    >
      <span className="live-status-date">{formatCompactDate(date)}</span>
      <span className="live-status-pill">{statusText}</span>
    </span>
  );
}
