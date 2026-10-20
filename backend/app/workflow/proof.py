"""Document integrity proof and local cryptographic receipt (SC-19).

Computes deterministic SHA-256 digests, validates byte-for-byte integrity, and issues an honest
local integrity receipt (`LOCAL_INTEGRITY_RECEIPT`) without fabricating blockchain transactions,
block numbers, contracts, or explorer URLs.
"""

import hashlib
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.services.approval import payload_sha256
from app.workflow import audit
from app.workflow.owner import Owner


def compute_sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def verify_integrity(original_hash: str, candidate_content: bytes) -> dict:
    computed = compute_sha256(candidate_content)
    is_valid = computed.lower() == original_hash.strip().lower()
    return {
        "verified": is_valid,
        "original_sha256": original_hash.strip().lower(),
        "computed_sha256": computed,
        "byte_length": len(candidate_content),
        "status": "INTEGRITY_VERIFIED" if is_valid else "TAMPERING_DETECTED",
        "detail": (
            "The document contents match the original recorded SHA-256 hash byte-for-byte."
            if is_valid
            else "The candidate document produces a different cryptographic hash. Content has been altered or replaced."
        ),
        "limitation_notice": (
            "Local SHA-256 byte integrity check only. A matching digest proves the file bytes "
            "have not changed since recording; it does not prove issuer authenticity."
        ),
    }


def anchor_document_proof(
    db: Session,
    owner: Owner,
    document_hash: str,
    document_title: str,
    mime_type: str = "application/pdf",
) -> dict:
    clean_hash = document_hash.strip().lower()
    now = datetime.now(UTC)
    proof_id = f"PRF-{now.year}-{clean_hash[:8].upper()}"

    canonical_body = {
        "proof_id": proof_id,
        "document_sha256": clean_hash,
        "mime_type": mime_type,
        "timestamp": now.isoformat(),
        "anchoring_type": "LOCAL_INTEGRITY_RECEIPT",
    }
    receipt_digest = payload_sha256(canonical_body)

    receipt = {
        "proof_id": proof_id,
        "document_title": document_title[:120],
        "document_sha256": clean_hash,
        "receipt_sha256": receipt_digest,
        "mime_type": mime_type,
        "network": "LOCAL_ONLY",
        "transaction_hash": None,
        "block_number": None,
        "contract_address": None,
        "timestamp": now.isoformat(),
        "anchoring_type": "LOCAL_INTEGRITY_RECEIPT",
        "explorer_url": None,
        "verification_statement": (
            "Local SHA-256 integrity receipt recorded in INSURRA. "
            "No external blockchain transaction was broadcast."
        ),
        "notice": (
            "Local cryptographic integrity receipt only. Proves that the file bytes match the "
            "recorded SHA-256 digest at this timestamp; does not establish issuer authenticity."
        ),
    }

    # Record privacy-safe audit event (never embed raw document title or user text)
    audit.record(
        db,
        owner,
        "DOCUMENT_PROOF_RECORDED",
        "DOCUMENTS",
        "Local document integrity receipt recorded",
        summary=f"SHA-256 digest {clean_hash[:16]}... recorded with local integrity receipt.",
        actor_type="BACKEND_EXECUTED",
        tool="verify_document_hash",
        receipt_ref=proof_id,
        details={
            "payload_digest": clean_hash[:16],
            "document_kind": mime_type,
            "environment": "LOCAL",
        },
    )

    return receipt
