import { describe, expect, test } from "vitest";

import { buildOtherMemberPayloadObject } from "./helpers";

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
