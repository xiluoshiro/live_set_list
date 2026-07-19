import { DEFAULT_BAND_MEMBERS } from "./constants";
import songLookupPunctuationConfig from "../../../../config/song_lookup_punctuation_groups.json";
import type { DerivedSegment, OtherMemberDraft, SetlistDraftRow } from "./types";

const songLookupPunctuationTranslation = new Map<string, string>(
  songLookupPunctuationConfig.groups.flatMap((group) => group.map((value) => [value, group[0]] as [string, string])),
);
const songLookupCanonicalPunctuation = new Set(songLookupPunctuationConfig.groups.map((group) => group[0]));

function removeWhitespaceAdjacentToLookupPunctuation(value: string): string {
  const characters = Array.from(value);
  const result: string[] = [];

  for (let index = 0; index < characters.length;) {
    if (!/\s/u.test(characters[index])) {
      result.push(characters[index]);
      index += 1;
      continue;
    }

    let whitespaceEnd = index + 1;
    while (whitespaceEnd < characters.length && /\s/u.test(characters[whitespaceEnd])) {
      whitespaceEnd += 1;
    }
    const previousCharacter = result[result.length - 1];
    const nextCharacter = characters[whitespaceEnd];
    if (
      !songLookupCanonicalPunctuation.has(previousCharacter)
      && !songLookupCanonicalPunctuation.has(nextCharacter)
    ) {
      result.push(...characters.slice(index, whitespaceEnd));
    }
    index = whitespaceEnd;
  }

  return result.join("");
}

function isAsciiAlphaNumeric(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9]$/u.test(value);
}

function isNonAscii(value: string | undefined): boolean {
  return value !== undefined && value.codePointAt(0)! > 0x7f;
}

function isPunctuatedAsciiToken(value: string): boolean {
  const characters = Array.from(value);
  return characters.some((character, index) => (
    songLookupCanonicalPunctuation.has(character)
    && isAsciiAlphaNumeric(characters[index - 1])
    && isAsciiAlphaNumeric(characters[index + 1])
  ));
}

function removeWhitespaceBetweenPunctuatedAsciiTokenAndNonAscii(value: string): string {
  const characters = Array.from(value);
  const result: string[] = [];

  for (let index = 0; index < characters.length;) {
    if (!/\s/u.test(characters[index])) {
      result.push(characters[index]);
      index += 1;
      continue;
    }

    let whitespaceEnd = index + 1;
    while (whitespaceEnd < characters.length && /\s/u.test(characters[whitespaceEnd])) {
      whitespaceEnd += 1;
    }
    let previousTokenStart = result.length;
    while (previousTokenStart > 0 && !/\s/u.test(result[previousTokenStart - 1])) {
      previousTokenStart -= 1;
    }
    let nextTokenEnd = whitespaceEnd;
    while (nextTokenEnd < characters.length && !/\s/u.test(characters[nextTokenEnd])) {
      nextTokenEnd += 1;
    }
    const previousToken = result.slice(previousTokenStart).join("");
    const nextToken = characters.slice(whitespaceEnd, nextTokenEnd).join("");
    const joinsPreviousTokenToNonAscii = isPunctuatedAsciiToken(previousToken)
      && isNonAscii(characters[whitespaceEnd]);
    const joinsNonAsciiToNextToken = isNonAscii(result[result.length - 1])
      && isPunctuatedAsciiToken(nextToken);
    if (!joinsPreviousTokenToNonAscii && !joinsNonAsciiToNextToken) {
      result.push(...characters.slice(index, whitespaceEnd));
    }
    index = whitespaceEnd;
  }

  return result.join("");
}

export function normalizeSongLookupText(value: string): string {
  const punctuationNormalized = value
    .normalize("NFKC")
    .split("")
    .map((char) => songLookupPunctuationTranslation.get(char) ?? char)
    .join("");
  const punctuationWhitespaceNormalized = removeWhitespaceAdjacentToLookupPunctuation(punctuationNormalized);
  return removeWhitespaceBetweenPunctuatedAsciiTokenAndNonAscii(punctuationWhitespaceNormalized)
    .trim()
    .toLowerCase();
}

export function getBandMembersTemplate(_bandName: string): string[] {
  return [...DEFAULT_BAND_MEMBERS];
}

export function buildOtherMemberPayloadObject(
  entries: OtherMemberDraft[],
  separator: string,
): Record<string, string[] | null> | null {
  const effectiveSeparator = separator || ",";
  const payload = entries.reduce<Record<string, string[] | null>>((payload, entry) => {
    const key = entry.member_key.trim();
    if (key === "") return payload;
    const values = entry.member_value
      .split(effectiveSeparator)
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (values.length === 0) {
      payload[key] ??= null;
    } else {
      payload[key] = [...(Array.isArray(payload[key]) ? payload[key] : []), ...values];
    }
    return payload;
  }, {});
  return Object.keys(payload).length === 0 ? null : payload;
}

export function buildOtherMemberPayload(entries: OtherMemberDraft[], separator: string): string {
  return JSON.stringify(buildOtherMemberPayloadObject(entries, separator));
}

export function summarizeBandMember(row: SetlistDraftRow): string {
  const bands = Object.keys(row.band_member).length;
  const members = Object.values(row.band_member).reduce((sum, membersByBand) => sum + membersByBand.length, 0);
  if (bands === 0) return "未选择";
  return `${bands}支 / ${members}人`;
}

export function summarizeOtherMember(row: SetlistDraftRow): string {
  const count = row.other_member.filter(
    (entry) => entry.member_key.trim() !== "" || entry.member_value.trim() !== "",
  ).length;
  if (count === 0) return "未填";
  return `${count}项`;
}

export function toggleBand(selectedBandIds: number[], bandId: number): number[] {
  if (selectedBandIds.includes(bandId)) {
    return selectedBandIds.filter((id) => id !== bandId);
  }
  return [...selectedBandIds, bandId].sort((a, b) => a - b);
}

export function getDerivedSegments(rows: SetlistDraftRow[]): DerivedSegment[] {
  const derived: DerivedSegment[] = [];
  let currentSegment = "M";
  let currentSubOrder = 0;

  rows.forEach((row, index) => {
    const startType = row.segment_start_type.trim();
    if (index === 0) {
      currentSegment = startType || "M";
      currentSubOrder = 1;
    } else if (startType !== "") {
      currentSegment = startType;
      currentSubOrder = 1;
    } else {
      currentSubOrder += 1;
    }

    derived.push({
      segmentType: currentSegment,
      subOrder: currentSubOrder,
    });
  });

  return derived;
}
