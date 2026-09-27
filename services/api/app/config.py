import logging
import os
import secrets

# Values that are public (in the repo), so tokens signed with them can be forged by anyone.
_PUBLIC_SECRETS = {"dev-only-change-me", "change-me-to-a-long-random-string"}


def _jwt_secret() -> str:
    value = os.getenv("JWT_SECRET")
    if not value:
        return secrets.token_urlsafe(32)  # unset: random per process, so tokens die on restart but can't be forged
    if value in _PUBLIC_SECRETS or len(value) < 32:
        logging.getLogger("asclep").warning("JWT_SECRET is a public placeholder or under 32 chars; set a random one "
                                            "in infra/.env (python -c 'import secrets; print(secrets.token_urlsafe(32))')")
    return value


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql+psycopg2://asclep:asclep@localhost:5432/asclep")
    jwt_secret: str = _jwt_secret()
    jwt_ttl_minutes: int = int(os.getenv("JWT_TTL_MINUTES", "15"))
    labtech_url: str = os.getenv("LABTECH_URL", "http://localhost:8100")
    resident_url: str = os.getenv("RESIDENT_URL", "http://localhost:8200")
    ehr_a_url: str = os.getenv("EHR_A_URL", "http://localhost:8080/fhir")
    ehr_b_url: str = os.getenv("EHR_B_URL", "http://localhost:8081/fhir")
    mongo_url: str = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    mongo_db: str = os.getenv("MONGO_DB", "asclep")
    resident_mock: bool = os.getenv("RESIDENT_MOCK", "1") == "1"  # AI steps then run locally, not on Claude
    demo_tz: str = os.getenv("DEMO_TZ", "America/New_York")  # "today" for schedules and seeded appointments


settings = Settings()
