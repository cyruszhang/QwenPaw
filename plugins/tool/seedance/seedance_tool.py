# -*- coding: utf-8 -*-
"""Doubao Seedance 2.0 video tools via DashScope.

Unlike Wan / HappyHorse (which use the DashScope SDK's VideoSynthesis
class against ``/services/aigc/video-generation/video-synthesis``),
Seedance lives at the **model-evaluation** subpath:

    /api/v1/services/aigc/model-evaluation/async-inference/

with a chat-style content array carrying text + reference assets via
``role`` ("reference_image", "reference_video", "reference_audio").

The SDK doesn't wrap this endpoint, so we drive it manually with
``httpx``: submit → task_id → poll ``/api/v1/tasks/{id}`` until DONE
or FAILED → download the resulting MP4.

Three exported tools — surface mirrors wan27 / happyhorse so the
Creator Stage 3 dispatcher can swap providers without changing the
call site.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from pathlib import Path
from typing import List, Optional

import httpx
from agentscope.message import TextBlock, VideoBlock
from agentscope.tool import ToolResponse
from qwenpaw.constant import DEFAULT_MEDIA_DIR
from qwenpaw.plugins import get_tool_config

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 900.0  # 15 min — Seedance polls take a while
_POLL_INTERVAL_S = 8.0
_SUBMIT_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/"
    "model-evaluation/async-inference/"
)
_TASKS_URL = "https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
_MODEL_ID = "doubao.doubao-seedance-2-0-260128"

_VALID_RATIOS = {"16:9", "9:16", "1:1", "4:3", "3:4"}
_IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


# ── config resolution ────────────────────────────────────────────────


def _extract_config(tool_config: dict) -> tuple[str, float]:
    api_key = tool_config.get("api_key", "")
    raw = tool_config.get("timeout")
    timeout = (
        float(raw)
        if (raw is not None and float(raw) > 0)
        else _DEFAULT_TIMEOUT
    )
    return api_key, timeout


def _resolve_tool_config(
    tool_name: str,
    api_key_override: Optional[str],
) -> Optional[tuple[str, float]]:
    if api_key_override and api_key_override.strip():
        return _extract_config({"api_key": api_key_override.strip()})
    cfg = get_tool_config(tool_name)
    if not cfg:
        return None
    return _extract_config(cfg)


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
    return Path(DEFAULT_MEDIA_DIR) / "seedance"


# ── image resolver (local path → base64 data URL or URL passthrough) ─


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


# ── submit + poll ────────────────────────────────────────────────────


async def _submit_task(
    api_key: str,
    content: list[dict],
    *,
    ratio: str,
    duration: int,
    generate_audio: bool,
    watermark: bool,
) -> dict:
    """POST to the async-inference submit endpoint."""
    payload = {
        "model": _MODEL_ID,
        "input": {
            "content": content,
            "ratio": ratio,
            "duration": duration,
            "generate_audio": generate_audio,
            "watermark": watermark,
        },
        "parameters": {},
    }
    headers = {
        "X-DashScope-Async": "enable",
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as cli:
        r = await cli.post(_SUBMIT_URL, json=payload, headers=headers)
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
    return body


async def _poll_task(api_key: str, task_id: str, *, deadline: float) -> dict:
    """Poll the task endpoint until DONE / FAILED / timeout."""
    url = _TASKS_URL.format(task_id=task_id)
    headers = {"Authorization": f"Bearer {api_key}"}
    while True:
        if time.time() > deadline:
            raise TimeoutError(f"Seedance task {task_id} timed out after wait")
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
        logger.info(f"seedance task {task_id}: {status}")
        if status in ("SUCCEEDED", "DONE", "SUCCESS"):
            return body
        if status in ("FAILED", "FAILURE", "ERROR"):
            raise RuntimeError(
                f"task failed: {out.get('message') or out.get('error') or out}",  # noqa: E501
            )
        # else PENDING / RUNNING / IN_QUEUE — keep polling


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
    logger.info(f"Seedance video saved to {out}")
    return out


def _extract_video_url(task_result: dict) -> Optional[str]:
    """Pull the video URL out of the SUCCEEDED task body.

    Seedance's response shape (observed in production):
        output.data.content.video_url            ← primary
    Other shapes worth probing (defensive — different model versions
    have used these):
        output.video_url
        output.url
        output.results[0].url / .video_url
        output.result.url / .video_url
        output.data.video_url
    """
    out = task_result.get("output") or {}

    # 1. The primary observed shape for Seedance via DashScope:
    #    output.data.content.video_url
    data = out.get("data")
    if isinstance(data, dict):
        content = data.get("content")
        if isinstance(content, dict):
            u = content.get("video_url") or content.get("url")
            if isinstance(u, str) and u.startswith(("http://", "https://")):
                return u
        # Some variants put it directly under output.data.
        u = data.get("video_url") or data.get("url")
        if isinstance(u, str) and u.startswith(("http://", "https://")):
            return u

    # 2. Older / simpler shapes — same as before.
    for k in ("video_url", "results", "result", "url"):
        v = out.get(k)
        if isinstance(v, str) and v.startswith(("http://", "https://")):
            return v
        if isinstance(v, list) and v:
            first = v[0]
            if isinstance(first, str) and first.startswith(
                ("http://", "https://"),
            ):
                return first
            if isinstance(first, dict):
                u = first.get("url") or first.get("video_url")
                if u:
                    return u
        if isinstance(v, dict):
            u = v.get("url") or v.get("video_url")
            if u:
                return u
    return None


# ── public tools ─────────────────────────────────────────────────────


async def _generate(
    *,
    tool_name: str,
    content: list[dict],
    api_key: Optional[str],
    ratio: str,
    duration: int,
    generate_audio: bool,
    watermark: bool,
    prefix: str,
) -> ToolResponse:
    resolved = _resolve_tool_config(tool_name, api_key)
    if resolved is None:
        return _error_response(
            "Tool not configured. Set your DashScope API key in the tool settings.",  # noqa: E501
        )
    key, timeout = resolved
    if not key:
        return _error_response("DashScope API key not configured.")
    if ratio not in _VALID_RATIOS:
        return _error_response(
            f"ratio must be one of {sorted(_VALID_RATIOS)}; got {ratio!r}",
        )
    if duration < 2 or duration > 30:
        return _error_response("duration must be in [2, 30]")
    try:
        submit_body = await _submit_task(
            key,
            content,
            ratio=ratio,
            duration=duration,
            generate_audio=generate_audio,
            watermark=watermark,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Seedance submit failed")
        return _error_response(str(exc))
    task_id = submit_body["output"]["task_id"]
    deadline = time.time() + timeout
    try:
        result = await _poll_task(key, task_id, deadline=deadline)
    except Exception as exc:  # noqa: BLE001
        return _error_response(str(exc))
    video_url = _extract_video_url(result)
    if not video_url:
        return _error_response(
            f"task succeeded but no video URL in response: {result}",
        )
    try:
        local = await _download_video(video_url, _save_dir(), prefix, timeout)
    except Exception as exc:  # noqa: BLE001
        return _error_response(f"video download failed: {exc}")
    return _ok_response(local)


async def text_to_video_seedance(
    prompt: str,
    ratio: str = "16:9",
    duration: int = 5,
    generate_audio: bool = False,
    watermark: bool = False,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video from a text prompt with Seedance 2.0."""
    content = [{"type": "text", "text": prompt}]
    return await _generate(
        tool_name="text_to_video_seedance",
        content=content,
        api_key=api_key,
        ratio=ratio,
        duration=duration,
        generate_audio=generate_audio,
        watermark=watermark,
        prefix="seedance_t2v",
    )


async def image_to_video_seedance(
    prompt: str,
    first_frame_url: str,
    # ignored — Seedance doesn't take resolution/prompt_extend the same
    # way Wan does; kept for signature compatibility with image_to_video_wan
    resolution: str = "720P",
    duration: int = 5,
    prompt_extend: bool = True,
    ratio: str = "16:9",
    generate_audio: bool = False,
    watermark: bool = False,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video starting from the given image with Seedance 2.0.

    Signature mirrors ``image_to_video_wan`` so the Creator Stage 3
    dispatcher can swap providers without rewriting call sites. The
    extra Seedance-specific knobs (ratio / generate_audio / watermark)
    have sensible defaults.
    """
    del resolution, prompt_extend  # Seedance doesn't honor these directly
    try:
        img_url = _resolve_image_url(first_frame_url)
    except Exception as exc:  # noqa: BLE001
        return _error_response(f"first_frame_url: {exc}")
    content: List[dict] = [
        {"type": "text", "text": prompt},
        {
            "type": "image_url",
            "image_url": {"url": img_url},
            "role": "reference_image",
        },
    ]
    return await _generate(
        tool_name="image_to_video_seedance",
        content=content,
        api_key=api_key,
        ratio=ratio,
        duration=duration,
        generate_audio=generate_audio,
        watermark=watermark,
        prefix="seedance_i2v",
    )


async def reference_to_video_seedance(
    prompt: str,
    ref_images_url: Optional[List[str]] = None,
    ref_video_url: str = "",
    ref_audio_url: str = "",
    ratio: str = "16:9",
    duration: int = 5,
    generate_audio: bool = True,
    watermark: bool = False,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate a video with multi-modal references — Seedance's strength.

    Anything left empty / None is omitted from the content array.
    """
    content: list[dict] = [{"type": "text", "text": prompt}]
    for img in ref_images_url or []:
        try:
            url = _resolve_image_url(img)
        except Exception as exc:  # noqa: BLE001
            return _error_response(f"ref_images_url: {exc}")
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": url},
                "role": "reference_image",
            },
        )
    if ref_video_url:
        if not ref_video_url.startswith(("http://", "https://")):
            return _error_response("ref_video_url must be an http(s) URL")
        content.append(
            {
                "type": "video_url",
                "video_url": {"url": ref_video_url},
                "role": "reference_video",
            },
        )
    if ref_audio_url:
        if not ref_audio_url.startswith(("http://", "https://")):
            return _error_response("ref_audio_url must be an http(s) URL")
        content.append(
            {
                "type": "audio_url",
                "audio_url": {"url": ref_audio_url},
                "role": "reference_audio",
            },
        )
    return await _generate(
        tool_name="reference_to_video_seedance",
        content=content,
        api_key=api_key,
        ratio=ratio,
        duration=duration,
        generate_audio=generate_audio,
        watermark=watermark,
        prefix="seedance_r2v",
    )
