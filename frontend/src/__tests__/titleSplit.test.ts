import { describe, expect, test } from "vitest";

import { buildTitleLines, titleSegments } from "../titleSplit";

describe("titleSegments", () => {
  test("无引号时返回 null", () => {
    // 测试点：标题不含引号段时不进行拆解，交由自然换行兜底。
    expect(titleSegments("Ave Mujica LIVE TOUR 2026 FINAL")).toBeNull();
  });

  test("取第一个「」引号段，返回前中后三段", () => {
    // 测试点：只取首个引号段，剩余内容（含后续引号）归入 suffix。
    expect(titleSegments("Ave Mujica LIVE TOUR 2026「Exitus」-FINAL- DAY1")).toEqual({
      prefix: "Ave Mujica LIVE TOUR 2026",
      quoted: "「Exitus」",
      suffix: "-FINAL- DAY1",
    });
  });

  test("支持『』与“”引号", () => {
    // 测试点：拆解不限定「」一种引号，『』“”同样生效。
    expect(titleSegments("Tour『Day 1』Foo")).toEqual({
      prefix: "Tour",
      quoted: "『Day 1』",
      suffix: "Foo",
    });
    expect(titleSegments("Tour“Day 1”Foo")).toEqual({
      prefix: "Tour",
      quoted: "“Day 1”",
      suffix: "Foo",
    });
  });

  test("引号位于开头或结尾时对应段为空", () => {
    // 测试点：前缀或后缀为空时仍能正确切分，由 buildTitleLines 过滤空段。
    expect(titleSegments("「Exitus」-FINAL-")).toEqual({
      prefix: "",
      quoted: "「Exitus」",
      suffix: "-FINAL-",
    });
    expect(titleSegments("Tour「Exitus」")).toEqual({
      prefix: "Tour",
      quoted: "「Exitus」",
      suffix: "",
    });
  });
});

describe("buildTitleLines", () => {
  test("两行都未超阈值时采用两行拆分", () => {
    // 测试点：prefix+quoted 与 suffix 均在阈值内时，保持两行不继续拆分。
    const lines = buildTitleLines(
      { prefix: "A", quoted: "「B」", suffix: "C" },
      (line) => line.length > 6,
    );
    expect(lines).toEqual(["A「B」", "C"]);
  });

  test("任一行超阈值时拆成三段", () => {
    // 测试点：两行方案的首行仍超阈值时，退化为 prefix/quoted/suffix 三段。
    const lines = buildTitleLines(
      { prefix: "Ave Mujica LIVE TOUR 2026", quoted: "「Exitus」", suffix: "-FINAL- DAY1" },
      (line) => line.length > 20,
    );
    expect(lines).toEqual(["Ave Mujica LIVE TOUR 2026", "「Exitus」", "-FINAL- DAY1"]);
  });

  test("空段会被过滤，不会产生空行", () => {
    // 测试点：引号在开头或结尾时，空段不进入结果行。
    expect(buildTitleLines({ prefix: "", quoted: "「Exitus」", suffix: "C" }, () => true)).toEqual([
      "「Exitus」",
      "C",
    ]);
    expect(buildTitleLines({ prefix: "A", quoted: "「Exitus」", suffix: "" }, () => true)).toEqual([
      "A",
      "「Exitus」",
    ]);
  });

  test("过滤后只剩一段时回退为整串", () => {
    // 测试点：整串只包含引号段时不再拆分，原样返回。
    expect(buildTitleLines({ prefix: "", quoted: "「Exitus」", suffix: "" }, () => true)).toEqual([
      "「Exitus」",
    ]);
  });
});
