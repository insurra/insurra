"""Owner scoping shared by notifications, preferences and events.

Accepts either the workspace `Actor` (account_id / session_id) or the workflow `Owner`
(kind / id). Caller-supplied identifiers are never trusted here: both come from a validated
bearer or demo session.
"""

from uuid import UUID

from app.schemas.actor import Actor, ActorType
from app.workflow.owner import ACCOUNT, DEMO, Owner


def owner_values(actor) -> dict[str, UUID | None]:
    if hasattr(actor, "kind"):
        demo = actor.kind == DEMO
        return {
            "account_id": None if demo else actor.id,
            "session_id": actor.id if demo else None,
        }
    return {"account_id": actor.account_id, "session_id": actor.session_id}


def owner_where(model, actor):
    values = owner_values(actor)
    if values["account_id"] is not None:
        return model.account_id == values["account_id"]
    return model.session_id == values["session_id"]


def owner_kind_id(actor) -> tuple[str, UUID]:
    values = owner_values(actor)
    if values["account_id"] is not None:
        return ACCOUNT, values["account_id"]
    return DEMO, values["session_id"]


def is_demo_actor(actor) -> bool:
    return owner_values(actor)["session_id"] is not None


def owner_for(actor) -> Owner:
    """Convert a workspace Actor or workflow Owner into a canonical workflow Owner."""
    if isinstance(actor, Owner):
        return actor
    kind, owner_id = owner_kind_id(actor)
    return Owner(kind=kind, id=owner_id)


def actor_for(owner) -> Actor:
    """Convert a workflow Owner or workspace Actor into a canonical workspace Actor."""
    if isinstance(owner, Actor):
        return owner
    values = owner_values(owner)
    if values["account_id"] is not None:
        return Actor(actor_type=ActorType.AUTHENTICATED_ACCOUNT, account_id=values["account_id"])
    return Actor(actor_type=ActorType.DEMO_SESSION, session_id=values["session_id"])
