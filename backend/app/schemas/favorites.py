from typing import Literal

from pydantic import BaseModel, Field


class FavoriteBatchRequest(BaseModel):
    action: Literal["favorite", "unfavorite"] = Field(
        ...,
        description="Batch favorite action: favorite to add, unfavorite to remove",
    )
    live_ids: list[int] = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Target live IDs; duplicates are allowed in request and deduped by backend",
    )


class FavoriteBatchResponse(BaseModel):
    action: Literal["favorite", "unfavorite"] = Field(..., description="Applied batch action")
    requested_count: int = Field(..., ge=0, description="Count after server-side dedupe")
    applied_live_ids: list[int] = Field(..., description="IDs that changed state in this batch")
    noop_live_ids: list[int] = Field(..., description="IDs already in target state")
    not_found_live_ids: list[int] = Field(..., description="IDs not found in live_attrs")
