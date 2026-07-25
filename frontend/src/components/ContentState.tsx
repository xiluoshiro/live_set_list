import type { ReactNode } from "react";

type ContentStateKind = "loading" | "empty" | "error";
type ContentStateLayout = "rows" | "cards" | "statistics" | "detail";

type ContentStateProps = {
  kind: ContentStateKind;
  title: string;
  description?: string;
  layout?: ContentStateLayout;
  compact?: boolean;
  action?: ReactNode;
};

const SKELETON_COUNTS: Record<ContentStateLayout, number> = {
  rows: 4,
  cards: 6,
  statistics: 6,
  detail: 5,
};

export function ContentState({
  kind,
  title,
  description,
  layout = "rows",
  compact = false,
  action,
}: ContentStateProps) {
  const role = kind === "error" ? "alert" : "status";

  return (
    <div
      className={`content-state content-state-${kind} content-state-${layout}${compact ? " is-compact" : ""}`}
      role={role}
      aria-live={kind === "loading" ? "polite" : undefined}
    >
      {kind === "loading" && (
        <div className="content-state-skeleton" aria-hidden="true">
          {Array.from({ length: SKELETON_COUNTS[layout] }, (_, index) => (
            <span key={index} />
          ))}
        </div>
      )}
      <div className="content-state-copy">
        <strong>{title}</strong>
        {description && <span>{description}</span>}
      </div>
      {action && <div className="content-state-action">{action}</div>}
    </div>
  );
}
