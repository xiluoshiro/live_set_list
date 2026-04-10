import os
import hashlib
import ipaddress
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, status
from psycopg2.extras import Json

from app.db import get_write_db_connection
from app.logging_config import get_logger


SESSION_COOKIE_NAME = "live_set_list_session"
CSRF_HEADER_NAME = "X-CSRF-Token"
DEFAULT_SESSION_HOURS = 8
PASSWORD_HASHER = PasswordHasher()
ROLE_PRIORITY = {"viewer": 10, "editor": 20, "admin": 30}

logger = get_logger(__name__)


@dataclass(frozen=True)
class AuthUser:
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool


@dataclass(frozen=True)
class AuthSessionContext:
    session_id: int
    user: AuthUser
    csrf_token_hash: str
    expires_at: datetime


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, password)
    except (InvalidHashError, VerifyMismatchError):
        return False


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _normalize_client_ip(raw_client_ip: str | None) -> str | None:
    if not raw_client_ip:
        return None
    try:
        return str(ipaddress.ip_address(raw_client_ip))
    except ValueError:
        return None


def _session_lifetime() -> timedelta:
    hours = int(os.getenv("AUTH_SESSION_HOURS", str(DEFAULT_SESSION_HOURS)))
    return timedelta(hours=hours)


def _session_cookie_max_age_seconds() -> int:
    return int(_session_lifetime().total_seconds())


def _user_payload(user: AuthUser) -> dict[str, Any]:
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "role": user.role,
    }


def _raise_auth_error(status_code: int, code: str, message: str) -> None:
    raise HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
        },
    )


def _parse_auth_user(row: tuple[Any, ...]) -> AuthUser:
    return AuthUser(
        id=int(row[0]),
        username=str(row[1]),
        display_name=str(row[2]),
        role=str(row[3]),
        is_active=bool(row[4]),
    )


def _get_favorite_live_ids(cur: Any, user_id: int) -> list[int]:
    cur.execute(
        """
        SELECT live_id
        FROM user_live_favorites
        WHERE user_id = %s
        ORDER BY live_id
        """,
        (user_id,),
    )
    return [int(row[0]) for row in cur.fetchall() if row and isinstance(row[0], int)]


def _write_audit_log(
    cur: Any,
    *,
    user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    payload_json: dict[str, Any] | None = None,
) -> None:
    cur.execute(
        """
        INSERT INTO audit_logs (user_id, action, resource_type, resource_id, payload_json)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (user_id, action, resource_type, resource_id, Json(payload_json) if payload_json is not None else None),
    )


def write_audit_log_entry(
    *,
    user_id: int | None,
    action: str,
    resource_type: str,
    resource_id: str | None = None,
    payload_json: dict[str, Any] | None = None,
) -> None:
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            _write_audit_log(
                cur,
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                payload_json=payload_json,
            )


def authenticate_user(username: str, password: str, request: Request) -> dict[str, Any]:
    normalized_username = normalize_username(username)
    now = _now_utc()
    session_expires_at = now + _session_lifetime()
    session_token = secrets.token_urlsafe(32)
    csrf_token = secrets.token_urlsafe(32)
    session_token_hash = _hash_token(session_token)
    csrf_token_hash = _hash_token(csrf_token)
    client_ip = _normalize_client_ip(request.client.host if request.client else None)
    user_agent = request.headers.get("user-agent")

    # 登录在一个事务里完成：校验密码、写 session、更新登录时间、记录审计。
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, username, display_name, role, is_active, password_hash
                FROM app_users
                WHERE username = %s
                """,
                (normalized_username,),
            )
            row = cur.fetchone()
            if not row:
                write_audit_log_entry(
                    user_id=None,
                    action="login_failed",
                    resource_type="auth",
                    payload_json={"username": normalized_username, "reason": "user_not_found"},
                )
                _raise_auth_error(status.HTTP_401_UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")

            user = _parse_auth_user(row[:5])
            password_hash = str(row[5])
            if not user.is_active:
                write_audit_log_entry(
                    user_id=user.id,
                    action="login_failed",
                    resource_type="auth",
                    resource_id=str(user.id),
                    payload_json={"username": user.username, "reason": "user_inactive"},
                )
                _raise_auth_error(status.HTTP_403_FORBIDDEN, "AUTH_USER_INACTIVE", "用户已被停用")

            if not verify_password(password, password_hash):
                write_audit_log_entry(
                    user_id=user.id,
                    action="login_failed",
                    resource_type="auth",
                    resource_id=str(user.id),
                    payload_json={"username": user.username, "reason": "password_mismatch"},
                )
                _raise_auth_error(status.HTTP_401_UNAUTHORIZED, "AUTH_INVALID_CREDENTIALS", "用户名或密码错误")

            cur.execute(
                """
                UPDATE app_users
                SET last_login_at = %s, updated_at = %s
                WHERE id = %s
                """,
                (now, now, user.id),
            )
            cur.execute(
                """
                INSERT INTO auth_sessions (
                    user_id,
                    session_token_hash,
                    csrf_token_hash,
                    expires_at,
                    last_seen_at,
                    created_ip,
                    user_agent
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    user.id,
                    session_token_hash,
                    csrf_token_hash,
                    session_expires_at,
                    now,
                    client_ip,
                    user_agent,
                ),
            )
            favorite_live_ids = _get_favorite_live_ids(cur, user.id)
            _write_audit_log(
                cur,
                user_id=user.id,
                action="login_success",
                resource_type="auth",
                resource_id=str(user.id),
                payload_json={"session_expires_at": session_expires_at.isoformat()},
            )

    return {
        "user": user,
        "session_token": session_token,
        "csrf_token": csrf_token,
        "favorite_live_ids": favorite_live_ids,
        "expires_at": session_expires_at,
    }


def build_authenticated_response_payload(context: AuthSessionContext) -> dict[str, Any]:
    csrf_token = secrets.token_urlsafe(32)
    csrf_token_hash = _hash_token(csrf_token)
    now = _now_utc()
    # `/api/auth/me` 每次返回新的 CSRF token，避免前端长期复用同一个写令牌。
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET csrf_token_hash = %s,
                    last_seen_at = %s
                WHERE id = %s
                """,
                (csrf_token_hash, now, context.session_id),
            )
            favorite_live_ids = _get_favorite_live_ids(cur, context.user.id)

    return {
        "authenticated": True,
        "user": _user_payload(context.user),
        "csrf_token": csrf_token,
        "favorite_live_ids": favorite_live_ids,
    }


def _load_auth_context(session_token: str) -> AuthSessionContext | None:
    now = _now_utc()
    session_token_hash = _hash_token(session_token)
    # cookie 只带明文 token，服务端始终按 hash 查库，避免数据库里保存可直接使用的 session 值。
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    s.id,
                    s.user_id,
                    s.csrf_token_hash,
                    s.expires_at,
                    u.id,
                    u.username,
                    u.display_name,
                    u.role,
                    u.is_active
                FROM auth_sessions s
                JOIN app_users u
                    ON u.id = s.user_id
                WHERE s.session_token_hash = %s
                    AND s.revoked_at IS NULL
                """,
                (session_token_hash,),
            )
            row = cur.fetchone()
            if not row:
                return None

            expires_at = row[3]
            if not isinstance(expires_at, datetime) or expires_at <= now:
                cur.execute(
                    """
                    UPDATE auth_sessions
                    SET revoked_at = COALESCE(revoked_at, %s)
                    WHERE id = %s
                    """,
                    (now, row[0]),
                )
                return None

            user = AuthUser(
                id=int(row[4]),
                username=str(row[5]),
                display_name=str(row[6]),
                role=str(row[7]),
                is_active=bool(row[8]),
            )
            if not user.is_active:
                return None

            cur.execute(
                """
                UPDATE auth_sessions
                SET last_seen_at = %s
                WHERE id = %s
                """,
                (now, row[0]),
            )
            return AuthSessionContext(
                session_id=int(row[0]),
                user=user,
                csrf_token_hash=str(row[2]),
                expires_at=expires_at,
            )


def get_current_auth_context_optional(request: Request) -> AuthSessionContext | None:
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_token:
        return None
    return _load_auth_context(session_token)


def get_current_auth_context(
    request: Request,
) -> AuthSessionContext:
    context = get_current_auth_context_optional(request)
    if context is None:
        _raise_auth_error(status.HTTP_401_UNAUTHORIZED, "AUTH_SESSION_EXPIRED", "登录状态已失效，请重新登录")
    return context


def get_current_user_optional(
    context: AuthSessionContext | None = Depends(get_current_auth_context_optional),
) -> AuthUser | None:
    if context is None:
        return None
    return context.user


def get_current_user(
    context: AuthSessionContext = Depends(get_current_auth_context),
) -> AuthUser:
    return context.user


def require_role(required_role: str):
    if required_role not in ROLE_PRIORITY:
        raise ValueError(f"Unsupported role: {required_role}")

    # 角色按优先级比较，避免在每个路由里手写 viewer/editor/admin 的分支判断。
    def _role_dependency(user: AuthUser = Depends(get_current_user)) -> AuthUser:
        current_priority = ROLE_PRIORITY.get(user.role, -1)
        required_priority = ROLE_PRIORITY[required_role]
        if current_priority < required_priority:
            _raise_auth_error(status.HTTP_403_FORBIDDEN, "AUTH_FORBIDDEN", "当前账号无权访问该资源")
        return user

    return _role_dependency


def assert_valid_csrf(request: Request, context: AuthSessionContext) -> None:
    csrf_token = request.headers.get(CSRF_HEADER_NAME)
    if not csrf_token:
        _raise_auth_error(status.HTTP_403_FORBIDDEN, "AUTH_CSRF_INVALID", "缺少 CSRF Token")

    if not secrets.compare_digest(_hash_token(csrf_token), context.csrf_token_hash):
        _raise_auth_error(status.HTTP_403_FORBIDDEN, "AUTH_CSRF_INVALID", "CSRF Token 校验失败")


def logout_current_session(request: Request, context: AuthSessionContext) -> None:
    assert_valid_csrf(request, context)
    now = _now_utc()
    with get_write_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE auth_sessions
                SET revoked_at = COALESCE(revoked_at, %s),
                    last_seen_at = %s
                WHERE id = %s
                """,
                (now, now, context.session_id),
            )
            _write_audit_log(
                cur,
                user_id=context.user.id,
                action="logout",
                resource_type="auth",
                resource_id=str(context.user.id),
                payload_json={"session_id": context.session_id},
            )


def session_cookie_settings(expires_at: datetime) -> dict[str, Any]:
    secure = os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
    return {
        "key": SESSION_COOKIE_NAME,
        "value": "",
        "httponly": True,
        "secure": secure,
        "samesite": "lax",
        "path": "/",
        "expires": expires_at,
        "max_age": _session_cookie_max_age_seconds(),
    }
