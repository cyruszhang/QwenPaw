# -*- coding: utf-8 -*-
"""In-process progress event bus for the Creator pipeline.

Pipeline stages call ``emit(pid, kind, **payload)`` at meaningful
moments (stage_start, scene_start, scene_done, etc.). The SSE endpoint
in ``routers/creator.py`` calls ``subscribe(pid)`` to get an async
iterator that yields those events to the browser.

Fan-out: multiple browser tabs can subscribe to the same project — each
gets its own queue, every ``emit`` broadcasts to all subscribers.

Cleanup: dropped subscribers (e.g. browser tab closed) are removed
lazily when the next emit happens. No persistence — restart wipes state.
This is a live-progress channel, not an event log.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator, Optional

logger = logging.getLogger(__name__)


class StreamCoalescer:
    """Throttle streamed text deltas into low-frequency full snapshots.

    A token stream (e.g. the LLM decomposition) can produce hundreds of
    tiny deltas. Forwarding each one to the SSE bus would flood the
    bounded subscriber queues. Instead, ``push(delta)`` accumulates the
    text and only returns a snapshot when enough new characters have
    arrived (or a line just completed); otherwise it returns ``None``.

    Snapshots are the FULL accumulated text, not a delta — so the
    channel is drop-robust: a subscriber that misses intermediate
    events still converges on the latest snapshot. Call ``flush()`` once
    at the end to emit any unflushed tail. Pure / no I/O — unit-testable.
    """

    def __init__(self, min_chars: int = 64) -> None:
        self._text = ""
        self._emitted_len = 0
        self._min_chars = max(1, min_chars)

    def push(self, delta: str) -> Optional[str]:
        if not delta:
            return None
        self._text += delta
        pending = len(self._text) - self._emitted_len
        if pending >= self._min_chars or delta.endswith("\n"):
            self._emitted_len = len(self._text)
            return self._text
        return None

    def flush(self) -> Optional[str]:
        if len(self._text) > self._emitted_len:
            self._emitted_len = len(self._text)
            return self._text
        return None

    @property
    def text(self) -> str:
        return self._text


# pid → set of subscriber queues
_SUBSCRIBERS: dict[str, set[asyncio.Queue]] = {}


def emit(pid: str, kind: str, **payload) -> None:
    """Broadcast a progress event to every subscriber on ``pid``.

    Safe to call from sync or async code (we never await). Queues use
    ``put_nowait`` so a slow subscriber can't block the producer; if a
    queue is full we drop the event for that subscriber and log.

    Typical kinds:
      stage_start / stage_done / stage_failed
      scene_start / scene_done / scene_failed
      asset_start / asset_done   (Stage 0a/0b/0c per-asset)
      stage_progress             (free-form, message field)
    """
    subs = _SUBSCRIBERS.get(pid)
    if not subs:
        return
    event = {"kind": kind, **payload}
    dead: list[asyncio.Queue] = []
    for q in list(subs):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            logger.warning(
                "[progress] dropped %s event for %s (queue full)",
                kind,
                pid,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[progress] dropped %s event for %s: %s",
                kind,
                pid,
                exc,
            )
            dead.append(q)
    for q in dead:
        subs.discard(q)


async def subscribe(pid: str) -> AsyncIterator[dict]:
    """Async iterator yielding events for ``pid``.

    The endpoint calls this in a ``StreamingResponse``. On cancellation
    (client disconnect) the queue is removed from the subscriber set.
    Sends a heartbeat-friendly ``{kind: 'open'}`` immediately so the
    client knows the channel is alive.
    """
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _SUBSCRIBERS.setdefault(pid, set()).add(q)
    try:
        yield {"kind": "open", "pid": pid}
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=20.0)
                yield event
            except asyncio.TimeoutError:
                # Heartbeat keeps the connection alive through proxies
                # and lets the client detect a dead connection.
                yield {"kind": "ping"}
    finally:
        subs = _SUBSCRIBERS.get(pid)
        if subs is not None:
            subs.discard(q)
            if not subs:
                _SUBSCRIBERS.pop(pid, None)
