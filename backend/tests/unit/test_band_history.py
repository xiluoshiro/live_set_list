from app.band_history import calculate_attendance, suggest_lineup_usage


# 测试点：集合计算必须区分全员、全员加特别出演、缺席和无可靠版本四种状态。
def test_calculate_attendance_statuses_from_member_sets():
    full = calculate_attendance(expected_members=["A", "B"], present_members=["A", "B"])
    full_plus = calculate_attendance(
        expected_members=["A", "B"],
        present_members=["A", "B", "C"],
        incoming_members=["C"],
    )
    partial = calculate_attendance(expected_members=["A", "B"], present_members=["A"])
    unknown = calculate_attendance(expected_members=None, present_members=["A"])

    assert full.attendance_status == "full"
    assert full_plus.attendance_status == "full_plus"
    assert full_plus.extra_members[0].category == "incoming"
    assert partial.attendance_status == "partial"
    assert partial.missing_members == ("B",)
    assert unknown.attendance_status == "unknown"
    assert unknown.present_count == 1


# 测试点：正式成员缺席不能被人数相同的额外成员抵消为全员。
def test_calculate_attendance_keeps_equal_count_missing_member_partial():
    result = calculate_attendance(
        expected_members=["A", "B", "C"],
        present_members=["A", "B", "X"],
        appearance_roles={"X": "support"},
    )

    assert result.attendance_status == "partial"
    assert result.expected_count == result.present_count == 3
    assert result.missing_members == ("C",)
    assert [(item.member_name, item.category) for item in result.extra_members] == [("X", "support")]


# 测试点：双版本建议应保留 base、next、handover 及歧义确认，不假定模式单调切换。
def test_suggest_lineup_usage_handles_handover_and_ambiguous_rows():
    base = ["A", "B", "Old"]
    next_lineup = ["A", "B", "New"]

    assert suggest_lineup_usage(
        base_members=base,
        next_members=next_lineup,
        present_members=base,
    ).lineup_usage == "base"
    assert suggest_lineup_usage(
        base_members=base,
        next_members=next_lineup,
        present_members=next_lineup,
    ).lineup_usage == "next"
    assert suggest_lineup_usage(
        base_members=base,
        next_members=next_lineup,
        present_members=[*base, "New"],
    ).lineup_usage == "handover"
    ambiguous = suggest_lineup_usage(
        base_members=base,
        next_members=next_lineup,
        present_members=["A", "B"],
    )
    assert ambiguous.lineup_usage is None
    assert ambiguous.requires_confirmation is True
