# QwenPaw Creator

The bundle plugin home for the **Creator vertical** — the agentic
substrate for storybook video, carousel posts, brand-launch shorts,
and downstream verticals (Yearbook, Wedding-book, Corporate-annual,
etc.). See `/Users/yilei.z/dev/QwenPawDocs/qwenpaw-creator/CREATOR-STACK.md`
and `DEVELOPER-API.md` for the full design.

## Status: v0.2 — console panel + Stage 00 decompose

| Layer | State |
|---|---|
| Bundle plugin shell (this dir) | ✅ |
| `storybook-video` skill (skills/) | ✅ |
| **Stage 00 — LLM script decomposition** | ✅ via DashScope qwen-max |
| **HTTP routes (`/api/creator/*`)** | ✅ — sources, decompose, projects, stages |
| **Console panel UI (Vite/React)** | ✅ at `/plugin/qwenpaw-creator/storybook` |
| Stage 3 (per-scene I2V — Wan / HappyHorse / Seedance) | ✅ panel-driven |
| Stage 4 (ffmpeg assembly) | ✅ panel-driven |
| Stage-specialist agents (Asset/Script/Shots) | ❌ v0.3+ |
| Cloudpaw `proposal_choice` integration | ❌ v0.3+ |

The console panel walks a user through:

1. **Source** — drag-drop a `.txt`/`.md`/`.pdf`/`.docx` or paste text.
2. **Decompose** — LLM identifies characters, recurring settings, and
   slices the source into 5–8 storyboard scenes. Emits a v15
   ProjectSpec YAML into `<working_dir>/creator/<project_id>/project.yml`.
3. **Generate refs** — Stage 0a (characters) + 0b (settings) + 0c
   (style) via `gpt-image-2`. HITL review thumbnails in the panel.
4. **Compose frames** — Stage 02 via `/v1/images/edits` with the
   locked refs as multi-image conditioning. HITL review thumbnails.
5. **Animate** — Stage 03 dispatches each scene to its chosen I2V
   provider (Wan 2.7 / HappyHorse / Seedance). HITL review shots.
6. **Assemble** — Stage 04 runs ffmpeg (audio mix + uniform scale +
   concat) to produce the final MP4.

## Required env vars

- `DASHSCOPE_API_KEY` — Stage 00 (qwen-max decomposition) and Stage 01
  (CosyVoice TTS).
- `OPENAI_API_KEY` — Stage 0 ref gen + Stage 02 multi-ref edit
  composition via `gpt-image-2`.

Both are read either from process env or from QwenPaw's `envs.json`.

## Layout

```
plugins/bundle/qwenpaw-creator/
├── plugin.json                # entry.backend + entry.frontend
├── plugin.py                  # register() mounts the API router
├── creator_paths.py           # workspace dir resolution
├── routers/
│   ├── __init__.py
│   └── creator.py             # FastAPI APIRouter (POST /sources/...,
│                              #   POST /projects/{pid}/decompose,
│                              #   POST /projects/{pid}/stage,
│                              #   GET  /projects/{pid}/refs/{name}, ...)
├── ui/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.tsx          # the panel
│   │   └── qwenpaw-host.d.ts  # window.QwenPaw types
│   └── dist/index.js          # the built bundle consumed by plugin.json
└── skills/
    └── storybook-video/
        ├── SKILL.md
        ├── spec.py            # ProjectSpec dataclasses
        ├── styles/styles.yml  # 12 curated style presets
        └── pipeline/
            ├── stage_00_script.py       # NEW: LLM script decomposition
            ├── stage_00a_characters.py  # gpt-image-2 character refs
            ├── stage_00b_scenes.py      # gpt-image-2 scene refs
            ├── stage_00c_style.py       # style ref resolution
            ├── stage_01_script.py       # CosyVoice TTS
            ├── stage_02_v15_compose.py  # multi-ref edit composition
            ├── stage_03_shots.py        # Wan I2V (CLI-driven)
            └── stage_04_assemble.py     # ffmpeg + Pillow (CLI-driven)
```

## Skill catalog

| Skill | Purpose | Entry |
|---|---|---|
| `storybook-video` | Turn a story spec into a narrated video. Battle-tested via the Old Man and the Sea v11 benchmark (~$5, 73s output). | `skills/storybook-video/SKILL.md` |

Future skills (sketched but not built):

| Skill | Purpose |
|---|---|
| `carousel` | Per-platform carousel posts (XHS, LinkedIn, IG) |
| `brand-launch` | 60s prestige short with R2V + voice clone |
| `yearbook-page` | One yearbook page (used by the Yearbook vertical) |

## Building the UI

```bash
cd plugins/bundle/qwenpaw-creator/ui
npm install
npm run build       # → ui/dist/index.js (consumed by plugin.json)
# or
npm run dev         # vite build --watch for hot iteration
```

`React`, `react-dom`, and `antd` are all provided at runtime by the
QwenPaw console host (via `window.QwenPaw.host`). The Vite config
externalizes them so the bundle stays small (~31 KB).

## Cross-bundle composition (future)

When the Yearbook bundle ships (`plugins/bundle/qwenpaw-yearbook/`),
it will consume Creator's skills + primitives. Two viable patterns:

1. **In-process API via `sys.modules` injection** — Creator's
   startup hook publishes `sys.modules["qwenpaw_creator_api"] = api`;
   Yearbook (running at a later hook priority) imports it. Matches
   cloudpaw's existing `qwenpaw.app.interaction` injection pattern.
2. **HTTP routes under `/api/creator/*`** — already exposed by v0.2.
   Slower (localhost round-trip) but cleaner contract.

We'll choose when Yearbook gets built.
