from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    ok: bool = Field(..., description='Whether the database health check passed')
    result: int | None = Field(
        ...,
        description='Result of select 1; null when no row is returned',
    )
