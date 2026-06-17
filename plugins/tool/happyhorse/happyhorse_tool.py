# -*- coding: utf-8 -*-
"""HappyHorse video generation tools — t2v / i2v / r2v.

Three functions exposed to the agent toolkit, all hitting DashScope's
``/api/v1/services/aigc/video-generation/video-synthesis`` endpoint
(the same one Wan 2.7 uses) with the ``happyhorse-1.0-*`` model ids:

  - ``happyhorse-1.0-t2v`` — text-to-video
  - ``happyhorse-1.0-i2v`` — image-to-video (drop-in for image_to_video_wan)
  - ``happyhorse-1.0-r2v`` — reference-to-video

The signatures mirror the Wan tool's where possible so the Creator
bundle's Stage 3 can swap providers via the per-scene ``video_provider``
field without changing call-site code.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import threading
import time
from pathlib import Path
from typing import List, Optional

import httpx
from agentscope.message import TextBlock, VideoBlock
from agentscope.tool import ToolResponse
from qwenpaw.constant import DEFAULT_MEDIA_DIR
from qwenpaw.plugins import get_tool_config

logger = logging.getLogger(__name__)

_DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1"
_DEFAULT_TIMEOUT = 600.0
_VALID_RESOLUTIONS = {"720P", "1080P"}
_VALID_RATIOS = {"16:9", "9:16", "1:1", "4:3", "3:4"}
_IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

# The DashScope SDK's ``VideoSynthesis.call`` only forwards a fixed
# allow-list of input fields (``img_url``, ``ref_images_url``, etc.).
# happyhorse uses ``input.media`` — not in that allow-list — so SDK
# forwarding silently drops it. We submit + poll via raw httpx instead.
_VIDEO_SUBMIT_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/"
    "video-generation/video-synthesis"
)
_TASKS_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
_POLL_INTERVAL_S = 8.0

# Same retry classes as wan27 — TCP RESET / read timeout on long polls.
_RETRIABLE_NETWORK_EXCEPTIONS = (
    ConnectionError,
    ConnectionResetError,
    TimeoutError,
)
_RETRIABLE_NAMES = {
    "ConnectionError",
    "ConnectTimeout",
    "ReadTimeout",
    "ProtocolError",
    "RemoteDisconnected",
    "IncompleteRead",
    "ChunkedEncodingError",
}

_DASHSCOPE_LOCK = threading.Lock()


def _is_retriable_network_error(exc: BaseException) -> bool:
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, _RETRIABLE_NETWORK_EXCEPTIONS):
            return True
        if type(exc).__name__ in _RETRIABLE_NAMES:
            return True
        cause = exc.__cause__ or exc.__context__
        if cause is exc:
            break
        exc = cause  # type: ignore[assignment]
    return False


# ── config resolution ────────────────────────────────────────────────


def _extract_config(tool_config: dict) -> tuple[str, str, float]:
    api_key = tool_config.get("api_key", "")
    endpoint = tool_config.get("endpoint", "") or _DEFAULT_ENDPOINT
    raw = tool_config.get("timeout")
    timeout = (
        float(raw)
        if (raw is not None and float(raw) > 0)
        else _DEFAULT_TIMEOUT
    )
    return api_key, endpoint, timeout


def _resolve_tool_config(
    tool_name: str,
    api_key_override: Optional[str],
) -> Optional[tuple[str, str, float]]:
    if api_key_override and api_key_override.strip():
        return _extract_config({"api_key": api_key_override.strip()})
    cfg = get_tool_config(tool_name)
    if not cfg:
        return None
    return _extract_config(cfg)


# ── image resolver (local path → base64 data URL) ────────────────────


def _resolve_image_url(path_or_url: str) -> str:
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url
    p = Path(path_or_url)
    if not p.is_file():
        raise FileNotFoundError(f"Image file not found: {path_or_url}")
    ext = p.suffix.lower()
    if ext not in _IMAGE_MIME_TYPES:
        raise ValueError(
            f"Unsupported image format: {ext}. "
            f"Supported: {', '.join(_IMAGE_MIME_TYPES.keys())}",
        )
    mime = _IMAGE_MIME_TYPES[ext]
    data = base64.b64encode(p.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{data}"


# ── video download ───────────────────────────────────────────────────


async def _download_video(
    video_url: str,
    save_dir: Path,
    prefix: str,
    timeout: float,
) -> Path:
    save_dir.mkdir(parents=True, exist_ok=True)
    ts = int(time.time() * 1000)
    out = save_dir / f"{prefix}_{ts}.mp4"
    async with httpx.AsyncClient(timeout=timeout) as cli:
        async with cli.stream("GET", video_url) as resp:
            resp.raise_for_status()
            chunks = []
            async for chunk in resp.aiter_bytes(chunk_size=1024 * 1024):
                chunks.append(chunk)
    await asyncio.to_thread(out.write_bytes, b"".join(chunks))
    logger.info(f"Video saved to {out}")
    return out


# ── shared synchronous call wrapper with retry ───────────────────────


def _call_video_synthesis(
    api_key: str,
    endpoint: str,
    model: str,
    prompt: str,
    *,
    max_retries: int = 3,
    backoff_base_s: float = 5.0,
    **kwargs,
):
    """Call DashScope VideoSynthesis SDK with thread-safe endpoint
    setup + transient-network retry. Mirrors the wan27 helper.
    """
    import dashscope
    from dashscope import VideoSynthesis

    last_exc: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            with _DASHSCOPE_LOCK:
                dashscope.base_http_api_url = endpoint
                rsp = VideoSynthesis.call(
                    api_key=api_key,
                    model=model,
                    prompt=prompt,
                    **kwargs,
                )
            return rsp
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if not _is_retriable_network_error(exc):
                raise
            if attempt >= max_retries:
                logger.error(
                    f"happyhorse VideoSynthesis network error after "
                    f"{attempt + 1} attempts: {exc!r}",
                )
                raise
            sleep_s = backoff_base_s * (2**attempt)
            logger.warning(
                f"happyhorse transient network error "
                f"(attempt {attempt + 1}/{max_retries + 1}); "
                f"retrying in {sleep_s:.0f}s — {exc!r}",
            )
            time.sleep(sleep_s)
    assert last_exc is not None
    raise last_exc


def _check_for_task_error(rsp) -> Optional[str]:
    """Return a friendly error message if the task failed, else None.

    The DashScope SDK returns ``status_code=200`` even when the
    underlying async task ends with FAILED — the failure is encoded in
    ``rsp.output.task_status`` + ``rsp.output.message``. Our previous
    parser missed this and reported the symptom ("No video_url") instead
    of the actual upstream error.
    """
    status = getattr(rsp, "status_code", None)
    out = getattr(rsp, "output", None)
    task_status = getattr(out, "task_status", None) if out else None
    code = getattr(out, "code", None) if out else None
    msg = getattr(out, "message", None) if out else None

    if status and status != 200:
        detail = (
            getattr(rsp, "message", None)
            or getattr(rsp, "code", None)
            or "unknown error"
        )
        return f"DashScope {status}: {detail}"
    if task_status in ("FAILED", "FAILURE", "ERROR"):
        return f"task failed: code={code!r} message={msg!r}"
    if code and code != "Success":
        # Defensive — some endpoints embed a non-fatal code; treat as error.
        return f"task code={code!r} message={msg!r}"
    return None


def _error_response(msg: str) -> ToolResponse:
    return ToolResponse(content=[TextBlock(type="text", text=f"Error: {msg}")])


def _ok_response(local_path: Path) -> ToolResponse:
    return ToolResponse(
        content=[
            VideoBlock(
                type="video",
                source={"type": "url", "url": str(local_path)},
            ),
            TextBlock(
                type="text",
                text=(
                    f"Generated video saved to {local_path}\n"
                    f"Saved to: {local_path}"
                ),
            ),
        ],
    )


def _save_dir() -> Path:
    return Path(DEFAULT_MEDIA_DIR) / "happyhorse"


# ── public tools ─────────────────────────────────────────────────────


async def _submit_video_task(
    api_key: str,
    model: str,
    input_block: dict,
    parameters: dict,
) -> str:
    """Async-submit a video task; return task_id."""
    payload = {"model": model, "input": input_block, "parameters": parameters}
    headers = {
        "X-DashScope-Async": "enable",
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as cli:
        r = await cli.post(_VIDEO_SUBMIT_URL, json=payload, headers=headers)
    try:
        body = r.json()
    except Exception:
        body = {"raw": r.text[:500]}
    if r.status_code != 200:
        raise RuntimeError(
            f"submit failed {r.status_code}: "
            f"code={body.get('code')!r} msg={body.get('message')!r}",
        )
    task_id = (body.get("output") or {}).get("task_id")
    if not task_id:
        raise RuntimeError(f"no task_id in response: {body}")
    return task_id


async def _poll_video_task(
    api_key: str,
    task_id: str,
    *,
    deadline: float,
) -> str:
    """Poll the tasks endpoint until SUCCEEDED → returns the video URL.
    Raises on FAILED / timeout.
    """
    url = _TASKS_URL.format(task_id=task_id)
    headers = {"Authorization": f"Bearer {api_key}"}
    while True:
        if time.time() > deadline:
            raise TimeoutError(f"task {task_id} timed out")
        await asyncio.sleep(_POLL_INTERVAL_S)
        async with httpx.AsyncClient(timeout=30.0) as cli:
            r = await cli.get(url, headers=headers)
        try:
            body = r.json()
        except Exception:
            body = {"raw": r.text[:500]}
        if r.status_code != 200:
            raise RuntimeError(
                f"poll failed {r.status_code}: "
                f"code={body.get('code')!r} msg={body.get('message')!r}",
            )
        out = body.get("output") or {}
        status = out.get("task_status") or out.get("status")
        logger.info(f"happyhorse task {task_id}: {status}")
        if status in ("SUCCEEDED", "DONE", "SUCCESS"):
            video_url = out.get("video_url") or out.get("url")
            if not video_url:
                results = out.get("results") or []
                if results and isinstance(results, list):
                    first = results[0]
                    video_url = (
                        first.get("url") if isinstance(first, dict) else None
                    )
            if not video_url:
                raise RuntimeError(
                    f"task SUCCEEDED but no video_url in output: {out}",
                )
            return video_url
        if status in ("FAILED", "FAILURE", "ERROR"):
            raise RuntimeError(
                f"task failed: code={out.get('code')!r} "
                f"message={out.get('message')!r}",
            )


async def _run(
    *,
    tool_name: str,
    model: str,
    input_block: dict,
    parameters: dict,
    prefix: str,
    api_key: Optional[str],
) -> ToolResponse:
    resolved = _resolve_tool_config(tool_name, api_key)
    if resolved is None:
        return _error_response(
            "Tool not configured. Set your DashScope API key in the tool settings.",  # noqa: E501
        )
    key, _endpoint, timeout = resolved
    if not key:
        return _error_response("DashScope API key not configured.")
    try:
        task_id = await _submit_video_task(key, model, input_block, parameters)
    except Exception as exc:  # noqa: BLE001
        logger.exception("%s submit failed", tool_name)
        return _error_response(str(exc))
    deadline = time.time() + timeout
    try:
        video_url = await _poll_video_task(key, task_id, deadline=deadline)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc))
    try:
        local = await _download_video(video_url, _save_dir(), prefix, timeout)
    except Exception as exc:  # noqa: BLE001
        return _error_response(f"video download failed: {exc}")
    return _ok_response(local)


async def text_to_video_happyhorse(
    prompt: str,
    resolution: str = "720P",
    ratio: str = "16:9",
    duration: int = 5,
    negative_prompt: str = "",
    prompt_extend: bool = True,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video from a text prompt with HappyHorse 1.0 t2v."""
    if resolution not in _VALID_RESOLUTIONS:
        return _error_response(
            f"resolution must be one of {sorted(_VALID_RESOLUTIONS)}; "
            f"got {resolution!r}",
        )
    if ratio not in _VALID_RATIOS:
        return _error_response(
            f"ratio must be one of {sorted(_VALID_RATIOS)}; got {ratio!r}",
        )
    if duration < 2 or duration > 15:
        return _error_response("duration must be in [2, 15]")
    input_block = {"prompt": prompt}
    if negative_prompt:
        input_block["negative_prompt"] = negative_prompt
    parameters = {
        "resolution": resolution,
        "ratio": ratio,
        "duration": duration,
        "prompt_extend": prompt_extend,
    }
    logger.info(
        f"happyhorse t2v: resolution={resolution} ratio={ratio} duration={duration}s",  # noqa: E501
    )
    return await _run(
        tool_name="text_to_video_happyhorse",
        model="happyhorse-1.0-t2v",
        input_block=input_block,
        parameters=parameters,
        prefix="happyhorse_t2v",
        api_key=api_key,
    )


async def image_to_video_happyhorse(
    prompt: str,
    first_frame_url: str,
    resolution: str = "720P",
    duration: int = 5,
    prompt_extend: bool = True,
    ratio: str = "16:9",
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video starting from the given image with HappyHorse 1.0 i2v.

    Signature is drop-in compatible with ``image_to_video_wan``'s core
    fields, so the Creator bundle's Stage 3 can swap providers via the
    per-scene ``video_provider`` field without changing call sites.
    """
    if resolution not in _VALID_RESOLUTIONS:
        return _error_response(
            f"resolution must be one of {sorted(_VALID_RESOLUTIONS)}; "
            f"got {resolution!r}",
        )
    if duration < 2 or duration > 15:
        return _error_response("duration must be in [2, 15]")
    try:
        img_url = _resolve_image_url(first_frame_url)
    except Exception as exc:  # noqa: BLE001
        return _error_response(f"first_frame_url: {exc}")
    # happyhorse i2v expects ``input.media`` as a list of MediaItem
    # objects with shape ``{"type": "first_frame", "url": <img-or-data-url>}``.
    input_block = {
        "prompt": prompt,
        "media": [{"type": "first_frame", "url": img_url}],
    }
    parameters = {
        "resolution": resolution,
        "ratio": ratio,
        "duration": duration,
        "prompt_extend": prompt_extend,
    }
    logger.info(
        f"happyhorse i2v: resolution={resolution} duration={duration}s "
        f"(frame={first_frame_url})",
    )
    return await _run(
        tool_name="image_to_video_happyhorse",
        model="happyhorse-1.0-i2v",
        input_block=input_block,
        parameters=parameters,
        prefix="happyhorse_i2v",
        api_key=api_key,
    )


async def reference_to_video_happyhorse(
    prompt: str,
    ref_images_url: List[str],
    resolution: str = "720P",
    ratio: str = "16:9",
    duration: int = 5,
    prompt_extend: bool = True,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video with character/object reference images."""
    if not ref_images_url:
        return _error_response("ref_images_url must have at least one entry")
    try:
        resolved_imgs = [_resolve_image_url(u) for u in ref_images_url]
    except Exception as exc:  # noqa: BLE001
        return _error_response(f"ref_images_url: {exc}")
    input_block = {"prompt": prompt, "ref_images_url": resolved_imgs}
    parameters = {
        "resolution": resolution,
        "ratio": ratio,
        "duration": duration,
        "prompt_extend": prompt_extend,
    }
    logger.info(
        f"happyhorse r2v: {len(resolved_imgs)} refs, "
        f"resolution={resolution} ratio={ratio} duration={duration}s",
    )
    return await _run(
        tool_name="reference_to_video_happyhorse",
        model="happyhorse-1.0-r2v",
        input_block=input_block,
        parameters=parameters,
        prefix="happyhorse_r2v",
        api_key=api_key,
    )
