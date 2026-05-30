import { parse } from "./generatedParser.js";
import { mapParsedSetlist } from "./mapParsedSetlist";
import type { BandOption } from "../types";
import type { SetlistParseResult } from "./types";

export function parseSetlistText(
  input: string,
  bands: BandOption[],
  rowKeyStart: number,
  otherMemberEntryKeyStart: number,
): SetlistParseResult {
  return mapParsedSetlist(parse(input), bands, rowKeyStart, otherMemberEntryKeyStart);
}
