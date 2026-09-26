"""Role permission matrix: spec section 13, step 1. Seed values; admin-editable later (SHOULD).

Scopes:
  all            - allowed for any patient/object
  care_team      - only patients the user has a care_team_member row for
  attending      - care team with relationship 'attending'
  own            - only the user's own rows (route must filter)
  specimen_only  - lab staff: specimen/slide objects only (route must filter)
"""

ROLES = ("admin", "physician", "nurse", "scribe", "lab_staff")

PERMISSIONS: dict[str, dict[str, str]] = {
    "authenticated":       {r: "all" for r in ROLES},
    "view_dashboard":      {"physician": "all", "nurse": "all"},
    "view_demographics":   {"admin": "all", "physician": "care_team", "nurse": "care_team", "scribe": "care_team", "lab_staff": "specimen_only"},
    "view_labs":           {"physician": "care_team", "nurse": "care_team"},
    "view_notes":          {"physician": "care_team", "nurse": "care_team", "scribe": "own"},
    "view_restricted":     {"physician": "attending"},
    "run_lab_technician":  {"physician": "care_team", "lab_staff": "specimen_only"},
    "review_findings":     {"physician": "attending"},
    "request_transcripts": {"physician": "care_team"},
    "record_consent":      {"admin": "all"},
    "use_ask":             {"physician": "all", "nurse": "all"},  # tools still enforce per patient
    "view_inventory":      {"admin": "all", "physician": "all", "nurse": "all", "lab_staff": "all"},
    "start_scribe":        {"physician": "care_team", "nurse": "care_team"},
    "review_scribe":       {"physician": "attending"},
    "view_audit":          {"admin": "all", "physician": "own", "nurse": "own", "scribe": "own", "lab_staff": "own"},
    "manage_users":        {"admin": "all"},
    "emergency_access":    {"physician": "all"},
}


def scope_for(permission: str, role: str) -> str | None:
    return PERMISSIONS.get(permission, {}).get(role)


def permissions_for(role: str) -> list[str]:
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)
