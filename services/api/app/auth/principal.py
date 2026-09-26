from dataclasses import dataclass, field
from uuid import UUID


@dataclass
class Principal:
    """Who is acting. The Resident acts with the human user's Principal (actor_kind='resident')."""
    user_id: UUID
    role: str  # admin | physician | nurse | scribe | lab_staff
    actor_kind: str = "human"  # human | resident | system
    emergency_patient_ids: set[UUID] = field(default_factory=set)  # break-the-glass grants (SHOULD)
