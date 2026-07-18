from fastapi import APIRouter

from app.routers.console_read import router as console_read_router
from app.routers.console_tours import router as console_tours_router
from app.routers.console_write import router as console_write_router

router = APIRouter(prefix="/api/console", tags=["console"])
router.include_router(console_read_router)
router.include_router(console_write_router)
router.include_router(console_tours_router)
