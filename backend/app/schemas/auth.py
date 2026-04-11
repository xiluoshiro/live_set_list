from pydantic import BaseModel, Field


class AuthErrorDetail(BaseModel):
    code: str = Field(..., description='Stable auth/business error code')
    message: str = Field(..., description='Human-readable error message')


class AuthErrorResponse(BaseModel):
    detail: AuthErrorDetail = Field(..., description='Structured auth error payload')


class AuthUserResponse(BaseModel):
    id: int = Field(..., description='User primary key ID')
    username: str = Field(..., description='Normalized login username')
    display_name: str = Field(..., description='Display name shown in the UI')
    role: str = Field(..., description='Current role, such as viewer/editor/admin')


class AuthLoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64, description='Login username')
    password: str = Field(..., min_length=1, max_length=4096, description='Plain-text password for login only')


class AuthLoginResponse(BaseModel):
    user: AuthUserResponse = Field(..., description='Authenticated user info')
    csrf_token: str = Field(..., description='CSRF token for subsequent write requests')
    favorite_live_ids: list[int] = Field(..., description='Current favorite live IDs for the user')


class AuthMeResponse(BaseModel):
    authenticated: bool = Field(..., description='Whether the current request is authenticated')
    user: AuthUserResponse | None = Field(default=None, description='Current authenticated user; null when anonymous')
    csrf_token: str | None = Field(default=None, description='Fresh CSRF token; null when anonymous')
    favorite_live_ids: list[int] | None = Field(
        default=None,
        description='Current favorite live IDs; null when anonymous',
    )
