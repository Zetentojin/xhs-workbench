from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


for env_path in (
    Path(__file__).resolve().parent / ".env.local",
    Path(__file__).resolve().parent.parent / "frontend" / ".env.local",
):
    if env_path.exists():
        load_dotenv(env_path, override=False)


SUPABASE_URL = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = (
    os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    or ""
)
SUPABASE_JWKS_URL = os.environ.get("SUPABASE_JWKS_URL") or (
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else ""
)
SUPABASE_ISSUER = os.environ.get("SUPABASE_ISSUER") or (f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else "")
SUPABASE_AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")


def _is_truthy(value: str | None) -> bool:
    return (value or "").lower() in {"1", "true", "yes", "on"}


PUBLIC_ACCESS_ENABLED = _is_truthy(os.environ.get("PUBLIC_ACCESS_ENABLED")) or _is_truthy(
    os.environ.get("AUTH_BYPASS_ENABLED")
)


@dataclass
class AuthenticatedUser:
    user_id: str
    email: Optional[str]
    role: Optional[str]
    claims: dict[str, Any]


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _auth_unavailable(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=detail,
    )


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    if not SUPABASE_JWKS_URL:
        raise _auth_unavailable("Supabase JWKS URL is not configured")
    return jwt.PyJWKClient(SUPABASE_JWKS_URL)


def _verify_with_jwks(token: str) -> dict[str, Any]:
    signing_key = _jwks_client().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience=SUPABASE_AUDIENCE,
        issuer=SUPABASE_ISSUER or None,
    )


def _verify_with_auth_server(token: str) -> dict[str, Any]:
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise _auth_unavailable("Supabase Auth verification is not configured")

    request = Request(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
          "Authorization": f"Bearer {token}",
          "apikey": SUPABASE_PUBLISHABLE_KEY,
        },
    )

    try:
        with urlopen(request, timeout=6) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code in {401, 403}:
            raise _unauthorized("Supabase token is invalid or expired") from exc
        raise _auth_unavailable("Supabase Auth server is unavailable") from exc
    except URLError as exc:
        raise _auth_unavailable("Supabase Auth server is unavailable") from exc

    user_id = str(payload.get("id") or "")
    if not user_id:
        raise _unauthorized("Supabase user payload is missing an id")

    return {
        "sub": user_id,
        "email": payload.get("email"),
        "role": payload.get("role"),
        "raw_user": payload,
    }


def verify_supabase_token(token: str) -> AuthenticatedUser:
    if not SUPABASE_URL:
        raise _auth_unavailable("Supabase URL is not configured")

    unverified_header = jwt.get_unverified_header(token)
    algorithm = str(unverified_header.get("alg") or "")

    try:
        if algorithm.startswith("HS"):
            claims = _verify_with_auth_server(token)
        else:
            claims = _verify_with_jwks(token)
    except jwt.PyJWKClientError:
        claims = _verify_with_auth_server(token)
    except jwt.InvalidTokenError as exc:
        raise _unauthorized("Supabase token is invalid or expired") from exc

    user_id = str(claims.get("sub") or claims.get("user_id") or "")
    if not user_id:
        raise _unauthorized("Supabase token is missing a user id")

    return AuthenticatedUser(
        user_id=user_id,
        email=claims.get("email"),
        role=claims.get("role"),
        claims=claims,
    )


bearer_scheme = HTTPBearer(auto_error=False)


def require_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if PUBLIC_ACCESS_ENABLED:
        return AuthenticatedUser(
            user_id="public-access-user",
            email=None,
            role="public_access",
            claims={"mode": "public_access"},
        )

    if not credentials:
        raise _unauthorized("当前服务未开启公开访问，需要 Bearer token")

    if credentials.scheme.lower() != "bearer":
        raise _unauthorized("仅支持 Bearer token")

    return verify_supabase_token(credentials.credentials)
