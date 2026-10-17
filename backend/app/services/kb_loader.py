import json
import re
from pathlib import Path

from app.core.errors import AppError
from app.schemas.kb import CountryKB, CountryManifest


class CountryKBLoader:
    """Validated versioned files; country codes never become arbitrary filesystem paths."""

    def __init__(self, root: Path):
        self.root = root

    def discover(self) -> list[CountryManifest]:
        return [
            self.load(p.parent.name).manifest for p in sorted(self.root.glob("*/manifest.json"))
        ]

    def load(self, country_code: str) -> CountryKB:
        if not re.fullmatch(r"[A-Z]{2}", country_code):
            raise AppError(422, "UNSUPPORTED_COUNTRY", "Kode negara tidak didukung.")
        folder = self.root / country_code
        if not (folder / "manifest.json").is_file():
            raise AppError(
                422, "UNSUPPORTED_COUNTRY", "Negara belum tersedia dalam basis pengetahuan."
            )
        data = {
            name: json.loads((folder / f"{name}.json").read_text())
            for name in ("manifest", "rules", "coverage_needs", "pathways", "glossary")
        }
        kb = CountryKB.model_validate(data)
        if kb.manifest.country_code != country_code:
            raise ValueError("KB folder and manifest country code differ")
        return kb
