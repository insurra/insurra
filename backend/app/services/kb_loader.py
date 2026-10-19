import json
import re
from collections.abc import Iterable
from pathlib import Path

from app.core.errors import AppError
from app.schemas.kb import (
    CountryKB,
    CountryManifest,
    CountryResources,
    InjectionPattern,
    VersionedResource,
)


class CountryKBLoader:
    """Validated versioned files; country codes never become arbitrary filesystem paths."""

    def __init__(self, root: Path, active_countries: Iterable[str] | None = None):
        """`active_countries=None` means every folder under root (test roots); the app passes
        the `ACTIVE_KB_COUNTRIES` setting so inactive folders stay on disk but are not served."""
        self.root = root
        self.active_countries = (
            None if active_countries is None else frozenset(c.upper() for c in active_countries)
        )

    def is_active(self, country_code: str) -> bool:
        return self.active_countries is None or country_code in self.active_countries

    def discover(self) -> list[CountryManifest]:
        return [
            self.load(p.parent.name).manifest
            for p in sorted(self.root.glob("*/manifest.json"))
            if self.is_active(p.parent.name)
        ]

    def load(self, country_code: str) -> CountryKB:
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            raise AppError(422, "UNSUPPORTED_COUNTRY", "Kode negara tidak didukung.")
        folder = self.root / country_code
        if not self.is_active(country_code) or not (folder / "manifest.json").is_file():
            raise AppError(
                422, "UNSUPPORTED_COUNTRY", "Negara belum tersedia dalam basis pengetahuan."
            )
        manifest = CountryManifest.model_validate_json((folder / "manifest.json").read_text())
        resources = CountryResources.model_validate(
            {
                name: json.loads((folder / f"{name}.json").read_text())
                for name in CountryResources.model_fields
            }
        )
        if manifest.country_code != country_code:
            raise ValueError("KB folder and manifest country code differ")
        if any(
            getattr(resources, name).version != manifest.version
            for name in CountryResources.model_fields
        ):
            raise ValueError("Resource and manifest versions differ")
        return CountryKB(
            manifest=manifest,
            rules=resources.rules.data,
            coverage_needs=resources.coverage_needs.data,
            pathways=resources.pathways.data,
            glossary=resources.glossary.data,
            resources=resources,
        )

    def load_injection_patterns(self) -> VersionedResource[list[InjectionPattern]]:
        return VersionedResource[list[InjectionPattern]].model_validate_json(
            (self.root / "injection_patterns.json").read_text()
        )
