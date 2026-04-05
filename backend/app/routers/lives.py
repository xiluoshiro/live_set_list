import json
from collections.abc import Mapping
from math import ceil
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field
from psycopg2 import Error, OperationalError
from psycopg2.errors import QueryCanceled

from app.db import get_db_connection

router = APIRouter(prefix="/api/lives", tags=["lives"])

ALLOWED_PAGE_SIZE = {15, 20}

BAND_TOTAL_COUNT_SQL = """
CASE
    WHEN ba.band_members IS NULL THEN NULL
    WHEN jsonb_typeof(to_jsonb(ba.band_members)) = 'array' THEN jsonb_array_length(to_jsonb(ba.band_members))
    ELSE length(ba.band_members::text)
END
"""

LIVES_BASE_QUERY = """
SELECT
    l.id,
    l.live_date,
    l.live_title,
    COALESCE(
        array_agg(DISTINCT b.id ORDER BY b.id)
            FILTER (WHERE b.id IS NOT NULL),
        ARRAY[]::int[]
    ) AS band_ids,
    NULL AS url
FROM live_attrs l
JOIN live_setlist ls
    ON l.id = ls.live_id
LEFT JOIN LATERAL (
    SELECT jsonb_object_keys(ls.band_member) AS key
    WHERE jsonb_typeof(ls.band_member) = 'object'
) t ON true
LEFT JOIN band_attrs b
    ON b.band_name = t.key
GROUP BY l.id, l.live_date, l.live_title
"""

LIVES_COUNT_QUERY = f"""
SELECT COUNT(*) FROM (
    {LIVES_BASE_QUERY}
) q
"""

LIVES_PAGE_QUERY = f"""
{LIVES_BASE_QUERY}
ORDER BY l.live_date DESC, l.id DESC
LIMIT %s OFFSET %s
"""

LIVE_DETAIL_HEADER_QUERY = """
SELECT
    l.id AS live_id,
    l.live_date,
    l.live_title,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    to_jsonb(l) ->> 'opening_time' AS opening_time,
    to_jsonb(l) ->> 'start_time' AS start_time,
    COALESCE(
        (
            SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
            FROM live_setlist stl
            JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                ON jsonb_typeof(stl.band_member) = 'object'
            JOIN band_attrs ba
                ON ba.band_name = k.band_name
            WHERE stl.live_id = l.id
        ),
        ARRAY[]::int[]
    ) AS bands,
    COALESCE(
        (
            SELECT array_agg(
                x.band_name
                ORDER BY (x.band_id IS NULL), x.band_id, x.band_name
            )
            FROM (
                SELECT DISTINCT
                    k.band_name AS band_name,
                    ba.id AS band_id
                FROM live_setlist stl
                JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                    ON jsonb_typeof(stl.band_member) = 'object'
                LEFT JOIN band_attrs ba
                    ON ba.band_name = k.band_name
                WHERE stl.live_id = l.id
            ) x
        ),
        ARRAY[]::text[]
    ) AS band_names,
    to_jsonb(l) ->> 'url' AS url
FROM live_attrs l
LEFT JOIN venue_list v
    ON v.id = NULLIF(to_jsonb(l) ->> 'venue_id', '')::int
WHERE l.id = %s
"""

LIVE_DETAIL_ROWS_QUERY = """
SELECT
    concat(stl.segment_type, stl.sub_order)::text AS row_id,
    s.song_name,
    stl.band_member,
    stl.other_member,
    stl.is_short
FROM live_setlist stl
JOIN song_list s
    ON s.id = stl.song_id
WHERE stl.live_id = %s
ORDER BY stl.absolute_order
"""

BATCH_LIVE_DETAIL_HEADERS_QUERY = """
SELECT
    l.id AS live_id,
    l.live_date,
    l.live_title,
    COALESCE(to_jsonb(v) ->> 'venue', to_jsonb(v) ->> 'venue_name') AS venue,
    to_jsonb(l) ->> 'opening_time' AS opening_time,
    to_jsonb(l) ->> 'start_time' AS start_time,
    COALESCE(
        (
            SELECT array_agg(DISTINCT ba.id ORDER BY ba.id)
            FROM live_setlist stl
            JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                ON jsonb_typeof(stl.band_member) = 'object'
            JOIN band_attrs ba
                ON ba.band_name = k.band_name
            WHERE stl.live_id = l.id
        ),
        ARRAY[]::int[]
    ) AS bands,
    COALESCE(
        (
            SELECT array_agg(
                x.band_name
                ORDER BY (x.band_id IS NULL), x.band_id, x.band_name
            )
            FROM (
                SELECT DISTINCT
                    k.band_name AS band_name,
                    ba.id AS band_id
                FROM live_setlist stl
                JOIN LATERAL jsonb_object_keys(stl.band_member) k(band_name)
                    ON jsonb_typeof(stl.band_member) = 'object'
                LEFT JOIN band_attrs ba
                    ON ba.band_name = k.band_name
                WHERE stl.live_id = l.id
            ) x
        ),
        ARRAY[]::text[]
    ) AS band_names,
    to_jsonb(l) ->> 'url' AS url
FROM live_attrs l
LEFT JOIN venue_list v
    ON v.id = NULLIF(to_jsonb(l) ->> 'venue_id', '')::int
WHERE l.id = ANY(%s)
"""

BATCH_LIVE_DETAIL_ROWS_QUERY = f"""
WITH row_base AS (
    SELECT
        stl.live_id,
        concat(stl.segment_type, stl.sub_order)::text AS row_id,
        s.song_name,
        stl.band_member,
        stl.other_member,
        stl.is_short,
        stl.absolute_order
    FROM live_setlist stl
    JOIN song_list s
        ON s.id = stl.song_id
    WHERE stl.live_id = ANY(%s)
)
SELECT
    rb.live_id,
    rb.row_id,
    rb.song_name,
    COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'band_id', ba.id,
                'band_name', kv.key,
                'total_count', {BAND_TOTAL_COUNT_SQL},
                'present_members',
                CASE
                    WHEN jsonb_typeof(kv.value) = 'array' THEN kv.value
                    WHEN kv.value IS NULL THEN '[]'::jsonb
                    ELSE jsonb_build_array(kv.value)
                END
            )
            ORDER BY (ba.id IS NULL), ba.id, kv.key
        ) FILTER (WHERE kv.key IS NOT NULL),
        '[]'::jsonb
    ) AS band_members,
    rb.other_member,
    rb.is_short
FROM row_base rb
LEFT JOIN LATERAL jsonb_each(
    CASE
        WHEN jsonb_typeof(rb.band_member) = 'object' THEN rb.band_member
        ELSE '{{}}'::jsonb
    END
) kv(key, value) ON true
LEFT JOIN band_attrs ba
    ON ba.band_name = kv.key
GROUP BY
    rb.live_id,
    rb.row_id,
    rb.song_name,
    rb.other_member,
    rb.is_short,
    rb.absolute_order
ORDER BY rb.live_id, rb.absolute_order
"""

BAND_ID_LOOKUP_QUERY = f"""
SELECT
    ba.id,
    ba.band_name,
    {BAND_TOTAL_COUNT_SQL} AS total_count
FROM band_attrs ba
WHERE ba.band_name = ANY(%s)
"""

DEFAULT_BAND_TOTAL_COUNT = 5
MAX_BATCH_LIVE_IDS = 100


class LiveDetailBatchRequest(BaseModel):
    live_ids: list[int] = Field(..., min_length=1, max_length=MAX_BATCH_LIVE_IDS)


ParsedDetailRow = tuple[str, str, dict[str, Any], dict[str, Any], bool]


def _ensure_json_object(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def _ensure_json_array(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            return []
    return []


def _to_string_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, tuple):
        return [str(item) for item in raw]
    return [str(raw)]


def _to_string_array(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, tuple):
        return [str(item) for item in raw]
    if isinstance(raw, str):
        stripped = raw.strip()
        # 兼容 value 存成 JSON 字符串数组的情况，例如 "[\"a\", \"b\"]"
        if stripped.startswith("[") and stripped.endswith("]"):
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, list):
                    return [str(item) for item in parsed]
            except json.JSONDecodeError:
                pass
        # 兼容双引号包裹的字符串字面量，例如 "\"xxx\""
        if len(stripped) >= 2 and stripped[0] == '"' and stripped[-1] == '"':
            try:
                parsed = json.loads(stripped)
                if isinstance(parsed, str):
                    return [parsed]
            except json.JSONDecodeError:
                pass
        return [raw]
    if isinstance(raw, (int, float, bool)):
        return [str(raw)]
    return [json.dumps(raw, ensure_ascii=False)]


def _normalize_band_ids(raw: Any) -> list[int]:
    if not isinstance(raw, (list, tuple)):
        return []
    return sorted({int(v) for v in raw if isinstance(v, int)})


def _normalize_total_count(raw: Any) -> int:
    if isinstance(raw, int) and raw > 0:
        return raw
    return DEFAULT_BAND_TOTAL_COUNT


def _other_member_sort_key(item: dict[str, Any]) -> str:
    key = item.get("key")
    return str(key) if key is not None else ""


def _order_band_names_by_bands(
    bands: list[int],
    raw_band_names: Any,
    band_name_to_id: Mapping[str, int | None] | None = None,
) -> list[str]:
    if not isinstance(raw_band_names, (list, tuple)):
        return []

    # 去重并保持原始出现顺序，避免重复 band_name 污染展示。
    deduped_names: list[str] = []
    seen_names: set[str] = set()
    for raw_name in raw_band_names:
        name = str(raw_name)
        if name in seen_names:
            continue
        seen_names.add(name)
        deduped_names.append(name)

    if not deduped_names or not band_name_to_id:
        return deduped_names

    mapped_groups: dict[int, list[str]] = {}
    unmapped_names: list[str] = []
    for name in deduped_names:
        band_id = band_name_to_id.get(name)
        if isinstance(band_id, int):
            mapped_groups.setdefault(band_id, []).append(name)
        else:
            unmapped_names.append(name)

    ordered_names: list[str] = []
    for band_id in bands:
        ordered_names.extend(sorted(mapped_groups.pop(band_id, [])))

    # 容错：若存在可映射但不在 bands 中的 id，仍按 band_id 升序拼接到已映射尾部。
    for band_id in sorted(mapped_groups):
        ordered_names.extend(sorted(mapped_groups[band_id]))

    # 规则：未映射到 band_id 的名称放在末尾。
    ordered_names.extend(unmapped_names)
    return ordered_names


def _build_live_detail_payload(
    header_row: tuple[Any, ...],
    parsed_rows: list[ParsedDetailRow],
    band_meta_by_name: dict[str, dict[str, int | None]],
) -> dict[str, Any]:
    bands = _normalize_band_ids(header_row[6])
    band_name_to_id = {
        band_name: band_meta["band_id"]
        for band_name, band_meta in band_meta_by_name.items()
        if isinstance(band_meta.get("band_id"), int)
    }
    detail_rows = []
    for row_id, song_name, band_member_obj, other_member_obj, is_short in parsed_rows:
        band_members = []
        for band_name, present_members_raw in band_member_obj.items():
            band_meta = band_meta_by_name.get(str(band_name), {})
            present_members = _to_string_list(present_members_raw)
            present_count = len(present_members)
            total_count = _normalize_total_count(band_meta.get("total_count"))
            band_members.append(
                {
                    "band_id": band_meta.get("band_id"),
                    "band_name": str(band_name),
                    "present_members": present_members,
                    "present_count": present_count,
                    "total_count": total_count,
                    "is_full": present_count >= total_count,
                }
            )

        band_members.sort(
            key=lambda item: (
                item["band_id"] is None,
                item["band_id"] if item["band_id"] is not None else 10**9,
                item["band_name"],
            )
        )

        other_members = [{"key": str(key), "value": _to_string_array(value)} for key, value in other_member_obj.items()]
        other_members.sort(key=_other_member_sort_key)

        comments: list[str] = ["短版"] if is_short else []

        detail_rows.append(
            {
                "row_id": row_id,
                "song_name": song_name,
                "band_members": band_members,
                "other_members": other_members,
                "comments": comments,
            }
        )

    return {
        "live_id": int(header_row[0]),
        "live_date": header_row[1],
        "live_title": str(header_row[2]),
        "venue": header_row[3],
        "opening_time": header_row[4],
        "start_time": header_row[5],
        "bands": bands,
        "band_names": _order_band_names_by_bands(bands, header_row[7], band_name_to_id),
        "url": header_row[8],
        "detail_rows": detail_rows,
    }


def _build_live_detail_with_cursor(cur: Any, live_id: int) -> dict[str, Any] | None:
    cur.execute(LIVE_DETAIL_HEADER_QUERY, (live_id,))
    header_row = cur.fetchone()
    if not header_row:
        return None

    cur.execute(LIVE_DETAIL_ROWS_QUERY, (live_id,))
    raw_rows = cur.fetchall()

    parsed_rows: list[ParsedDetailRow] = []
    all_band_names: set[str] = set()
    for row in raw_rows:
        row_id, song_name, band_member_raw, other_member_raw, is_short = row
        band_member_obj = _ensure_json_object(band_member_raw)
        other_member_obj = _ensure_json_object(other_member_raw)
        all_band_names.update(str(k) for k in band_member_obj.keys())
        parsed_rows.append(
            (
                str(row_id),
                str(song_name),
                band_member_obj,
                other_member_obj,
                bool(is_short),
            )
        )

    band_meta_by_name: dict[str, dict[str, int | None]] = {}
    if all_band_names:
        ordered_band_names = sorted(all_band_names)
        cur.execute(BAND_ID_LOOKUP_QUERY, (ordered_band_names,))
        band_lookup_rows = cur.fetchall()
        band_meta_by_name = {
            str(band_name): {
                "band_id": int(band_id) if isinstance(band_id, int) else None,
                "total_count": int(total_count) if isinstance(total_count, int) else None,
            }
            for band_id, band_name, total_count in band_lookup_rows
            if band_name is not None
        }

    return _build_live_detail_payload(header_row, parsed_rows, band_meta_by_name)


@router.get("")
def get_lives(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20),
):
    if page_size not in ALLOWED_PAGE_SIZE:
        raise HTTPException(status_code=400, detail="page_size must be 15 or 20")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(LIVES_COUNT_QUERY)
                count_row = cur.fetchone()
                total = int(count_row[0]) if count_row else 0

                total_pages = ceil(total / page_size) if total > 0 else 1
                safe_page = min(page, total_pages)
                offset = (safe_page - 1) * page_size

                cur.execute(LIVES_PAGE_QUERY, (page_size, offset))
                rows = cur.fetchall()
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    items = [
        {
            "live_id": row[0],
            "live_date": row[1],
            "live_title": row[2],
            "bands": row[3] or [],
            "url": row[4],
        }
        for row in rows
    ]

    return {
        "items": items,
        "pagination": {
            "page": safe_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.post("/details:batch")
def get_live_details_batch(payload: LiveDetailBatchRequest = Body(...)):
    deduped_live_ids: list[int] = []
    seen: set[int] = set()
    for live_id in payload.live_ids:
        if live_id < 1:
            raise HTTPException(status_code=400, detail="all live_ids must be >= 1")
        if live_id in seen:
            continue
        seen.add(live_id)
        deduped_live_ids.append(live_id)

    items: list[dict[str, Any]] = []
    missing_live_ids: list[int] = []
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(BATCH_LIVE_DETAIL_HEADERS_QUERY, (deduped_live_ids,))
                header_rows = cur.fetchall()
                header_by_live_id = {int(row[0]): row for row in header_rows}

                cur.execute(BATCH_LIVE_DETAIL_ROWS_QUERY, (deduped_live_ids,))
                raw_rows = cur.fetchall()

                parsed_rows_by_live_id: dict[int, list[dict[str, Any]]] = {}
                band_name_to_id_by_live_id: dict[int, dict[str, int]] = {}
                for row in raw_rows:
                    live_id, row_id, song_name, band_members_raw, other_member_raw, is_short = row
                    band_members_arr = _ensure_json_array(band_members_raw)
                    band_members = []
                    for band_item in band_members_arr:
                        if not isinstance(band_item, dict):
                            continue
                        band_name_raw = band_item.get("band_name")
                        if band_name_raw is None:
                            continue
                        band_name = str(band_name_raw)
                        band_id_raw = band_item.get("band_id")
                        band_id = int(band_id_raw) if isinstance(band_id_raw, int) else None
                        if band_id is not None:
                            band_name_to_id_by_live_id.setdefault(int(live_id), {})[band_name] = band_id
                        present_members = _to_string_list(band_item.get("present_members"))
                        present_count = len(present_members)
                        total_count = _normalize_total_count(band_item.get("total_count"))
                        band_members.append(
                            {
                                "band_id": band_id,
                                "band_name": band_name,
                                "present_members": present_members,
                                "present_count": present_count,
                                "total_count": total_count,
                                "is_full": present_count >= total_count,
                            }
                        )

                    band_members.sort(
                        key=lambda item: (
                            item["band_id"] is None,
                            item["band_id"] if item["band_id"] is not None else 10**9,
                            item["band_name"],
                        )
                    )

                    other_member_obj = _ensure_json_object(other_member_raw)
                    parsed_rows_by_live_id.setdefault(int(live_id), []).append(
                        {
                            "row_id": str(row_id),
                            "song_name": str(song_name),
                            "band_members": band_members,
                            "other_member_obj": other_member_obj,
                            "is_short": bool(is_short),
                        }
                    )

                for live_id in deduped_live_ids:
                    header_row = header_by_live_id.get(live_id)
                    if header_row is None:
                        missing_live_ids.append(live_id)
                        continue
                    detail_rows = []
                    for parsed_row in parsed_rows_by_live_id.get(live_id, []):
                        other_members = [
                            {"key": str(key), "value": _to_string_array(value)}
                            for key, value in parsed_row["other_member_obj"].items()
                        ]
                        other_members.sort(key=_other_member_sort_key)
                        comments: list[str] = ["短版"] if parsed_row["is_short"] else []
                        detail_rows.append(
                            {
                                "row_id": parsed_row["row_id"],
                                "song_name": parsed_row["song_name"],
                                "band_members": parsed_row["band_members"],
                                "other_members": other_members,
                                "comments": comments,
                            }
                        )

                    detail = {
                        "live_id": int(header_row[0]),
                        "live_date": header_row[1],
                        "live_title": str(header_row[2]),
                        "venue": header_row[3],
                        "opening_time": header_row[4],
                        "start_time": header_row[5],
                        "bands": _normalize_band_ids(header_row[6]),
                        "band_names": _order_band_names_by_bands(
                            _normalize_band_ids(header_row[6]),
                            header_row[7],
                            band_name_to_id_by_live_id.get(live_id, {}),
                        ),
                        "url": header_row[8],
                        "detail_rows": detail_rows,
                    }
                    items.append(detail)
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "items": items,
        "missing_live_ids": missing_live_ids,
    }


@router.get("/{live_id}")
def get_live_detail(live_id: int):
    if live_id < 1:
        raise HTTPException(status_code=400, detail="live_id must be >= 1")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                detail = _build_live_detail_with_cursor(cur, live_id)
                if detail is None:
                    raise HTTPException(status_code=404, detail=f"Live id {live_id} not found")
    except QueryCanceled as exc:
        raise HTTPException(status_code=504, detail="Database query timeout") from exc
    except OperationalError as exc:
        if "timeout expired" in str(exc).lower():
            raise HTTPException(status_code=504, detail="Database connection timeout") from exc
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    except Error as exc:
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return detail
