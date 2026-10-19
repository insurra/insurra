"""Provenance regression tests: dry-run and hand-written data must never look officially verified.

Never use em dashes in strings or docstrings.
"""

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import ROOT
from app.pipeline.collectors.source_crawler import SourceCrawler
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.runner import PipelineRunner
from app.pipeline.schemas.models import (
    ClaimProcedure,
    EvidenceClass,
    PipelineVerificationStatus,
    ProvenancedRecord,
)
from app.services.kb_loader import CountryKBLoader

KB = ROOT / "kb"
REAL_HASH = re.compile(r"^[0-9a-f]{64}$")
FAKE_HASH_MARKER = "simulated_" + "sha256_hash"
# Hand-curated runtime resources that safety paths still read as VERIFIED (emergency numbers,
# red flags, the sourced BPJS pathway). They must stay MANUALLY_CURATED with an https source.
CURATED_RUNTIME_FILES = {"emergency.json", "red_flags.json", "pathways.json"}


def _json_files() -> list[Path]:
    folders = [KB / "CN", KB / "ID", KB / "global", KB / "exports", KB / "assets"]
    return [p for folder in folders for p in sorted(folder.rglob("*.json"))]


def _records(node, inherited=None):
    """Yields (record, nearest evidence_class) for dicts that carry a verification status."""
    if isinstance(node, dict):
        current = node.get("evidence_class", inherited)
        if "verification_status" in node or "licensing_verification_status" in node:
            yield node, current
        for value in node.values():
            yield from _records(value, current)
    elif isinstance(node, list):
        for value in node:
            yield from _records(value, inherited)


def test_no_verified_record_without_retrieved_official_evidence():
    for path in _json_files():
        for record, evidence_class in _records(json.loads(path.read_text())):
            statuses = {
                record.get("verification_status"),
                record.get("licensing_verification_status"),
            }
            if "VERIFIED" not in statuses:
                continue
            artifact = record.get("retrieval_artifact_sha256")
            if evidence_class == "RETRIEVED_OFFICIAL" and REAL_HASH.fullmatch(artifact or ""):
                continue
            # Only the explicitly curated runtime resources may keep the label, and only with a
            # real https source and a non-retrieved class.
            assert path.name in CURATED_RUNTIME_FILES, f"{path}: VERIFIED without evidence"
            assert evidence_class == "MANUALLY_CURATED", f"{path}: wrong evidence_class"
            assert str(record.get("source_url", "")).startswith("https://"), path


def test_pipeline_record_files_are_never_verified_and_carry_a_class():
    """Generator-authored datasets are all non-VERIFIED and declare an explicit class."""
    names = (
        "companies",
        "products",
        "regulations",
        "insurance_schemes",
        "claims_procedures",
        "claim_evidence",
        "network_providers",
        "medical_costs",
        "consumer_disputes",
        "rag_chunks",
    )
    for country in ("CN", "ID"):
        for name in names:
            for record in json.loads((KB / country / f"{name}.json").read_text()):
                assert record["verification_status"] != "VERIFIED", (country, name)
                assert record.get("licensing_verification_status") != "VERIFIED"
                assert record["evidence_class"] in {"MANUALLY_CURATED", "SYNTHETIC_FIXTURE"}
                assert record["retrieval_artifact_sha256"] is None
        for record in json.loads((KB / country / "network_providers.json").read_text()):
            assert record["cashless_direct_billing_verified"] is False
    for chunk in json.loads((KB / "CN" / "rag_chunks.json").read_text()):
        assert chunk["evidence_class"] == "SYNTHETIC_FIXTURE"


def test_university_requirements_uses_envelope_and_is_synthetic():
    envelope = json.loads((KB / "CN" / "university_requirements.json").read_text())
    assert envelope["schema_version"] == "1.5"
    assert envelope["verification_status"] == "UNVERIFIED"
    assert envelope["evidence_class"] == "SYNTHETIC_FIXTURE"
    assert envelope["source_url"] is None and envelope["checked_at"] is None
    assert envelope["data"] and all(
        r["evidence_class"] == "SYNTHETIC_FIXTURE" for r in envelope["data"]
    )


def test_country_kb_loader_accepts_provenance_fields():
    loader = CountryKBLoader(KB)
    for code in ("CN", "ID"):
        country = loader.load(code)
        assert country.resources.emergency.evidence_class is not None
        expected = EvidenceClass.MANUALLY_CURATED if code == "CN" else EvidenceClass.PLACEHOLDER
        assert country.resources.rules.evidence_class == expected
    # AU stays untouched and still validates without provenance fields.
    assert loader.load("AU").resources.emergency.evidence_class is None


def test_no_fake_hash_anywhere():
    roots = [KB, ROOT / "fixtures", ROOT / "docs", ROOT / "backend" / "app"]
    for root in roots:
        for path in root.rglob("*"):
            if path.suffix in {".json", ".md", ".py"} and path.is_file():
                assert FAKE_HASH_MARKER not in path.read_text(errors="ignore"), path


def test_dry_run_crawl_reports_not_fetched_with_null_hash(tmp_path):
    summary = SourceCrawler(cache_dir=tmp_path, live_network=False).crawl_sources(
        list(OFFICIAL_SOURCES)
    )
    statuses = {r["status"] for r in summary.audit_records}
    assert statuses <= {"NOT_FETCHED", "SKIPPED_PER_POLICY"}
    assert summary.successful_count == 0
    for record in summary.audit_records:
        assert record["sha256"] is None
        assert not record["bytes"]
        assert record["http_code"] is None
    assert all(s.verification_status.value == "DISCOVERED" for s in OFFICIAL_SOURCES)


def test_verified_requires_retrieved_official_and_real_hash():
    class Probe(ProvenancedRecord):
        verification_status: PipelineVerificationStatus

    with pytest.raises(ValidationError):
        Probe(verification_status=PipelineVerificationStatus.VERIFIED)
    with pytest.raises(ValidationError):
        Probe(
            verification_status=PipelineVerificationStatus.VERIFIED,
            evidence_class=EvidenceClass.RETRIEVED_OFFICIAL,
            retrieval_artifact_sha256="simulated_" + "sha256_hash",
        )
    with pytest.raises(ValidationError):
        Probe(
            verification_status=PipelineVerificationStatus.VERIFIED,
            evidence_class=EvidenceClass.MANUALLY_CURATED,
            retrieval_artifact_sha256="a" * 64,
        )
    ok = Probe(
        verification_status=PipelineVerificationStatus.VERIFIED,
        evidence_class=EvidenceClass.RETRIEVED_OFFICIAL,
        retrieval_artifact_sha256="a" * 64,
    )
    assert ok.evidence_class == EvidenceClass.RETRIEVED_OFFICIAL
    assert ClaimProcedure.model_fields["evidence_class"].default == EvidenceClass.MANUALLY_CURATED


@pytest.mark.parametrize(
    "manifest_path",
    [
        KB / "assets" / "insurers" / "manifest.json",
        ROOT / "frontend/public/assets/insurers/manifest.json",
    ],
)
def test_insurer_manifest_has_no_unverified_official_claims(manifest_path):
    manifest = json.loads(manifest_path.read_text())
    assert manifest["placeholder"] is True
    assert "not official" in manifest["notice"]
    assert manifest["insurers"]
    for entry in manifest["insurers"]:
        assert entry["placeholder"] is True
        assert entry["license_status"] == "NOT_VERIFIED"
        assert entry["evidence_class"] == "PLACEHOLDER"
        assert entry["logo"]["status"] == "placeholder"
        assert entry["logo"]["fetched"] is False
        assert REAL_HASH.fullmatch(entry["logo"]["sha256"])
        text = json.dumps(entry).casefold()
        assert "permitted" not in text
        assert "official brand" not in text
        assert "registered trademark" not in text
        # The legacy path must keep working for any consumer.
        assert (ROOT / "frontend/public" / entry["logo"]["public_url"].lstrip("/")).is_file()


def test_report_is_truthful_and_counts_come_from_data():
    report = (ROOT / "docs/prd/DATA_PROVENANCE_AND_QUALITY_REPORT.md").read_text()
    lowered = report.casefold()
    for phrase in (
        "official brand logos",
        "sanitized & hashed",
        "permitted autonomous ingestion",
        "has been built and executed",
        "collects, sanitizes, normalizes",
        "authoritative public insurance knowledge",
        "corroborated against official",
        "source-linked rag",
    ):
        assert phrase not in lowered, phrase
    assert "—" not in report
    assert f"Sources registered: {len(OFFICIAL_SOURCES)}" in report
    assert "Sources downloaded with a real content hash: 0" in report
    assert "Records parsed from a downloaded source: 0" in report
    assert "Records with that class: 0" in report
    assert "Pipeline datasets labelled VERIFIED: 0" in report
    runtime = PipelineRunner(root=ROOT)._runtime_verified()
    assert f"still labelled VERIFIED: {sum(c for _, c, _ in runtime)}" in report
    for section in ("registered", "downloaded", "parsed", "manually_curated", "synthetic_fixture"):
        assert section in lowered
