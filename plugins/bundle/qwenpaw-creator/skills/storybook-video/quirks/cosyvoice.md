# CosyVoice (DashScope) — Model Quirks

For `synthesize_speech_cosyvoice(model="cosyvoice-v2", ...)`.

## v2 vs v1 voice suffix

The single biggest bug source. cosyvoice-v2 voices use the `_v2`
suffix; cosyvoice-v1 voices don't. The plugin catches the mismatch and
errors out clearly, but it's easy to copy a v1 voice id into a v2 call:

| Model | Correct voice form | Example |
|---|---|---|
| `cosyvoice-v2` | `<name>_v2` | `longshu_v2`, `longwan_v2` |
| `cosyvoice-v1` | `<name>` (no suffix) | `longxiaochun`, `longxiaoxia` |

## Voice ↔ OpenAI TTS mapping (rough)

For people coming from `tts-1-hd` voices:

| OpenAI | CosyVoice v2 | Notes |
|---|---|---|
| onyx (deep male narrator) | `longshu_v2` *(benchmark default)* | Mature, well-modulated, narration-friendly |
| nova (bright female) | `longxiaoxia_v2` | Brighter than onyx-equivalent |
| alloy / shimmer (neutral) | `longxiaobai_v2` | Less character; documentation-style |
| echo (warm male) | `longwan_v2` | Warmer than longshu_v2 |

These are calibrated by ear; the actual sound varies — re-audition with
your story material before locking.

## Format × sample-rate quirks

- mp3 at 22050 / 24000 / 44100 / 48000 → 256 kbps
- mp3 at 8000 / 16000 → 128 kbps (lower-fi)
- wav and pcm are 16-bit mono at every supported rate
- The plugin's `_pick_audio_format` maps these to the dashscope enum

## Hard limits

- **2000 characters per call.** Split long narration on sentence
  boundaries; concat resulting mp3s with ffmpeg.
- One `SpeechSynthesizer` instance is streaming-or-not, pick one. Don't
  reuse a streaming-callback instance for buffered calls.

## Speech rate

`speech_rate` 0.5–2.0; 1.0 default. For storybook narration, 0.95–1.0
hits a contemplative pace. >1.2 sounds rushed for literary text.

## Calibrating duration vs scene length

Stage 01's calibration: take the synthesized mp3 duration via `ffprobe`,
assert it fits inside `scene.duration - 1.0` (one-second buffer). If
not, either shorten the narration text or extend the scene duration —
**never** "stretch the audio" with speech_rate (sounds artificial).

The director-skill rule-of-thumb for English at speech_rate=1.0:

| Voice | wpm | words/sec | 5s scene | 8s scene | 10s scene |
|---|---|---|---|---|---|
| longshu_v2 | ~145 | ~2.4 | 9-11 | 16-17 | 21-23 |
| longwan_v2 | ~150 | ~2.5 | 10-12 | 17-18 | 22-25 |
| longxiaoxia_v2 | ~160 | ~2.7 | 12-14 | 19-21 | 25-28 |

Re-measure once we have real data from Phase B/C.

## Pricing (DashScope, 2026-05)

- Approx $0.02 per 1,000 characters of synthesis input
- Full benchmark (6 narrations × ~150 chars each) → pennies

## Per-run additions

### 2026-05-25 — Phase B (scene 01)

- **longshu_v2 @ speech_rate=1.0 measured wps: 4.11** (26 words / 6.32s).
  That's ~246 wpm — meaningfully faster than the ~145 wpm I'd guessed
  before measurement. The director-skill table (built around OpenAI's
  "onyx" voice) overstates how slow CosyVoice's narrators run. **Implication:**
  the 1-second narration/scene-duration buffer is comfortable; we probably
  have room for more text per scene than I originally budgeted.
- The 124-char narration ("He was an old man who fished alone in a skiff
  in the Gulf Stream and he had gone eighty-four days now without taking
  a fish.") fit a 10s scene with 3.68s of headroom.

