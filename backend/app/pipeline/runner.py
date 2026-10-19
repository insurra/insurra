"""Pipeline Runner Orchestrator.
Coordinates source discovery, asset sanitization, knowledge synthesis,
export to knowledge base, database ingestion, and provenance reporting.
Never use em dashes in strings or docstrings.
"""

import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import ROOT, get_settings
from app.core.database import make_engine, session_factory
from app.pipeline.brand_assets.collector import BrandAssetPipeline
from app.pipeline.collectors.source_crawler import SourceCrawler
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.exporters.kb_exporter import KBExporter
from app.pipeline.generators import cn_data, id_data
from app.pipeline.generators.cn_data import CN_COMPANIES, CN_PRODUCTS
from app.pipeline.generators.global_data import GLOBAL_GLOSSARY_ENTRIES
from app.pipeline.generators.id_data import ID_COMPANIES, ID_PRODUCTS
from app.pipeline.generators.rules_data import DETERMINISTIC_RULES
from app.pipeline.rag.chunker import CN_RAG_CHUNKS, ID_RAG_CHUNKS
from app.pipeline.schemas.models import EvidenceClass
from app.pipeline.synthetic.generator import SYNTHETIC_FIXTURES


def _count_verified(node, classes: set[str]) -> int:
    """Counts nested records labelled VERIFIED and collects their evidence classes."""
    total = 0
    if isinstance(node, dict):
        if node.get("verification_status") == "VERIFIED":
            total += 1
            classes.add(str(node.get("evidence_class", "NONE")))
        total += sum(_count_verified(v, classes) for v in node.values())
    elif isinstance(node, list):
        total += sum(_count_verified(v, classes) for v in node)
    return total


class PipelineRunner:
    def __init__(self, root: Path = ROOT):
        self.root = root
        self.kb_dir = root / "kb"
        self.frontend_dir = root / "frontend"
        self.fixtures_dir = root / "fixtures"

    def run(self, live_network: bool = False) -> dict:
        """Executes the full pipeline end-to-end."""
        started_at = datetime.now(UTC)

        # 1. Source Discovery, Crawling and Access Assessment
        total_sources = len(OFFICIAL_SOURCES)
        cn_sources = [s for s in OFFICIAL_SOURCES if s.country == "CN"]
        id_sources = [s for s in OFFICIAL_SOURCES if s.country == "ID"]
        blocked_sources = [
            s
            for s in OFFICIAL_SOURCES
            if s.access_decision.value in ("blocked", "metadata_only", "manual_review_required")
        ]
        permitted_sources = [
            s
            for s in OFFICIAL_SOURCES
            if s.access_decision.value in ("api_allowed", "download_allowed", "crawl_allowed")
        ]

        crawler = SourceCrawler(
            cache_dir=self.root / "backend/data/cache/collectors", live_network=live_network
        )
        crawl = crawler.crawl_sources(OFFICIAL_SOURCES)

        # 2. Brand Asset Pipeline
        asset_pipeline = BrandAssetPipeline(frontend_dir=self.frontend_dir, kb_dir=self.kb_dir)
        brand_assets = asset_pipeline.execute()

        # 3. Knowledge Base Exporter
        exporter = KBExporter(kb_root=self.kb_dir)
        exporter.export_all(brand_assets=brand_assets)

        # 4. Export Synthetic Fixtures to fixtures/synthetic/
        synth_dir = self.fixtures_dir / "synthetic"
        synth_dir.mkdir(parents=True, exist_ok=True)
        for fix in SYNTHETIC_FIXTURES:
            fix_path = synth_dir / f"{fix.fixture_id}.json"
            fix_path.write_text(fix.model_dump_json(indent=2))

        # 5. Ingest into Database
        settings = get_settings()
        engine = make_engine(settings.database_url)
        factory = session_factory(engine)
        total_db_rows = 0
        with factory() as db:
            total_db_rows = exporter.ingest_into_database(db=db, brand_assets=brand_assets)

        completed_at = datetime.now(UTC)
        duration_sec = (completed_at - started_at).total_seconds()

        # 6. Generate Data Provenance and Quality Report
        report_content = self.generate_quality_report(
            total_sources=total_sources,
            cn_sources_count=len(cn_sources),
            id_sources_count=len(id_sources),
            permitted_count=len(permitted_sources),
            blocked_count=len(blocked_sources),
            blocked_sources=blocked_sources,
            brand_assets=brand_assets,
            total_db_rows=total_db_rows,
            crawl_records=crawl.audit_records,
            live_network=live_network,
        )
        report_path = self.root / "docs/prd/DATA_PROVENANCE_AND_QUALITY_REPORT.md"
        report_path.write_text(report_content)

        return {
            "status": "COMPLETED",
            "duration_seconds": duration_sec,
            "total_sources": total_sources,
            "cn_sources": len(cn_sources),
            "id_sources": len(id_sources),
            "permitted_sources": len(permitted_sources),
            "restricted_or_review_sources": len(blocked_sources),
            "cn_companies": len(CN_COMPANIES),
            "id_companies": len(ID_COMPANIES),
            "cn_products": len(CN_PRODUCTS),
            "id_products": len(ID_PRODUCTS),
            "brand_assets_sanitized": len(brand_assets),
            "sources_downloaded": sum(1 for r in crawl.audit_records if r["sha256"]),
            "rag_chunks_total": len(CN_RAG_CHUNKS) + len(ID_RAG_CHUNKS),
            "synthetic_fixtures": len(SYNTHETIC_FIXTURES),
            "database_rows_ingested": total_db_rows,
            "report_path": str(report_path),
        }

    @staticmethod
    def _dataset_groups(brand_assets: list) -> list[tuple[str, list]]:
        return [
            ("Source registry entries", list(OFFICIAL_SOURCES)),
            ("Insurer entities", CN_COMPANIES + ID_COMPANIES),
            ("Insurance products", CN_PRODUCTS + ID_PRODUCTS),
            ("Regulations", cn_data.CN_REGULATIONS + id_data.ID_REGULATIONS),
            ("Public schemes", cn_data.CN_PUBLIC_SCHEMES + id_data.ID_PUBLIC_SCHEMES),
            ("University requirements", cn_data.CN_UNIVERSITY_REQUIREMENTS),
            (
                "Claim procedures",
                cn_data.CN_CLAIM_PROCEDURES + id_data.ID_CLAIM_PROCEDURES,
            ),
            ("Claim evidence items", cn_data.CN_CLAIM_EVIDENCE + id_data.ID_CLAIM_EVIDENCE),
            (
                "Healthcare providers",
                cn_data.CN_HEALTHCARE_PROVIDERS + id_data.ID_HEALTHCARE_PROVIDERS,
            ),
            ("Medical cost references", cn_data.CN_MEDICAL_COSTS + id_data.ID_MEDICAL_COSTS),
            (
                "Consumer dispute procedures",
                cn_data.CN_CONSUMER_DISPUTES + id_data.ID_CONSUMER_DISPUTES,
            ),
            ("RAG clause chunks", CN_RAG_CHUNKS + ID_RAG_CHUNKS),
            ("Deterministic rules", list(DETERMINISTIC_RULES)),
            ("Glossary entries", list(GLOBAL_GLOSSARY_ENTRIES)),
            ("Insurer logo assets", list(brand_assets)),
            ("Synthetic test fixtures", list(SYNTHETIC_FIXTURES)),
        ]

    def _runtime_verified(self) -> list[tuple[str, int, str]]:
        """Counts records still labelled VERIFIED in the hand-curated runtime KB resources."""
        found: list[tuple[str, int, str]] = []
        for country in ("CN", "ID"):
            for path in sorted((self.kb_dir / country).glob("*.json")):
                try:
                    data = json.loads(path.read_text())
                except ValueError:
                    continue
                classes: set[str] = set()
                count = _count_verified(data, classes)
                if count:
                    found.append((f"{country}/{path.name}", count, ", ".join(sorted(classes))))
        return found

    def generate_quality_report(
        self,
        total_sources: int,
        cn_sources_count: int,
        id_sources_count: int,
        permitted_count: int,
        blocked_count: int,
        blocked_sources: list,
        brand_assets: list,
        total_db_rows: int,
        crawl_records: list[dict],
        live_network: bool,
    ) -> str:
        """Builds the report from actual data. Every count is computed, none is asserted."""
        crawl_status = Counter(r["status"] for r in crawl_records)
        downloaded = sum(1 for r in crawl_records if r["sha256"])
        accessed = crawl_status["FETCH_SUCCESS"] + crawl_status["FETCH_RESTRICTED_OR_TIMEOUT"]
        not_fetched = crawl_status["NOT_FETCHED"]
        skipped = crawl_status["SKIPPED_PER_POLICY"]
        groups = self._dataset_groups(brand_assets)
        by_class: Counter = Counter()
        verified_total = 0
        dataset_rows = ""
        for name, items in groups:
            classes = Counter(str(i.evidence_class.value) for i in items)
            statuses = Counter(
                str(getattr(i, "verification_status", None) or "NOT_APPLICABLE") for i in items
            )
            by_class.update(classes)
            verified_total += sum(
                1 for i in items if str(getattr(i, "verification_status", "")) == "VERIFIED"
            )
            dataset_rows += (
                f"| {name} | {len(items)} | "
                + ", ".join(f"{k} {v}" for k, v in sorted(classes.items()))
                + " | "
                + ", ".join(f"{k} {v}" for k, v in sorted(statuses.items()))
                + " |\n"
            )
        class_rows = "".join(f"| {k.value} | {by_class.get(k.value, 0)} |\n" for k in EvidenceClass)
        blocked_rows = ""
        for s in blocked_sources:
            reason = s.blocking_reason or "Access restricted"
            blocked_rows += (
                f"| {s.source_id} | {s.publisher} | {s.access_decision.value} | {reason} |\n"
            )
        runtime = self._runtime_verified()
        runtime_total = sum(count for _, count, _ in runtime)
        runtime_rows = "".join(f"| {n} | {c} | {k} |\n" for n, c, k in runtime)
        mode = "live network run" if live_network else "dry run (no network access)"
        retrieved = by_class.get(EvidenceClass.RETRIEVED_OFFICIAL.value, 0)

        return f"""# INSURRA Data Pipeline: Provenance and Quality Report

Generated by `PipelineRunner` in a {mode}. All counts below are computed from the data.
Active Geographic Scope: China (CN) and Indonesia (ID) only.
Legacy Scope: Australia (AU) disabled and preserved without modification.

## 1. Summary

- Nothing in this knowledge base is officially verified unless it appears in the
  RETRIEVED_OFFICIAL row of section 3. Records with that class: {retrieved}.
- Pipeline datasets labelled VERIFIED: {verified_total}.
- Hand-curated runtime KB records still labelled VERIFIED: {runtime_total} (see section 3). None
  of them was retrieved from a source; they are kept only because safety features read them.
- Sources registered: {total_sources} (China: {cn_sources_count}, Indonesia: {id_sources_count}).
- Sources downloaded with a real content hash: {downloaded}.
- Records parsed from a downloaded source: 0 (no parser consumes fetched artifacts).
- Most knowledge records were hand-written by developers with a public source URL and were not
  machine-verified. Some are illustrative synthetic fixtures. Treat all of them as UNVERIFIED.
- Insurer logo files are generated placeholders, not official logos. Their license status is
  NOT_VERIFIED.
- Database rows written to catalog tables in this run: {total_db_rows}.

## 2. Pipeline stages: what actually happened

| Stage | Count | Meaning |
| --- | --- | --- |
| Registered | {total_sources} | Source listed in the registry with a developer-assigned access policy. |
| Access permitted by policy | {permitted_count} | Policy allows an automated fetch. This is intent, not an outcome. |
| Restricted or manual review by policy | {blocked_count} | Policy forbids or defers automated access. |
| Accessed (HTTP response received) | {accessed} | Fetch attempted in a live run. |
| Not fetched (dry run) | {not_fetched} | Permitted by policy but no request was made. No hash, size or status exists. |
| Skipped per policy | {skipped} | Not requested because of the access decision. |
| Downloaded with real sha256 | {downloaded} | Only these could ever back a VERIFIED record. |
| Parsed into knowledge records | 0 | No extraction from a fetched artifact exists. |

The registry field `last_checked_date` records when the registry entry was authored. It does not
mean the page was fetched or reviewed.

## 3. Evidence classes

| Evidence class | Records |
| --- | --- |
{class_rows}
- RETRIEVED_OFFICIAL: backed by a really fetched artifact with a real sha256. Required for VERIFIED.
- MANUALLY_CURATED: written by a developer, usually citing a public URL, not machine-verified.
- SYNTHETIC_FIXTURE: illustrative or test data. Never a source for a real obligation, limit or quote.
- PLACEHOLDER: generated stand-in artwork or data.

### Per dataset

| Dataset | Records | Evidence class | Verification status |
| --- | --- | --- | --- |
{dataset_rows}
### Runtime KB records still labelled VERIFIED

These records in `kb/CN` and `kb/ID` (emergency contacts, red flags, pathways) were hand-written
by a developer with an official-host source URL. They are MANUALLY_CURATED, not retrieved. The
VERIFIED label is retained only for the emergency and triage safety paths and must not be shown
to users as "officially verified".

| File | Records | Evidence class |
| --- | --- | --- |
{runtime_rows}
Unverified caveats:
- Insurer license references, contacts, prices, benefit limits, deadlines and filing channels were
  hand-entered and have not been checked against regulator registers or insurer documents.
- RAG chunk text and clause or page labels, and university requirements including minimum benefit
  limits, are synthetic illustrations and are not retrieved quotations.
- Healthcare provider fields named `verified_*` or `cashless_direct_billing_verified` keep legacy
  names. Their values are unverified.

## 4. Access decisions (policy intent)

Where portals use WAF rate limiting, CAPTCHA or restrictive terms, no bypass is attempted.

| Source ID | Publisher | Access Decision | Reason |
| --- | --- | --- | --- |
{blocked_rows}
## 5. Insurer logo assets

- {len(brand_assets)} SVG files were generated locally from templates and sanitized. They are
  placeholder artwork, not retrieved and not official marks, even where the legacy file name
  contains `official`.
- Each manifest entry is marked `placeholder: true`, `license_status: NOT_VERIFIED`,
  `evidence_class: PLACEHOLDER`. The sha256 values hash the generated files only.
- No real logo was downloaded and no trademark license was checked.
- Manifest files: `frontend/public/assets/insurers/manifest.json` and
  `kb/assets/insurers/manifest.json`.

## 6. Team data packages

Packages in `kb/exports/` are re-exports of the records above and carry the same evidence
classes and statuses:
- `regina_data_package.json`: companies, products, placeholder logo metadata, taxonomies.
- `valen_data_package.json`: synthetic RAG chunks, cost references, glossary, providers.
- `joshua_data_package.json`: regulations, schemes, procedures, evidence items, rules.

## 7. Verification governance

- VERIFIED is only allowed when evidence_class is RETRIEVED_OFFICIAL and the record carries the
  sha256 of a really retrieved artifact. The pipeline schemas reject any other combination.
- To promote a record: fetch the source in a live run, keep the artifact and hash, parse and
  review it, then set the class and status together.
- Features that need VERIFIED knowledge show uncertainty or fail closed until that happens.
"""
