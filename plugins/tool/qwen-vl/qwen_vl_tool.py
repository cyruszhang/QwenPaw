# -*- coding: utf-8 -*-
# pylint: disable=too-many-return-statements,too-many-branches
# pylint: disable=too-many-statements,too-many-locals
"""Qwen-VL image Q&A tool.

For validation use cases: ask yes/no questions about generated images
to check prop presence, composition rules, forbidden content, etc.

Pricing: ~$0.001 per question on qwen-vl-max-latest. Per-panel
validation with 5-10 questions costs ~$0.05 — significantly less than
the $0.60 wasted on a Wan animation against a bad frame.
"""

import asyncio
import base64
import logging
import threading
import time
from pathlib import Path
from typing import Optional

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse
from qwenpaw.plugins import get_tool_config

logger = logging.getLogger(__name__)


# Transient-network exception classifier — same shape as wan27_tool's.
# DashScope's MultiModalConversation occasionally drops the connection
# mid-request (TCP RESET, ProtocolError, executor-thread-stall), which
# without retry surfaces as Errno 54 / "Connection aborted" / timeout.
_RETRIABLE_BASE_EXCEPTIONS = (
    ConnectionError,
    ConnectionResetError,
    TimeoutError,
    asyncio.TimeoutError,
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


def _is_retriable_network_error(exc: BaseException) -> bool:
    """Walk __cause__/__context__ chain and detect transient network failures."""
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        seen.add(id(exc))
        if isinstance(exc, _RETRIABLE_BASE_EXCEPTIONS):
            return True
        if type(exc).__name__ in _RETRIABLE_NAMES:
            return True
        cause = exc.__cause__ or exc.__context__
        if cause is exc:
            break
        exc = cause   # type: ignore[assignment]
    return False

# Thread lock to protect dashscope global base_http_api_url setting.
_DASHSCOPE_LOCK = threading.Lock()

_DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1"
_DEFAULT_TIMEOUT = 180.0   # bumped from 60s — DashScope can be slow under load
_DEFAULT_MODEL = "qwen-vl-max-latest"

_VALID_MODELS = {
    "qwen-vl-max-latest",
    "qwen-vl-max",
    "qwen-vl-plus-latest",
    "qwen-vl-plus",
}

_IMAGE_MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def _resolve_image_url(path_or_url: str) -> str:
    """Convert local file path → base64 data URL; pass through HTTP URLs."""
    if path_or_url.startswith(("http://", "https://")):
        return path_or_url

    path_obj = Path(path_or_url)
    if not path_obj.exists():
        raise FileNotFoundError(f"Image file not found: {path_or_url}")
    if not path_obj.is_file():
        raise ValueError(f"Not a file: {path_or_url}")

    ext = path_obj.suffix.lower()
    if ext not in _IMAGE_MIME_TYPES:
        raise ValueError(
            f"Unsupported image format: {ext}. "
            f"Supported: {', '.join(_IMAGE_MIME_TYPES.keys())}",
        )
    mime_type = _IMAGE_MIME_TYPES[ext]
    with open(path_obj, "rb") as f:
        data = base64.b64encode(f.read()).decode("utf-8")
    return f"data:{mime_type};base64,{data}"


def _extract_config(tool_config: dict) -> tuple[str, str, float, str]:
    """Extract api_key, endpoint, timeout, model from tool config."""
    api_key = tool_config.get("api_key", "")
    endpoint = tool_config.get("endpoint", "")
    if not endpoint or not endpoint.strip():
        endpoint = _DEFAULT_ENDPOINT

    timeout_raw = tool_config.get("timeout")
    if timeout_raw is None or float(timeout_raw) <= 0:
        timeout = _DEFAULT_TIMEOUT
    else:
        timeout = float(timeout_raw)

    model = tool_config.get("model", "") or _DEFAULT_MODEL
    return api_key, endpoint, timeout, model


def _resolve_tool_config(
    tool_name: str,
    api_key_override: Optional[str],
    model_override: Optional[str],
) -> tuple[str, str, float, str] | None:
    """Resolve config, preferring explicit overrides.

    Same dual-path pattern as the other DashScope tool plugins: pass
    ``api_key=`` to skip the agent-context lookup.
    """
    if api_key_override and api_key_override.strip():
        synthetic = {"api_key": api_key_override.strip()}
        if model_override:
            synthetic["model"] = model_override
        return _extract_config(synthetic)
    tool_config = get_tool_config(tool_name)
    if not tool_config:
        return None
    if model_override:
        tool_config = {**tool_config, "model": model_override}
    return _extract_config(tool_config)


def _call_vlm(
    api_key: str,
    endpoint: str,
    model: str,
    image_url: str,
    question: str,
    *,
    max_retries: int = 3,
    backoff_base_s: float = 3.0,
):
    """Call DashScope MultiModalConversation with one image + one text question.

    Retries on transient network errors (TCP reset, read timeout,
    ProtocolError, executor-thread-stall) with exponential backoff.
    Real API errors (status_code != 200) propagate immediately.

    Returns the raw SDK response.
    """
    import dashscope
    from dashscope import MultiModalConversation

    messages = [
        {
            "role": "user",
            "content": [
                {"image": image_url},
                {"text": question},
            ],
        },
    ]

    last_exc: BaseException | None = None
    for attempt in range(max_retries + 1):
        try:
            with _DASHSCOPE_LOCK:
                dashscope.base_http_api_url = endpoint
                rsp = MultiModalConversation.call(
                    api_key=api_key,
                    model=model,
                    messages=messages,
                    result_format="message",
                    stream=False,
                )
            return rsp
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if not _is_retriable_network_error(exc):
                raise
            if attempt >= max_retries:
                logger.error(
                    f"VLM call network-failed after {attempt + 1} attempts; "
                    f"giving up: {exc!r}",
                )
                raise
            sleep_s = backoff_base_s * (2 ** attempt)
            logger.warning(
                f"VLM transient network error "
                f"(attempt {attempt + 1}/{max_retries + 1}); "
                f"retrying in {sleep_s:.0f}s — {exc!r}",
            )
            time.sleep(sleep_s)
    assert last_exc is not None
    raise last_exc


def _extract_answer_text(rsp) -> str:
    """Pull the model's text answer out of the SDK response."""
    choices = getattr(getattr(rsp, "output", None), "choices", None)
    if not choices:
        return ""
    for choice in choices:
        message = getattr(choice, "message", None)
        if not message:
            continue
        content = getattr(message, "content", None)
        if not content:
            continue
        for item in content:
            if isinstance(item, dict):
                text = item.get("text")
            else:
                text = getattr(item, "text", None)
            if text:
                return str(text)
    return ""


async def vlm_check_image(
    image_path: str,
    question: str,
    *,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> ToolResponse:
    """Ask a question about an image via Qwen-VL.

    For validation: prefer yes/no questions phrased so the answer is
    one word. Example:
        ``"Is there a tall vertical wooden mast clearly visible? "
        ``"Answer ONLY 'yes' or 'no'."``

    For free-form description (composition / OCR / etc.), use a more
    open question. The full model answer is returned in the TextBlock.

    Args:
        image_path (str):
            Local file path or HTTP/HTTPS URL of the image to inspect.
            Local paths get base64-encoded automatically.
        question (str):
            Natural-language prompt. For validation, end with
            ``"Answer ONLY 'yes' or 'no'."`` to constrain the model.
        model (str, optional):
            Override the configured Qwen-VL model.
        api_key (str, optional):
            Explicit DashScope API key. When provided, bypasses the
            agent-context configuration lookup — lets the tool be
            invoked from standalone scripts.

    Returns:
        ToolResponse: One TextBlock with the model's text answer (and
        a status line; see source for the format).
    """
    timeout = _DEFAULT_TIMEOUT  # bound early so the TimeoutError except can read it
    try:
        if not image_path or not image_path.strip():
            return ToolResponse(content=[
                TextBlock(type="text", text="Error: image_path is empty."),
            ])
        if not question or not question.strip():
            return ToolResponse(content=[
                TextBlock(type="text", text="Error: question is empty."),
            ])

        resolved = _resolve_tool_config("vlm_check_image", api_key, model)
        if resolved is None:
            return ToolResponse(content=[
                TextBlock(type="text", text=(
                    "Error: Tool not configured. Please set your API key.")),
            ])
        api_key_val, endpoint, timeout, model_name = resolved
        if not api_key_val:
            return ToolResponse(content=[
                TextBlock(type="text", text=(
                    "Error: DashScope API key not configured.")),
            ])
        if model_name not in _VALID_MODELS:
            return ToolResponse(content=[
                TextBlock(type="text", text=(
                    f"Error: Invalid model '{model_name}'. "
                    f"Valid: {', '.join(sorted(_VALID_MODELS))}")),
            ])

        try:
            image_url = _resolve_image_url(image_path)
        except (FileNotFoundError, ValueError) as e:
            return ToolResponse(content=[
                TextBlock(type="text", text=f"Error: image_path - {e}"),
            ])

        logger.info(
            "Qwen-VL check: model=%s image=%s question=%r",
            model_name, image_path, question[:80],
        )

        rsp = await asyncio.wait_for(
            asyncio.to_thread(
                _call_vlm,
                api_key=api_key_val,
                endpoint=endpoint,
                model=model_name,
                image_url=image_url,
                question=question,
            ),
            timeout=timeout,
        )

        if rsp.status_code != 200:
            err = (
                f"DashScope API error: {rsp.status_code} - "
                f"{rsp.code}: {rsp.message}"
            )
            logger.error(err)
            return ToolResponse(content=[
                TextBlock(type="text", text=f"Error: {err}"),
            ])

        answer = _extract_answer_text(rsp).strip()
        if not answer:
            return ToolResponse(content=[
                TextBlock(type="text", text=(
                    "Error: Qwen-VL returned no answer text.")),
            ])

        return ToolResponse(content=[
            TextBlock(type="text", text=answer),
        ])

    except asyncio.TimeoutError:
        return ToolResponse(content=[
            TextBlock(type="text", text=(
                f"Error: Qwen-VL request timed out after {timeout}s")),
        ])
    except Exception as e:  # noqa: BLE001
        logger.error("Qwen-VL check failed: %s", e, exc_info=True)
        return ToolResponse(content=[
            TextBlock(type="text", text=f"Error: VLM check failed - {e}"),
        ])
