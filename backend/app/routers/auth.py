from fastapi import APIRouter, Request, Response

from app.auth import (
    build_authenticated_response_payload,
    authenticate_user,
    get_current_auth_context_optional,
    logout_current_session,
    session_cookie_settings,
)
from app.schemas.auth import AuthErrorResponse, AuthLoginRequest, AuthLoginResponse, AuthMeResponse
from app.schemas.common import ValidationErrorResponse


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=AuthLoginResponse,
    summary="用户登录",
    description="校验用户名密码，写入 HttpOnly session cookie，并返回当前用户信息与 CSRF Token。",
    responses={
        401: {
            "model": AuthErrorResponse,
            "description": "用户名或密码错误",
        },
        403: {
            "model": AuthErrorResponse,
            "description": "用户已停用",
        },
        422: {
            "model": ValidationErrorResponse,
            "description": "请求体验证失败",
        },
    },
)
def login(payload: AuthLoginRequest, request: Request, response: Response):
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


@router.get(
    "/me",
    response_model=AuthMeResponse,
    response_model_exclude_none=True,
    summary="获取当前登录态",
    description="读取当前 session cookie；已登录时返回用户信息、新的 CSRF Token 和收藏 ID 列表。",
)
def me(request: Request):
    context = get_current_auth_context_optional(request)
    if context is None:
        return {"authenticated": False}

    return build_authenticated_response_payload(context)


@router.post(
    "/logout",
    status_code=204,
    summary="退出登录",
    description="使当前 session 失效并删除 session cookie。写请求需要携带有效的 X-CSRF-Token。",
    responses={
        204: {
            "description": "退出成功或当前本就未登录",
        },
        403: {
            "model": AuthErrorResponse,
            "description": "CSRF Token 缺失或校验失败",
        },
    },
)
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
