from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.auth import ensure_default_admin_user
from app.config import assert_production_security_config, cors_allow_origins, docs_urls, is_trusted_proxy_ip
from app.logging_config import get_logger, setup_logging
from app.routers.auth import router as auth_router
from app.routers.catalog import router as catalog_router
from app.routers.console import router as console_router
from app.routers.health import router as health_router
from app.routers.lives import router as lives_router
from app.routers.me import router as me_router
from app.routers.tours import router as tours_router
from app.schemas import RootResponse

setup_logging()
logger = get_logger(__name__)


def _first_forwarded_for_ip(header_value: str | None) -> str | None:
    if not header_value:
        return None
    first_value = header_value.split(",", 1)[0].strip()
    return first_value or None


def get_request_client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else None
    if is_trusted_proxy_ip(direct_ip):
        forwarded_ip = _first_forwarded_for_ip(request.headers.get("x-forwarded-for"))
        if forwarded_ip:
            return forwarded_ip
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return direct_ip or "-"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Prepare startup-only state before the API begins serving requests."""
    ensure_default_admin_user()
    yield


async def log_api_requests(request: Request, call_next):
    """Emit one access log per request and keep uncaught exception logging in one place."""
    start = perf_counter()
    query_string = request.url.query or "-"
    client_ip = get_request_client_ip(request)
    try:
        response = await call_next(request)
    except Exception:
        # 兜底记录未被路由层消费的异常，随后继续抛给 FastAPI。
        duration_ms = round((perf_counter() - start) * 1000, 2)
        logger.exception(
            "request failed method=%s path=%s query_string=%s duration_ms=%s client_ip=%s",
            request.method,
            request.url.path,
            query_string,
            duration_ms,
            client_ip,
        )
        raise

    # access log 只在请求完成后记录一条，避免重复刷屏。
    duration_ms = round((perf_counter() - start) * 1000, 2)
    logger.info(
        "request completed method=%s path=%s query_string=%s status=%s duration_ms=%s client_ip=%s",
        request.method,
        request.url.path,
        query_string,
        response.status_code,
        duration_ms,
        client_ip,
    )
    return response


def root():
    """Return a lightweight startup confirmation message without touching the database."""
    return {"message": "LiveSetList backend is running"}


def create_app() -> FastAPI:
    assert_production_security_config()
    doc_config = docs_urls()
    app = FastAPI(
        title="LiveSetList API",
        lifespan=lifespan,
        docs_url=doc_config["docs_url"],
        redoc_url=doc_config["redoc_url"],
        openapi_url=doc_config["openapi_url"],
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_allow_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.middleware("http")(log_api_requests)
    app.get(
        "/",
        response_model=RootResponse,
        summary="服务根路由",
        description="用于确认后端服务已启动，不访问数据库。",
    )(root)
    app.include_router(health_router)
    app.include_router(lives_router)
    app.include_router(catalog_router)
    app.include_router(tours_router)
    app.include_router(auth_router)
    app.include_router(me_router)
    app.include_router(console_router)
    return app


app = create_app()


