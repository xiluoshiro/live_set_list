import { describe, expect, test } from "vitest";

import { buildOtherMemberPayloadObject, normalizeSongLookupText } from "./helpers";

describe("buildOtherMemberPayloadObject", () => {
  test("按配置分隔符拆分同一 key 的多项 value 并合并重复 key", () => {
    // 测试点：other_member 的多值输入必须提交为同一 key 下的字符串数组。
    expect(buildOtherMemberPayloadObject([
      { entry_id: 1, member_key: "嘉宾", member_value: "a / b /  c" },
      { entry_id: 2, member_key: "嘉宾", member_value: "d" },
      { entry_id: 3, member_key: "支援", member_value: "" },
    ], "/")).toEqual({
      嘉宾: ["a", "b", "c", "d"],
      支援: null,
    });
  });
});

describe("normalizeSongLookupText", () => {
  test("等价撇号及其拉丁词与日文之间的空白会归一化", () => {
    // 测试点：目标标题的弯撇号和拉丁词后空白差异不能阻止 setlist 歌曲匹配。
    expect(normalizeSongLookupText("LET’S あちあちトレーニング！"))
      .toBe(normalizeSongLookupText("LET'Sあちあちトレーニング！"));
  });

  test("普通词间空格仍参与歌曲匹配", () => {
    // 测试点：没有内部等价标点的普通拉丁词不能因归一化而合并词间空格。
    expect(normalizeSongLookupText("My Song")).not.toBe(normalizeSongLookupText("MySong"));
  });
});
