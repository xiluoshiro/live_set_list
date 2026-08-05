export function toMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function getCurrentMonthKey(now: Date = new Date()): string {
  return toMonthKey(now.getFullYear(), now.getMonth() + 1);
}

export function getMonthParts(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

export function shiftMonthKey(monthKey: string, delta: number): string {
  const { year, month } = getMonthParts(monthKey);
  const totalMonths = year * 12 + (month - 1) + delta;
  return toMonthKey(Math.floor(totalMonths / 12), (totalMonths % 12) + 1);
}

export function monthKeyToLabel(monthKey: string): string {
  const { year, month } = getMonthParts(monthKey);
  return `${year} 年 ${month} 月`;
}

export function monthKeyToShortLabel(monthKey: string): string {
  const { year, month } = getMonthParts(monthKey);
  return `${year}.${String(month).padStart(2, "0")}`;
}

export function getMonthDateRange(monthKey: string): { monthStart: Date; nextMonthStart: Date } {
  const { year, month } = getMonthParts(monthKey);
  const monthStart = new Date(year, month - 1, 1);
  const nextMonthStart = new Date(year, month, 1);
  return { monthStart, nextMonthStart };
}

export function getDaysInMonth(monthKey: string): number {
  const { nextMonthStart } = getMonthDateRange(monthKey);
  return new Date(nextMonthStart.getFullYear(), nextMonthStart.getMonth(), 0).getDate();
}

export function getFirstWeekdayOffset(monthKey: string): number {
  const { monthStart } = getMonthDateRange(monthKey);
  return (monthStart.getDay() + 6) % 7;
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
