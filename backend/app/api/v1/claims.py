from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.dependencies import ConsentedSession
from app.core.errors import not_implemented
from app.schemas.claim import Claim, ClaimDraftRequest
from app.workflow import actions, claims
from app.workflow.owner import DB, CurrentOwner

router = APIRouter(prefix="/claims", tags=["Claims"])


class EditDraftValuesRequest(BaseModel):
    values: dict[str, str]


@router.post("/draft", response_model=Claim, status_code=201)
def draft(body: ClaimDraftRequest, session: ConsentedSession):
    not_implemented()


@router.post("/{claim_id}/readiness")
def get_claim_readiness(claim_id: UUID, db: DB, owner: CurrentOwner):
    from app.services import claim_preparation_agent

    return claim_preparation_agent.evaluate_claim_readiness(db, owner, claim_id)


@router.get("/{claim_id}/requirements")
def get_claim_requirements(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    evaluation = claims.recompute(db, owner, case)
    return {
        "claim_id": str(case.id),
        "claim_type": case.claim_type,
        "country_code": case.country_code,
        "requirements": evaluation.get("items", []),
    }


@router.post("/{claim_id}/prepare")
def prepare_claim_with_agent(claim_id: UUID, db: DB, owner: CurrentOwner):
    from app.services import claim_preparation_agent

    res = claim_preparation_agent.prepare_claim_draft(db, owner, claim_id)
    db.commit()
    return res


@router.get("/{claim_id}/drafts")
def list_claim_drafts(claim_id: UUID, db: DB, owner: CurrentOwner):
    case = claims.get_case(db, owner, claim_id)
    draft_row = claims.case_draft(db, case)
    return {
        "claim_id": str(case.id),
        "active_draft": {
            "id": str(draft_row.id),
            "version": draft_row.version,
            "status": draft_row.status,
            "form": draft_row.form,
            "missing_required": draft_row.missing_required,
            "updated_at": draft_row.updated_at.isoformat(),
        }
        if draft_row
        else None,
    }


@router.patch("/{claim_id}/drafts/{draft_id}")
def update_claim_draft(
    claim_id: UUID, draft_id: UUID, body: EditDraftValuesRequest, db: DB, owner: CurrentOwner
):
    case = claims.get_case(db, owner, claim_id)
    draft_row = claims.edit_draft(db, owner, case, body.values)
    db.commit()
    return {
        "id": str(draft_row.id),
        "version": draft_row.version,
        "status": draft_row.status,
        "form": draft_row.form,
        "missing_required": draft_row.missing_required,
    }


@router.post("/{claim_id}/drafts/{draft_id}/confirm")
def confirm_claim_draft_with_action(claim_id: UUID, draft_id: UUID, db: DB, owner: CurrentOwner):
    from app.services import claim_preparation_agent

    draft_row, action = claim_preparation_agent.confirm_and_create_action(db, owner, claim_id)
    db.commit()
    return {
        "draft": {
            "id": str(draft_row.id),
            "version": draft_row.version,
            "status": draft_row.status,
            "form": draft_row.form,
        },
        "action": actions.action_view(db, action),
    }
