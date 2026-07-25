from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status

from .config import get_settings


@dataclass(frozen=True)
class RateLimitKey:
    party_id: str
    endpoint: str


class InMemoryRateLimiter:
    def __init__(self, default_limit: int, window_seconds: int) -> None:
        self.default_limit = default_limit
        self.window_seconds = window_seconds
        self._bucket: dict[RateLimitKey, deque[float]] = defaultdict(deque)

    def hit(self, party_id: str, endpoint: str, limit: int | None = None) -> None:
        now = datetime.now(timezone.utc).timestamp()
        max_hits = limit or self.default_limit
        key = RateLimitKey(party_id=party_id, endpoint=endpoint)
        queue = self._bucket[key]

        cutoff = now - self.window_seconds
        while queue and queue[0] < cutoff:
            queue.popleft()

        if len(queue) >= max_hits:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded for endpoint '{endpoint}'",
            )

        queue.append(now)


settings = get_settings()
rate_limiter = InMemoryRateLimiter(
    default_limit=settings.rate_limit_per_window,
    window_seconds=settings.rate_limit_window_seconds,
)
