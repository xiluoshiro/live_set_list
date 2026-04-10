from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from app.auth import (
    build_authenticated_response_payload,
    authenticate_user,
    get_current_auth_context_optional,
    logout_current_session,
    session_cookie_settings,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=4096)


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response):
    auth_result = authenticate_user(payload.username, payload.password, request)
    cookie_settings = session_cookie_settings(auth_result["expires_at"])
    cookie_settings["value"] = auth_result["session_token"]
    response.set_cookie(**cookie_settings)
    return {
        "user": {
            "id": auth_result["user"].id,
            "username": auth_result["user"].username,
            "display_name": auth_result["user"].display_name,
            "role": auth_result["user"].role,
        },
        "csrf_token": auth_result["csrf_token"],
        "favorite_live_ids": auth_result["favorite_live_ids"],
    }


@router.get("/me")
def me(request: Request):
    context = get_current_auth_context_optional(request)
    if context is None:
        return {"authenticated": False}

    return build_authenticated_response_payload(context)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response):
    context = get_current_auth_context_optional(request)
    if context is None:
        response.delete_cookie(key="live_set_list_session", path="/", samesite="lax")
        response.status_code = 204
        return None

    logout_current_session(request, context)
    response.delete_cookie(key="live_set_list_session", path="/", samesite="lax")
    response.status_code = 204
    return None
