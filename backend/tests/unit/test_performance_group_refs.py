import pytest

from app.performance_group_refs import (
    build_performance_group_ref,
    build_performance_group_ref_from_row,
)


# 测试点：build_performance_group_ref 在 group_id 为 None 时应返回 None，表示 Live 不属于任何活动组。
def test_build_performance_group_ref_returns_none_when_group_id_is_none():
    result = build_performance_group_ref(None, "Any Title")
    assert result is None


# 测试点：传入有效 group_id 和 group_title 时，应返回包含正确键值对的字典。
def test_build_performance_group_ref_returns_correct_dict():
    result = build_performance_group_ref(5, "My Group")
    assert result == {"group_id": 5, "group_title": "My Group"}


# 测试点：查询行缺少声明的活动组投影字段时应立即失败，避免静默掩盖 SQL 回归。
def test_build_performance_group_ref_from_row_rejects_short_row():
    row = (1, "2026-01-01")  # only 2 columns, need index 8 and 9
    with pytest.raises(IndexError):
        build_performance_group_ref_from_row(row, group_id_index=8, group_title_index=9)


# 测试点：row 长度足够时，应正确委托给 build_performance_group_ref 并返回其结果。
def test_build_performance_group_ref_from_row_delegates_to_build_performance_group_ref():
    row = (None,) * 10  # create a tuple with 10 None values
    # Place actual values at indices 5 and 6
    row_list = list(row)
    row_list[5] = 7
    row_list[6] = "Test Group"
    row_tuple = tuple(row_list)

    result = build_performance_group_ref_from_row(
        row_tuple, group_id_index=5, group_title_index=6
    )
    assert result == {"group_id": 7, "group_title": "Test Group"}
