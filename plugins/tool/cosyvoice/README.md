# CosyVoice TTS Tool

Bilingual (English + Chinese) text-to-speech for QwenPaw agents, powered
by Alibaba's CosyVoice models on DashScope. Single-utterance, buffered
file out — for narration / voiceover / pre-rendered dialogue workloads.

For real-time streaming TTS (the SIP / IM bot use case), see
`src/qwenpaw/app/channels/sip/stt_tts.py` — this tool is non-streaming
on purpose: it returns one file per call.

## Tool

| Name | Args | Returns |
|---|---|---|
| `synthesize_speech_cosyvoice` | `text, voice, format, sample_rate, speech_rate, api_key` | `ToolResponse` with local file path |

## Voice catalog

CosyVoice v2 voices use the `_v2` suffix; v1 voices are unsuffixed. The
catalog below is the curated default set — DashScope's catalog is
broader, and custom voice-clone ids are accepted. Consult
[the DashScope CosyVoice docs](https://help.aliyun.com/zh/model-studio/cosyvoice-quick-start)
for the full list.

### `cosyvoice-v2` (recommended for new work)

| Voice | Profile | Best for |
|---|---|---|
| `longshu_v2` *(default)* | Mature male, narration-friendly | Storybook narration, documentaries — comparable to OpenAI's "onyx" |
| `longwan_v2` | Warm male | Friendly explainers, marketing |
| `longxiaochun_v2` | Warm female | Standard narration |
| `longxiaoxia_v2` | Bright female | Upbeat content, ads |
| `longxiaobai_v2` | Neutral | Documentation read-throughs |
| `longshuo_v2` | Younger male | Casual / conversational |

### `cosyvoice-v1` (legacy — used by SIP channel today)

| Voice | Profile |
|---|---|
| `longxiaochun` | Warm female |
| `longxiaoxia` | Bright female |
| `longxiaocheng` | Neutral male |
| `longxiaobai` | Neutral female |
| `loongstella` | English-leaning male |

## Format × sample-rate matrix

| Format | Supported sample rates | Notes |
|---|---|---|
| `mp3` | 8000, 16000, 22050 *(default)*, 24000, 44100, 48000 | 128 kbps at ≤16 kHz, 256 kbps at ≥22.05 kHz |
| `wav` | 8000–48000 | 16-bit mono PCM in WAV container |
| `pcm` | 8000–48000 | Raw 16-bit mono PCM (no container) |

## Sample call

```python
from cosyvoice_tool import synthesize_speech_cosyvoice
import asyncio, os

async def main():
    resp = await synthesize_speech_cosyvoice(
        text="He was an old man who fished alone in a skiff in the Gulf Stream.",
        voice="longshu_v2",
        format="mp3",
        sample_rate=22050,
        speech_rate=1.0,
        api_key=os.environ["DASHSCOPE_API_KEY"],
    )
    print(resp.content[-1].text)

asyncio.run(main())
```

## Configuration (when running inside the QwenPaw agent runner)

The agent UI surfaces these fields from `plugin.json`:

- **DashScope API Key** *(required)* — `sk-...` from Bailian console
- **Model** — `cosyvoice-v2` (default) or `cosyvoice-v1`
- **API Endpoint** — Beijing or Singapore region
- **Request Timeout** — seconds (default 120)

When called standalone (benchmarks, CLI scripts), pass `api_key=...`
explicitly and the agent-context lookup is skipped.

## Limits

- ≤ 2000 characters per call (DashScope hard limit) — split longer
  narration into multiple calls and concatenate the resulting files.
- The `_v2` suffix is required for `cosyvoice-v2` voices and rejected
  by `cosyvoice-v1`. The tool catches this and returns an explicit
  error — easy source of confusion otherwise.
