"""Idempotent, validated template seeding. Never creates or consents a user session."""

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import ROOT, get_settings
from app.core.database import make_engine, session_factory
from app.models import PersonaRow
from app.schemas.document import Document, SourceEvidence
from app.schemas.insurance import UnifiedInsuranceRecord
from app.schemas.profile import UserProfile


def seed_personas(db: Session, fixture_root: Path = ROOT / "fixtures") -> int:
    inserted = 0
    for folder in sorted(fixture_root.iterdir()):
        if not folder.is_dir():
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
        if db.get(PersonaRow, folder.name) is None:
            db.add(
                PersonaRow(
                    persona_id=folder.name,
                    description=f"{profile.display_name} · {profile.city} · synthetic data",
                    profile_payload=profile.model_dump(mode="json"),
                    record_payload=record.model_dump(mode="json"),
                )
            )
            inserted += 1
    db.commit()
    return inserted


if __name__ == "__main__":
    engine = make_engine(get_settings().database_url)
    with session_factory(engine)() as db:
        print(f"Inserted {seed_personas(db)} synthetic persona templates.")
    engine.dispose()
