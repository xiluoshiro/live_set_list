import type { SetlistDraftRow } from "../types";

export type ParsedSetlistWarning = {
  line: number;
  message: string;
};

export type SetlistParseResult = {
  rows: SetlistDraftRow[];
  warnings: ParsedSetlistWarning[];
  nextRowKey: number;
  nextOtherMemberEntryKey: number;
};
