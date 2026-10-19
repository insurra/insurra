"""Source crawler and access policy execution engine.
Iterates over official source registry, performs permitted collections,
and audits access restrictions.
Never use em dashes in strings or docstrings.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.pipeline.collectors.base import HTTPCollector
from app.pipeline.discovery.registry import OFFICIAL_SOURCES
from app.pipeline.schemas.models import (
    AccessDecision,
    PipelineVerificationStatus,
    SourceRegistryEntry,
)

logger = logging.getLogger("insurra.pipeline.crawler")


@dataclass
class CrawlSummary:
    total_sources: int
    attempted_count: int
    successful_count: int
    restricted_count: int
    failed_or_blocked_count: int
    audit_records: list[dict]
    executed_at: datetime


class SourceCrawler:
    """Orchestrates source fetching for China and Indonesia official resources."""

    def __init__(self, cache_dir: Path | None = None, live_network: bool = True):
        self.live_network = live_network
        self.collector = HTTPCollector(cache_dir=cache_dir, timeout_seconds=6.0)

    def crawl_sources(self, sources: list[SourceRegistryEntry] | None = None) -> CrawlSummary:
        """Executes crawl over official sources respecting access decisions."""
        target_sources = sources if sources is not None else OFFICIAL_SOURCES
        now = datetime.now(UTC)

        attempted = 0
        successful = 0
        restricted = 0
        failed_or_blocked = 0
        audit_records = []

        for src in target_sources:
            decision = src.access_decision

            # Policy check: only attempt network calls if permitted
            if decision in (
                AccessDecision.API_ALLOWED,
                AccessDecision.DOWNLOAD_ALLOWED,
                AccessDecision.CRAWL_ALLOWED,
            ):
                if self.live_network:
                    attempted += 1
                    res = self.collector.fetch(src.url)
                    if res.success:
                        successful += 1
                        src.verification_status = PipelineVerificationStatus.COLLECTED
                        audit_records.append(
                            {
                                "source_id": src.source_id,
                                "url": src.url,
                                "status": "FETCH_SUCCESS",
                                "http_code": res.status_code,
                                "sha256": res.content_sha256,
                                "bytes": res.raw_bytes_len,
                                "error": None,
                            }
                        )
                    else:
                        failed_or_blocked += 1
                        # If HTTP 403 or 429, update blocking reason honestly
                        if res.status_code in (403, 429):
                            src.blocking_reason = (
                                f"Automated access blocked by portal with HTTP {res.status_code}"
                            )
                        elif res.error_message:
                            src.blocking_reason = res.error_message
                        audit_records.append(
                            {
                                "source_id": src.source_id,
                                "url": src.url,
                                "status": "FETCH_RESTRICTED_OR_TIMEOUT",
                                "http_code": res.status_code,
                                "sha256": None,
                                "bytes": 0,
                                "error": res.error_message,
                            }
                        )
                else:
                    successful += 1
                    audit_records.append(
                        {
                            "source_id": src.source_id,
                            "url": src.url,
                            "status": "CACHED_OR_DRY_RUN",
                            "http_code": 200,
                            "sha256": "simulated_sha256_hash",
                            "bytes": 1024,
                            "error": None,
                        }
                    )
            else:
                restricted += 1
                audit_records.append(
                    {
                        "source_id": src.source_id,
                        "url": src.url,
                        "status": "SKIPPED_PER_POLICY",
                        "http_code": None,
                        "sha256": None,
                        "bytes": 0,
                        "error": (
                            f"Policy {decision.value}: {src.blocking_reason or 'Access restricted'}"
                        ),
                    }
                )

        return CrawlSummary(
            total_sources=len(target_sources),
            attempted_count=attempted,
            successful_count=successful,
            restricted_count=restricted,
            failed_or_blocked_count=failed_or_blocked,
            audit_records=audit_records,
            executed_at=now,
        )
