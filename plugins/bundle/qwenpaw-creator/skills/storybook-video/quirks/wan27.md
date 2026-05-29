# Wan 2.7 I2V — Model Quirks

Hard-won knowledge for `image_to_video_wan(model="wan2.7-i2v-...")`.

## Motion prompt discipline

**Always include explicit limb positioning** — without it, Wan
hallucinates floating hands. The most reliable form pairs an action
with a static anchor:

```
✅ "Old fisherman sits in skiff. His weathered hands rest on the oar
    across his lap, still and relaxed. Gentle waves softly rock the
    boat. Static locked-off shot."

❌ "Old fisherman in a skiff on a calm sea. Gentle waves rocking."
    — Wan invents random arm / hand movements
```

## Camera directions Wan responds well to

- `"static locked-off shot"` — no camera movement
- `"slow dolly in"`, `"gentle pan right"`, `"slow tilt up"`
- `"wide establishing shot"`, `"medium close-up"`
- `"slow cinematic motion"` — general slow-mo modifier

Avoid: `"rapid zoom"`, `"snap cut"`, `"shaky cam"` — Wan over-applies
these and the result looks noisy.

## Duration by scene type (v11 calibration)

| Scene type | Duration | Notes |
|---|---|---|
| Title intro | 5s | Just enough to read the title overlay |
| Story scene | 10s | Sweet spot — narration fits, motion has room |
| Credits outro | 8s | Time for credits roll + fade |

## Output resolution is NOT what you ask for

Even with `resolution="1080P"`, actual Wan outputs vary widely
(observed: 2262×916, 2470×840, 1920×1080). **Always uniform-scale
downstream** — Stage 04's letterbox-to-1920×1080 pass handles this.

Don't try to fix it by changing the `resolution` param; the variance
is upstream of that flag.

## Sync vs async return

`VideoSynthesis.call(...)` historically returned async (poll task_id);
recently it sometimes returns sync (immediate `SUCCEEDED`). The
`wan27_tool.py` plugin handles both transparently — don't add polling
logic in the benchmark.

## Wan auto-generates ambient audio

The returned MP4 has both video and a synthesized ambient track (water,
wind, room tone) matching the scene mood. **Don't discard it** — Stage
04 mixes it at 25% as a bed under TTS narration. Without the bed,
narration sounds dry against silent video.

## Cost (DashScope, 2026-05)

- Approx $0.06 per second of generated video at 1080P
- A 10-second story scene → ~$0.60
- A full 8-scene 73s benchmark → ~$4.50 of Wan calls

## Per-run additions

*(Append findings here after each benchmark run.)*
