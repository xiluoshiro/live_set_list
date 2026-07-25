export function FavoriteIcon({ filled = false }: { filled?: boolean }) {
  return (
    <span
      className={`action-icon ${filled ? "action-icon-star-filled" : "action-icon-star"}`}
      aria-hidden="true"
    />
  );
}

export function ExternalLinkIcon() {
  return <span className="action-icon action-icon-external" aria-hidden="true" />;
}
