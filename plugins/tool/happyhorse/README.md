# HappyHorse Video Generation Tool

QwenPaw tool plugin exposing the HappyHorse 1.0 video models on DashScope.

| Model | Purpose | Function |
|---|---|---|
| `happyhorse-1.0-t2v` | Text-to-video | `text_to_video_happyhorse(prompt, resolution, ratio, duration, ...)` |
| `happyhorse-1.0-i2v` | Image-to-video (drop-in with `image_to_video_wan`) | `image_to_video_happyhorse(prompt, first_frame_url, resolution, duration, ...)` |
| `happyhorse-1.0-r2v` | Reference-to-video | `reference_to_video_happyhorse(prompt, ref_images_url, ...)` |

All three hit the standard DashScope video-synthesis endpoint
(`/api/v1/services/aigc/video-generation/video-synthesis`) with the
async submit + poll pattern. No special endpoint plumbing beyond
swapping the model id.

Install:

```bash
qwenpaw plugin install plugins/tool/happyhorse --force
```

Configure: same DashScope API key as the `wan27` tool — the panel
auto-detects it via `_resolve_dashscope_key()`.

The Creator bundle's Stage 3 picks between `wan27` and `happyhorse` per
scene via `scene.video_provider` (default `wan27`). Set in the Scene
Edit modal.
