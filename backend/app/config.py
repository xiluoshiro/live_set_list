import os
from ipaddress import ip_address, ip_network


TRUTHY_VALUES = {"1", "true", "yes", "on"}
DEV_CORS_ALLOW_ORIGINS = ["http://localhost:5173"]
DEFAULT_TRUSTED_PROXY_CIDRS = ["127.0.0.1/32", "::1/128"]


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


def trusted_proxy_cidrs() -> list[str]:
    raw_cidrs = os.getenv("TRUSTED_PROXY_CIDRS")
    if raw_cidrs is None:
        return DEFAULT_TRUSTED_PROXY_CIDRS
    return [cidr.strip() for cidr in raw_cidrs.split(",") if cidr.strip()]


def is_trusted_proxy_ip(raw_ip: str | None) -> bool:
    if not raw_ip:
        return False
    try:
        client_ip = ip_address(raw_ip)
    except ValueError:
        return False
    for raw_cidr in trusted_proxy_cidrs():
        try:
            if client_ip in ip_network(raw_cidr, strict=False):
                return True
        except ValueError:
            continue
    return False


def docs_urls() -> dict[str, str | None]:
    if is_production():
        return {"docs_url": None, "redoc_url": None, "openapi_url": None}
    return {"docs_url": "/docs", "redoc_url": "/redoc", "openapi_url": "/openapi.json"}


def cookie_secure_enabled() -> bool:
    return is_truthy_env("AUTH_COOKIE_SECURE", "false")


def historical_default_band_selection_enabled() -> bool:
    """Allow temporary manual selection of historical default Band versions."""
    return is_truthy_env("ALLOW_HISTORICAL_DEFAULT_BAND_SELECTION", "true")


def assert_production_security_config() -> None:
    if is_production() and not cookie_secure_enabled():
        raise RuntimeError("AUTH_COOKIE_SECURE=true is required when APP_ENV=production")
