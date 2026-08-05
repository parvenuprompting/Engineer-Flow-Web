from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field


# Demo RSA keypair for local development only.
DEMO_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDOoT0JZdcZvAWE
n1BfpgvXyTiWHX5RYW6rTeGfeCDBhpsW7RyLeM5+42WzPLDgNfhDtC9VsuWoJoCZ
e90NkBBt15RMaCah9RcnGyxMYNBf/R/WfWM95vy4dslPA62vCWiMJXKG7xh+Y+5n
REnZWgZ3ZsnNhuSkU9KSqfiuBgap98HQvx+04NfhbwLNYZCGire5iRpDORcOG0Jn
ID+sjWy3YYoe1ARXZsHrKktUdcQmw0QAvgA4JwiJHHldgMmdEPr7QkazxB2FZVD7
clN/vfH01Ebx549w47wRLIH6KVJ3OggnGYsXa097GpNkox9GHFkfr1JOmMHt6wiW
An4sHLehAgMBAAECggEAEblP6H31UO5JVOJrfQDbtDM86Nd3zdg7K3N/PnQJ7z+y
Dung0G/Y2pZ70z+J9nl6pagPhVzWiTFgR4oR4IdyeVGMFW+7nJnO1hplFtoZFZq7
P+U6fYVSOSprQx1QKRr3/kl6BOv+YF0HBpGbegrYUiadecUv2I6eGdl9jMPUj4Ca
2/hzNJV6v6Kbf79cW9oA0vOTAKeQEwMOFE64nwBOX0fPlFzRRA/oP0+G1lxEIvw3
a61TLnaIEaMHDlYW/D0qgwgfe9tccdkKNFE+6v7lcKFQUg9TGlsJYWXockt+QAVY
12VuKnsR2tBql7b4v66mmyl+zhS7IvtGEBhpnJjJ7wKBgQD8w8GjUcMjSoA611hS
26AiNlVG5xTLpuaEil0LgQXPixJQvSE6SYaMvH6Lhiy2zLho0IH9ZQhuHBHXp51N
rvQrKqVr1xVKlCez5QWO5qIoAlpA4gIOGVTPqEYiLP86WdYZe2PDEQF04AIaOS0Z
j4RxaMA4XXKnr1tH8Hq8RojqmwKBgQDRRk9tFZl3bMUPlBZOTXnGWwqRqKr3j8aZ
sAGebRwftTz98duzW7e1hnsyjC4dnuHIrnVlrX6H1pMmcQDpJDqybtVYjUTohL5f
wKF97sECRzydsQIqN4PS6SA3ZhDdAQPOB9jGjI/dNPYG58OCZKwoNPuI/Ig1FIhf
hFVKT008cwKBgQC6sIdT7m7XoQ4m56j3wfl7a2/+52xnooU+PcfNWGWHTiuf8KEb
IPU8+3fn65kZBwnpeJ+aHcZlNVxEUSuRFfiH7X6ysPCr3dOZPj2lt1jrfhlVNNjZ
uwH2Qk5SrbNxUKsetRERIX1W6qEC51oVN/hVn03iE7s8ePtNniO47cvwowKBgAke
r0dpsY5qxwuuwGoZJj1mqkc+unSfZ2A7M1bcGmWnWEkYySI/1PmsKqJBSaEw01YT
hDoyHVl+GFuMgSWn1ocAHXwGbAJWBpXVpzP9u5uFzzZwCFAeqzf9wNGpOQLokGni
HahJZ9uT+0TBxNth177I0E1f8++cPXUsJytd2VfRAoGAEkrqmba5OuYyZrJ6i3Wg
p/7cb9RC4CZEa+P2G6wC/Kowam8rgGmJED5IBZh0cEUnKGINuaeEbD3RjffLgVmg
XZQH8P/ZMObFctthUrTEczLQOFaAMSM87zkQaDw0YFnYSNJMxrh3O8h+2hPx0PtI
XNdcZKAS/7LzSi/MKbBtWL8=
-----END PRIVATE KEY-----"""

DEMO_PUBLIC_KEY = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzqE9CWXXGbwFhJ9QX6YL
18k4lh1+UWFuq03hn3ggwYabFu0ci3jOfuNlszyw4DX4Q7QvVbLlqCaAmXvdDZAQ
bdeUTGgmofUXJxssTGDQX/0f1n1jPeb8uHbJTwOtrwlojCVyhu8YfmPuZ0RJ2VoG
d2bJzYbkpFPSkqn4rgYGqffB0L8ftODX4W8CzWGQhoq3uYkaQzkXDhtCZyA/rI1s
t2GKHtQEV2bB6ypLVHXEJsNEAL4AOCcIiRx5XYDJnRD6+0JGs8QdhWVQ+3JTf73x
9NRG8eePcOO8ESyB+ilSdzoIJxmLF2tPexqTZKMfRhxZH69STpjB7esIlgJ+LBy3
oQIDAQAB
-----END PUBLIC KEY-----"""


class Settings(BaseModel):
    app_name: str = "LUCID Engineer Flow"
    app_version: str = "0.2.0"
    policy_version: str = "LUCID-v0.2"

    database_url: str = Field(
        default_factory=lambda: os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg://postgres:postgres@localhost:5432/lucid_engineer_flow",
        )
    )

    jwt_issuer: str = Field(default_factory=lambda: os.getenv("LUCID_JWT_ISSUER", "lucid-internal-issuer"))
    jwt_audience: str = Field(default_factory=lambda: os.getenv("LUCID_JWT_AUDIENCE", "lucid-engineer-flow"))
    jwt_algorithm: str = "RS256"
    jwt_leeway_seconds: int = 15

    hmac_secret: str = Field(default_factory=lambda: os.getenv("LUCID_HMAC_SECRET", "lucid-dev-hmac-secret"))

    rate_limit_window_seconds: int = Field(default_factory=lambda: int(os.getenv("LUCID_RATE_LIMIT_WINDOW", "60")))
    rate_limit_per_window: int = Field(default_factory=lambda: int(os.getenv("LUCID_RATE_LIMIT_PER_WINDOW", "60")))

    trigger1_window_hours: int = Field(default_factory=lambda: int(os.getenv("LUCID_TRIGGER1_WINDOW_HOURS", "24")))
    trigger1_batch_interval_minutes: int = Field(default_factory=lambda: int(os.getenv("LUCID_TRIGGER1_BATCH_INTERVAL_MINUTES", "60")))

    dev_auth_enabled: bool = Field(default_factory=lambda: os.getenv("LUCID_ENABLE_DEV_AUTH", "false").lower() == "true")
    auto_create_schema: bool = Field(
        default_factory=lambda: os.getenv(
            "LUCID_AUTO_CREATE_SCHEMA",
            "true" if os.getenv("LUCID_ENABLE_DEV_AUTH", "false").lower() == "true" else "false",
        ).lower()
        == "true"
    )

    default_jwt_kid: str = Field(default_factory=lambda: os.getenv("LUCID_DEFAULT_JWT_KID", "dev-key-1"))
    efl_audit_ingest_enabled: bool = Field(
        default_factory=lambda: os.getenv("LUCID_EFL_AUDIT_INGEST_ENABLED", "true").lower() == "true"
    )
    efl_audit_ingest_secret: str = Field(
        default_factory=lambda: os.getenv("LUCID_EFL_AUDIT_INGEST_SECRET", "efl-local-sync-secret")
    )

    jwt_public_keys: dict[str, str] = Field(default_factory=dict)
    jwt_private_keys: dict[str, str] = Field(default_factory=dict)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()

    raw_public = os.getenv("LUCID_JWT_PUBLIC_KEYS_JSON")
    if raw_public:
        settings.jwt_public_keys = json.loads(raw_public)
    elif settings.dev_auth_enabled:
        settings.jwt_public_keys = {settings.default_jwt_kid: DEMO_PUBLIC_KEY}
    else:
        settings.jwt_public_keys = {}

    raw_private = os.getenv("LUCID_JWT_PRIVATE_KEYS_JSON")
    if raw_private:
        settings.jwt_private_keys = json.loads(raw_private)
    elif settings.dev_auth_enabled:
        settings.jwt_private_keys = {settings.default_jwt_kid: DEMO_PRIVATE_KEY}
    else:
        settings.jwt_private_keys = {}

    return settings


def to_jsonable(payload: Any) -> Any:
    if isinstance(payload, (str, int, float, bool)) or payload is None:
        return payload
    if isinstance(payload, dict):
        return {k: to_jsonable(v) for k, v in payload.items()}
    if isinstance(payload, (list, tuple, set)):
        return [to_jsonable(v) for v in payload]
    if hasattr(payload, "isoformat"):
        return payload.isoformat()
    if hasattr(payload, "model_dump"):
        return to_jsonable(payload.model_dump())
    return str(payload)
