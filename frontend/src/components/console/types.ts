export type ConsoleMode = "live_create" | "live_edit" | "setlist" | "song" | "tour" | "performance_group";

export type Position = {
  top: number;
  left: number;
  width: number;
};

export type BandOption = {
  band_id: number;
  band_name: string;
  band_abbr?: string;
  band_members?: string[];
};

export type VenueOption = {
  venue_id: number;
  venue_name: string;
};

export type LiveInsertRow = {
  live_id: number;
  live_date: string;
  live_title: string;
  live_type: string;
  bands: number[];
  url: string | null;
};

export type SongInsertRow = {
  song_id: number;
  song_name: string;
  band_id: number;
  cover: boolean;
  band_name?: string;
};

export type SetlistInsertRow = {
  song_id: number;
  absolute_order: number;
  segment_type: string;
  sub_order: number;
  is_short: boolean;
  band_member: string;
  other_member: string;
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
  song_resolved_name?: string;
  song_candidates?: SongInsertRow[];
  segment_start_type: string;
  absolute_order?: number;
  sub_order?: number;
  is_short: boolean;
  band_member: Record<string, string[]>;
  other_member: OtherMemberDraft[];
};

export type DerivedSegment = {
  segmentType: string;
  subOrder: number;
};
