"""Base HTTP collector and extractor utilities.
Handles rate limiting, content hashing, HTML text extraction, and graceful fallbacks.
Never use em dashes in strings or docstrings.
"""

import hashlib
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path

import httpx

logger = logging.getLogger("insurra.pipeline.collector")


class HTMLTextExtractor(HTMLParser):
    """Clean HTML text extractor that removes scripts, styles, and extracts plain text."""

    def __init__(self):
        super().__init__()
        self._text_chunks: list[str] = []
        self._ignored_tags = {"script", "style", "noscript", "svg", "iframe"}
        self._current_tag: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]):
        self._current_tag = tag.lower()

    def handle_endtag(self, tag: str):
        if self._current_tag == tag.lower():
            self._current_tag = None

    def handle_data(self, data: str):
        if self._current_tag not in self._ignored_tags:
            cleaned = data.strip()
            if cleaned:
                self._text_chunks.append(cleaned)

    def get_text(self) -> str:
        text = " ".join(self._text_chunks)
        # Collapse multiple spaces and newlines
        return re.sub(r"\s+", " ", text).strip()


@dataclass
class FetchResult:
    url: str
    status_code: int | None
    success: bool
    content_sha256: str | None
    content_type: str | None
    extracted_text: str | None
    raw_bytes_len: int
    headers: dict[str, str]
    error_message: str | None
    fetched_at: datetime


class HTTPCollector:
    """Polite HTTP collector respecting robots, timeouts, and security policies."""

    USER_AGENT = "INSURRA-Intelligence-Bot/1.5 (+https://insurra.com/bot; research@insurra.com)"

    def __init__(self, cache_dir: Path | None = None, timeout_seconds: float = 8.0):
        self.timeout_seconds = timeout_seconds
        self.cache_dir = cache_dir
        if self.cache_dir:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    def compute_sha256(self, content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    def fetch(self, url: str, follow_redirects: bool = True) -> FetchResult:
        """Fetches a URL with timeout and error handling, returning structured FetchResult."""
        now = datetime.now(UTC)
        headers = {
            "User-Agent": self.USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,id;q=0.6",
        }

        try:
            with httpx.Client(
                timeout=self.timeout_seconds, follow_redirects=follow_redirects
            ) as client:
                response = client.get(url, headers=headers)
                content = response.content
                sha = self.compute_sha256(content)
                content_type = response.headers.get("content-type", "")

                extracted_text = None
                if "text/html" in content_type or "text/plain" in content_type:
                    try:
                        parser = HTMLTextExtractor()
                        parser.feed(response.text)
                        extracted_text = parser.get_text()
                    except Exception as e:
                        logger.warning(f"HTML parsing error for {url}: {e}")
                        extracted_text = response.text[:2000]

                # Cache raw content if cache directory configured
                if self.cache_dir and response.is_success:
                    safe_filename = re.sub(r"[^\w\-_\.]", "_", url)[:120] + f"_{sha[:8]}"
                    cache_file = self.cache_dir / safe_filename
                    try:
                        cache_file.write_bytes(content)
                    except OSError as e:
                        logger.warning(f"Could not cache {url}: {e}")

                return FetchResult(
                    url=url,
                    status_code=response.status_code,
                    success=response.is_success,
                    content_sha256=sha,
                    content_type=content_type,
                    extracted_text=extracted_text,
                    raw_bytes_len=len(content),
                    headers=dict(response.headers),
                    error_message=None if response.is_success else f"HTTP {response.status_code}",
                    fetched_at=now,
                )
        except httpx.TimeoutException:
            return FetchResult(
                url=url,
                status_code=None,
                success=False,
                content_sha256=None,
                content_type=None,
                extracted_text=None,
                raw_bytes_len=0,
                headers={},
                error_message="Connection timed out",
                fetched_at=now,
            )
        except httpx.RequestError as exc:
            return FetchResult(
                url=url,
                status_code=None,
                success=False,
                content_sha256=None,
                content_type=None,
                extracted_text=None,
                raw_bytes_len=0,
                headers={},
                error_message=f"Network error: {str(exc)}",
                fetched_at=now,
            )
