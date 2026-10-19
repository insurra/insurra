"""Idempotent, validated template seeding. Never creates or consents a user session."""

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import Field
from sqlalchemy.orm import Session

from app.core.config import ROOT, get_settings
from app.core.database import make_engine, session_factory
from app.models import PersonaRow
from app.schemas.common import Contract, CountryCode
from app.schemas.document import Document, SourceEvidence
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile


class PersonaMeta(Contract):
    """Presentation sidecar (`persona.json`) for a demo persona. Always synthetic."""

    persona_id: str = Field(min_length=1, max_length=50)
    country_code: CountryCode
    city: str = Field(min_length=1, max_length=100)
    role_label: str = Field(min_length=1, max_length=100)
    insurance_categories: list[str]
    description: str = Field(min_length=1, max_length=300)
    is_synthetic: Literal[True] = True


def load_persona_meta(
    persona_id: str, fixture_root: Path = ROOT / "fixtures"
) -> PersonaMeta | None:
    """Read and validate a persona sidecar; `persona_id` is never used as a free path."""
    if not re.fullmatch(r"[a-z0-9_-]{1,50}", persona_id):
        return None
    path = fixture_root / persona_id / "persona.json"
    if not path.is_file():
        return None
    return PersonaMeta.model_validate_json(path.read_text(encoding="utf-8"))


def seed_personas(db: Session, fixture_root: Path = ROOT / "fixtures") -> int:
    """Upsert persona templates by persona_id. Returns inserted plus changed template count."""
    inserted = 0
    for folder in sorted(fixture_root.iterdir()):
        if not folder.is_dir() or not (folder / "profile.json").exists():
            continue
        profile = UserProfile.model_validate_json((folder / "profile.json").read_text())
        record = UnifiedInsuranceRecord.model_validate_json(
            (folder / "insurance_record.json").read_text()
        )
        if record.profile_id != profile.id or record.country_code != profile.country_code:
            raise ValueError("Fixture profile and insurance record do not match")
        for item in json.loads((folder / "documents.json").read_text()):
            Document.model_validate(item)
        for item in json.loads((folder / "evidence_placeholders.json").read_text()):
            SourceEvidence.model_validate(item)
        meta = load_persona_meta(folder.name, fixture_root)
        if meta is not None and (
            meta.persona_id != folder.name or meta.country_code != profile.country_code
        ):
            raise ValueError("Persona sidecar and profile do not match")
        description = (
            meta.description
            if meta
            else f"{profile.display_name} · {profile.city} · synthetic data"
        )
        profile_payload = profile.model_dump(mode="json")
        record_payload = record.model_dump(mode="json")
        row = db.get(PersonaRow, folder.name)
        if row is None:
            db.add(
                PersonaRow(
                    persona_id=folder.name,
                    description=description,
                    profile_payload=profile_payload,
                    record_payload=record_payload,
                )
            )
            inserted += 1
        elif (
            row.description != description
            or row.profile_payload != profile_payload
            or row.record_payload != record_payload
        ):
            # Content updates apply to new sessions only; copied session rows are untouched.
            row.description = description
            row.profile_payload = profile_payload
            row.record_payload = record_payload
            inserted += 1
    db.commit()
    return inserted


if __name__ == "__main__":
    engine = make_engine(get_settings().database_url)
    with session_factory(engine)() as db:
        print(f"Inserted {seed_personas(db)} synthetic persona templates.")
    engine.dispose()
