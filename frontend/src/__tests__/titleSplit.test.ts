import { describe, expect, test } from "vitest";

import { buildTitleLines, titleTokens } from "../titleSplit";

describe("titleTokens", () => {
  test("无引号且无「 - 」分隔时返回单 token", () => {
    // 测试点：标题没有可断点时不拆，原样作为单 token。
    expect(titleTokens("Ave Mujica LIVE TOUR 2026 FINAL")).toEqual(["Ave Mujica LIVE TOUR 2026 FINAL"]);
  });

  test("单个引号段拆成三段 token", () => {
    // 测试点：引号段独立成 token，前后文本各自保留。
    expect(titleTokens("Ave Mujica LIVE TOUR 2026「Exitus」-FINAL- DAY1")).toEqual([
      "Ave Mujica LIVE TOUR 2026",
      "「Exitus」",
      "-FINAL- DAY1",
    ]);
  });

  test("多个引号段各自独立，引号内文字不拆", () => {
    // 测试点：同标题出现多个引号段时每段一个 token，引号内容保持完整。
    expect(titleTokens("Roselia「Lehre der Rose」 - Roselia 10th Anniversary Best Album「Lehre der Rose」リリース記念ライブ")).toEqual([
      "Roselia",
      "「Lehre der Rose」",
      " - ",
      "Roselia 10th Anniversary Best Album",
      "「Lehre der Rose」",
      "リリース記念ライブ",
    ]);
  });

  test("支持『』与“”引号", () => {
    // 测试点：拆解不限定「」一种引号，『』“”同样生效。
    expect(titleTokens("Tour『Day 1』Foo")).toEqual(["Tour", "『Day 1』", "Foo"]);
    expect(titleTokens("Tour“Day 1”Foo")).toEqual(["Tour", "“Day 1”", "Foo"]);
  });

  test("带空格连字符「 - 」作为分隔 token", () => {
    // 测试点：非引号段内部的「 - 」独立成 token，便于按语义块断行。
    expect(titleTokens("Foo - Bar - Baz")).toEqual(["Foo", " - ", "Bar", " - ", "Baz"]);
  });

  test("引号位于开头或结尾时无空 token", () => {
    // 测试点：引号在首尾时切分结果不产生空串。
    expect(titleTokens("「Exitus」-FINAL-")).toEqual(["「Exitus」", "-FINAL-"]);
    expect(titleTokens("Tour「Exitus」")).toEqual(["Tour", "「Exitus」"]);
  });
});

describe("buildTitleLines", () => {
  test("贪心打包：加入下一 token 超阈值才换行", () => {
    // 测试点：token 逐个累加测量，未超阈值继续拼接，超阈值才另起一行。
    const lines = buildTitleLines(
      ["A", "「B」", "C", "D"],
      (line) => line.length > 4,
    );
    expect(lines).toEqual(["A「B」", "CD"]);
  });

  test("Roselia 超长标题按引号与「 - 」拆成三行", () => {
    // 测试点：多引号加「 - 」分隔的标题，贪心打包得到 引号/分隔符/尾段 三行语义块。
    const lines = buildTitleLines(
      [
        "Roselia",
        "「Lehre der Rose」",
        " - ",
        "Roselia 10th Anniversary Best Album",
        "「Lehre der Rose」",
        "リリース記念ライブ",
      ],
      (line) => line.length > 55,
    );
    expect(lines).toEqual([
      "Roselia「Lehre der Rose」 - ",
      "Roselia 10th Anniversary Best Album「Lehre der Rose」",
      "リリース記念ライブ",
    ]);
  });

  test("新行首空白移到上一行行尾", () => {
    // 测试点：换行时 token 前导空白归入上一行末尾，下一行首无空格。
    const lines = buildTitleLines(["A", "「B」", " C"], (line) => line.length > 3);
    expect(lines).toEqual(["A", "「B」 ", "C"]);
  });

  test("超过 3 行时末尾行并入前一行", () => {
    // 测试点：打包结果多于 3 行时从尾部依次合并，最终不超过 3 行。
    const lines = buildTitleLines(["A", "B", "C", "D", "E"], (line) => line.length > 1);
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines.join("")).toBe("ABCDE");
  });

  test("单 token 超宽时独立成行", () => {
    // 测试点：单个 token 本身就超过阈值时不拆 token，单独成行交由 CSS 断词兜底。
    const lines = buildTitleLines(["VERYLONGTOKEN", "B"], (line) => line.length > 4);
    expect(lines).toEqual(["VERYLONGTOKEN", "B"]);
  });

  test("空结果回退为整串", () => {
    // 测试点：极端情况下无有效行时回退为原始拼接。
    expect(buildTitleLines(["  "], () => true)).toEqual(["  "]);
  });
});
