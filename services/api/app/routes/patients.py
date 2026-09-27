"""Patient routes (spec section 15). Owner: Alessandra."""
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth.principal import Principal
from app.db import get_session
from app.errors import AsclepError
from app.ontology import api as ontology
from app.rbac.require import require

router = APIRouter(tags=["patients"])


@router.get("/patients")
def list_patients(q: str | None = None, cursor: str | None = None,
                  p: Principal = Depends(require("view_demographics", object_type="Patient")),
                  s=Depends(get_session)):
    return ontology.list_objects(s, p, "Patient", patient_id=None, cursor=cursor)


@router.get("/patients/{patient_id}")
def get_patient(patient_id: UUID,
                p: Principal = Depends(require("view_demographics", patient_param="patient_id", object_type="Patient")),
                s=Depends(get_session)):
    try:
        return ontology.get_object(s, p, "Patient", patient_id)
    except LookupError:
        raise AsclepError("NOT_FOUND", f"Patient {patient_id} not found")
    except PermissionError:
        raise AsclepError("FORBIDDEN", "This record is restricted")


@router.get("/patients/{patient_id}/summary")
def patient_summary(patient_id: UUID,
                    p: Principal = Depends(require("view_labs", patient_param="patient_id", object_type="ContextView")),
                    s=Depends(get_session)):
    try:
        return ontology.context_view(s, p, "visit_prep", patient_id)
    except NotImplementedError as exc:
        raise AsclepError("NOT_FOUND", str(exc))