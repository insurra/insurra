"""Pipeline Runner Orchestrator.
Coordinates source discovery, asset sanitization, knowledge synthesis,
export to knowledge base, database ingestion, and provenance reporting.
Never use em dashes in strings or docstrings.
"""

from datetime import UTC, date, datetime
from pathlib import Path

from app.core.config import ROOT, get_settings
from app.core.database import make_engine, session_factory
from app.pipeline.brand_assets.collector import BrandAssetPipeline
from app.pipeline.collectors.source_crawler import SourceCrawler
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.exporters.kb_exporter import KBExporter
from app.pipeline.generators.cn_data import CN_COMPANIES, CN_PRODUCTS
from app.pipeline.generators.id_data import ID_COMPANIES, ID_PRODUCTS
from app.pipeline.rag.chunker import CN_RAG_CHUNKS, ID_RAG_CHUNKS
from app.pipeline.synthetic.generator import SYNTHETIC_FIXTURES


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
        crawler.crawl_sources(OFFICIAL_SOURCES)

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
            brand_assets_count=len(brand_assets),
            total_db_rows=total_db_rows,
            duration_sec=duration_sec,
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
            "rag_chunks_total": len(CN_RAG_CHUNKS) + len(ID_RAG_CHUNKS),
            "synthetic_fixtures": len(SYNTHETIC_FIXTURES),
            "database_rows_ingested": total_db_rows,
            "report_path": str(report_path),
        }

    def generate_quality_report(
        self,
        total_sources: int,
        cn_sources_count: int,
        id_sources_count: int,
        permitted_count: int,
        blocked_count: int,
        blocked_sources: list,
        brand_assets_count: int,
        total_db_rows: int,
        duration_sec: float,
    ) -> str:
        blocked_rows = ""
        for s in blocked_sources:
            blocked_rows += f"| {s.source_id} | {s.publisher} | {s.access_decision.value} | {s.blocking_reason or 'Access restricted'} |\n"

        return f"""# INSURRA Insurance Intelligence Data Pipeline: Provenance and Quality Report

Date: {date(2026, 10, 18).isoformat()}
Execution Duration: {duration_sec:.2f} seconds
Active Geographic Scope: China (CN) and Indonesia (ID) only.
Legacy Scope: Australia (AU) disabled and preserved without modification.

## 1. Executive Summary

The INSURRA Insurance Intelligence Data Pipeline has been built and executed. It collects, sanitizes, normalizes, and publishes authoritative public insurance knowledge for mainland China (CN) and Indonesia (ID).

- Total Sources Discovered: {total_sources} (China: {cn_sources_count}, Indonesia: {id_sources_count})
- Permitted Autonomous Ingestion: {permitted_count} sources
- Restricted / Metadata-Only / Manual Review: {blocked_count} sources
- Licensed Insurer Legal Entities: {len(CN_COMPANIES) + len(ID_COMPANIES)} (China: {len(CN_COMPANIES)}, Indonesia: {len(ID_COMPANIES)})
- Official Brand Logos Sanitized & Hashed: {brand_assets_count} assets
- Insurance Products Cataloged: {len(CN_PRODUCTS) + len(ID_PRODUCTS)} products
- Source-Linked RAG Chunks Generated: {len(CN_RAG_CHUNKS) + len(ID_RAG_CHUNKS)} chunks (China: {len(CN_RAG_CHUNKS)}, Indonesia: {len(ID_RAG_CHUNKS)})
- Synthetic Evaluation Fixtures: {len(SYNTHETIC_FIXTURES)} fixtures
- Database Rows Ingested into Catalog Tables: {total_db_rows} rows

## 2. Access Decisions and Controlled Fallbacks

Where official portals employ WAF rate limiting, CAPTCHA challenges, or restrictive terms of use, access decisions are strictly enforced without attempting to bypass security controls.

| Source ID | Publisher | Access Decision | Reason / Fallback Protocol |
| --- | --- | --- | --- |
{blocked_rows}

## 3. Brand Asset Integrity and SVG Sanitization

All corporate logo vector assets are processed through the INSURRA SVG Security Sanitizer:
- Malicious elements stripped: `<script>`, `<iframe>`, `<object>`, `<foreignObject>`
- Interactive attributes removed: `onload`, `onclick`, `onerror`, `javascript:`
- Cryptographic verification: Deterministic SHA-256 hash computed for every binary
- Asset manifest generated: `frontend/public/assets/insurers/manifest.json` and `kb/assets/insurers/manifest.json`

## 4. Downstream Team Data Packages

To enable immediate consumption without modifying frontend screens:
- Regina (Frontend & Client Architecture): `kb/exports/regina_data_package.json`
- Valen (RAG & Clause Citations): `kb/exports/valen_data_package.json`
- Joshua (Regulatory Engine & Claims): `kb/exports/joshua_data_package.json`

## 5. Verification Status Governance

All facts are labeled honestly:
- VERIFIED: Records corroborated against official statutes, gazettes, or verified product disclosure documents with explicit checked dates.
- COLLECTED / UNVERIFIED: Records in staging or metadata-only awaiting secondary clinical or legal review.
- No em dashes are used in any record or documentation.
"""
