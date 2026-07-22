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
  {
    band_id: 8,
    band_name: "MyGO!!!!!",
    band_abbr: "mygo",
    band_members: ["羊宮妃那", "立石凛", "青木陽菜", "小日向美香", "林鼓子"],
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

  // 测试点：同一 source band 的成员列表应支持半角逗号和顿号分隔，并保留输入顺序。
  test("解析多个 member from band", () => {
    const commaResult = parseSetlistText(
      "<羊宮妃那, 立石凛, 青木陽菜, 林鼓子 from MyGO!!!!!>\nM1. 迷星叫",
      bands,
      10,
      20,
    );
    const ideographicCommaResult = parseSetlistText(
      "<羊宮妃那、立石凛、青木陽菜、林鼓子 from MyGO!!!!!>\nM1. 迷星叫",
      bands,
      10,
      20,
    );
    const expectedMembers = ["羊宮妃那", "立石凛", "青木陽菜", "林鼓子"];

    expect(commaResult.rows[0]?.band_member).toEqual({ "MyGO!!!!!": expectedMembers });
    expect(commaResult.warnings).toEqual([]);
    expect(ideographicCommaResult.rows[0]?.band_member).toEqual({ "MyGO!!!!!": expectedMembers });
    expect(ideographicCommaResult.warnings).toEqual([]);
  });

  // 测试点：成员列表中的非法成员应单独移除，不能连带丢弃同一列表里的合法成员。
  test("逐个校验多个 from 成员", () => {
    const result = parseSetlistText(
      "<羊宮妃那, 不存在的成员、林鼓子 from MyGO!!!!!>\nM1. 迷星叫",
      bands,
      10,
      20,
    );

    expect(result.rows[0]?.band_member).toEqual({ "MyGO!!!!!": ["羊宮妃那", "林鼓子"] });
    expect(result.warnings).toEqual([
      { line: 1, message: "不存在的成员 不在 MyGO!!!!! 的 band_members 中，已从解析结果中移除。" },
    ]);
  });

  test("保留未识别行和曲序异常提示但仍生成可应用草稿", () => {
    // 测试点：解析预览不应因未知行或跳号中断，应该返回 warning 让用户人工确认。
    const result = parseSetlistText("<Roselia>\nMC\nM2. Song A", bands, 1, 1);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.song_name).toBe("Song A");
    expect(result.rows[0]?.sub_order).toBe(2);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "未识别行：MC",
      "M 段落编号不从 1 开始，请人工确认。",
    ]);
  });

  // 测试点：M2/M3 即使触发起始异常提示，应用草稿也必须保留原始 sub 与 abs 编号。
  test("保留非 1 起始的连续原始段内编号", () => {
    const result = parseSetlistText("<Roselia>\nM2. Song A\nM3. Song B", bands, 1, 1);

    expect(result.rows.map((row) => row.sub_order)).toEqual([2, 3]);
    expect(result.rows.map((row) => row.absolute_order)).toEqual([2, 3]);
    expect(result.warnings.map((warning) => warning.message)).toContain("M 段落编号不从 1 开始，请人工确认。");
  });

  // 测试点：跨段跳号时 abs 应累加此前段的最大 sub，而不是按表格行号重新顺排。
  test("跨段跳号时按此前段最大编号计算 absolute order", () => {
    const result = parseSetlistText(
      "<Roselia>\nOP2. Opening A\nOP3. Opening B\nM5. Main A\nM8. Main B",
      bands,
      1,
      1,
    );

    expect(result.rows.map((row) => row.sub_order)).toEqual([2, 3, 5, 8]);
    expect(result.rows.map((row) => row.absolute_order)).toEqual([2, 3, 8, 11]);
  });

  // 测试点：OP/EN/WEN/RH 段类型应生成对应的 segment_start_type。
  test("支持 OP/EN/WEN/RH 段类型并标记 segment_start_type", () => {
    const result = parseSetlistText(
      "<Roselia>\nOP1. Opening\nM1. Song A\nEN1. Encore\nWEN1. W Encore\nRH1. Rehearsal",
      bands,
      1,
      1,
    );

    expect(result.rows).toHaveLength(5);
    expect(result.rows[0]).toMatchObject({ song_name: "Opening", segment_start_type: "OP" });
    expect(result.rows[1]).toMatchObject({ song_name: "Song A", segment_start_type: "M" });
    expect(result.rows[2]).toMatchObject({ song_name: "Encore", segment_start_type: "EN" });
    expect(result.rows[3]).toMatchObject({ song_name: "W Encore", segment_start_type: "WEN" });
    expect(result.rows[4]).toMatchObject({ song_name: "Rehearsal", segment_start_type: "RH" });
    expect(result.warnings).toEqual([]);
  });

  // 测试点：已移除的 ED/SP 前缀应作为未知行提示，不能进入草稿表格。
  test("不再识别 ED/SP 段类型", () => {
    const result = parseSetlistText("<Roselia>\nED1. Ending\nSP1. Special", bands, 1, 1);

    expect(result.rows).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "未识别行：ED1. Ending",
      "未识别行：SP1. Special",
      "未解析到任何歌曲行。",
    ]);
  });

  // 测试点：M1 空格格式应能正确解析，与 M1. 点号格式等价。
  test("支持无点号格式 M1 等", () => {
    const result = parseSetlistText(
      "＜Roselia×戸山香澄 from Poppin'Party＞\nM1 キラキラ\nM2 ときめき",
      bands,
      10,
      20,
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.song_name).toBe("キラキラ");
    expect(result.rows[0]?.segment_start_type).toBe("M");
    expect(result.rows[1]?.song_name).toBe("ときめき");
    expect(result.rows[1]?.segment_start_type).toBe("");
  });
});
