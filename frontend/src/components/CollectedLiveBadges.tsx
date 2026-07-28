import { LiveTypeBadge } from "./LiveTypeBadge";

type CollectedLiveBadgesProps = {
  collectedCount: number;
  cancelledCount?: number | null;
};

export function CollectedLiveBadges({
  collectedCount,
  cancelledCount = 0,
}: CollectedLiveBadgesProps) {
  return (
    <>
      <LiveTypeBadge value="other" label={`收录${collectedCount}`} />
      {(cancelledCount ?? 0) > 0 && (
        <LiveTypeBadge value="cancelled" label={`取消${cancelledCount}`} />
      )}
    </>
  );
}
