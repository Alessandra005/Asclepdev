import os


class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql+psycopg2://asclep:asclep@localhost:5432/asclep")
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-only-change-me")
    jwt_ttl_minutes: int = int(os.getenv("JWT_TTL_MINUTES", "15"))
    labtech_url: str = os.getenv("LABTECH_URL", "http://localhost:8100")
    resident_url: str = os.getenv("RESIDENT_URL", "http://localhost:8200")
    ehr_a_url: str = os.getenv("EHR_A_URL", "http://localhost:8080/fhir")
    ehr_b_url: str = os.getenv("EHR_B_URL", "http://localhost:8081/fhir")
    mongo_url: str = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    mongo_db: str = os.getenv("MONGO_DB", "asclep")


settings = Settings()
