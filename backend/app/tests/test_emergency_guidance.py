def test_verified_emergency_directory_keeps_country_and_source(client):
    assert client.get("/api/v1/emergency?country_code=CN").status_code == 200
    china = client.get("/api/v1/emergency?country_code=CN").json()
    assert china["country_code"] == "CN"
    assert {item["service_code"]: item["phone_number"] for item in china["contacts"]} == {
        "medical": "120",
        "police": "110",
        "fire": "119",
    }
    assert all(
        item["source_url"] and item["checked_at"] and item["jurisdiction"]
        for item in china["contacts"]
    )
    indonesia = client.get("/api/v1/emergency?country_code=ID").json()
    assert {item["service_code"]: item["phone_number"] for item in indonesia["contacts"]} == {
        "general": "112",
        "medical": "119",
        "police": "110",
        "fire": "113",
    }
    # AU stays on disk but is inactive, so it is not served (no contacts, no placeholder).
    inactive = client.get("/api/v1/emergency?country_code=AU")
    assert inactive.status_code == 422 and inactive.json()["code"] == "UNSUPPORTED_COUNTRY"
    assert client.get("/api/v1/emergency?country_code=ZZ").status_code == 422


def test_multilingual_triage_escalates_without_clearing_unmatched_text(client, demo):
    _, headers = demo("sinta")
    url = "/api/v1/triage"
    assert client.post(url, json={"text": "胸痛"}).status_code == 401
    for phrase in ("nyeri dada berat", "severe chest pain", "胸痛", "呼吸困难"):
        result = client.post(url, headers=headers, json={"text": phrase})
        assert result.status_code == 200
        assert result.json()["red_flag"] is True
        assert result.json()["safety_flows"] == ["EMERGENCY_MEDICAL"]
        assert result.json()["screening_complete"] is False
        assert all(match["source_url"] for match in result.json()["matched"])
    self_harm = client.post(url, headers=headers, json={"text": "ingin menyakiti diri sendiri"})
    assert self_harm.json()["safety_flows"] == ["SELF_HARM_SUPPORT"]
    assert all(match["category"] == "SELF_HARM" for match in self_harm.json()["matched"])
    chinese = client.post(url, headers=headers, json={"text": "呼吸困难", "country_code": "CN"})
    assert chinese.json()["matched"][0]["kb_version"] == "0.2.0"
    assert chinese.json()["safety_flows"] == ["EMERGENCY_MEDICAL"]
    unmatched = client.post(url, headers=headers, json={"text": "gejala tidak jelas"}).json()
    assert unmatched == {
        "red_flag": False,
        "matched": [],
        "safety_flows": [],
        "screening_complete": False,
    }
