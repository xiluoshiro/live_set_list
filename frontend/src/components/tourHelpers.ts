export function getTourStopShortTitle(liveTitle: string, tourTitle: string): string {
  if (!liveTitle.startsWith(tourTitle)) return liveTitle;
  return liveTitle.slice(tourTitle.length).trim() || liveTitle;
}
