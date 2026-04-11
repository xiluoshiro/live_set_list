from typing import Any

from pydantic import BaseModel, Field


class RootResponse(BaseModel):
    message: str = Field(..., description='Service startup status message')


class ErrorResponse(BaseModel):
    detail: str = Field(..., description='Error message')


class ValidationErrorItem(BaseModel):
    type: str = Field(..., description='Validation error type')
    loc: list[str | int] = Field(..., description='Error location')
    msg: str = Field(..., description='Validation error message')
    input: Any | None = Field(default=None, description='Input that failed validation')


class ValidationErrorResponse(BaseModel):
    detail: list[ValidationErrorItem] = Field(..., description='Validation error details')
