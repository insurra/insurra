"""Tests for freezing legacy /api/v1/actions write routes while keeping reads available (B3.5)."""

from app.core.config import get_settings


def test_legacy_actions_frozen_writes_return_410_with_canonical_pointer(client, demo, monkeypatch):
    _, headers = demo("raka")
    client.post(
        "/api/v1/consents",
        headers=headers,
        json={"purpose": "process_documents", "granted": True},
    )

    # Seed legacy actions before freezing
    list_res = client.get("/api/v1/actions?seed_demo=true", headers=headers)
    assert list_res.status_code == 200
    items = list_res.json()
    assert len(items) >= 1
    first_id = items[0]["id"]

    monkeypatch.setenv("FREEZE_LEGACY_ACTIONS", "true")
    get_settings.cache_clear()
    try:
        # Read endpoints remain 200
        read_list = client.get("/api/v1/actions", headers=headers)
        assert read_list.status_code == 200
        read_detail = client.get(f"/api/v1/actions/{first_id}", headers=headers)
        assert read_detail.status_code == 200

        # Write endpoints return 410 LEGACY_ROUTE_FROZEN with pointer to /api/v1/workflow/actions
        propose_res = client.post(
            "/api/v1/actions",
            headers=headers,
            json={
                "action_type": "create_reminder",
                "permission_level": "L1",
                "source_screen": "SC-10",
                "payload": {"title": "Test"},
            },
        )
        assert propose_res.status_code == 410
        assert propose_res.json()["code"] == "LEGACY_ROUTE_FROZEN"
        assert propose_res.json()["details"]["canonical_endpoint"] == "/api/v1/workflow/actions"

        approve_res = client.post(
            f"/api/v1/actions/{first_id}/approve",
            headers=headers,
            json={"confirmed": True},
        )
        assert approve_res.status_code == 410
        assert approve_res.json()["code"] == "LEGACY_ROUTE_FROZEN"

        reject_res = client.post(
            f"/api/v1/actions/{first_id}/reject",
            headers=headers,
            json={"reason": "No longer needed"},
        )
        assert reject_res.status_code == 410

        exec_res = client.post(
            f"/api/v1/actions/{first_id}/execute",
            headers=headers,
            json={"approved_payload_sha256": "0" * 64},
        )
        assert exec_res.status_code == 410
    finally:
        monkeypatch.delenv("FREEZE_LEGACY_ACTIONS", raising=False)
        get_settings.cache_clear()
