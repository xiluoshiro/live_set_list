import { describe, expect, test } from "vitest";

import { parseSetlistText } from "./parseSetlistText";
import type { BandOption } from "../types";

const bands: BandOption[] = [
  {
    band_id: 1,
    band_name: "Poppin'Party",
    band_abbr: "ポピパ",
    band_members: ["戸山香澄", "花園たえ"],
  },
  {
    band_id: 2,
    band_name: "Roselia",
    band_abbr: "ロゼリア",
    band_members: ["湊友希那", "氷川紗夜"],
  },
];

describe("parseSetlistText", () => {
  test("解析尖括号上下文并把 from 成员优先归入有效 band", () => {
    // 测试点：from token 应先匹配 source band，命中有效 band 时写入 band_member 而不是 other_member。
    const result = parseSetlistText(
      "＜Roselia×戸山香澄 from Poppin'Party＞\nM1. BLACK SHOUT\nM2. Requiem for Fate",
      bands,
      1000,
      2000,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      song_name: "BLACK SHOUT",
      segment_start_type: "M",
      song_id: "",
      is_short: false,
    });
    expect(result.rows[0]?.band_member).toEqual({
      Roselia: ["湊友希那", "氷川紗夜"],
      "Poppin'Party": ["戸山香澄"],
    });
    expect(result.rows[0]?.other_member).toEqual([{ entry_id: 2001, member_key: "", member_value: "" }]);
    expect(result.rows[1]?.segment_start_type).toBe("");
    expect(result.warnings).toEqual([]);
  });

  test("source band 只有 id=0 时 from 成员落入 other_member", () => {
    // 测试点：band_id=0 是无效占位，不允许写入 band_member，需要降级为 other_member。
    const result = parseSetlistText(
      "＜戸山香澄 from Poppin'Party＞\nM1. BLACK SHOUT",
      [{ band_id: 0, band_name: "Poppin'Party", band_members: ["戸山香澄"] }],
      10,
      20,
    );

    expect(result.rows[0]?.band_member).toEqual({});
    expect(result.rows[0]?.other_member).toEqual([
      { entry_id: 21, member_key: "Poppin'Party", member_value: "戸山香澄" },
    ]);
    expect(result.warnings[0]?.message).toContain("未匹配到有效 band");
  });

  test("from 成员不在有效 band 成员列表中时直接移除", () => {
    // 测试点：命中有效 source band 但成员不属于该 band 时，不应默认加入 band_member 或 other_member。
    const result = parseSetlistText(
      "＜戸山香澄 from Roselia＞\nM1. BLACK SHOUT",
      bands,
      10,
      20,
    );

    expect(result.rows[0]?.band_member).toEqual({});
    expect(result.rows[0]?.other_member).toEqual([{ entry_id: 21, member_key: "", member_value: "" }]);
    expect(result.warnings[0]?.message).toBe("戸山香澄 不在 Roselia 的 band_members 中，已从解析结果中移除。");
  });

  test("保留未识别行和曲序异常提示但仍生成可应用草稿", () => {
    // 测试点：解析预览不应因未知行或跳号中断，应该返回 warning 让用户人工确认。
    const result = parseSetlistText("<Roselia>\nMC\nM2. Song A", bands, 1, 1);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.song_name).toBe("Song A");
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "未识别行：MC",
      "M 段落编号不从 1 开始，请人工确认。",
    ]);
  });
});
