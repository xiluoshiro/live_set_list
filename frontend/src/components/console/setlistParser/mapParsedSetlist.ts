import { getBandMembersTemplate } from "../helpers";
import type { BandOption, OtherMemberDraft, SetlistDraftRow } from "../types";
import type { ParsedSetlistLine } from "./generatedParser";
import type { ParsedSetlistWarning, SetlistParseResult } from "./types";

function findValidBand(token: string, bands: BandOption[]): BandOption | null {
  const normalizedToken = token.trim();
  if (normalizedToken === "") return null;
  return (
    bands.find(
      (band) =>
        band.band_id > 0 &&
        (band.band_name.trim() === normalizedToken || band.band_abbr?.trim() === normalizedToken),
    ) ?? null
  );
}

function getWholeBandMembers(band: BandOption): string[] {
  return band.band_members && band.band_members.length > 0
    ? [...band.band_members]
    : getBandMembersTemplate(band.band_name);
}

function addOtherMember(
  entries: OtherMemberDraft[],
  nextEntryId: () => number,
  memberKey: string,
  memberValue: string,
): void {
  entries.push({
    entry_id: nextEntryId(),
    member_key: memberKey,
    member_value: memberValue,
  });
}

function mapPerformerContext(
  context: string,
  contextLine: number,
  bands: BandOption[],
  nextEntryId: () => number,
): {
  bandMember: Record<string, string[]>;
  otherMember: OtherMemberDraft[];
  warnings: ParsedSetlistWarning[];
} {
  const bandMember: Record<string, string[]> = {};
  const otherMember: OtherMemberDraft[] = [];
  const warnings: ParsedSetlistWarning[] = [];
  const tokens = context.split("×").map((token) => token.trim()).filter((token) => token !== "");

  tokens.forEach((token) => {
    const fromMatch = token.match(/^(.+?)\s+from\s+(.+)$/i);
    if (fromMatch) {
      const memberName = fromMatch[1]?.trim() ?? "";
      const sourceBandName = fromMatch[2]?.trim() ?? "";
      const sourceBand = findValidBand(sourceBandName, bands);
      if (!sourceBand) {
        addOtherMember(otherMember, nextEntryId, sourceBandName, memberName);
        warnings.push({
          line: contextLine,
          message: `${sourceBandName} 未匹配到有效 band，${memberName} 已放入 other_member。`,
        });
        return;
      }

      if (bandMember[sourceBand.band_name]) return;
      if (sourceBand.band_members && sourceBand.band_members.length > 0 && !sourceBand.band_members.includes(memberName)) {
        warnings.push({
          line: contextLine,
          message: `${memberName} 不在 ${sourceBand.band_name} 的 band_members 中，已从解析结果中移除。`,
        });
        return;
      }
      bandMember[sourceBand.band_name] = [memberName];
      return;
    }

    const band = findValidBand(token, bands);
    if (band) {
      bandMember[band.band_name] = getWholeBandMembers(band);
      return;
    }

    addOtherMember(otherMember, nextEntryId, token, "");
    warnings.push({
      line: contextLine,
      message: `${token} 未匹配到有效 band，已放入 other_member。`,
    });
  });

  if (otherMember.length === 0) {
    addOtherMember(otherMember, nextEntryId, "", "");
  }

  return { bandMember, otherMember, warnings };
}

export function mapParsedSetlist(
  lines: ParsedSetlistLine[],
  bands: BandOption[],
  rowKeyStart: number,
  otherMemberEntryKeyStart: number,
): SetlistParseResult {
  let currentContext = "";
  let currentContextLine = 0;
  let lastSegmentType = "";
  let lastSegmentOrderByType: Record<string, number> = {};
  let nextRowKey = rowKeyStart;
  let nextOtherMemberEntryKey = otherMemberEntryKeyStart;
  const warnings: ParsedSetlistWarning[] = [];
  const rows: SetlistDraftRow[] = [];
  const nextEntryId = () => {
    nextOtherMemberEntryKey += 1;
    return nextOtherMemberEntryKey;
  };

  lines.forEach((line) => {
    if (line.type === "performer_context") {
      currentContext = line.text;
      currentContextLine = line.line;
      return;
    }

    if (line.type === "unknown_line") {
      if (line.text !== "") {
        warnings.push({ line: line.line, message: `未识别行：${line.text}` });
      }
      return;
    }

    const mapping = currentContext === ""
      ? {
          bandMember: {},
          otherMember: [{ entry_id: nextEntryId(), member_key: "", member_value: "" }],
          warnings: [{ line: line.line, message: `${line.songName} 没有演出者上下文，band_member 为空。` }],
        }
      : mapPerformerContext(currentContext, currentContextLine, bands, nextEntryId);
    warnings.push(...mapping.warnings);

    const previousOrder = lastSegmentOrderByType[line.segmentType];
    if (previousOrder === undefined && line.segmentOrder !== 1) {
      warnings.push({
        line: line.line,
        message: `${line.segmentType} 段落编号不从 1 开始，请人工确认。`,
      });
    }
    if (previousOrder !== undefined && line.segmentOrder !== previousOrder + 1) {
      warnings.push({
        line: line.line,
        message: `${line.segmentType}${line.segmentOrder} 与上一首同段编号不连续，请人工确认。`,
      });
    }
    if (previousOrder === line.segmentOrder) {
      warnings.push({
        line: line.line,
        message: `${line.segmentType}${line.segmentOrder} 编号重复，请人工确认。`,
      });
    }

    const segmentStartType = line.segmentType !== lastSegmentType ? line.segmentType : "";
    lastSegmentType = line.segmentType;
    lastSegmentOrderByType = {
      ...lastSegmentOrderByType,
      [line.segmentType]: line.segmentOrder,
    };
    nextRowKey += 1;
    rows.push({
      row_key: nextRowKey,
      song_name: line.songName,
      song_id: "",
      segment_start_type: segmentStartType,
      // 保留原文段内编号；即使从 M2 开始，也不能在应用草稿时静默回退为 1。
      sub_order: line.segmentOrder,
      is_short: false,
      band_member: mapping.bandMember,
      other_member: mapping.otherMember,
    });
  });

  if (rows.length === 0) {
    warnings.push({ line: 1, message: "未解析到任何歌曲行。" });
  }

  return {
    rows,
    warnings,
    nextRowKey,
    nextOtherMemberEntryKey,
  };
}
