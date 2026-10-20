"""Single deterministic calendar-interval computation shared across continuity, completeness and insights."""

from datetime import date, timedelta

from app.schemas.common import DateRange


def uncovered_interval(
    start: date,
    end: date,
    intervals: list[tuple[date, date]],
) -> tuple[int, list[DateRange]]:
    """Union and clamp inclusive calendar intervals [left, right] against [start, end].

    Returns (uncovered_days, gap_ranges) where each DateRange is inclusive.
    Python ordinals avoid overflow and never use floating-point or LLM arithmetic.
    """
    if start > end:
        return 0, []
    ranges = sorted(
        (max(start.toordinal(), left.toordinal()), min(end.toordinal(), right.toordinal()))
        for left, right in intervals
        if left is not None and right is not None and left <= right
    )
    cursor, end_day = start.toordinal(), end.toordinal()
    gaps: list[DateRange] = []
    for left, right in ranges:
        if left > right:
            continue
        if left > cursor:
            gaps.append(
                DateRange(start_date=date.fromordinal(cursor), end_date=date.fromordinal(left - 1))
            )
        cursor = max(cursor, right + 1)
    if cursor <= end_day:
        gaps.append(DateRange(start_date=date.fromordinal(cursor), end_date=end))
    total_days = sum((g.end_date - g.start_date + timedelta(days=1)).days for g in gaps)
    return total_days, gaps


def covered_days(
    start: date,
    end: date,
    intervals: list[tuple[date, date]],
) -> tuple[int, int, list[DateRange]]:
    """Returns (covered_days, uncovered_days, gap_ranges) for an inclusive [start, end] period."""
    if start > end:
        return 0, 0, []
    total_span = (end - start + timedelta(days=1)).days
    uncovered, gaps = uncovered_interval(start, end, intervals)
    return max(0, total_span - uncovered), uncovered, gaps
