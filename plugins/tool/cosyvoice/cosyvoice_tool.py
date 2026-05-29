# -*- coding: utf-8 -*-
# pylint: disable=too-many-return-statements,too-many-branches
# pylint: disable=too-many-statements,too-many-locals
"""CosyVoice TTS tool — bilingual (EN + ZH) speech synthesis via DashScope.

The non-streaming path: a single utterance in, audio bytes out, written
to a deterministic local file. Streaming + bidirectional callbacks live
in ``src/qwenpaw/app/channels/sip/stt_tts.py`` for the SIP channel; this
tool is for narration-style workloads (storybook scenes, dialogue lines,
pre-rendered voiceovers) where a buffered file is the right product.
"""

import asyncio
import logging
import threading
import time

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse
from qwenpaw.constant import DEFAULT_MEDIA_DIR
from qwenpaw.plugins import get_tool_config

logger = logging.getLogger(__name__)

# Thread lock to protect dashscope global base_http_api_url + api_key setting
_DASHSCOPE_LOCK = threading.Lock()

_DEFAULT_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1"
_DEFAULT_TIMEOUT = 120.0
_DEFAULT_MODEL = "cosyvoice-v2"

_VALID_MODELS = {"cosyvoice-v1", "cosyvoice-v2"}
_VALID_FORMATS = {"mp3", "wav", "pcm"}


# Curated default voice catalog.
# cosyvoice-v2 uses the *_v2 suffix; cosyvoice-v1 uses the bare voice id.
# This list is a v0 default — DashScope's catalog is broader; consult
# https://help.aliyun.com/zh/model-studio/cosyvoice-quick-start for the
# full set including custom voice-clone ids.
_VOICE_CATALOG_V2 = {
    "longshu_v2",         # mature male, narration-friendly (≈ OpenAI onyx)
    "longwan_v2",         # warm male
    "longxiaochun_v2",    # warm female
    "longxiaoxia_v2",     # bright female
    "longxiaobai_v2",     # neutral
    "longshuo_v2",        # younger male
}

_VOICE_CATALOG_V1 = {
    "longxiaochun",
    "longxiaoxia",
    "longxiaocheng",
    "longxiaobai",
    "loongstella",
}


def _extract_config(
    tool_config: dict,
) -> tuple[str, str, float, str]:
    """Extract api_key, endpoint, timeout, model from tool config.

    Args:
        tool_config: Tool configuration dict.

    Returns:
        Tuple of (api_key, endpoint, timeout, model).
    """
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
    api_key_override: str | None,
) -> tuple[str, str, float, str] | None:
    """Resolve tool config, preferring an explicit api_key override.

    See qwen-image/qwen_image_tool.py:_resolve_tool_config for the same
    pattern. When ``api_key_override`` is set, builds a synthetic config
    and skips the agent-context ``get_tool_config()`` flow so standalone
    scripts (benchmarks, CLIs) can invoke the tool.
    """
    if api_key_override and api_key_override.strip():
        synthetic = {"api_key": api_key_override.strip()}
        return _extract_config(synthetic)

    tool_config = get_tool_config(tool_name)
    if not tool_config:
        return None
    return _extract_config(tool_config)


def _pick_audio_format(format_name: str, sample_rate: int):
    """Map (format, sample_rate) → dashscope tts_v2 AudioFormat enum.

    The enum is module-scoped in dashscope.audio.tts_v2; we import lazily
    to avoid forcing the dependency at plugin-load time.

    Args:
        format_name: "mp3", "wav", or "pcm".
        sample_rate: 8000, 16000, 22050, 24000, or 48000.

    Returns:
        AudioFormat enum value.

    Raises:
        ValueError: When the (format, sample_rate) pair isn't supported.
    """
    from dashscope.audio.tts_v2 import AudioFormat

    # Names from dashscope.audio.tts_v2.AudioFormat (verified against
    # dashscope 1.25.19). MP3 ships at 128kbps for ≤16kHz and 256kbps
    # for ≥22.05kHz; WAV/PCM are 16-bit mono.
    pairs = {
        ("mp3", 8000): AudioFormat.MP3_8000HZ_MONO_128KBPS,
        ("mp3", 16000): AudioFormat.MP3_16000HZ_MONO_128KBPS,
        ("mp3", 22050): AudioFormat.MP3_22050HZ_MONO_256KBPS,
        ("mp3", 24000): AudioFormat.MP3_24000HZ_MONO_256KBPS,
        ("mp3", 44100): AudioFormat.MP3_44100HZ_MONO_256KBPS,
        ("mp3", 48000): AudioFormat.MP3_48000HZ_MONO_256KBPS,
        ("wav", 8000): AudioFormat.WAV_8000HZ_MONO_16BIT,
        ("wav", 16000): AudioFormat.WAV_16000HZ_MONO_16BIT,
        ("wav", 22050): AudioFormat.WAV_22050HZ_MONO_16BIT,
        ("wav", 24000): AudioFormat.WAV_24000HZ_MONO_16BIT,
        ("wav", 44100): AudioFormat.WAV_44100HZ_MONO_16BIT,
        ("wav", 48000): AudioFormat.WAV_48000HZ_MONO_16BIT,
        ("pcm", 8000): AudioFormat.PCM_8000HZ_MONO_16BIT,
        ("pcm", 16000): AudioFormat.PCM_16000HZ_MONO_16BIT,
        ("pcm", 22050): AudioFormat.PCM_22050HZ_MONO_16BIT,
        ("pcm", 24000): AudioFormat.PCM_24000HZ_MONO_16BIT,
        ("pcm", 44100): AudioFormat.PCM_44100HZ_MONO_16BIT,
        ("pcm", 48000): AudioFormat.PCM_48000HZ_MONO_16BIT,
    }
    key = (format_name, sample_rate)
    if key not in pairs:
        raise ValueError(
            f"Unsupported (format, sample_rate) pair: {key}. "
            f"Supported: {sorted(pairs.keys())}",
        )
    return pairs[key]


def _call_synthesizer(
    api_key: str,
    endpoint: str,
    model: str,
    voice: str,
    audio_fmt,
    speech_rate: float,
    text: str,
) -> bytes:
    """Call DashScope CosyVoice synthesizer with thread-safe setup.

    The dashscope SDK reads api_key and base_http_api_url from
    module-level state; we serialize on _DASHSCOPE_LOCK to avoid races
    with the qwen-image / wan27 tools that mutate the same globals.

    Args:
        api_key: DashScope API key.
        endpoint: Base HTTP API URL.
        model: "cosyvoice-v2" or "cosyvoice-v1".
        voice: Voice preset id (e.g. "longshu_v2").
        audio_fmt: AudioFormat enum from tts_v2.
        speech_rate: 0.5 to 2.0.
        text: Utterance to synthesize.

    Returns:
        bytes: Raw audio bytes in the requested format.
    """
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer

    with _DASHSCOPE_LOCK:
        dashscope.base_http_api_url = endpoint
        dashscope.api_key = api_key

        synthesizer = SpeechSynthesizer(
            model=model,
            voice=voice,
            format=audio_fmt,
            speech_rate=speech_rate,
        )
        audio_bytes = synthesizer.call(text)

    return audio_bytes or b""


async def synthesize_speech_cosyvoice(
    text: str,
    voice: str = "longshu_v2",
    format: str = "mp3",  # pylint: disable=redefined-builtin
    sample_rate: int = 22050,
    speech_rate: float = 1.0,
    api_key: str | None = None,
) -> ToolResponse:
    """Synthesize speech from text using CosyVoice on DashScope.

    Bilingual (EN + ZH). Single-utterance, non-streaming. Returns a
    ToolResponse whose text block reports the saved local path; the
    bytes are written to ``DEFAULT_MEDIA_DIR / "cosyvoice"``.

    For long-running streaming TTS (e.g. real-time IM bot speech), see
    ``src/qwenpaw/app/channels/sip/stt_tts.py`` — this tool is for the
    narration/voiceover workload (single buffered file out).

    Args:
        text (str):
            Utterance to synthesize. ≤ 2000 characters per call.
            Supports Chinese and English; bilingual sentences too.
        voice (str, optional):
            Voice preset id. For cosyvoice-v2 the catalog has a "_v2"
            suffix: ``longshu_v2`` (mature male narrator, default —
            comparable to OpenAI's "onyx"), ``longwan_v2`` (warm male),
            ``longxiaochun_v2`` (warm female), ``longxiaoxia_v2``
            (bright female). For cosyvoice-v1 use the bare ids
            (``longxiaochun``, ``longxiaoxia``, ...). Custom voice-clone
            ids are also accepted — the catalog above is the curated
            default set; consult the DashScope console for the full
            list. Default: ``"longshu_v2"``.
        format (str, optional):
            Output container. ``"mp3"`` (default — narration friendly),
            ``"wav"`` (PCM container — bigger files, lossless), ``"pcm"``
            (raw PCM — for stream concatenation).
        sample_rate (int, optional):
            22050 (mp3 default), 24000, or 48000 for mp3/wav; 16000,
            22050, or 24000 for pcm. Default: 22050.
        speech_rate (float, optional):
            Playback speed. 0.5 to 2.0. Default: 1.0.
        api_key (str, optional):
            Explicit DashScope API key. When provided, bypasses the
            agent-context configuration lookup — lets the tool be
            invoked from standalone scripts.

    Returns:
        ToolResponse: One TextBlock with the local file path and
        synthesis metadata. The audio bytes are written to disk; the
        caller reads the file from the returned path.
    """
    timeout = _DEFAULT_TIMEOUT  # bound early so except blocks can see it
    try:
        resolved = _resolve_tool_config(
            "synthesize_speech_cosyvoice",
            api_key,
        )
        if resolved is None:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: Tool not configured. "
                            "Please set your API key in the tool settings."
                        ),
                    ),
                ],
            )
        api_key, endpoint, timeout, model = resolved
        if not api_key:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: DashScope API key not configured. "
                            "Please set your API key in the tool settings."
                        ),
                    ),
                ],
            )

        if model not in _VALID_MODELS:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid model '{model}'. "
                            f"Valid options: {', '.join(sorted(_VALID_MODELS))}"
                        ),
                    ),
                ],
            )

        if format not in _VALID_FORMATS:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid format '{format}'. "
                            f"Valid options: {', '.join(sorted(_VALID_FORMATS))}"
                        ),
                    ),
                ],
            )

        if not 0.5 <= speech_rate <= 2.0:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: Invalid speech_rate '{speech_rate}'. "
                            f"Must be between 0.5 and 2.0."
                        ),
                    ),
                ],
            )

        if not text or not text.strip():
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text="Error: text is empty.",
                    ),
                ],
            )

        if len(text) > 2000:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: text exceeds 2000 characters "
                            f"(got {len(text)}). Split into multiple calls."
                        ),
                    ),
                ],
            )

        # Voice-vs-model sanity check — common bug source.
        # The _v2 suffix is required for cosyvoice-v2 voices and rejected
        # by cosyvoice-v1. Custom clone ids pass through without check.
        if model == "cosyvoice-v2" and voice in _VOICE_CATALOG_V1:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: voice '{voice}' belongs to cosyvoice-v1. "
                            f"For model='cosyvoice-v2', use a _v2-suffixed "
                            f"voice (e.g. {voice}_v2)."
                        ),
                    ),
                ],
            )
        if model == "cosyvoice-v1" and voice in _VOICE_CATALOG_V2:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"Error: voice '{voice}' belongs to cosyvoice-v2. "
                            f"For model='cosyvoice-v1', strip the _v2 suffix."
                        ),
                    ),
                ],
            )

        try:
            audio_fmt = _pick_audio_format(format, sample_rate)
        except ValueError as e:
            return ToolResponse(
                content=[
                    TextBlock(type="text", text=f"Error: {e}"),
                ],
            )

        logger.info(
            f"Synthesizing speech with CosyVoice: "
            f"model={model}, voice={voice}, "
            f"format={format}, sample_rate={sample_rate}, "
            f"chars={len(text)}",
        )

        audio_bytes = await asyncio.wait_for(
            asyncio.to_thread(
                _call_synthesizer,
                api_key=api_key,
                endpoint=endpoint,
                model=model,
                voice=voice,
                audio_fmt=audio_fmt,
                speech_rate=speech_rate,
                text=text,
            ),
            timeout=timeout,
        )

        if not audio_bytes:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: CosyVoice returned no audio bytes. "
                            "Check the voice id and account quota."
                        ),
                    ),
                ],
            )

        save_dir = DEFAULT_MEDIA_DIR / "cosyvoice"
        save_dir.mkdir(parents=True, exist_ok=True)
        ts = int(time.time() * 1000)
        ext = "mp3" if format == "mp3" else ("wav" if format == "wav" else "pcm")
        audio_path = save_dir / f"cosyvoice_{ts}.{ext}"
        await asyncio.to_thread(audio_path.write_bytes, audio_bytes)

        logger.info(
            f"CosyVoice synthesized {len(audio_bytes)} bytes → "
            f"{audio_path}",
        )

        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        f"Speech synthesized successfully using CosyVoice\n"
                        f"Model: {model}, Voice: {voice}\n"
                        f"Format: {format}@{sample_rate}Hz, "
                        f"Speed: {speech_rate}x\n"
                        f"Text length: {len(text)} chars, "
                        f"Audio bytes: {len(audio_bytes)}\n"
                        f"Saved to: {audio_path}"
                    ),
                ),
            ],
        )

    except asyncio.TimeoutError:
        logger.error(
            f"CosyVoice synthesis timed out after {timeout}s",
        )
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        f"Error: CosyVoice synthesis timed out "
                        f"after {timeout} seconds."
                    ),
                ),
            ],
        )
    except Exception as e:
        logger.error(
            f"CosyVoice synthesis failed: {e}",
            exc_info=True,
        )
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=f"Error: Speech synthesis failed - {str(e)}",
                ),
            ],
        )
