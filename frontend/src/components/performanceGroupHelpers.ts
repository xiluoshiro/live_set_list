export function getGroupedLiveShortTitle(liveTitle: string, groupTitle: string): string {
  if (!liveTitle.startsWith(groupTitle)) return liveTitle;
  const short = liveTitle.slice(groupTitle.length).trim();
  return short || liveTitle;
}
