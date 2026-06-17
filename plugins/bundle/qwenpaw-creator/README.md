# QwenPaw Creator

The bundle plugin home for the **Creator vertical** — the agentic
substrate for storybook video, carousel posts, brand-launch shorts,
and downstream verticals (Yearbook, Wedding-book, Corporate-annual,
etc.). See `/Users/yilei.z/dev/QwenPawDocs/qwenpaw-creator/CREATOR-STACK.md`
and `DEVELOPER-API.md` for the full design.

## Status: v0.3 — two-pass decompose + VLM auto-fix + live progress

| Layer | State |
|---|---|
| Bundle plugin shell (this dir) | ✅ |
| `storybook-video` skill (skills/) | ✅ |
| **Stage 00 — two-pass LLM decomposition** | ✅ Pass 1 beat sheet → HITL gate → Pass 2 per-beat craft (parallel), via DashScope qwen-max |
| **Story-constraint auto-extraction (Pass 1)** | ✅ — pulls hard constraints from the source with evidence anchors |
| **HTTP routes (`/api/creator/*`)** | ✅ — sources, decompose, craft, autofix, stages, takes, styles, cost-forecast |
| **Live progress (SSE)** | ✅ — `GET /projects/{pid}/events` streams stage progress to the panel |
| **Console panel UI (Vite/React)** | ✅ at `/plugin/qwenpaw-creator/storybook` (collapsible overview + project list, editable beat-sheet view) |
| Stage 0a/0b/0c ref generation (`gpt-image-2`, parallelized) | ✅ panel-driven, HITL review |
| **Stage 02 compose + VLM validate + auto-fix loop** | ✅ — `qwen-vl` checks each frame; indeterminate checks skip auto-fix |
| **Takes — alternate generations + select** | ✅ — `POST /projects/{pid}/takes/select` |
| **Cost forecast** | ✅ — `GET /projects/{pid}/cost-forecast` |
| Stage 3 (per-scene I2V — Wan / HappyHorse / Seedance) | ✅ panel-driven |
| Stage 4 (ffmpeg assembly) | ✅ panel-driven |
| Stage-specialist agents (Asset/Script/Shots) | ❌ v0.4+ |
| Cloudpaw `proposal_choice` integration | ❌ v0.4+ |

The console panel walks a user through:

1. **Source** — drag-drop a `.txt`/`.md`/`.pdf`/`.docx` or paste text;
   pick the LLM + frame/video providers on this step.
2. **Decompose (Pass 1)** — LLM extracts hard story constraints (with
   evidence anchors), identifies characters and recurring settings, and
   drafts a **beat sheet** of 5–8 beats.
3. **Beat-sheet gate (HITL)** — review and edit the beats/fields in the
   panel before committing. Pass 2 then crafts one scene per beat in
   parallel and emits a v15 ProjectSpec YAML into
   `<working_dir>/creator/<project_id>/project.yml`.
4. **Generate refs** — Stage 0a (characters) + 0b (settings) + 0c
   (style) via `gpt-image-2`, parallelized. HITL review thumbnails.
5. **Compose frames** — Stage 02 via `/v1/images/edits` with the locked
   refs as multi-image conditioning, then a `qwen-vl` **validation +
   auto-fix loop** flags and re-rolls off-spec frames. HITL review
   thumbnails; pick among **takes**.
6. **Animate** — Stage 03 dispatches each scene to its chosen I2V
   provider (Wan 2.7 / HappyHorse / Seedance). HITL review shots.
7. **Assemble** — Stage 04 runs ffmpeg (audio mix + uniform scale +
   concat) to produce the final MP4.

> **Note:** `plugin.json` still pins `version: 0.2.0` / a v0.2 description.
> Bump it alongside the next release cut.

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
│                              #   POST /projects/{pid}/decompose + /craft,
│                              #   POST /projects/{pid}/autofix,
│                              #   POST /projects/{pid}/stage,
│                              #   GET  /projects/{pid}/events  (SSE),
│                              #   POST /projects/{pid}/takes/select,
│                              #   GET  /projects/{pid}/cost-forecast, ...)
├── progress.py               # SSE progress bus shared by the stages
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
            ├── stage_00_script.py       # Pass-1 beat-sheet decomposition
            ├── stage_00_v2.py           # two-pass decompose orchestrator
            ├── stage_00a_characters.py  # gpt-image-2 character refs
            ├── stage_00b_scenes.py      # gpt-image-2 scene refs
            ├── stage_00c_style.py       # style ref resolution
            ├── stage_01_script.py       # CosyVoice TTS
            ├── stage_02_assets.py       # asset resolution
            ├── stage_02_v15_compose.py  # multi-ref edit composition
            ├── stage_02_5_validate.py   # qwen-vl frame validation
            ├── stage_02_autofix.py      # VLM-driven re-roll loop
            ├── stage_02_select.py       # take selection
            ├── stage_03_shots.py        # per-scene I2V dispatcher
            └── stage_04_assemble.py     # ffmpeg + Pillow assembly
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
