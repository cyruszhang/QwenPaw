# -*- coding: utf-8 -*-
# pylint: disable=too-many-return-statements,too-many-branches
"""GPT Image 2 image generation tool."""

import base64
import json
import logging
import time
from pathlib import Path
from typing import List, Optional

import httpx
from agentscope.message import ImageBlock, TextBlock
from agentscope.tool import ToolResponse
from qwenpaw.constant import DEFAULT_MEDIA_DIR
from qwenpaw.plugins import get_tool_config

logger = logging.getLogger(__name__)


def _flush_logs() -> None:
    """Force-flush all of the root logger's FileHandlers.

    Python's FileHandler is block-buffered by default, so a single
    ``logger.info()`` mid-call doesn't appear in the log file until
    a few more writes accumulate or the call completes. For long-
    running eval-cluster requests (3-10 min) that buffering hides
    progress and makes debugging awful — explicitly flushing after
    key log lines surfaces them in real time.
    """
    for h in logging.getLogger().handlers:
        try:
            h.flush()
        except Exception:  # noqa: BLE001
            pass
    # Also flush this module's own logger's handlers (if any are
    # configured separately from the root).
    for h in logger.handlers:
        try:
            h.flush()
        except Exception:  # noqa: BLE001
            pass


def _resolve_tool_config(
    tool_name: str,
    api_key_override: Optional[str],
    default_endpoint: str,
    default_timeout: float = 480.0,
) -> tuple[str, str, float] | None:
    """Resolve (api_key, endpoint, timeout), preferring an explicit override.

    Same dual-path pattern as qwen-image / wan27 / cosyvoice / qwen-vl:
    when ``api_key_override`` is provided, bypass the agent-context
    ``get_tool_config`` lookup so the tool is callable from standalone
    scripts (benchmarks, CLIs) without an active agent.

    ``default_timeout`` lets callers pick a different floor — the
    DashScope eval-cluster path needs more headroom (broker queue +
    model gen + OSS fetch) than OpenAI-direct.
    """
    if api_key_override and api_key_override.strip():
        return api_key_override.strip(), default_endpoint, default_timeout

    tool_config = get_tool_config(tool_name)
    if not tool_config:
        return None
    api_key = tool_config.get("api_key", "")
    endpoint = tool_config.get("endpoint") or default_endpoint
    timeout_raw = tool_config.get("timeout")
    timeout = (
        float(timeout_raw)
        if timeout_raw and float(timeout_raw) > 0
        else default_timeout
    )
    return api_key, endpoint, timeout


async def generate_image_gpt(
    prompt: str,
    size: str = "1024x1024",
    quality: str = "auto",
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Generate an image using OpenAI GPT Image 2 model.

    This tool uses OpenAI's state-of-the-art GPT Image 2 model to
    generate high-quality images from text descriptions.

    Args:
        prompt (str):
            Text description of the image to generate. Be specific
            and detailed for best results.
        size (str, optional):
            Output image size. Options: "1024x1024", "1024x1792",
            "1792x1024". Defaults to "1024x1024".
        quality (str, optional):
            Image quality level. Options: "low", "medium", "high", "auto".
            - low: Faster generation, lower quality
            - medium: Balanced quality and speed
            - high: Best quality, slower generation
            - auto: Automatically choose based on prompt (default)

    Returns:
        ToolResponse:
            Contains the generated image and metadata.

    Example:
        >>> result = await generate_image_gpt(
        ...     prompt="A serene mountain landscape at sunset",
        ...     size="1792x1024",
        ... )
    """
    try:
        resolved = _resolve_tool_config(
            "generate_image_gpt", api_key,
            default_endpoint="https://api.openai.com/v1/images/generations",
        )
        if resolved is None:
            return ToolResponse(content=[TextBlock(type="text", text=(
                "Error: Tool not configured. Please set your API key."
            ))])
        api_key, endpoint, timeout = resolved
        if not api_key:
            return ToolResponse(content=[TextBlock(type="text", text=(
                "Error: OpenAI API key not configured."
            ))])

        # Validate parameters
        valid_sizes = {"1024x1024", "1024x1792", "1792x1024"}
        if size not in valid_sizes:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid size '{size}'. "
                            f"Must be one of: {', '.join(valid_sizes)}"
                        ),
                    ),
                ],
            )

        # Validate quality parameter
        # GPT Image 2 supports: low, medium, high, auto
        valid_quality = {"low", "medium", "high", "auto"}
        if quality not in valid_quality:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid quality '{quality}'. "
                            f"Must be one of: "
                            f"{', '.join(sorted(valid_quality))}"
                        ),
                    ),
                ],
            )

        # Call OpenAI API
        logger.info(
            f"Generating image with GPT Image 2: "
            f"size={size}, quality={quality}",
        )

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-image-2",
                    "prompt": prompt,
                    "size": size,
                    "quality": quality,
                    "n": 1,
                },
            )

        if response.status_code != 200:
            error_msg = f"OpenAI API error: {response.status_code}"
            try:
                error_data = response.json()
                if "error" in error_data:
                    error_msg += f" - {error_data['error'].get('message')}"
            except Exception:
                pass
            logger.error(error_msg)
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: {error_msg}",
                    ),
                ],
            )

        # Parse response
        # GPT Image 2 returns b64_json, not url
        data = response.json()
        b64_json = data["data"][0]["b64_json"]

        logger.info("Image generated successfully (base64)")

        # Save image to local file in DEFAULT_MEDIA_DIR

        media_dir = DEFAULT_MEDIA_DIR / "gpt_image2"
        media_dir.mkdir(parents=True, exist_ok=True)

        # Generate unique filename using timestamp
        timestamp = int(time.time() * 1000)
        filename = f"gpt_image2_{timestamp}.png"
        image_path = media_dir / filename

        # Decode base64 and save to file
        try:
            image_data = base64.b64decode(b64_json)
            image_path.write_bytes(image_data)
            logger.info(f"Image saved to {image_path}")
        except Exception as e:
            logger.error(f"Failed to save image: {e}")
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: Failed to save image - {str(e)}",
                    ),
                ],
            )

        # Return image with local file path
        return ToolResponse(
            content=[
                ImageBlock(
                    type="image",
                    source={"type": "url", "url": str(image_path)},
                ),
                TextBlock(
                    type="text",
                    text=(
                        f"Generated image using GPT Image 2\n"
                        f"Prompt: {prompt}\n"
                        f"Size: {size}, Quality: {quality}\n"
                        f"Saved to: {image_path}"
                    ),
                ),
            ],
        )

    except httpx.TimeoutException:
        logger.error("Image generation timed out")
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Error: Image generation timed out. "
                        "Please try again."
                    ),
                ),
            ],
        )
    except Exception as e:
        logger.error(f"Image generation failed: {e}", exc_info=True)
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=f"Error: Image generation failed - {str(e)}",
                ),
            ],
        )


async def edit_image_gpt(  # pylint: disable=too-many-statements
    prompt: str,
    reference_images: List[str],
    size: str = "1024x1024",
    quality: str = "auto",
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Edit or generate image using reference images with GPT Image 2.

    This tool uses OpenAI's GPT Image 2 model to generate or edit images
    based on one or more reference images and a text prompt.

    Note: gpt-image-2 always processes images at high fidelity and does
    not support the input_fidelity parameter.

    Args:
        prompt (str):
            Text description of the desired image edit or generation.
        reference_images (List[str]):
            List of reference images (1-16 images). Each item can be:
            - Web URL (https://example.com/image.png)
            - Local file path (/path/to/image.png)
            Note: Local files will be converted to base64 automatically.
        size (str, optional):
            Output image size. Options: "1024x1024", "1024x1536",
            "1536x1024", "auto". Defaults to "1024x1024".
        quality (str, optional):
            Image quality level. Options: "low", "medium", "high", "auto".
            Defaults to "auto".

    Returns:
        ToolResponse:
            Contains the generated/edited image and metadata.

    Example:
        >>> result = await edit_image_gpt(
        ...     prompt="Make this photo look like a watercolor painting",
        ...     reference_images=["/path/to/photo.jpg"],
        ...     quality="high"
        ... )
    """
    try:
        # Validate reference_images
        if not reference_images:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: reference_images is required. "
                            "Please provide at least one reference image."
                        ),
                    ),
                ],
            )

        if len(reference_images) > 16:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Too many reference images. "
                            f"Maximum is 16, got {len(reference_images)}."
                        ),
                    ),
                ],
            )

        resolved = _resolve_tool_config(
            "edit_image_gpt", api_key,
            default_endpoint="https://api.openai.com/v1/images/edits",
        )
        if resolved is None:
            return ToolResponse(content=[TextBlock(type="text", text=(
                "Error: Tool not configured. Please set your API key."
            ))])
        api_key, endpoint, timeout = resolved
        if not api_key:
            return ToolResponse(content=[TextBlock(type="text", text=(
                "Error: OpenAI API key not configured."
            ))])

        # Validate parameters
        valid_sizes = {"auto", "1024x1024", "1024x1536", "1536x1024"}
        if size not in valid_sizes:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid size '{size}'. "
                            f"Must be one of: {', '.join(valid_sizes)}"
                        ),
                    ),
                ],
            )

        valid_quality = {"low", "medium", "high", "auto"}
        if quality not in valid_quality:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid quality '{quality}'. "
                            f"Must be one of: "
                            f"{', '.join(sorted(valid_quality))}"
                        ),
                    ),
                ],
            )

        # Process reference images
        try:
            images_payload = []
            for img_path in reference_images:
                img_dict = _process_image_url(img_path)
                images_payload.append(img_dict)
        except FileNotFoundError as e:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: Reference image not found - {str(e)}",
                    ),
                ],
            )
        except Exception as e:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Failed to process reference images - "
                            f"{str(e)}"
                        ),
                    ),
                ],
            )

        # Call OpenAI API
        logger.info(
            f"Editing image with GPT Image 2: {len(reference_images)} "
            f"reference images, size={size}, quality={quality}",
        )

        # Note: gpt-image-2 does not support input_fidelity parameter
        # It always processes images at high fidelity
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                endpoint,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-image-2",
                    "images": images_payload,
                    "prompt": prompt,
                    "size": size,
                    "quality": quality,
                    "n": 1,
                },
            )

        if response.status_code != 200:
            error_msg = f"OpenAI API error: {response.status_code}"
            try:
                error_data = response.json()
                if "error" in error_data:
                    error_msg += f" - {error_data['error'].get('message')}"
            except Exception:
                pass
            logger.error(error_msg)
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: {error_msg}",
                    ),
                ],
            )

        # Parse response
        data = response.json()
        b64_json = data["data"][0]["b64_json"]

        logger.info("Image edited successfully (base64)")

        # Save image to local file
        media_dir = DEFAULT_MEDIA_DIR / "gpt_image2"
        media_dir.mkdir(parents=True, exist_ok=True)

        timestamp = int(time.time() * 1000)
        filename = f"gpt_image2_edit_{timestamp}.png"
        image_path = media_dir / filename

        # Decode base64 and save to file
        try:
            image_data = base64.b64decode(b64_json)
            image_path.write_bytes(image_data)
            logger.info(f"Image saved to {image_path}")
        except Exception as e:
            logger.error(f"Failed to save image: {e}")
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: Failed to save image - {str(e)}",
                    ),
                ],
            )

        # Return image with local file path
        return ToolResponse(
            content=[
                ImageBlock(
                    type="image",
                    source={"type": "url", "url": str(image_path)},
                ),
                TextBlock(
                    type="text",
                    text=(
                        f"Edited image using GPT Image 2\n"
                        f"Prompt: {prompt}\n"
                        f"Reference images: {len(reference_images)}\n"
                        f"Size: {size}, Quality: {quality}\n"
                        f"Saved to: {image_path}"
                    ),
                ),
            ],
        )

    except httpx.TimeoutException:
        logger.error("Image editing timed out")
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=("Error: Image editing timed out. Please try again."),
                ),
            ],
        )
    except Exception as e:
        logger.error(f"Image editing failed: {e}", exc_info=True)
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=f"Error: Image editing failed - {str(e)}",
                ),
            ],
        )


# ── DashScope eval-cluster backend (brokered OpenAI gpt-image-2) ────
#
# The Aliyun eval cluster brokers OpenAI's gpt-image-2 behind a custom
# chat-completions-style URL with a non-standard body shape:
#
#     POST https://eval.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
#     Authorization: Bearer <DASHSCOPE_API_KEY>
#     {
#       "model": "azure.gpt-image-2",
#       "prompt": "...",
#       "image": ["<url or data URI>", ...]   # optional, for edits
#       "size": "1024x1024",
#       "n": 1
#     }
#
# Response: ``data[0].b64_json`` is a signed Aliyun OSS URL (despite
# the field name), valid ~24h. Download → save → return local path.
# Access requires the caller's egress IP to be whitelisted on the
# eval cluster (RBAC-gated at istio gateway).


_EVAL_ENDPOINT = (
    "https://eval.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
)
_EVAL_MODEL = "azure.gpt-image-2"
# `stream: true` on this endpoint changes the RESPONSE FORMAT (SSE
# `data: {...}` lines) but does NOT make gpt-image-2 emit progress
# chunks — the upstream model holds the connection silent until the
# final image is ready, and the broker passes that silence through.
# So this is effectively a "max silent wait" knob, same as a blocking
# POST's read timeout. 600s = 10 min, covers normal slow gens
# (multi-ref edits routinely 3-5 min); failures above that are likely
# true stalls or upstream quota issues worth investigating.
_EVAL_DEFAULT_TIMEOUT = 600.0
# How many times to retry on a connection-level timeout. The broker
# does intermittently stall; one retry catches most flakes without
# pretending we have a real reconnect protocol.
_EVAL_RETRY_ON_TIMEOUT = 1


def _to_url_or_data_uri(image_path: str) -> str:
    """Convert a local file path to a base64 data URI; pass HTTP URLs
    through unchanged. The eval cluster accepts either form in the
    ``image`` array.
    """
    if image_path.startswith(("http://", "https://")):
        return image_path
    path_obj = Path(image_path)
    if not path_obj.exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")
    if not path_obj.is_file():
        raise ValueError(f"Not a file: {image_path}")
    ext = path_obj.suffix.lower()
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext)
    if not mime:
        raise ValueError(
            f"Unsupported image format: {ext}. Supported: "
            f"{', '.join(['.png', '.jpg', '.jpeg', '.webp'])}",
        )
    data = base64.b64encode(path_obj.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{data}"


class _EvalNon200Error(RuntimeError):
    """Non-200 response from the eval cluster — surface to caller
    without retry. ``str(self)`` is the user-visible message."""


async def _eval_post_once(
    *,
    payload: dict,
    api_key: str,
    httpx_timeout: httpx.Timeout,
) -> tuple[dict, float]:
    """One streaming POST attempt. Returns (body_dict, ttfb_seconds).

    Raises:
      - httpx.TimeoutException: caller should retry per policy.
      - _EvalNon200Error: non-2xx response; caller surfaces the message.
      - RuntimeError: stream ended without a parseable data chunk.
    """
    t_start = time.time()
    first_byte_at: Optional[float] = None
    body: Optional[dict] = None

    async with httpx.AsyncClient(timeout=httpx_timeout) as client:
        async with client.stream(
            "POST", _EVAL_ENDPOINT,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json=payload,
        ) as resp:
            if resp.status_code != 200:
                err_body = await resp.aread()
                snippet = err_body.decode("utf-8", "replace")[:600]
                raise _EvalNon200Error(
                    f"DashScope eval API error: {resp.status_code} - "
                    f"{snippet}",
                )

            async for line in resp.aiter_lines():
                if first_byte_at is None:
                    first_byte_at = time.time()
                if not line or not line.startswith("data:"):
                    continue
                payload_text = line[5:].strip()
                if not payload_text or payload_text == "[DONE]":
                    continue
                try:
                    body = json.loads(payload_text)
                except json.JSONDecodeError as e:
                    logger.warning(
                        f"SSE chunk not JSON ({e}): {payload_text[:200]}",
                    )

    if body is None:
        raise RuntimeError("eval stream ended without a data event")
    return body, (first_byte_at or t_start)


async def _eval_call_and_save(
    *,
    payload: dict,
    api_key: str,
    timeout: float,
    file_prefix: str,
) -> ToolResponse:
    """POST to the eval endpoint (streaming) and download the returned image.

    Streams via ``stream: true`` SSE. gpt-image-2 itself doesn't emit
    progressive frames — the broker holds silent until OpenAI returns,
    so ``timeout`` here is effectively "max silent wait." Retry once
    on timeout (broker stalls are real and often transient). Logs
    time-to-first-byte and total wall time per attempt for debugging.
    """
    payload = {**payload, "stream": True}
    httpx_timeout = httpx.Timeout(
        connect=30.0,
        read=timeout,
        write=60.0,
        pool=30.0,
    )
    attempts = _EVAL_RETRY_ON_TIMEOUT + 1
    body: Optional[dict] = None
    last_timeout: Optional[BaseException] = None

    for attempt in range(1, attempts + 1):
        t_attempt_start = time.time()
        logger.info(
            f"[eval] attempt {attempt}/{attempts} starting "
            f"(read-timeout={timeout}s, model={payload.get('model')}, "
            f"image_refs={len(payload.get('image') or [])})",
        )
        _flush_logs()
        try:
            body, first_byte_at = await _eval_post_once(
                payload=payload, api_key=api_key,
                httpx_timeout=httpx_timeout,
            )
            elapsed = time.time() - t_attempt_start
            ttfb = first_byte_at - t_attempt_start
            logger.info(
                f"[eval] attempt {attempt}/{attempts} OK — "
                f"ttfb={ttfb:.1f}s total={elapsed:.1f}s",
            )
            _flush_logs()
            break
        except httpx.TimeoutException as exc:
            elapsed = time.time() - t_attempt_start
            last_timeout = exc
            logger.warning(
                f"[eval] attempt {attempt}/{attempts} TIMED OUT after "
                f"{elapsed:.0f}s (read-timeout={timeout}s); "
                + ("retrying..." if attempt < attempts else "giving up"),
            )
            _flush_logs()
        except _EvalNon200Error as exc:
            logger.error(f"[eval] non-200: {exc}")
            _flush_logs()
            return ToolResponse(content=[TextBlock(
                type="text", text=f"Error: {exc}",
            )])
        except RuntimeError as exc:
            logger.error(f"[eval] stream error: {exc}")
            _flush_logs()
            return ToolResponse(content=[TextBlock(
                type="text", text=f"Error: {exc}",
            )])

    if body is None:
        if last_timeout is not None:
            return ToolResponse(content=[TextBlock(
                type="text",
                text=(
                    f"Error: eval cluster timed out after "
                    f"{attempts} attempt(s) of ~{timeout:.0f}s each. "
                    "Broker is either backlogged or the request is "
                    "malformed. Click Run again to retry."
                ),
            )])
        return ToolResponse(content=[TextBlock(
            type="text",
            text="Error: eval call failed without a recognized error.",
        )])

    data_list = body.get("data") or []
    if not data_list:
        return ToolResponse(content=[TextBlock(
            type="text",
            text=f"Error: eval response had no data: {body}",
        )])
    payload_field = data_list[0].get("b64_json") or ""
    if not payload_field:
        return ToolResponse(content=[TextBlock(
            type="text",
            text=f"Error: eval response missing b64_json: {body}",
        )])

    # ``b64_json`` may actually be a signed OSS URL (despite the
    # field name) — DashScope returns either depending on its size.
    if payload_field.startswith(("http://", "https://")):
        async with httpx.AsyncClient(timeout=timeout) as client:
            img_resp = await client.get(payload_field)
        if img_resp.status_code != 200:
            return ToolResponse(content=[TextBlock(
                type="text",
                text=(
                    f"Error: failed to download generated image from "
                    f"{payload_field[:120]}: {img_resp.status_code}"
                ),
            )])
        img_bytes = img_resp.content
    else:
        try:
            img_bytes = base64.b64decode(payload_field)
        except Exception as e:  # noqa: BLE001
            return ToolResponse(content=[TextBlock(
                type="text",
                text=f"Error: could not decode b64_json: {e}",
            )])

    media_dir = DEFAULT_MEDIA_DIR / "gpt_image2"
    media_dir.mkdir(parents=True, exist_ok=True)
    timestamp = int(time.time() * 1000)
    image_path = media_dir / f"{file_prefix}_{timestamp}.png"
    image_path.write_bytes(img_bytes)
    logger.info(f"Eval image saved to {image_path}")

    usage = body.get("usage") or {}
    size_actual = body.get("size") or "?"
    return ToolResponse(content=[
        ImageBlock(
            type="image",
            source={"type": "url", "url": str(image_path)},
        ),
        TextBlock(
            type="text",
            text=(
                f"Generated image via DashScope eval cluster "
                f"({_EVAL_MODEL})\n"
                f"Prompt: {payload.get('prompt', '')[:200]}\n"
                f"Size: {size_actual}\n"
                f"Tokens: {usage.get('total_tokens', '?')}\n"
                f"Saved to: {image_path}"
            ),
        ),
    ])


async def generate_image_gpt_eval(
    prompt: str,
    size: str = "1024x1024",
    quality: str = "auto",
    n: int = 1,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """T2I via DashScope's eval cluster brokering OpenAI gpt-image-2.

    Uses ``DASHSCOPE_API_KEY`` (NOT ``OPENAI_API_KEY``). The caller's
    egress IP must be whitelisted on the eval cluster.
    """
    try:
        resolved = _resolve_tool_config(
            "generate_image_gpt_eval", api_key,
            default_endpoint=_EVAL_ENDPOINT,
            default_timeout=_EVAL_DEFAULT_TIMEOUT,
        )
        if resolved is None:
            return ToolResponse(content=[TextBlock(
                type="text",
                text="Error: Tool not configured.",
            )])
        api_key, _, timeout = resolved
        if not api_key:
            return ToolResponse(content=[TextBlock(
                type="text",
                text="Error: DashScope API key not configured.",
            )])

        payload = {
            "model": _EVAL_MODEL,
            "prompt": prompt,
            "size": size,
            "n": n,
        }
        if quality and quality != "auto":
            payload["quality"] = quality
        logger.info(
            f"Generating image via eval cluster: size={size}, n={n}",
        )
        _flush_logs()
        return await _eval_call_and_save(
            payload=payload, api_key=api_key, timeout=timeout,
            file_prefix="gpt_image2_eval",
        )
    except httpx.TimeoutException:
        return ToolResponse(content=[TextBlock(
            type="text",
            text="Error: eval cluster timed out.",
        )])
    except Exception as e:  # noqa: BLE001
        logger.error(f"eval gen failed: {e}", exc_info=True)
        return ToolResponse(content=[TextBlock(
            type="text", text=f"Error: eval gen failed - {e}",
        )])


async def edit_image_gpt_eval(
    prompt: str,
    reference_images: List[str],
    size: str = "1024x1024",
    quality: str = "auto",
    n: int = 1,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Multi-ref edit via DashScope eval brokering OpenAI gpt-image-2.

    Reference images are accepted as HTTP URLs (passed through) or
    local file paths (converted to base64 data URIs). The eval
    cluster accepts both.
    """
    try:
        if not reference_images:
            return ToolResponse(content=[TextBlock(
                type="text",
                text="Error: reference_images is required.",
            )])

        resolved = _resolve_tool_config(
            "edit_image_gpt_eval", api_key,
            default_endpoint=_EVAL_ENDPOINT,
            default_timeout=_EVAL_DEFAULT_TIMEOUT,
        )
        if resolved is None:
            return ToolResponse(content=[TextBlock(
                type="text",
                text="Error: Tool not configured.",
            )])
        api_key, _, timeout = resolved
        if not api_key:
            return ToolResponse(content=[TextBlock(
                type="text",
                text="Error: DashScope API key not configured.",
            )])

        try:
            image_payload = [_to_url_or_data_uri(p) for p in reference_images]
        except FileNotFoundError as e:
            return ToolResponse(content=[TextBlock(
                type="text",
                text=f"Error: reference image not found - {e}",
            )])
        except (ValueError, Exception) as e:  # noqa: BLE001
            return ToolResponse(content=[TextBlock(
                type="text",
                text=f"Error: failed to process reference images - {e}",
            )])

        payload = {
            "model": _EVAL_MODEL,
            "prompt": prompt,
            "image": image_payload,
            "size": size,
            "n": n,
        }
        if quality and quality != "auto":
            payload["quality"] = quality
        logger.info(
            f"Editing image via eval cluster: {len(reference_images)} "
            f"refs, size={size}",
        )
        _flush_logs()
        return await _eval_call_and_save(
            payload=payload, api_key=api_key, timeout=timeout,
            file_prefix="gpt_image2_eval_edit",
        )
    except httpx.TimeoutException:
        return ToolResponse(content=[TextBlock(
            type="text",
            text="Error: eval cluster timed out.",
        )])
    except Exception as e:  # noqa: BLE001
        logger.error(f"eval edit failed: {e}", exc_info=True)
        return ToolResponse(content=[TextBlock(
            type="text", text=f"Error: eval edit failed - {e}",
        )])


def _process_image_url(image_path: str) -> dict:
    """Convert image path/URL to API format.

    Args:
        image_path: Web URL or local file path

    Returns:
        dict: {"image_url": "..."} for API payload

    Raises:
        FileNotFoundError: If local file doesn't exist
        ValueError: If file format is not supported
    """
    if image_path.startswith(("http://", "https://")):
        # Web URL - use directly
        return {"image_url": image_path}

    # Local file - convert to base64 data URL
    path_obj = Path(image_path)

    if not path_obj.exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")

    if not path_obj.is_file():
        raise ValueError(f"Not a file: {image_path}")

    # Detect MIME type from extension
    ext = path_obj.suffix.lower()
    mime_type_map = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }

    if ext not in mime_type_map:
        raise ValueError(
            f"Unsupported image format: {ext}. "
            f"Supported formats: {', '.join(mime_type_map.keys())}",
        )

    mime_type = mime_type_map[ext]

    # Read and encode image
    with open(path_obj, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    return {"image_url": f"data:{mime_type};base64,{image_data}"}
