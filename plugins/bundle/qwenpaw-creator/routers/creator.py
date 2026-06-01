# -*- coding: utf-8 -*-
"""HTTP routes for the QwenPaw Creator console panel.

Mounted at ``/api/creator`` by ``plugin.py`` via
``PluginApi.register_http_router``.

Endpoints (all return JSON unless otherwise noted):

  POST   /sources                    multipart upload OR JSON {text}
                                     → {project_id, source_path, preview}
  POST   /projects/{pid}/decompose   run Stage 00 → {draft (YAML dict)}
  GET    /projects                   list all creator projects
  GET    /projects/{pid}             return draft project.yml as JSON
  PUT    /projects/{pid}             write a full edited draft (JSON body)
  PATCH  /projects/{pid}             merge a partial draft
  GET    /styles                     style catalog as JSON
  POST   /projects/{pid}/stage       run Stage 0a/0b/0c/2; sync; returns report
  GET    /projects/{pid}/refs/{name} stream a generated PNG (Stage 0/2 art)
  GET    /projects/{pid}/status      asset inventory: which refs/frames exist

The handlers are intentionally synchronous-friendly (FastAPI runs
sync defs in a threadpool); the LLM call and image-gen calls are
async so they are awaited.
"""

from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import mimetypes
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from creator_paths import (  # type: ignore[import]  # noqa: E402
    creator_root,
    list_projects,
    project_dir,
    safe_project_id,
)

logger = logging.getLogger(__name__)


# ── sys.path plumbing so the storybook-video skill is importable ─────

_BUNDLE_DIR = Path(__file__).resolve().parent.parent
_SKILL_DIR = _BUNDLE_DIR / "skills" / "storybook-video"
for _p in (str(_SKILL_DIR), str(_BUNDLE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ── helpers ──────────────────────────────────────────────────────────


_SAFE_REF_NAME = re.compile(r"^[a-zA-Z0-9._-]{1,128}$")


def _now_iso() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).isoformat(timespec="seconds")


def _slug(s: str, *, fallback_seed: str = "") -> str:
    """ASCII-only slug. Resolution order:

      1. If the input has alphanumerics, keep them. ("Old Man & Sea" →
         "old_man_sea")
      2. If the input is pure CJK / non-ASCII, try pinyin transliteration
         via ``pypinyin`` if available. ("老人与海" → "lao_ren_yu_hai")
      3. Fall back to ``untitled_<sha1[:6]>`` so two non-ASCII titles
         don't collide on the literal string ``project``.
    """
    raw = (s or "").strip()
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", raw).strip("_").lower()
    if cleaned:
        return cleaned[:48]

    # Pinyin attempt — optional dep, graceful if missing.
    try:
        from pypinyin import lazy_pinyin  # type: ignore

        py = "_".join(lazy_pinyin(raw)).lower()
        py = re.sub(r"[^a-z0-9_]+", "_", py).strip("_")
        # Collapse repeated underscores.
        py = re.sub(r"_+", "_", py)
        if py:
            return py[:48]
    except ImportError:
        pass

    import hashlib

    seed = fallback_seed or _now_iso()
    h = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6]
    return f"untitled_{h}"


def _resolve_dashscope_key() -> str:
    """Read DASHSCOPE_API_KEY from env or from QwenPaw envs.json."""
    k = (os.environ.get("DASHSCOPE_API_KEY") or "").strip()
    if k:
        return k
    try:
        from qwenpaw.envs import load_envs  # type: ignore

        envs = load_envs() or {}
        return (envs.get("DASHSCOPE_API_KEY") or "").strip()
    except Exception:
        return ""


def _resolve_openai_key() -> str:
    """Read OPENAI_API_KEY for gpt-image-2 (Stage 0/2 v15 path)."""
    k = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if k:
        return k
    try:
        from qwenpaw.envs import load_envs  # type: ignore

        envs = load_envs() or {}
        return (envs.get("OPENAI_API_KEY") or "").strip()
    except Exception:
        return ""


def _yaml_loads(text: str) -> dict:
    import yaml  # type: ignore

    return yaml.safe_load(text) or {}


def _yaml_dumps(data: dict) -> str:
    import yaml  # type: ignore

    return yaml.dump(
        data,
        sort_keys=False, default_flow_style=False,
        allow_unicode=True, width=78,
    )


def _read_project(pid: str) -> dict:
    """Read ``project.yml`` for ``pid`` and return the parsed dict."""
    proj = project_dir(pid, create=False)
    f = proj / "project.yml"
    if not f.is_file():
        raise HTTPException(404, f"project.yml not found for {pid}")
    try:
        return _yaml_loads(f.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"invalid YAML for {pid}: {exc}") from exc


def _write_project(pid: str, draft: dict) -> Path:
    proj = project_dir(pid, create=True)
    f = proj / "project.yml"
    f.write_text(_yaml_dumps(draft), encoding="utf-8")
    return f


def _write_meta(pid: str, meta: dict) -> None:
    proj = project_dir(pid, create=True)
    target = proj / "meta.json"
    existing: dict = {}
    if target.is_file():
        try:
            existing = json.loads(target.read_text(encoding="utf-8"))
        except Exception:
            existing = {}
    existing.update(meta)
    target.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _hydrate_refs(spec: Any, proj_dir: Path) -> None:
    """Walk ``proj_dir/refs/`` and back-fill each asset's ``reference_image``
    so a Stage 2 invocation can find images produced by an earlier
    Stage 0 run in a separate request.
    """
    refs_dir = proj_dir / "refs"
    if not refs_dir.exists():
        return
    for cid, ch in getattr(spec.assets, "characters", {}).items():
        p = refs_dir / f"{cid}_ref.png"
        if p.exists() and p.stat().st_size > 0:
            ch.reference_image = p
    for sid, sr in getattr(spec.assets, "scene_refs", {}).items():
        p = refs_dir / f"scene_{sid}_ref.png"
        if p.exists() and p.stat().st_size > 0:
            sr.reference_image = p
    if getattr(spec.assets, "style", None):
        p = refs_dir / "style_ref.png"
        if p.exists() and p.stat().st_size > 0:
            spec.assets.style.reference_image = p


def _draft_to_projectspec(draft: dict) -> Any:
    """Convert a draft dict into a ProjectSpec via the in-skill loader."""
    from yaml_loader import load_project_spec_from_dict  # type: ignore

    return load_project_spec_from_dict(draft)


# ── request models ───────────────────────────────────────────────────


class TextSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(..., min_length=1, max_length=200_000)
    title: Optional[str] = None
    # Project-level model picks chosen at the source step. Persisted to
    # meta.json so ProjectPane can hydrate the Decompose form state and
    # propagate the choice through to every scene at decompose time.
    frame_provider: Optional[str] = None
    video_provider: Optional[str] = None


class DecomposeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    duration_target_s: int = Field(default=60, ge=10, le=600)
    style_hint: Optional[str] = None
    audience: Optional[str] = None
    voice: str = "longshu_v2"
    model: str = "qwen-max"
    # Optional story-level constraints — passed into Stage 00's prompt
    # AND persisted into global_config so Stage 2's compose prompt can
    # reuse them.
    era: Optional[str] = None
    country: Optional[str] = None
    genre: Optional[str] = None
    tone: Optional[str] = None
    story_anchor: Optional[str] = None
    style_directives: Optional[list[str]] = None
    world_bible: Optional[str] = None
    # Per-project model picks — propagated to every scene so the
    # downstream stages don't have to re-resolve from globals.
    frame_provider: Optional[str] = None  # Stage 2: gpt-image-2 | qwen-image
    video_provider: Optional[str] = None  # Stage 3: wan27 | happyhorse | seedance
    # Optional explicit beat count override. When None, the Pass 1
    # prompt suggests a range derived from duration_target_s.
    target_scenes: Optional[int] = Field(default=None, ge=3, le=60)


class CraftRequest(BaseModel):
    """Body for POST /projects/{pid}/craft — Pass 2 of the two-pass
    decomposition. Optional ``beats`` overrides whatever's currently
    saved in ``project.yml`` (so the UI can craft from the user's
    edited beat sheet without a separate save round-trip first).
    """

    model_config = ConfigDict(extra="forbid")
    beats: Optional[list[dict]] = None
    model: str = "qwen-max"


class AutoFixRequest(BaseModel):
    """Body for POST /projects/{pid}/autofix.

    Validates all scenes, appends VLM failure reasons to each failing
    scene's regen_notes, re-runs Stage 2 for the failures, re-validates.
    Caps at ``max_iters`` (default 2 — each iter is one Stage 2 regen
    per failing scene, ~$0.20-0.30 per regen on gpt-image-2).
    """

    model_config = ConfigDict(extra="forbid")
    max_iters: int = Field(default=2, ge=1, le=5)
    only_scene: Optional[str] = None


class StageRunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # One of: "0a" | "0b" | "0c" | "0" (all of 0) | "1" | "2" | "3" | "4"
    stage: str
    overwrite: bool = False
    only_character: Optional[str] = None
    only_scene_ref: Optional[str] = None
    only_scene: Optional[str] = None
    final_name: Optional[str] = None  # for stage 4
    max_shots: int = 8                # for stage 3 cost guardrail


class AnchorEditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # One of: "add", "update", "delete"
    op: str
    # One of: "character", "scene_ref"
    kind: str
    id: str
    description: Optional[str] = None  # required for add/update


class ProjectWriteBody(BaseModel):
    """Body for PUT /projects/{pid} — full draft replace."""

    model_config = ConfigDict(extra="forbid")
    draft: dict


class YamlWriteBody(BaseModel):
    """Body for PUT /projects/{pid}/yaml — raw YAML text replace."""

    model_config = ConfigDict(extra="forbid")
    yaml: str
    force: bool = False


class RenameProjectBody(BaseModel):
    """Body for POST /projects/{pid}/rename.

    ``new_id`` is normalized via ``_slug``-like rules: pinyin or
    cleaned alphanumerics, ≤48 chars, no path separators.
    """

    model_config = ConfigDict(extra="forbid")
    new_id: str


class SceneEditRequest(BaseModel):
    """Partial scene update. Any field set to None is left untouched.

    Note: ``scene_id`` is in the URL path, not the body — it's
    immutable. Renaming a scene id is not supported here; that would
    break references from ``uses_characters`` / Stage 2 filename
    conventions and is a draft-rewrite operation, not a patch.
    """

    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = None
    duration: Optional[int] = None
    has_narration: Optional[bool] = None
    standalone: Optional[bool] = None
    narration: Optional[str] = None
    scene_description: Optional[str] = None
    motion_prompt: Optional[str] = None
    uses_characters: Optional[list[str]] = None
    uses_scene_ref: Optional[str] = None
    uses_style: Optional[bool] = None
    n_candidates: Optional[int] = None
    # Free-text user correction appended to Stage 2's edit prompt on
    # the next regeneration. Persisted so subsequent re-runs keep it.
    regen_notes: Optional[str] = None
    # Which Stage 3 video model to use: "wan27" (default) or "happyhorse".
    video_provider: Optional[str] = None
    # Which Stage 2 image model to use: "gpt-image-2" (default) or
    # "qwen-image". qwen-image is ~5× cheaper but weaker on multi-ref
    # identity coherence — switch for cost-sensitive iteration.
    frame_provider: Optional[str] = None


# ── router build ─────────────────────────────────────────────────────


def build_router() -> APIRouter:  # noqa: C901, PLR0915
    router = APIRouter()

    # ─── DashScope model probe ───────────────────────────────────────

    @router.get("/diagnose/dashscope")
    async def diagnose_dashscope() -> dict:
        """Probe whether the in-process DashScope key has access to
        specific image / video models.

        Sends a small async-mode submit to each model endpoint and
        reports back the status + DashScope error code (if any).
        Never returns the key. The body of the response contains:

            {model_id: {status, code, message, task_id?}}

        Use this to confirm whether DashScope is brokering third-party
        models like ``openai.gpt-image-2`` or
        ``doubao.doubao-seedance-2-0-260128``.
        """
        import httpx  # noqa: PLC0415

        key = _resolve_dashscope_key()
        if not key:
            raise HTTPException(400, "DASHSCOPE_API_KEY not configured")

        base_t2i = (
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/"
            "text2image/image-synthesis"
        )
        base_video = (
            "https://dashscope.aliyuncs.com/api/v1/services/aigc/"
            "video-generation/video-synthesis"
        )
        base_oai = (
            "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )

        async def _probe_image_native(model_name: str) -> dict:
            payload = {
                "model": model_name,
                "input": {"prompt": "A small red apple on a white background"},
                "parameters": {"size": "1024*1024", "n": 1},
            }
            async with httpx.AsyncClient(timeout=30.0) as cli:
                r = await cli.post(
                    base_t2i,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                        "X-DashScope-Async": "enable",
                    },
                )
            return _summarize(r)

        async def _probe_image_oai(model_name: str) -> dict:
            payload = {
                "model": model_name,
                "prompt": "A small red apple on a white background",
                "size": "1024x1024",
                "n": 1,
            }
            async with httpx.AsyncClient(timeout=30.0) as cli:
                r = await cli.post(
                    f"{base_oai}/images/generations",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                    },
                )
            return _summarize(r)

        async def _probe_video(model_name: str) -> dict:
            payload = {
                "model": model_name,
                "input": {"prompt": "A small apple on a wooden table, slow zoom"},
                "parameters": {"duration": 5, "resolution": "720P"},
            }
            async with httpx.AsyncClient(timeout=30.0) as cli:
                r = await cli.post(
                    base_video,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {key}",
                        "Content-Type": "application/json",
                        "X-DashScope-Async": "enable",
                    },
                )
            return _summarize(r)

        def _summarize(r) -> dict:
            try:
                body = r.json()
            except Exception:
                body = {"raw": r.text[:600]}
            code = (
                body.get("code")
                or (body.get("error") or {}).get("code")
            )
            msg = (
                body.get("message")
                or (body.get("error") or {}).get("message")
                or ""
            )
            task_id = None
            out = body.get("output")
            if isinstance(out, dict):
                task_id = out.get("task_id")
            return {
                "status": r.status_code,
                "code": code,
                "message": msg[:300],
                "task_id": task_id,
                "accepted": r.status_code == 200 and not code,
            }

        probes: dict = {}

        probes["image:qwen-image-plus (control, native)"] = (
            await _probe_image_native("qwen-image-plus")
        )
        probes["image:openai.gpt-image-2 (native)"] = (
            await _probe_image_native("openai.gpt-image-2")
        )
        probes["image:openai.gpt-image-2 (oai-compat)"] = (
            await _probe_image_oai("openai.gpt-image-2")
        )
        probes["image:gpt-image-2 (oai-compat, no ns)"] = (
            await _probe_image_oai("gpt-image-2")
        )

        probes["video:wan2.7-i2v-1080p-prompt-extend (control)"] = (
            await _probe_video("wan2.7-i2v-1080p-prompt-extend")
        )
        probes["video:doubao.doubao-seedance-2-0-260128"] = (
            await _probe_video("doubao.doubao-seedance-2-0-260128")
        )
        probes["video:doubao-seedance-2-0-260128 (no ns)"] = (
            await _probe_video("doubao-seedance-2-0-260128")
        )

        return {"probes": probes}

    # ─── status ──────────────────────────────────────────────────────

    @router.get("/status")
    def status() -> dict:
        return {
            "ok": True,
            "creator_root": str(creator_root()),
            "has_dashscope": bool(_resolve_dashscope_key()),
            "has_openai": bool(_resolve_openai_key()),
            "project_count": len(list_projects()),
        }

    @router.get("/styles")
    def styles() -> dict:
        try:
            import yaml  # type: ignore
        except ImportError as exc:
            raise HTTPException(500, f"PyYAML missing: {exc}") from exc
        styles_yml = _SKILL_DIR / "styles" / "styles.yml"
        if not styles_yml.exists():
            return {"styles": []}
        data = yaml.safe_load(styles_yml.read_text(encoding="utf-8")) or {}
        # Strip the full positive_template payload to keep the response
        # small; UI just needs id/display_name/description.
        out = []
        for s in data.get("styles", []) or []:
            out.append({
                "id": s.get("id"),
                "display_name": s.get("display_name", s.get("id")),
                "description": (s.get("description") or "").strip(),
                "has_sample": bool(s.get("sample_ref")),
            })
        return {"styles": out}

    # ─── projects: CRUD ──────────────────────────────────────────────

    @router.get("/projects")
    def get_projects() -> dict:
        return {"projects": list_projects()}

    @router.get("/projects/{pid}")
    def get_project(pid: str) -> dict:
        """Return whatever exists for ``pid``:

        - directory missing → 404
        - directory exists, ``project.yml`` missing → return ``{draft: None}``
          (lets the UI render the Decompose form for a freshly-uploaded
          source).
        - both present → return parsed draft + meta.
        """
        safe_project_id(pid)  # syntactic check
        proj = creator_root() / pid
        if not proj.is_dir():
            raise HTTPException(404, f"project {pid!r} not found")
        meta_path = proj / "meta.json"
        meta: dict = {}
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        draft: Any = None
        proj_yml = proj / "project.yml"
        if proj_yml.is_file():
            try:
                draft = _yaml_loads(proj_yml.read_text(encoding="utf-8"))
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(
                    400, f"invalid YAML for {pid}: {exc}",
                ) from exc
        return {
            "id": pid,
            "path": str(proj),
            "draft": draft,
            "meta": meta,
            "has_source": (proj / "source.txt").is_file(),
        }

    @router.put("/projects/{pid}")
    def put_project(pid: str, body: ProjectWriteBody) -> dict:
        path = _write_project(pid, body.draft)
        _write_meta(pid, {"updated_at": _now_iso()})
        return {"ok": True, "path": str(path)}

    @router.delete("/projects/{pid}")
    def delete_project(pid: str) -> dict:
        proj = project_dir(pid, create=False)
        shutil.rmtree(proj, ignore_errors=True)
        return {"ok": True}

    @router.post("/projects/{pid}/rename")
    def rename_project(pid: str, body: RenameProjectBody) -> dict:
        """Rename a project's directory (and therefore its id).

        The user can pick the draft's auto-generated `project_id` (e.g.
        `the_old_man_and_the_sea`) or any other safe id. The whole
        workspace dir is moved atomically with ``Path.rename``; all
        artifact paths remain valid relative to the new dir.

        Validation:
          - new_id must pass ``_slug`` normalization
          - target dir must not already exist
        """
        raw = (body.new_id or "").strip()
        if not raw:
            raise HTTPException(400, "new_id required")
        normalized = _slug(raw, fallback_seed=raw)
        # Reject the auto-fallback if the user passed garbage.
        if normalized.startswith("untitled_"):
            raise HTTPException(
                400,
                "new_id didn't reduce to a safe slug. "
                "Use ASCII letters/digits, or a CJK title we can romanize.",
            )
        try:
            normalized = safe_project_id(normalized)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(400, str(exc)) from exc
        if normalized == pid:
            return {"ok": True, "id": pid, "noop": True}

        src = project_dir(pid, create=False)
        if not src.is_dir():
            raise HTTPException(404, f"project {pid!r} not found")
        dst = creator_root() / normalized
        if dst.exists():
            raise HTTPException(
                409,
                f"target id {normalized!r} already exists — pick another",
            )
        try:
            src.rename(dst)
        except OSError as exc:
            raise HTTPException(500, f"rename failed: {exc}") from exc
        _write_meta(normalized, {
            "renamed_from": pid,
            "renamed_at": _now_iso(),
        })
        return {"ok": True, "old_id": pid, "id": normalized,
                "path": str(dst)}

    # ─── YAML editor ─────────────────────────────────────────────────

    @router.get("/projects/{pid}/yaml")
    def get_project_yaml(pid: str) -> dict:
        """Return the on-disk project.yml as raw text.

        The on-disk YAML is the source of truth; we serve the raw bytes
        rather than round-tripping through the dict → YAML dumper so
        comments + formatting choices stay intact.
        """
        proj = project_dir(pid, create=False)
        f = proj / "project.yml"
        if not f.is_file():
            raise HTTPException(404, "project.yml missing")
        return {"yaml": f.read_text(encoding="utf-8")}

    def _collect_renames(old: dict, new: dict) -> list[dict]:
        """Diff old vs new draft for id/name renames.

        Walk by index — works for the common "edit in place" case
        (no add/delete). When lengths differ we don't try to guess and
        just return an empty list (the user did something structural,
        not a rename).
        """
        out: list[dict] = []

        for kind in ("characters", "scene_refs"):
            old_list = (old.get("assets", {}) or {}).get(kind) or []
            new_list = (new.get("assets", {}) or {}).get(kind) or []
            if len(old_list) != len(new_list):
                continue
            for o, n in zip(old_list, new_list):
                o_id, n_id = o.get("id"), n.get("id")
                if o_id and n_id and o_id != n_id:
                    if kind == "characters":
                        files = [f"refs/{o_id}_ref.png"]
                    else:
                        files = [f"refs/scene_{o_id}_ref.png"]
                    out.append({
                        "kind": kind[:-1],   # "character" / "scene_ref"
                        "from": o_id,
                        "to": n_id,
                        "orphan_files": files,
                    })

        old_scenes = old.get("scenes") or []
        new_scenes = new.get("scenes") or []
        if len(old_scenes) == len(new_scenes):
            for o, n in zip(old_scenes, new_scenes):
                o_id, o_name = str(o.get("id", "")), str(o.get("name", ""))
                n_id, n_name = str(n.get("id", "")), str(n.get("name", ""))
                if (o_id, o_name) == (n_id, n_name) or not o_id or not n_id:
                    continue
                stem = f"{o_id}_{o_name}"
                files = [
                    f"{stem}_frame.png",
                    f"{stem}_raw.mp4",
                    f"{stem}_narration.mp3",
                    f"{stem}_scaled.mp4",
                    f"{stem}_mixed.mp4",
                    f"{stem}_text.mp4",
                ]
                out.append({
                    "kind": "scene",
                    "from": stem,
                    "to": f"{n_id}_{n_name}",
                    "orphan_files": files,
                })

        return out

    @router.put("/projects/{pid}/yaml")
    def put_project_yaml(pid: str, body: YamlWriteBody) -> dict:
        """Replace project.yml with the submitted YAML text.

        Validation:
          1. Must parse as YAML → 400 with parse error
          2. Must produce a dict (top-level mapping) → 400
          3. If renames detected AND force=False → 409 with rename list

        On success, write atomically and bump meta.updated_at.
        """
        proj = project_dir(pid, create=True)
        try:
            new_draft = _yaml_loads(body.yaml)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                400, f"YAML parse error: {exc}",
            ) from exc
        if not isinstance(new_draft, dict):
            raise HTTPException(400, "top-level must be a mapping")

        # Diff against the existing on-disk draft for rename detection.
        old_yml = proj / "project.yml"
        if old_yml.is_file() and not body.force:
            try:
                old_draft = _yaml_loads(old_yml.read_text(encoding="utf-8"))
            except Exception:
                old_draft = {}
            renames = _collect_renames(old_draft, new_draft)
            if renames:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "rename_detected",
                        "message": (
                            "Rename detected. The current ref/frame "
                            "files would become orphaned (Stage 0/2 "
                            "would re-generate from scratch). Use the "
                            "Anchor UI to rename safely, or resubmit "
                            "with force=true to proceed anyway."
                        ),
                        "renames": renames,
                    },
                )

        old_yml.write_text(body.yaml, encoding="utf-8")
        _write_meta(pid, {"updated_at": _now_iso()})
        return {"ok": True, "draft": new_draft, "renamed": body.force}

    # ─── source upload ───────────────────────────────────────────────
    #
    # Two endpoints — FastAPI can't dispatch on Content-Type at the
    # parameter level (UploadFile + body=None still tries to parse a
    # body when JSON arrives, and a body model + File() in one signature
    # is brittle). Keeping the two paths separate is clearer and lets
    # the UI just pick the right URL.

    def _allocate_pid(title_str: str, explicit: Optional[str]) -> str:
        if explicit:
            return safe_project_id(explicit)
        base = _slug(title_str, fallback_seed=title_str)
        pid = base
        n = 1
        while (creator_root() / pid).exists():
            n += 1
            pid = f"{base}_{n}"
            if n > 999:
                raise HTTPException(500, "could not allocate project id")
        return pid

    @router.post("/sources/text")
    def post_source_text(body: TextSourceRequest) -> dict:
        """Save pasted text as a new project source."""
        title_str = body.title or "untitled"
        pid = _allocate_pid(title_str, None)
        proj = project_dir(pid, create=True)
        text = body.text
        (proj / "source.txt").write_text(text, encoding="utf-8")
        meta_extra: dict = {
            "title": title_str,
            "created_at": _now_iso(),
            "source_origin": "paste",
            "source_ext": ".txt",
        }
        if body.frame_provider:
            meta_extra["frame_provider"] = body.frame_provider
        if body.video_provider:
            meta_extra["video_provider"] = body.video_provider
        _write_meta(pid, meta_extra)
        preview = text.strip().splitlines()[:6]
        return {
            "project_id": pid,
            "title": title_str,
            "source_path": str(proj / "source.txt"),
            "char_count": len(text),
            "preview": "\n".join(preview)[:600],
        }

    @router.post("/sources/upload")
    def post_source_upload(
        file: UploadFile = File(...),
        title: Optional[str] = Form(None),
        project_id: Optional[str] = Form(None),
        frame_provider: Optional[str] = Form(None),
        video_provider: Optional[str] = Form(None),
    ) -> dict:
        """Save an uploaded file (.txt/.md/.pdf/.docx) as a new project."""
        ext = Path(file.filename or "upload.txt").suffix.lower() or ".txt"
        file_bytes = file.file.read()
        if not file_bytes:
            raise HTTPException(400, "empty file")
        if len(file_bytes) > 20 * 1024 * 1024:
            raise HTTPException(413, "upload exceeds 20 MB cap")
        title_str = (title or Path(file.filename or "upload").stem
                     or "untitled")
        pid = _allocate_pid(title_str, project_id)
        proj = project_dir(pid, create=True)

        orig = proj / f"source.original{ext}"
        orig.write_bytes(file_bytes)

        from pipeline.stage_00_script import extract_text  # noqa: PLC0415

        try:
            text = extract_text(orig)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                400, f"failed to extract text from {ext}: {exc}",
            ) from exc
        (proj / "source.txt").write_text(text, encoding="utf-8")
        meta_extra = {
            "title": title_str,
            "created_at": _now_iso(),
            "source_origin": "upload",
            "source_ext": ext,
        }
        if frame_provider:
            meta_extra["frame_provider"] = frame_provider
        if video_provider:
            meta_extra["video_provider"] = video_provider
        _write_meta(pid, meta_extra)
        preview = text.strip().splitlines()[:6]
        return {
            "project_id": pid,
            "title": title_str,
            "source_path": str(proj / "source.txt"),
            "char_count": len(text),
            "preview": "\n".join(preview)[:600],
        }

    # ─── decompose: Stage 00 ─────────────────────────────────────────

    @router.post("/projects/{pid}/decompose")
    async def decompose(pid: str, body: DecomposeRequest) -> dict:
        """Pass 1 of the two-pass decomposition: extract anchors + beat
        sheet from the source. Does NOT generate per-scene visual
        descriptions — that's the ``/craft`` endpoint's job.

        The returned draft has ``scenes: []`` and a populated ``beats``
        list. The UI is expected to surface the beats for HITL review
        before calling ``/craft``.
        """
        api_key = _resolve_dashscope_key()
        if not api_key:
            raise HTTPException(400, "DASHSCOPE_API_KEY not configured")

        proj = project_dir(pid, create=False)
        src = proj / "source.txt"
        if not src.is_file():
            raise HTTPException(
                404, "source.txt missing — POST /sources first",
            )
        text = src.read_text(encoding="utf-8")

        from pipeline.stage_00_v2 import extract_beats
        from pipeline.stage_00_script import draft_to_yaml

        try:
            draft = await extract_beats(
                text=text,
                api_key=api_key,
                duration_target_s=body.duration_target_s,
                style_hint=body.style_hint,
                audience=body.audience,
                voice=body.voice,
                model=body.model,
                era=body.era,
                country=body.country,
                genre=body.genre,
                tone=body.tone,
                story_anchor=body.story_anchor,
                style_directives=body.style_directives,
                world_bible=body.world_bible,
                target_scenes=body.target_scenes,
                frame_provider=body.frame_provider,
                video_provider=body.video_provider,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("[creator] stage_00 v2 extract_beats failed")
            raise HTTPException(500, f"decompose failed: {exc}") from exc

        # Persist. project.yml carries `beats: [...]` and `scenes: []`
        # at this point; /craft will populate scenes later.
        (proj / "project.yml").write_text(
            draft_to_yaml(draft), encoding="utf-8",
        )
        _write_meta(pid, {
            "decomposed_at": _now_iso(),
            "duration_target_s": body.duration_target_s,
            "style_hint": body.style_hint,
            "audience": body.audience,
            "voice": body.voice,
            "model": body.model,
            "target_scenes": body.target_scenes,
        })

        return {"ok": True, "project_id": pid, "draft": draft}

    @router.post("/projects/{pid}/craft")
    async def craft(pid: str, body: CraftRequest) -> dict:
        """Pass 2 of the two-pass decomposition: craft full scene
        specifications from the beat sheet. Reads beats from
        ``project.yml`` (or from ``body.beats`` if supplied — lets
        the UI pass freshly-edited beats without a save round-trip).
        """
        api_key = _resolve_dashscope_key()
        if not api_key:
            raise HTTPException(400, "DASHSCOPE_API_KEY not configured")

        proj = project_dir(pid, create=False)
        proj_yml = proj / "project.yml"
        if not proj_yml.is_file():
            raise HTTPException(
                404,
                "project.yml missing — run /decompose first to produce "
                "the beat sheet",
            )
        draft = _yaml_loads(proj_yml.read_text(encoding="utf-8"))
        if body.beats is not None:
            # Caller supplied (possibly-edited) beats; override.
            draft["beats"] = list(body.beats)
        if not (draft.get("beats") or []):
            raise HTTPException(
                400,
                "no beats in project.yml and none supplied in body — "
                "nothing to craft from",
            )

        from pipeline.stage_00_v2 import craft_scenes
        from pipeline.stage_00_script import draft_to_yaml

        try:
            draft = await craft_scenes(
                draft, api_key=api_key, model=body.model,
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("[creator] stage_00 v2 craft_scenes failed")
            raise HTTPException(500, f"craft failed: {exc}") from exc

        proj_yml.write_text(draft_to_yaml(draft), encoding="utf-8")
        _write_meta(pid, {
            "crafted_at": _now_iso(),
            "n_scenes": len(draft.get("scenes") or []),
        })

        return {"ok": True, "project_id": pid, "draft": draft}

    # ─── anchor CRUD (add/edit/delete characters + scene_refs) ──────

    @router.post("/projects/{pid}/autofix")
    async def autofix(pid: str, body: AutoFixRequest) -> dict:
        """Auto-fix loop: validate → regen failing scenes with the VLM
        failure reasons appended to regen_notes → re-validate. Up to
        ``max_iters`` iterations.

        Per-iteration:
          1. Run Stage 2.5 on the current set of (possibly filtered)
             scenes.
          2. Collect failing scene ids. If none, exit early.
          3. For each failing scene: append the failure reasons to
             ``regen_notes`` (deduped against the existing text).
          4. Persist the draft, then re-run Stage 2 with
             ``overwrite=True`` for each failing scene.
          5. Loop.

        Returns a structured report with per-iteration validation
        snapshots so the UI can render a "fixed N/M scenes" summary.
        """
        ds = _resolve_dashscope_key()
        if not ds:
            raise HTTPException(
                400,
                "DASHSCOPE_API_KEY missing — Qwen-VL validation needs it",
            )

        proj = project_dir(pid, create=False)
        proj_yml = proj / "project.yml"
        if not proj_yml.is_file():
            raise HTTPException(
                404, "project.yml missing — decompose+craft first",
            )

        from pipeline.stage_02_5_validate import run_stage_02_5
        from pipeline.stage_02_v15_compose import run_stage_02_v15
        from pipeline.stage_00_script import draft_to_yaml

        iterations: list[dict] = []
        fixed_scenes: set[str] = set()
        failed_scenes: set[str] = set()

        for i in range(body.max_iters):
            # Reload the draft each iter (the previous loop may have
            # edited regen_notes and committed Stage 2 outputs).
            draft = _read_project(pid)
            spec = _draft_to_projectspec(draft)
            _hydrate_refs(spec, proj)

            report = await run_stage_02_5(
                spec, proj,
                api_key=ds, only_scene=body.only_scene,
            )
            failing = [
                (sid, info) for sid, info in report.items()
                if sid != "_summary"
                and not info.get("passed", True)
                and info.get("rule_count", 0) > 0
            ]
            iterations.append({
                "iter": i,
                "scenes_checked": report.get("_summary", {}).get(
                    "scenes_checked", 0,
                ),
                "scenes_passed": report.get("_summary", {}).get(
                    "scenes_passed", 0,
                ),
                "scenes_failed": len(failing),
                "failing_scene_ids": [sid for sid, _ in failing],
            })

            if not failing:
                # Exit early — everything passes.
                fixed_scenes.update(
                    s.get("id") for s in (draft.get("scenes") or [])
                )
                break

            # Append VLM failure reasons to each failing scene's
            # regen_notes (additive, deduped — don't lose prior user
            # notes).
            for sid, info in failing:
                fail_lines = []
                for chk in info.get("failures", [])[:5]:
                    rule = chk.get("rule", "")
                    ans = chk.get("vlm_answer", "")
                    kind = chk.get("kind", "")
                    if kind == "must_contain":
                        fail_lines.append(
                            f"Must include: {rule} (VLM said: {ans[:60]})",
                        )
                    elif kind == "must_not_contain":
                        fail_lines.append(
                            f"Must NOT include: {rule}",
                        )
                    else:
                        fail_lines.append(f"Should be true: {rule}")
                fail_block = (
                    f"[auto-fix iter {i}] " + "; ".join(fail_lines)
                )
                for sc in draft.get("scenes") or []:
                    if str(sc.get("id")) == sid:
                        existing = (sc.get("regen_notes") or "").strip()
                        if fail_block in existing:
                            continue  # already there from a prior iter
                        sc["regen_notes"] = (
                            (existing + "\n" + fail_block).strip()
                            if existing else fail_block
                        )
                        break
            proj_yml.write_text(
                draft_to_yaml(draft), encoding="utf-8",
            )

            # Re-run Stage 2 for the failing scenes only. Use the same
            # provider/key resolution as the regular /stage handler.
            spec = _draft_to_projectspec(_read_project(pid))
            _hydrate_refs(spec, proj)
            oa = _resolve_openai_key()
            keys = {"openai": oa or "", "dashscope": ds}
            for sid, _ in failing:
                try:
                    await run_stage_02_v15(
                        spec, proj,
                        keys=keys,
                        only_scene=sid,
                        overwrite=True,
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception(
                        "[autofix] scene %s regen failed at iter %d",
                        sid, i,
                    )
                    failed_scenes.add(sid)
                    iterations[-1].setdefault("regen_errors", []).append({
                        "scene_id": sid, "error": str(exc),
                    })

        return {
            "ok": True,
            "project_id": pid,
            "max_iters": body.max_iters,
            "iterations": iterations,
            "fixed_scenes": sorted(fixed_scenes),
            "errored_scenes": sorted(failed_scenes),
        }

    @router.patch("/projects/{pid}/anchors")
    def edit_anchor(pid: str, body: AnchorEditRequest) -> dict:
        """Add, update, or delete a character or scene_ref in the draft.

        Body:
          - op:   "add" | "update" | "delete"
          - kind: "character" | "scene_ref"
          - id:   the anchor id (snake_case, e.g. "marlin")
          - description: required for add/update; ignored for delete

        Returns the updated draft so the UI can re-render in one round.
        """
        if body.op not in ("add", "update", "delete"):
            raise HTTPException(400, f"unknown op {body.op!r}")
        if body.kind not in ("character", "scene_ref"):
            raise HTTPException(400, f"unknown kind {body.kind!r}")
        if body.op in ("add", "update") and not (body.description or "").strip():
            raise HTTPException(400, "description required for add/update")
        anchor_id = re.sub(
            r"[^a-zA-Z0-9]+", "_", body.id.strip(),
        ).strip("_").lower()
        if not anchor_id:
            raise HTTPException(400, "id must contain alphanumerics")

        draft = _read_project(pid)
        assets = draft.setdefault("assets", {})
        key = "characters" if body.kind == "character" else "scene_refs"
        bucket = assets.setdefault(key, []) or []
        # Find existing entry by id.
        idx = next(
            (i for i, a in enumerate(bucket) if a.get("id") == anchor_id),
            -1,
        )

        if body.op == "add":
            if idx >= 0:
                raise HTTPException(
                    409, f"{body.kind} {anchor_id!r} already exists",
                )
            bucket.append({
                "id": anchor_id,
                "description": (body.description or "").strip(),
            })
        elif body.op == "update":
            if idx < 0:
                raise HTTPException(
                    404, f"{body.kind} {anchor_id!r} not found",
                )
            bucket[idx]["description"] = (body.description or "").strip()
        elif body.op == "delete":
            if idx < 0:
                raise HTTPException(
                    404, f"{body.kind} {anchor_id!r} not found",
                )
            bucket.pop(idx)
            # If a character is deleted, also strip it from every scene's
            # uses_characters list (otherwise Stage 02 will fail with a
            # missing-asset error). Same for scene_refs.
            if body.kind == "character":
                for s in draft.get("scenes", []) or []:
                    uses = s.get("uses_characters") or []
                    s["uses_characters"] = [
                        c for c in uses if c != anchor_id
                    ]
            else:
                for s in draft.get("scenes", []) or []:
                    if s.get("uses_scene_ref") == anchor_id:
                        s["uses_scene_ref"] = None

        assets[key] = bucket
        _write_project(pid, draft)
        _write_meta(pid, {"updated_at": _now_iso()})
        return {"ok": True, "draft": draft}

    # ─── scene editing ───────────────────────────────────────────────

    @router.patch("/projects/{pid}/scenes/{scene_id}")
    def edit_scene(pid: str, scene_id: str, body: SceneEditRequest) -> dict:
        """Patch one scene's fields. Anything not in the body stays put.

        Renaming the scene id is not supported (it would invalidate the
        ``<id>_<name>_frame.png`` filenames already on disk and break
        anchor references).
        """
        draft = _read_project(pid)
        scenes = draft.get("scenes") or []
        idx = next(
            (i for i, s in enumerate(scenes) if str(s.get("id")) == scene_id),
            -1,
        )
        if idx < 0:
            raise HTTPException(404, f"scene {scene_id!r} not found")
        scene = scenes[idx]

        # Validate uses_characters / uses_scene_ref point to anchors
        # that actually exist in this draft (typo guard).
        assets = draft.get("assets", {}) or {}
        char_ids = {c.get("id") for c in (assets.get("characters") or [])}
        ref_ids = {r.get("id") for r in (assets.get("scene_refs") or [])}
        if body.uses_characters is not None:
            unknown = [c for c in body.uses_characters if c not in char_ids]
            if unknown:
                raise HTTPException(
                    400,
                    f"uses_characters references unknown ids: {unknown}. "
                    f"Add them under Anchors first.",
                )
        if body.uses_scene_ref is not None and body.uses_scene_ref:
            if body.uses_scene_ref not in ref_ids:
                raise HTTPException(
                    400,
                    f"uses_scene_ref {body.uses_scene_ref!r} not found "
                    f"in scene_refs. Add it under Anchors first.",
                )

        patch = body.model_dump(exclude_unset=True)
        # uses_scene_ref="" means "clear it"; null also means "clear it".
        if "uses_scene_ref" in patch and not patch["uses_scene_ref"]:
            patch["uses_scene_ref"] = None
        scene.update(patch)
        scenes[idx] = scene
        draft["scenes"] = scenes
        _write_project(pid, draft)
        _write_meta(pid, {"updated_at": _now_iso()})
        return {"ok": True, "scene": scene, "draft": draft}

    # ─── ref/frame streaming ─────────────────────────────────────────

    # ─── progress event stream (SSE) ─────────────────────────────────

    @router.get("/projects/{pid}/events")
    async def project_events(pid: str):
        """Server-Sent Events stream of pipeline progress for ``pid``.

        Browser opens an EventSource → this endpoint yields events as
        ``data: {json}\\n\\n`` lines. Pipeline stages call
        ``progress.emit(pid, kind, **payload)`` to push messages.

        Heartbeat every 20s keeps the connection alive through proxies
        and lets the client detect a dead server.
        """
        safe_project_id(pid)  # validate id format

        from progress import subscribe  # type: ignore  # noqa: PLC0415

        async def _stream():
            async for event in subscribe(pid):
                yield f"data: {json.dumps(event, default=str)}\n\n"

        return StreamingResponse(
            _stream(),
            media_type="text/event-stream",
            headers={
                # Proxies (nginx etc.) may buffer event-stream — disable.
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @router.get("/projects/{pid}/refs/{name}")
    def get_ref(pid: str, name: str):
        """Serve any generated artifact by filename.

        Looks for ``proj/refs/<name>`` first (Stage 0 PNGs), then falls
        through to ``proj/<name>`` for the flat-layout Stage 1-4 files
        (``*_frame.png``, ``*_raw.mp4``, narration mp3s, final mp4).
        """
        if not _SAFE_REF_NAME.fullmatch(name):
            raise HTTPException(400, "invalid name")
        proj = project_dir(pid, create=False)
        proj_resolved = proj.resolve()
        for cand in (proj_resolved / "refs" / name, proj_resolved / name):
            try:
                cand.resolve().relative_to(proj_resolved)
            except ValueError:
                continue
            if cand.is_file():
                media, _ = mimetypes.guess_type(str(cand))
                return FileResponse(
                    cand, media_type=media or "application/octet-stream",
                )
        raise HTTPException(404, f"asset not found: {name}")

    @router.get("/projects/{pid}/status")
    def get_proj_status(pid: str) -> dict:
        """Asset inventory for the UI — which stage outputs exist.

        Stage 0 PNGs live in ``refs/``; Stage 1-4 outputs are flat in
        the project root so Stage 4's ffmpeg can find every file in
        one directory.
        """
        proj = project_dir(pid, create=False)
        out: dict = {"id": pid, "stages": {}}

        refs: list[dict] = []
        refs_dir = proj / "refs"
        if refs_dir.is_dir():
            for f in sorted(refs_dir.iterdir()):
                if f.is_file() and f.suffix.lower() == ".png":
                    refs.append({"name": f.name, "size": f.stat().st_size})
        out["stages"]["0"] = {"refs": refs}

        frames: list[dict] = []
        shots: list[dict] = []
        audio: list[dict] = []
        final: list[dict] = []
        if proj.is_dir():
            for f in sorted(proj.iterdir()):
                if not f.is_file():
                    continue
                n = f.name
                entry = {"name": n, "size": f.stat().st_size}
                if n.endswith("_frame.png"):
                    frames.append(entry)
                elif n.endswith("_raw.mp4"):
                    shots.append(entry)
                elif n.endswith("_narration.mp3"):
                    audio.append(entry)
                elif n.endswith("_final.mp4"):
                    final.append(entry)
        out["stages"]["1"] = {"audio": audio}
        out["stages"]["2"] = {"frames": frames}
        out["stages"]["3"] = {"shots": shots}
        out["stages"]["4"] = {"final": final}

        # Stage 2.5 validation report (if it exists). Shape:
        #   {<scene_id>: {passed, rule_count, failures, ...}, _summary: {...}}
        # The UI uses the per-scene `passed` field + failures count to
        # render a badge on each FrameGallery card.
        validation_report: dict = {}
        report_path = proj / "_validation_report.json"
        if report_path.is_file():
            try:
                validation_report = json.loads(
                    report_path.read_text(encoding="utf-8"),
                )
            except Exception:
                validation_report = {}
        out["stages"]["2.5"] = {"report": validation_report}
        return out

    # ─── stage runner ────────────────────────────────────────────────

    @router.post("/projects/{pid}/stage")
    async def run_stage(pid: str, body: StageRunRequest) -> dict:
        if body.stage not in (
            "0", "0a", "0b", "0c", "1", "2", "2.5", "3", "4",
        ):
            raise HTTPException(400, f"unknown stage: {body.stage}")
        proj = project_dir(pid, create=False)
        if not (proj / "project.yml").is_file():
            raise HTTPException(404, "project.yml missing — decompose first")

        # The bundle stages live under skills/storybook-video; we lazy
        # import them here to avoid circular sys.path effects.
        draft = _read_project(pid)
        spec = _draft_to_projectspec(draft)
        _hydrate_refs(spec, proj)

        # Single flat output_dir matches the benchmark runner's layout
        # (refs/ subdir for Stage 0; flat proj root for Stage 1-4 files).
        # Stage 4's ffmpeg sub-passes expect every input file in one
        # directory, so we don't sub-divide here.
        output_dir = proj
        (output_dir / "refs").mkdir(parents=True, exist_ok=True)

        report: dict = {"stage": body.stage, "results": {}}

        def _stage0_keys_and_validate() -> dict[str, str]:
            """Build {openai, dashscope} keys dict for Stage 0 dispatch.

            Stage 0a/0b/0c read ``global_config.frame_provider`` and
            dispatch per-call. Only require the key for the provider
            actually picked; that way a qwen-image project doesn't
            need an OPENAI_API_KEY set, and vice versa.
            """
            gc = (draft.get("global_config") or {})
            provider = str(gc.get("frame_provider") or "gpt-image-2")
            oa = _resolve_openai_key()
            ds = _resolve_dashscope_key()
            if provider == "gpt-image-2" and not oa:
                raise HTTPException(
                    400,
                    "OPENAI_API_KEY missing (required by gpt-image-2)",
                )
            if provider == "qwen-image" and not ds:
                raise HTTPException(
                    400,
                    "DASHSCOPE_API_KEY missing (required by qwen-image)",
                )
            return {"openai": oa, "dashscope": ds}

        async def _run_0a():
            from pipeline.stage_00a_characters import run_stage_00a
            return await run_stage_00a(
                spec, output_dir,
                keys=_stage0_keys_and_validate(),
                only_character=body.only_character,
                overwrite=body.overwrite,
            )

        async def _run_0b():
            from pipeline.stage_00b_scenes import run_stage_00b
            return await run_stage_00b(
                spec, output_dir,
                keys=_stage0_keys_and_validate(),
                only_scene_ref=body.only_scene_ref,
                overwrite=body.overwrite,
            )

        async def _run_0c():
            from pipeline.stage_00c_style import run_stage_00c
            return await run_stage_00c(
                spec, output_dir,
                keys=_stage0_keys_and_validate(),
                overwrite=body.overwrite,
            )

        async def _run_1():
            from pipeline.stage_01_script import (
                run_stage_01, NarrationOverrunError,
            )
            ds = _resolve_dashscope_key()
            if not ds:
                raise HTTPException(400, "DASHSCOPE_API_KEY missing")
            # The panel always passes allow_overrun=True: a too-long
            # narration is a *warning* (Stage 4 can crop or extend the
            # scene), not a fatal error. The CLI keeps the strict
            # default so batch runs surface the issue.
            try:
                return await run_stage_01(
                    spec, output_dir,
                    api_key=ds, overwrite=body.overwrite,
                    allow_overrun=True,
                )
            except NarrationOverrunError as exc:
                # Defensive — shouldn't fire with allow_overrun=True,
                # but if some future code path raises it we want to
                # downgrade to a warning instead of a 500.
                return {"warning": str(exc), "audit": exc.audit}

        async def _run_2():
            from pipeline.stage_02_v15_compose import run_stage_02_v15
            # Scenes may pick gpt-image-2 (OpenAI key) or qwen-image
            # (DashScope key) per-scene. Only require the keys that
            # actually-used providers need.
            scenes_to_run = [
                s for s in (draft.get("scenes") or [])
                if (
                    body.only_scene is None
                    or str(s.get("id")) == body.only_scene
                    or f"{s.get('id')}_{s.get('name')}" == body.only_scene
                )
            ]
            providers_used = {
                str(s.get("frame_provider") or "gpt-image-2")
                for s in scenes_to_run
            }
            oa = _resolve_openai_key()
            ds = _resolve_dashscope_key()
            if "gpt-image-2" in providers_used and not oa:
                raise HTTPException(
                    400, "OPENAI_API_KEY missing (required by gpt-image-2)",
                )
            if "qwen-image" in providers_used and not ds:
                raise HTTPException(
                    400, "DASHSCOPE_API_KEY missing (required by qwen-image)",
                )
            return await run_stage_02_v15(
                spec, output_dir,
                keys={"openai": oa, "dashscope": ds},
                only_scene=body.only_scene,
                overwrite=body.overwrite,
            )

        async def _run_2_5():
            from pipeline.stage_02_5_validate import run_stage_02_5
            ds = _resolve_dashscope_key()
            if not ds:
                raise HTTPException(
                    400,
                    "DASHSCOPE_API_KEY missing — Stage 2.5 uses Qwen-VL "
                    "to validate frames",
                )
            return await run_stage_02_5(
                spec, output_dir,
                api_key=ds, only_scene=body.only_scene,
            )

        async def _run_3():
            from pipeline.stage_03_shots import run_stage_03
            ds = _resolve_dashscope_key()
            if not ds:
                raise HTTPException(400, "DASHSCOPE_API_KEY missing")
            return await run_stage_03(
                spec, output_dir,
                api_key=ds,
                only_scene=body.only_scene,
                overwrite=body.overwrite,
                max_shots=body.max_shots,
            )

        async def _run_4():
            from pipeline.stage_04_assemble import run_stage_04_full

            # Stage 4 is pure ffmpeg / Pillow — no API key. ffmpeg must
            # be on PATH; check ahead of time so we error friendly.
            if not shutil.which("ffmpeg"):
                raise HTTPException(
                    400,
                    "ffmpeg not found on PATH — Stage 4 needs the "
                    "system `ffmpeg` (8.1+ recommended). Install via "
                    "Homebrew: `brew install ffmpeg`.",
                )
            final_name = (
                body.final_name
                or f"{draft.get('project_id', pid)}_final.mp4"
            )
            # Stage 4 is sync; run in a thread so the event loop survives.
            return await asyncio.to_thread(
                run_stage_04_full,
                spec, output_dir,
                final_name=final_name, overwrite=body.overwrite,
            )

        try:
            if body.stage == "0":
                # Key validation lives in _stage0_keys_and_validate(),
                # called from each sub-stage — fails fast with the
                # right error message based on the picked provider.
                # Style first → characters next → settings last. The
                # style ref anchors the aesthetic that 0a/0b's text
                # prompts then reference, and Stage 02 picks it up as
                # the first ref-image conditioning input.
                report["results"]["0c"] = await _run_0c()
                report["results"]["0a"] = await _run_0a()
                report["results"]["0b"] = await _run_0b()
            elif body.stage == "0a":
                report["results"]["0a"] = await _run_0a()
            elif body.stage == "0b":
                report["results"]["0b"] = await _run_0b()
            elif body.stage == "0c":
                report["results"]["0c"] = await _run_0c()
            elif body.stage == "1":
                report["results"]["1"] = await _run_1()
            elif body.stage == "2":
                report["results"]["2"] = await _run_2()
            elif body.stage == "2.5":
                report["results"]["2.5"] = await _run_2_5()
            elif body.stage == "3":
                report["results"]["3"] = await _run_3()
            elif body.stage == "4":
                report["results"]["4"] = await _run_4()
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("[creator] stage %s failed", body.stage)
            raise HTTPException(500, f"stage {body.stage} failed: {exc}") from exc

        # Persist report for audit
        rpt = proj / "_runs.jsonl"
        with rpt.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(
                {"at": _now_iso(), **report}, default=str,
            ) + "\n")

        return {"ok": True, **report}

    # ─── stage-0 cost forecast ───────────────────────────────────────

    @router.get("/projects/{pid}/cost-forecast")
    def cost_forecast(pid: str) -> dict:
        proj = creator_root() / safe_project_id(pid)
        proj_yml = proj / "project.yml"
        if not proj_yml.is_file():
            return {"stage_0_usd": 0, "stage_2_usd": 0, "total_usd": 0,
                    "breakdown": {"characters": 0, "scene_refs": 0, "scenes": 0}}
        draft = _yaml_loads(proj_yml.read_text(encoding="utf-8"))
        n_char = len(draft.get("assets", {}).get("characters", []) or [])
        n_ref = len(draft.get("assets", {}).get("scene_refs", []) or [])
        n_scene = len(draft.get("scenes", []) or [])
        # gpt-image-2 generate ~$0.15 / image; edit ~$0.25 / frame.
        # Wan 2.7 I2V ~$0.50 / 10s 1080p clip. Stage 4 = free (ffmpeg).
        s0 = round((n_char + n_ref + 1) * 0.15, 2)  # +1 for style
        s2 = round(n_scene * 0.25, 2)
        s3 = round(n_scene * 0.50, 2)
        return {
            "stage_0_usd": s0,
            "stage_2_usd": s2,
            "stage_3_usd": s3,
            "stage_4_usd": 0,
            "total_usd": round(s0 + s2 + s3, 2),
            "breakdown": {
                "characters": n_char,
                "scene_refs": n_ref,
                "scenes": n_scene,
            },
        }

    return router
