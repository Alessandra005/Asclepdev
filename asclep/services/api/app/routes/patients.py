"""Patient routes (spec section 15). Owner: Alessandra. Stubs show the required pattern."""
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth.principal import Principal
from app.errors import AsclepError
from app.rbac.require import require

router = APIRouter(tags=["patients"])


@router.get("/patients")
def list_patients(q: str | None = None, cursor: str | None = None,
                  p: Principal = Depends(require("view_demographics", object_type="Patient"))):
    # TODO(Alessandra): ontology.list_objects filtered to the user's care team
    return {"items": [], "next_cursor": None}


@router.get("/patients/{patient_id}")
def get_patient(patient_id: UUID,
                p: Principal = Depends(require("view_demographics", patient_param="patient_id", object_type="Patient"))):
    raise AsclepError("NOT_FOUND", "Not implemented yet (spec 15).")


@router.get("/patients/{patient_id}/summary")
def patient_summary(patient_id: UUID,
                    p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="ContextView"))):
    # TODO(Alessandra): return ontology.context_view(session, p, "visit_prep", patient_id)
    raise AsclepError("NOT_FOUND", "Not implemented yet (spec 7A.6 visit_prep).")
