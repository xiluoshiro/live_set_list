"""Read-only location suggestions, separate from Venue mutation APIs."""
import os
from typing import Any
from importlib.util import find_spec
from fastapi import APIRouter, Depends, Request
from psycopg2.extras import RealDictCursor
from app.auth import AuthSessionContext, assert_valid_csrf, get_current_auth_context, require_role
from app.db import get_db_connection
from app.geocoding import geocode, service_url
from app.routers.console_geography import _locality_view
from app.schemas.geocoding import ResolveInput, ResolveResult, SearchInput, SearchResult
from app.timezone_lookup import lookup_timezone

router = APIRouter(prefix="/geography", dependencies=[Depends(require_role("editor"))])


@router.get("/capabilities")
def capabilities():
    tile = os.getenv("VENUE_MAP_TILE_URL", "https://tile.openstreetmap.org/{z}/{x}/{y}.png")
    return {"tile_url": tile if tile.startswith("https://") else "",
            "attribution": os.getenv("VENUE_MAP_ATTRIBUTION", "© OpenStreetMap contributors"),
            "geocoding": bool(service_url()), "timezone": find_spec("timezonefinder") is not None}


@router.post("/search", response_model=SearchResult)
def search(payload: SearchInput, request: Request,
           context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    return geocode(query=payload.query, country_code=payload.country_code)


@router.post("/resolve", response_model=ResolveResult)
def resolve(payload: ResolveInput, request: Request,
            context: AuthSessionContext = Depends(get_current_auth_context)):
    assert_valid_csrf(request, context)
    result: dict[str, Any] = {"request_id": payload.request_id, "latitude": payload.latitude, "longitude": payload.longitude,
              "timezone": {"status": "not_requested"}, "address": None, "localities": []}
    if payload.parts == "timezone":
        result["timezone"] = lookup_timezone(payload.latitude, payload.longitude)
    else:
        address = geocode(latitude=payload.latitude, longitude=payload.longitude)
        result["address"] = address
        if address["items"]:
            item = address["items"][0]
            # Suggestions only: never register or mutate administrative records.
            with get_db_connection() as conn, conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""SELECT * FROM geo_localities WHERE country_code=%s AND
                    (area_level='country' OR (area_level='admin_area' AND admin_area=%s)
                     OR (area_level='locality' AND locality_name=%s AND admin_area IS NOT DISTINCT FROM %s))
                    ORDER BY id LIMIT 20""",
                    (item["country_code"], item["admin_area"], item["locality_name"], item["admin_area"]))
                result["localities"] = [_locality_view(dict(row)) for row in cur.fetchall()]
    return result
