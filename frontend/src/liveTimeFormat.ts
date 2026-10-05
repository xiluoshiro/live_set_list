const TIMEZONE_CODES: Record<string, string> = {
  "+00:00": "UTC",
  "+07:00": "ICT",
  "+08:00": "CST",
  "+09:00": "JST",
  "+05:30": "IST",
  "+05:00": "PKT",
  "+03:00": "MSK",
  "+02:00": "EET",
  "+01:00": "CET",
  "-05:00": "EST",
  "-06:00": "CDT",
  "-07:00": "MST",
  "-08:00": "PST",
  "-09:00": "AKST",
  "-10:00": "HST",
  "+11:00": "AEDT",
  "+12:00": "NZST",
};

export function formatTimedLabel(value: string | null | undefined, timezoneLabel?: string | null): string {
  const raw = value?.trim();
  if (!raw) return "未公布";
  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?(?:([+-]\d{2})(?::?(\d{2}))?)?$/);
  if (!match) return raw;
  const [, timePart, offsetHour, offsetMinute] = match;
  if (!offsetHour) return timePart;
  const normalizedOffset = `${offsetHour}:${offsetMinute ?? "00"}`;
  return `${timePart} (${timezoneLabel ?? TIMEZONE_CODES[normalizedOffset] ?? `UTC${normalizedOffset}`})`;
}

