export function formatCompactDate(date: string): string {
  return date.replace(/-/g, ".");
}

export function formatCompactDateRange(
  startDate: string | null,
  endDate: string | null,
  fallbackDate: string,
  separator = "–",
): string {
  const resolvedStartDate = startDate ?? fallbackDate;
  const compactStart = formatCompactDate(resolvedStartDate);
  if (!endDate || resolvedStartDate === endDate) return compactStart;
  const [startYear, startMonth] = resolvedStartDate.split("-");
  const [endYear, endMonth, endDay] = endDate.split("-");
  if (startYear === endYear && startMonth === endMonth) {
    return `${compactStart}${separator}${endDay}`;
  }
  if (startYear === endYear) {
    return `${compactStart}${separator}${endMonth}.${endDay}`;
  }
  return `${compactStart}${separator}${formatCompactDate(endDate)}`;
}
