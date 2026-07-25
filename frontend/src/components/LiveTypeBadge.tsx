import { formatLiveType } from "./console/constants";

type LiveTypeBadgeProps = {
  value: string;
  label?: string;
};

function getLiveTypeTone(value: string): string {
  if (value === "oneman") return "oneman";
  if (value === "multi_act" || value === "taiban") return "multi";
  if (value === "festival") return "festival";
  if (value === "event") return "event";
  if (value === "performance_group") return "group";
  return "other";
}

export function LiveTypeBadge({ value, label }: LiveTypeBadgeProps) {
  return (
    <span className="live-type-badge" data-tone={getLiveTypeTone(value)}>
      {label ?? formatLiveType(value)}
    </span>
  );
}
