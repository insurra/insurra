"""Proactive Renewal & Anti-Lapse Agent Service (Flow 6 - P0).

Lifecycle:
Scheduled Trigger -> Read Coverage Periods -> Calculate Gap/Expiry ->
Create Finding -> Deduplicate -> Draft Inquiry -> User Approval ->
Authorized Execution -> Receipt

Core requirements:
1. Configurable H-30, H-7, H-1 checks.
2. Date and timezone correctness (owner local timezone, e.g. Asia/Jakarta / Asia/Shanghai).
3. Detect possible continuity gaps between policies and against stay horizons.
4. Distinguish historical document expiry from confirmed current lapse.
5. Deduplicate findings and notifications across repeated cycles.
6. Show prioritized next actions on Home.
7. Draft an inquiry request using verified policy data.
8. No automatic purchase, payment, or renewal (strictly safety gate in AWAITING_APPROVAL).
9. Store execution response from authorized sandbox/channel.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.schemas.foundation import (
    AntiLapseAgentStatus,
    ContinuityGapItem,
    MonitoredPolicyItem,
)
from app.workflow import followup
from app.workflow.models import WfActionRow, WfReminderRow
from app.workflow.owner import Owner

logger = logging.getLogger(__name__)


def resolve_owner_timezone(country_code: str | None = None) -> tuple[ZoneInfo, str]:
    """Deterministically resolve local timezone based on country context."""
    code = (country_code or "ID").upper()
    if code == "CN":
        return ZoneInfo("Asia/Shanghai"), "Asia/Shanghai"
    if code == "AU":
        return ZoneInfo("Australia/Sydney"), "Australia/Sydney"
    return ZoneInfo("Asia/Jakarta"), "Asia/Jakarta"


def _parse_date(val: Any) -> date | None:
    if not val:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except (ValueError, TypeError):
        return None


def run_anti_lapse_agent(
    db: Session,
    owner: Owner,
    actor: Any = None,
    profile_data: Any = None,
    *,
    today: date | None = None,
    offsets: tuple[int, ...] = (30, 7, 1),
    force_scan: bool = False,
) -> AntiLapseAgentStatus:
    """Execute the full autonomous reasoning cycle of the Proactive Renewal & Anti-Lapse Agent."""
    # 1. Date and Timezone Correctness
    # Resolve country from profile
    profile = profile_data
    if profile is None and actor:
        try:
            from app.services.workspace import profile as get_profile

            profile = get_profile(db, actor)
        except Exception:
            profile = None

    country_code = getattr(profile, "country_code", "ID") or "ID"
    tz, tz_name = resolve_owner_timezone(country_code)
    now_local = datetime.now(tz)
    local_today = today or now_local.date()

    reasoning_trail: list[str] = []
    ts = now_local.strftime("%H:%M:%S")
    reasoning_trail.append(f"[{ts} {tz_name}] 🛰️ Trigger: Scheduled Anti-Lapse Sentinel evaluation")
    reasoning_trail.append(
        f"[{ts} {tz_name}] 📍 Timezone Engine: {tz_name} — Local date evaluated: {local_today.isoformat()}"
    )

    # 2. Read Coverage Periods
    policies = followup.owner_policies(db, owner)
    reasoning_trail.append(
        f"[{ts} {tz_name}] 🔍 Policy Reader: Evaluated {len(policies)} recorded policy record(s)"
    )

    monitored_policies: list[MonitoredPolicyItem] = []
    dated_coverages: list[dict[str, Any]] = []

    for pol in policies:
        end_dt = _parse_date(pol.end)
        start_dt = _parse_date(pol.start)
        provider_name = pol.name or pol.provider or pol.kind or "Insurance"
        cat = pol.kind or "General Health"

        if end_dt is None:
            monitored_policies.append(
                MonitoredPolicyItem(
                    policy_ref=pol.ref,
                    provider=provider_name,
                    category=cat,
                    end_date=None,
                    days_left=None,
                    status="UNDATED",
                    status_label="Undated",
                    is_historical=False,
                    action_prepared=False,
                )
            )
            continue

        days_remaining = (end_dt - local_today).days
        dated_coverages.append(
            {
                "ref": pol.ref,
                "provider": provider_name,
                "category": cat,
                "start": start_dt,
                "end": end_dt,
                "days_remaining": days_remaining,
            }
        )

        # 4. Distinguish historical document expiry from confirmed current lapse
        if days_remaining < -90:
            status = "HISTORICAL_DOCUMENT_EXPIRED"
            status_label = f"Expired Document ({abs(days_remaining)}d ago)"
            is_hist = True
        elif -90 <= days_remaining < 0:
            status = "CONFIRMED_CURRENT_LAPSE"
            status_label = f"Confirmed Lapse ({abs(days_remaining)}d ago)"
            is_hist = False
        elif 0 <= days_remaining <= 30:
            status = "UPCOMING_EXPIRY"
            status_label = f"Expires in {days_remaining}d"
            is_hist = False
        else:
            status = "ACTIVE_GOOD_STANDING"
            status_label = f"Active ({days_remaining}d remaining)"
            is_hist = False

        monitored_policies.append(
            MonitoredPolicyItem(
                policy_ref=pol.ref,
                provider=provider_name,
                category=cat,
                end_date=end_dt.isoformat(),
                days_left=days_remaining,
                status=status,
                status_label=status_label,
                is_historical=is_hist,
                action_prepared=False,
            )
        )

    # 3. Detect possible continuity gaps
    continuity_gaps: list[ContinuityGapItem] = []
    # Sort coverages with dates chronologically
    sorted_covs = [c for c in dated_coverages if c["start"] is not None]
    sorted_covs.sort(key=lambda x: (x["start"], x["end"]))

    for i in range(len(sorted_covs) - 1):
        curr = sorted_covs[i]
        nxt = sorted_covs[i + 1]
        # Check if consecutive policies leave an uncovered interval
        if curr["end"] < nxt["start"] - timedelta(days=1):
            gap_start = curr["end"] + timedelta(days=1)
            gap_end = nxt["start"] - timedelta(days=1)
            gap_days = (gap_end - gap_start + timedelta(days=1)).days
            if gap_days > 0:
                gap_id = f"gap_{curr['ref']}_{nxt['ref']}"
                continuity_gaps.append(
                    ContinuityGapItem(
                        id=gap_id,
                        gap_type="BETWEEN_POLICIES",
                        category=curr["category"],
                        start_date=gap_start.isoformat(),
                        end_date=gap_end.isoformat(),
                        days=gap_days,
                        severity="HIGH" if gap_days >= 7 else "MEDIUM",
                        description=f"Coverage gap of {gap_days} day(s) detected between {curr['provider']} (ends {curr['end'].isoformat()}) and {nxt['provider']} (starts {nxt['start'].isoformat()}).",
                    )
                )

    # Check forward stay / study continuity if profile has end date
    study_end = _parse_date(getattr(profile, "study_end_date", None)) if profile else None
    if study_end and dated_coverages:
        max_end = max(c["end"] for c in dated_coverages)
        if max_end < study_end:
            gap_start = max_end + timedelta(days=1)
            gap_days = (study_end - gap_start + timedelta(days=1)).days
            if gap_days > 0:
                continuity_gaps.append(
                    ContinuityGapItem(
                        id="gap_stay_uncovered",
                        gap_type="STAY_UNCOVERED",
                        category="Residence / Study Stay",
                        start_date=gap_start.isoformat(),
                        end_date=study_end.isoformat(),
                        days=gap_days,
                        severity="HIGH",
                        description=f"Coverage ends {max_end.isoformat()}, leaving {gap_days} day(s) uncovered before planned stay end ({study_end.isoformat()}).",
                    )
                )

    reason_expiry_count = sum(1 for m in monitored_policies if m.status == "UPCOMING_EXPIRY")
    reason_lapse_count = sum(1 for m in monitored_policies if m.status == "CONFIRMED_CURRENT_LAPSE")
    reasoning_trail.append(
        f"[{ts} {tz_name}] ⏱️ Expiry Calculation: H-30/H-7/H-1 horizons checked ({reason_expiry_count} upcoming, {reason_lapse_count} lapsed)"
    )
    reasoning_trail.append(
        f"[{ts} {tz_name}] 🧩 Gap Analysis: Sequential coverage evaluation complete ({len(continuity_gaps)} gap(s) detected)"
    )

    # 4. Configurable H-30, H-7, H-1 checks & Sync Reminders (Deduplicated)
    rem_sync = followup.sync_policy_reminders(db, owner, offsets=offsets, today=local_today)
    reasoning_trail.append(
        f"[{ts} {tz_name}] 📋 Reminders Sync: {rem_sync.get('scheduled', 0)} scheduled, {rem_sync.get('cancelled', 0)} cancelled (Deduplication enforced)"
    )

    # 5. Draft Inquiry using verified data (Safety: No automatic purchase, payment, or renewal)
    # Only prepare actions for policies expiring within the primary offset horizon (H-30) or recently lapsed (-7)
    scan_window = offsets[0] if offsets else 30
    prepared_actions = followup.prepare_proactive_renewal_actions(
        db, owner, today=local_today, window_days=scan_window
    )
    if prepared_actions:
        reasoning_trail.append(
            f"[{ts} {tz_name}] ✍️ Proactive Inquiry Draft: Prepared {len(prepared_actions)} renewal action(s) with verified policy data"
        )
    else:
        reasoning_trail.append(
            f"[{ts} {tz_name}] ✍️ Proactive Inquiry Draft: No new draft required (existing actions retained or deduplicated)"
        )

    reasoning_trail.append(
        f"[{ts} {tz_name}] 🔒 Safety Boundary: Actions remain in AWAITING_APPROVAL. Zero automatic payments or renewals permitted."
    )

    # 6. Check Active Prepared Actions in DB
    existing_actions = db.scalars(
        select(WfActionRow)
        .where(
            WfActionRow.owner_kind == owner.kind,
            WfActionRow.owner_id == owner.id,
            WfActionRow.action_type == "renewal_inquiry",
            WfActionRow.status.in_(("AWAITING_APPROVAL", "APPROVED")),
        )
        .order_by(WfActionRow.created_at.desc())
    ).all()

    active_action = existing_actions[0] if existing_actions else None

    # Mark monitored policies if action prepared
    if active_action:
        payload_cov_id = (active_action.payload or {}).get("coverage_id")
        for m in monitored_policies:
            if m.policy_ref == payload_cov_id:
                m.action_prepared = True

    # Total active reminders
    db.scalar(
        select(WfReminderRow).where(
            WfReminderRow.owner_kind == owner.kind,
            WfReminderRow.owner_id == owner.id,
            WfReminderRow.status == "SCHEDULED",
        )
    )
    active_reminders_count = len(
        db.scalars(
            select(WfReminderRow).where(
                WfReminderRow.owner_kind == owner.kind,
                WfReminderRow.owner_id == owner.id,
                WfReminderRow.status == "SCHEDULED",
            )
        ).all()
    )

    # 7. Formulate Status and Headline (Focused, compact, clear distinction)
    upcoming_90d_pol = next(
        (m for m in monitored_policies if m.days_left is not None and 0 <= m.days_left <= 90),
        None,
    )

    if active_action:
        status_val = "ACTION_PREPARED"
        headline = "Renewal inquiry prepared · 1 action pending"
        description = (
            f"The agent safely drafted a renewal inquiry for {active_action.title.replace('Renewal inquiry for ', '')} "
            f"using verified policy details. Awaiting your authorization before transmission."
        )
    elif continuity_gaps:
        status_val = "ATTENTION_REQUIRED"
        first_gap = continuity_gaps[0]
        headline = "Renewal monitoring active · 1 gap finding"
        description = (
            f"Potential coverage gap ({first_gap.days} days) detected between {first_gap.start_date} and {first_gap.end_date} "
            f"based on recorded dates — not a confirmed lapse."
        )
    elif upcoming_90d_pol:
        status_val = (
            "ATTENTION_REQUIRED" if upcoming_90d_pol.days_left <= 30 else "ACTIVE_MONITORING"
        )
        headline = "Renewal monitoring active · 1 finding"
        description = (
            f"{upcoming_90d_pol.provider} recorded end date is in {upcoming_90d_pol.days_left} days ({upcoming_90d_pol.end_date}). "
            f"Potential continuity gap evaluated based on available dates — not a confirmed lapse."
        )
    else:
        status_val = "ACTIVE_MONITORING"
        headline = "Renewal monitoring active · All clear"
        description = (
            f"Autonomous sentinel actively monitoring {len(policies)} policy record(s) "
            f"against timezone {tz_name}. No coverage gaps or lapses detected."
        )

    return AntiLapseAgentStatus(
        agent_id="anti_lapse_sentinel",
        agent_name="Proactive Renewal & Anti-Lapse Agent",
        status=status_val,
        headline=headline,
        description=description,
        last_scanned_at=now_local.isoformat(),
        timezone=tz_name,
        scan_offsets=list(offsets),
        policies_scanned=len(policies),
        active_monitored_policies=monitored_policies,
        continuity_gaps=continuity_gaps,
        prepared_actions_count=len(existing_actions),
        reminders_count=active_reminders_count,
        reasoning_trail=reasoning_trail,
        active_action_id=str(active_action.id) if active_action else None,
        active_action_ref=active_action.reference if active_action else None,
        active_action_title=active_action.title if active_action else None,
    )
