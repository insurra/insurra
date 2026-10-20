from fastapi import APIRouter, Query

from app.core.dependencies import DB, KB
from app.schemas.protection_assessment import (
    FullProtectionAssessment,
    ProductComparisonResponse,
    ProductOption,
    ReassessRequest,
)
from app.services.protection_assessment import (
    _get_products_for_category,
    build_protection_assessment,
    compare_selected_products,
)
from app.services.workspace import WorkspaceActor

router = APIRouter(prefix="/protection", tags=["Protection Assessment"])


@router.get("/assessment", response_model=FullProtectionAssessment)
def get_assessment(db: DB, kb: KB, actor: WorkspaceActor):
    """Retrieve canonical AI protection assessment for the current session or account."""
    return build_protection_assessment(db, actor, kb, force_refresh=False)


@router.post("/reassess", response_model=FullProtectionAssessment)
def reassess_protection(body: ReassessRequest, db: DB, kb: KB, actor: WorkspaceActor):
    """Trigger an on-demand reassessment of protection needs and coverage gaps."""
    return build_protection_assessment(
        db,
        actor,
        kb,
        force_refresh=True,
        refresh_reason=body.notes or "USER_REQUESTED",
    )


@router.get("/products", response_model=list[ProductOption])
def get_protection_products(
    category: str = Query(default="dental"),
    country_code: str = Query(default="CN"),
):
    """Retrieve sourced catalog options matching a specific unmet protection category."""
    return _get_products_for_category(country_code, category)


@router.post("/compare", response_model=ProductComparisonResponse)
def compare_products_endpoint(
    product_ids: list[str],
    country_code: str = Query(default="CN"),
):
    """Compare selected insurance products side by side with structured attributes."""
    return compare_selected_products(product_ids, country_code)
