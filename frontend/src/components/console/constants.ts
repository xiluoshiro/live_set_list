import type { BandOption, LiveInsertRow, SetlistDraftRow, SongInsertRow, VenueOption } from "./types";

export const SEGMENT_OPTIONS = ["M", "OP", "EN", "WEN", "RH"];
export const DEFAULT_BAND_MEMBERS = ["主唱", "吉他", "贝斯", "鼓手", "键盘"];
export const LIVE_TYPE_LABELS = {
  oneman: "专场",
  multi_act: "拼盘",
  taiban: "对邦",
  festival: "音乐节",
  event: "活动",
  other: "其他",
} as const;

export const LIVE_TYPE_OPTIONS = Object.entries(LIVE_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export function formatLiveType(value: string): string {
  return LIVE_TYPE_LABELS[value as keyof typeof LIVE_TYPE_LABELS] ?? value;
}
export const TIMEZONE_HOUR_OPTIONS = Array.from({ length: 27 }, (_, index) => {
  const hour = index - 12;
  return `${hour >= 0 ? "+" : ""}${hour}`;
});

export const TIMEZONE_MINUTE_SUFFIXES = [":00", ":15", ":30", ":45"] as const;

export const MOCK_BANDS: BandOption[] = [
  { band_id: 1, band_name: "Poppin'Party" },
  { band_id: 2, band_name: "Afterglow" },
  { band_id: 3, band_name: "Pastel*Palettes" },
  { band_id: 4, band_name: "Roselia" },
  { band_id: 5, band_name: "Hello, Happy World!" },
];

export const MOCK_LIVES: LiveInsertRow[] = [
  { live_id: 101, live_date: "2026-03-28", live_title: "Spring Live", live_type: "oneman", bands: [1, 2], url: null },
  { live_id: 102, live_date: "2026-03-29", live_title: "After School", live_type: "festival", bands: [3], url: "https://example.com/live/102" },
];

export const MOCK_SONGS: SongInsertRow[] = [
  { song_id: 201, song_name: "春日序曲", band_id: 1, cover: false },
  { song_id: 202, song_name: "逆光海岸", band_id: 2, cover: false },
];

export const MOCK_VENUES: VenueOption[] = [
  { venue_id: 301, venue_name: "武道馆" },
  { venue_id: 302, venue_name: "Zepp Haneda" },
  { venue_id: 303, venue_name: "有明Arena" },
];

export const INITIAL_SETLIST_ROWS: SetlistDraftRow[] = [
  {
    row_key: 1,
    song_name: "",
    song_id: "",
    segment_start_type: "M",
    is_short: false,
    band_member: {},
    band_performances: {},
    other_member: [{ entry_id: 1, member_key: "", member_value: "" }],
  },
];
