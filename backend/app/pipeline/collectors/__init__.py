"""Official INSURRA collectors package.
Never use em dashes in strings or docstrings.
"""

from app.pipeline.collectors.base import FetchResult, HTMLTextExtractor, HTTPCollector
from app.pipeline.collectors.source_crawler import CrawlSummary, SourceCrawler

__all__ = ["CrawlSummary", "FetchResult", "HTMLTextExtractor", "HTTPCollector", "SourceCrawler"]
