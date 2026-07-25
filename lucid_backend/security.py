from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import InvalidTokenError

from .config import get_settings


@dataclass
class AuthContext:
    sub: str
    party_type: str
    party_id: str
    scopes: set[str]
    exp: int
    kid: str


settings = get_settings()


def _extract_bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Authorization header")
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Authorization scheme")
    token = authorization[len(prefix) :].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty bearer token")
    return token


def decode_token(token: str) -> AuthContext:
    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid JWT header") from exc

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing JWT kid header")

    public_key = settings.jwt_public_keys.get(kid)
    if not public_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown JWT kid")

    try:
        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["sub", "party_type", "party_id", "scopes", "exp"]},
            leeway=settings.jwt_leeway_seconds,
        )
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"Invalid JWT: {exc}") from exc

    party_type = payload.get("party_type")
    if party_type not in {"garage", "fabrikant", "verzekeraar"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing party_type claim")

    scopes = payload.get("scopes")
    if not isinstance(scopes, list) or any(not isinstance(s, str) for s in scopes):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid scopes claim")

    return AuthContext(
        sub=payload["sub"],
        party_type=party_type,
        party_id=payload.get("party_id"),
        scopes=set(scopes),
        exp=int(payload["exp"]),
        kid=kid,
    )


def get_auth_context(authorization: Annotated[str | None, Header()] = None) -> AuthContext:
    token = _extract_bearer_token(authorization)
    return decode_token(token)


def require_scopes(required: set[str]):
    def dependency(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if not required.issubset(auth.scopes):
            missing = sorted(required - auth.scopes)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required scopes: {', '.join(missing)}",
            )
        return auth

    return dependency


def require_party_types(allowed: set[str]):
    def dependency(auth: AuthContext = Depends(get_auth_context)) -> AuthContext:
        if auth.party_type not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Party type '{auth.party_type}' is not allowed for this endpoint",
            )
        return auth

    return dependency


def issue_dev_token(subject: str, party_type: str, party_id: str, scopes: list[str], expires_in_minutes: int) -> str:
    if not settings.dev_auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dev auth endpoint disabled")

    kid = settings.default_jwt_kid
    private_key = settings.jwt_private_keys.get(kid)
    if not private_key:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Missing private key for default kid")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "party_type": party_type,
        "party_id": party_id,
        "scopes": scopes,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_in_minutes)).timestamp()),
    }

    return jwt.encode(payload, key=private_key, algorithm=settings.jwt_algorithm, headers={"kid": kid})
