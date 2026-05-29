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
from typing import AsyncIterator

logger = logging.getLogger(__name__)

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
                "[progress] dropped %s event for %s (queue full)", kind, pid,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "[progress] dropped %s event for %s: %s", kind, pid, exc,
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
