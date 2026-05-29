# Seedance Video Generation Tool

ByteDance **Seedance 2.0** (`doubao.doubao-seedance-2-0-260128`) brokered
through DashScope's `model-evaluation/async-inference` endpoint.

| Function | Purpose |
|---|---|
| `text_to_video_seedance(prompt, ratio, duration, generate_audio, watermark, api_key)` | Text-to-video |
| `image_to_video_seedance(prompt, first_frame_url, ratio, duration, ...)` | Drop-in for `image_to_video_wan` |
| `reference_to_video_seedance(prompt, ref_images_url, ref_video_url, ref_audio_url, ...)` | Multi-modal refs (image+video+audio) |

Unlike Wan / HappyHorse (which use the DashScope SDK's `VideoSynthesis`),
Seedance lives at a different URL and uses a chat-style content array
with `role` markers (`reference_image`, `reference_video`,
`reference_audio`). This plugin drives it manually with `httpx`:
submit → task_id → poll `/api/v1/tasks/{id}` → download MP4.

Note: GPT Image 2 (`azure.gpt-image-2`) lives on the related
`eval.dashscope.aliyuncs.com` subdomain but requires additional
RBAC permission on the DashScope key. If you get `403 RBAC: access
denied`, that subdomain isn't authorized for your account; enable
the relevant product in https://bailian.console.aliyun.com/ first.
