import type { BandOption, LiveInsertRow, SetlistDraftRow, SongInsertRow } from "./types";

export const SEGMENT_OPTIONS = ["M", "EN", "SP"];
export const DEFAULT_BAND_MEMBERS = ["主唱", "吉他", "贝斯", "鼓手", "键盘"];

export const MOCK_BANDS: BandOption[] = [
  { band_id: 1, band_name: "Poppin'Party" },
  { band_id: 2, band_name: "Afterglow" },
  { band_id: 3, band_name: "Pastel*Palettes" },
  { band_id: 4, band_name: "Roselia" },
  { band_id: 5, band_name: "Hello, Happy World!" },
];

export const MOCK_LIVES: LiveInsertRow[] = [
  { live_id: 101, live_date: "2026-03-28", live_title: "Spring Live", bands: [1, 2], url: null },
  { live_id: 102, live_date: "2026-03-29", live_title: "After School", bands: [3], url: "https://example.com/live/102" },
];

export const MOCK_SONGS: SongInsertRow[] = [
  { song_id: 201, song_name: "春日序曲", band_id: 1, cover: false },
  { song_id: 202, song_name: "逆光海岸", band_id: 2, cover: false },
];

export const INITIAL_SETLIST_ROWS: SetlistDraftRow[] = [
  {
    row_key: 1,
    song_name: "春日序曲",
    song_id: "201",
    segment_start_type: "M",
    is_short: false,
    band_member: { "Poppin'Party": [...DEFAULT_BAND_MEMBERS] },
    other_member: [{ entry_id: 1, member_key: "", member_value: "" }],
    comment: "",
  },
  {
    row_key: 2,
    song_name: "逆光海岸",
    song_id: "202",
    segment_start_type: "",
    is_short: false,
    band_member: { Afterglow: [...DEFAULT_BAND_MEMBERS] },
    other_member: [{ entry_id: 2, member_key: "", member_value: "" }],
    comment: "",
  },
  {
    row_key: 3,
    song_name: "春日序曲",
    song_id: "201",
    segment_start_type: "EN",
    is_short: true,
    band_member: { Roselia: ["主唱", "吉他", "贝斯", "鼓手"] },
    other_member: [{ entry_id: 3, member_key: "键盘支援", member_value: "远程连线" }],
    comment: "短版",
  },
];
