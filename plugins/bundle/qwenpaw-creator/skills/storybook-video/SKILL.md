---
name: storybook-video
description: "Turn a story or illustrated book spec into a narrated MP4. Pipeline: per-panel Qwen-Image frames (seed + verbatim prefix for consistency) → Wan 2.7 I2V animation → CosyVoice narration → ffmpeg audio mix + uniform letterbox + concat-filter stitch. Battle-tested on the v11 Old Man and the Sea benchmark."
metadata:
  builtin_skill_version: "0.1.0"
  qwenpaw:
    emoji: "🎬"
    requires:
      packages: ["dashscope>=1.25.16", "pillow", "numpy", "agentscope==1.0.20"]
      tools: ["ffmpeg>=7.0 (with libfreetype + concat filter)"]
      plugins:
        - "plugins/tool/qwen-image (>=1.1.0 — needs seed + api_key params)"
        - "plugins/tool/wan27 (>=1.1.0 — needs api_key + retry support)"
        - "plugins/tool/cosyvoice (>=1.0.0)"
      api_keys: ["DASHSCOPE_API_KEY"]
---

# storybook-video

A four-stage agentic pipeline for narrated story videos. v0.1 ships as
a linear Python skill consumed directly by `examples/storybook-video/
run_benchmark.py`. v0.2+ will wrap it in stage-specialist agents with
HITL gates between stages (the `proposal_choice` pattern from cloudpaw).

## When to use

- User wants to turn a story, book, fable, biography, or narrative
  outline into a narrated MP4.
- User mentions "storybook video", "animated story", "book to video",
  "narrated short", or similar phrases.
- The content fits a 30s–2min runtime as 5–12 panels with one
  narrative voice.

## When NOT to use

- Real-time / live video — use a streaming agent instead.
- Dialogue scenes with multiple speakers — needs a different skill
  (voice clone per character, lip-sync, shot-reverse-shot framing).
- Anything requiring strict frame-perfect editorial control — use
  HyperFrames or a traditional NLE.

## Pipeline shape

```
        ProjectSpec  (anchors + per-scene scaffolds + narration)
            │
            ▼
        ┌─────────────────────────────────────────────────────────┐
        │ Stage 01 — script (TTS + duration calibration)          │
        │   CosyVoice-v2 narration; fail-fast if any clip > scene │
        │                                                          │
        │ Stage 02 — assets (Qwen-Image frames)                   │
        │   seed=42, prompt_extend=False, verbatim prefixes       │
        │                                                          │
        │ Stage 03 — shots (Wan 2.7 I2V animation)                │
        │   frame-conditioned, 1080P, motion prompts per scene    │
        │                                                          │
        │ Stage 04 — assemble (ffmpeg + Pillow)                   │
        │   overlays → audio mix → uniform scale → concat stitch  │
        └─────────────────────────────────────────────────────────┘
            │
            ▼
        Final MP4 (1920×1080 letterboxed @ 1920×816, AAC stereo)
```

The Cardinal Rule (from the production playbook this is derived from):
**Stage 01 runs FIRST.** TTS costs pennies; Wan costs dollars. Catch
oversize narration before any expensive call.

## Files

| File | Purpose |
|---|---|
| `spec.py` | `ProjectSpec`, `AnchorSet`, `SceneSpec`, `OverlaySpec` — the data contract |
| `interactive_setup.py` | v0.5 stub: anchor-by-anchor interactive selection (text-only PE / generate-and-approve / upload reference) |
| `pipeline/stage_01_script.py` | CosyVoice TTS + ffprobe calibration |
| `pipeline/stage_02_assets.py` | Qwen-Image 2.0 Pro frame generation per scene |
| `pipeline/stage_03_shots.py` | Wan 2.7 I2V animation per scene |
| `pipeline/stage_04_assemble.py` | overlays (Pillow) + audio mix + uniform scale + concat stitch |
| `ffmpeg_recipes.py` | Argv builders for every ffmpeg invocation |
| `overlays_render.py` | Per-frame Pillow text overlay (intro/outro) |
| `quirks/qwen-image.md` | Per-model gotchas: consistency strategy, hallucination patterns, negative-constraints rule |
| `quirks/wan27.md` | Per-model gotchas: motion-prompt limb anchoring, output-resolution variability, retry handling |
| `quirks/cosyvoice.md` | Per-model gotchas: v1 vs v2 voice suffix, format×sample-rate matrix, measured wpm |

## How to run (v0.1 — standalone benchmark)

```bash
cd /Users/yilei.z/dev/QwenPaw
source venv/bin/activate
set -a; source .env; set +a
cd examples/storybook-video

python3 run_benchmark.py --phase a              # audit (free, ~5s)
python3 run_benchmark.py --phase b              # smoke (~$0.66, ~5min)
python3 run_benchmark.py --phase c              # full (~$5, ~25-45min)
```

The benchmark's `ProjectSpec` literal (`examples/storybook-video/
prompts.py`) is what the skill operates on. Replace it with any
other `ProjectSpec` to drive the same skill with different content.

## How it will be invoked (v0.2+ — through an agent)

```python
# (pseudocode; the API shape lands when v0.2 ships)
agent = CreatorAgent(skills=["storybook-video"])
agent.run(
    goal="Produce a 60s narrated storybook video from this Hemingway excerpt.",
    inputs={"story_text": "...", "style_hint": "Ghibli watercolor"},
    hitl_gates=["anchors_locked", "shots_approved", "final_approved"],
)
```

The agent calls into this skill's pipeline stages, pauses for
`proposal_choice` gates between stages, and accepts free-text feedback
that re-runs only the affected per-scene artifacts.

## Iteration model

Per-scene artifacts are idempotent and addressable:

```bash
# Re-generate ONLY scene 04's frame after tuning the prompt
python3 run_benchmark.py --phase b --scene 04_the_catch --overwrite

# Re-animate just that one shot (frame stays cached)
python3 -m pipeline.stage_03_shots --scene 04 --overwrite

# Re-stitch the whole thing
python3 -m pipeline.stage_04_assemble --mode full --overwrite
```

This is the manual version of the agent loop. The agent will do it
autonomously with `proposal_choice` gates surfacing the cost of each
iteration BEFORE running it.
