import os


TRUTHY_VALUES = {"1", "true", "yes", "on"}
DEV_CORS_ALLOW_ORIGINS = ["http://localhost:5173"]


def is_truthy_env(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in TRUTHY_VALUES


def app_env() -> str:
    return os.getenv("APP_ENV", "development").strip().lower() or "development"


def is_production() -> bool:
    return app_env() == "production"


def cors_allow_origins() -> list[str]:
    raw_origins = os.getenv("CORS_ALLOW_ORIGINS")
    if raw_origins is None:
        return [] if is_production() else DEV_CORS_ALLOW_ORIGINS
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


def docs_urls() -> dict[str, str | None]:
    if is_production():
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


def cookie_secure_enabled() -> bool:
    return is_truthy_env("AUTH_COOKIE_SECURE", "false")


def assert_production_security_config() -> None:
    if is_production() and not cookie_secure_enabled():
        raise RuntimeError("AUTH_COOKIE_SECURE=true is required when APP_ENV=production")
