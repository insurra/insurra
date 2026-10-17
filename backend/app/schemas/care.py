from pydantic import Field

from app.schemas.common import Contract, CurrencyCode, Money, RuleSource


class CareComparisonRequest(Contract):
    symptoms: str = Field(min_length=1, max_length=4000)
    service_type: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)


class CarePath(Contract):
    pathway_code: str
    label: str
    description: str
    required_documents: list[str]
    estimated_out_of_pocket: Money | None = None
    currency: CurrencyCode | None = None
    uncertainties: list[str]
    source_reference: RuleSource | None = None
