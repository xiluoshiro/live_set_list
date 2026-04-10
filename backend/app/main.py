from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.logging_config import get_logger, setup_logging
from app.routers.auth import router as auth_router
from app.routers.health import router as health_router
from app.routers.lives import router as lives_router

setup_logging()
logger = get_logger(__name__)

app = FastAPI(title="LiveSetList API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(lives_router)
app.include_router(auth_router)


@app.middleware("http")
async def log_api_requests(request: Request, call_next):
    start = perf_counter()
    query_string = request.url.query or "-"
    client_ip = request.client.host if request.client else "-"
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


@app.get("/")
def root():
    return {"message": "LiveSetList backend is running"}
