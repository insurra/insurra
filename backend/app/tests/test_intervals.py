"""Unit tests for the shared deterministic interval engine (B1.12)."""

from datetime import date

from app.services.intervals import covered_days, uncovered_interval


def test_raka_76_day_continuity_interval():
    study_start = date(2026, 9, 1)
    study_end = date(2027, 6, 30)
    policy_start = date(2026, 9, 1)
    policy_end = date(2027, 4, 15)

    uncovered, gaps = uncovered_interval(study_start, study_end, [(policy_start, policy_end)])
    assert uncovered == 76
    assert len(gaps) == 1
    assert gaps[0].start_date == date(2027, 4, 16)
    assert gaps[0].end_date == date(2027, 6, 30)


def test_overlapping_and_adjacent_policies_union_cleanly():
    start = date(2026, 1, 1)
    end = date(2026, 12, 31)
    intervals = [
        (date(2026, 1, 1), date(2026, 6, 30)),
        (date(2026, 6, 15), date(2026, 10, 31)),
        (date(2026, 11, 1), date(2026, 12, 31)),
    ]
    uncovered, gaps = uncovered_interval(start, end, intervals)
    assert uncovered == 0
    assert gaps == []


def test_multiple_gaps_and_clamping_to_declared_period():
    start = date(2026, 3, 1)
    end = date(2026, 3, 31)
    intervals = [
        (date(2026, 1, 1), date(2026, 3, 5)),
        (date(2026, 3, 10), date(2026, 3, 20)),
        (date(2026, 4, 1), date(2026, 5, 1)),
    ]
    cov, uncov, gaps = covered_days(start, end, intervals)
    # Covered: Mar 1-5 (5 days) + Mar 10-20 (11 days) = 16 days
    # Uncovered: Mar 6-9 (4 days) + Mar 21-31 (11 days) = 15 days
    assert cov == 16
    assert uncov == 15
    assert len(gaps) == 2
    assert gaps[0].start_date == date(2026, 3, 6)
    assert gaps[0].end_date == date(2026, 3, 9)
    assert gaps[1].start_date == date(2026, 3, 21)
    assert gaps[1].end_date == date(2026, 3, 31)
