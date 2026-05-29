# -*- coding: utf-8 -*-
"""Workspace path resolution for the Creator bundle.

The Creator panel stores per-project artefacts under
``<working_dir>/creator/<project_id>/``:

    <working_dir>/creator/<project_id>/
        source.txt           # extracted plain-text source
        source.original.<ext># the file the user uploaded (if any)
        project.yml          # the decomposed v15 ProjectSpec
        meta.json            # {created_at, duration_target, voice, style_hint}
        refs/                # Stage 0 outputs (character/scene/style PNGs)
        frames/              # Stage 02 composed panels
        audio/               # Stage 01 narration mp3s
        shots/               # Stage 03 raw I2V mp4s
        output/              # Stage 04 final mp4

This mirrors the pattern used by ``plugins/bundle/qwenpaw-pet/pet_paths.py``
so the working-dir resolution follows the standard precedence.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

_SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")


def qwenpaw_working_dir() -> Path:
    """Resolve the QwenPaw working directory.

    Precedence (matches ``qwenpaw_pet_desktop.runtime.qwenpaw_working_dir``):
      1. ``QWENPAW_WORKING_DIR`` env var
      2. ``COPAW_WORKING_DIR`` env var
      3. ``qwenpaw.constant.WORKING_DIR``
      4. legacy ``~/.copaw`` if it exists
      5. ``~/.qwenpaw``
    """
    explicit = os.environ.get("QWENPAW_WORKING_DIR") or os.environ.get(
        "COPAW_WORKING_DIR",
    )
    if explicit:
        return Path(explicit).expanduser().resolve()
    try:
        from qwenpaw.constant import WORKING_DIR  # type: ignore

        return Path(WORKING_DIR).expanduser().resolve()
    except Exception:
        legacy = Path("~/.copaw").expanduser()
        if legacy.exists():
            return legacy.resolve()
        return Path("~/.qwenpaw").expanduser().resolve()


def creator_root() -> Path:
    """Return ``<working_dir>/creator/`` (created on demand)."""
    root = qwenpaw_working_dir() / "creator"
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_project_id(pid: str) -> str:
    """Validate ``pid`` as a safe directory name.

    Returns the canonical form (stripped). Raises ``ValueError`` if it
    contains anything outside ``[A-Za-z0-9._-]`` or escapes the parent
    directory.
    """
    p = (pid or "").strip()
    if not _SAFE_ID.fullmatch(p):
        raise ValueError(
            f"invalid project id {pid!r}: "
            "must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}",
        )
    return p


def project_dir(pid: str, *, create: bool = True) -> Path:
    """Return ``<creator_root>/<pid>/`` after validation.

    Always re-resolves and checks containment, defending against
    ``..``-style escapes even after the regex passes.
    """
    pid = safe_project_id(pid)
    root = creator_root().resolve()
    target = (root / pid).resolve()
    target.relative_to(root)  # raises ValueError on escape
    if create:
        target.mkdir(parents=True, exist_ok=True)
    return target


def list_projects() -> list[dict]:
    """Return one entry per ``<creator_root>/<x>`` containing ``project.yml``.

    Each entry: ``{id, path, title, created_at, scene_count}``.
    """
    import json

    root = creator_root()
    if not root.is_dir():
        return []
    out: list[dict] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not child.is_dir():
            continue
        # Show any directory that has at least a source.txt or project.yml
        # — a freshly-uploaded source (no decompose yet) is still a
        # "project" the user wants to see in the sidebar.
        proj = child / "project.yml"
        src = child / "source.txt"
        if not (proj.is_file() or src.is_file()):
            continue
        meta_path = child / "meta.json"
        meta: dict = {}
        if meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        title = meta.get("title") or child.name
        scene_count = 0
        try:
            import yaml  # type: ignore

            data = yaml.safe_load(proj.read_text(encoding="utf-8")) or {}
            scene_count = len(data.get("scenes", []) or [])
            if not meta.get("title"):
                title = data.get("title") or child.name
        except Exception:
            pass
        out.append({
            "id": child.name,
            "path": str(child.resolve()),
            "title": title,
            "created_at": meta.get("created_at"),
            "scene_count": scene_count,
        })
    return out
