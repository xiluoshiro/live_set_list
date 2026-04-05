export type ConsoleMode = "live" | "song";

export type Position = {
  top: number;
  left: number;
  width: number;
};

export type BandOption = {
  band_id: number;
  band_name: string;
};

export type LiveInsertRow = {
  live_id: number;
  live_date: string;
  live_title: string;
  bands: number[];
  url: string | null;
};

export type SongInsertRow = {
  song_id: number;
  song_name: string;
  band_id: number;
  cover: boolean;
};

export type SetlistInsertRow = {
  song_id: number;
  absolute_order: number;
  segment_type: string;
  sub_order: number;
  is_short: boolean;
  band_member: string;
  other_member: string;
  comment: string;
};

export type LiveInsertBundle = {
  live: LiveInsertRow;
  setlist_rows: SetlistInsertRow[];
};

export type OtherMemberDraft = {
  entry_id: number;
  member_key: string;
  member_value: string;
};

export type SetlistDraftRow = {
  row_key: number;
  song_name: string;
  song_id: string;
  segment_start_type: string;
  is_short: boolean;
  band_member: Record<string, string[]>;
  other_member: OtherMemberDraft[];
  comment: string;
};

export type DerivedSegment = {
  segmentType: string;
  subOrder: number;
};
