# -*- coding: utf-8 -*-
"""Locate and import the per-tool plugin modules the skill depends on.

The skill imports four sibling tool plugins (gpt-image2, wan27,
cosyvoice, qwen-vl) by direct file-path so we don't pay an agent-context
lookup just to call them. The path resolution has to work in three
deployment shapes:

  1. **Dev tree**: skill lives under
     ``<repo>/plugins/bundle/qwenpaw-creator/skills/storybook-video/``
     and tool plugins live under ``<repo>/plugins/tool/<id>/``. Walk
     up from the skill dir until we hit a ``plugins/tool/`` ancestor.

  2. **Bundle installed via ``qwenpaw plugin install``**: skill lives
     under ``<working_dir>/plugins/qwenpaw-creator/skills/...`` and the
     parent ``<working_dir>/plugins/`` flat-contains tool plugins like
     ``<working_dir>/plugins/gpt-image2/``. Check that flat layout.

  3. **Override**: ``QWENPAW_CREATOR_TOOLS_DIR`` env var pointing at any
     directory containing tool subfolders.

If none resolve, raise a clear error pointing at the install command.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType


def _candidate_tool_dirs() -> list[Path]:
    """Return directories that might contain tool subfolders, most-
    specific first.

    Each candidate is a *parent* of the tool dirs we want, e.g. a
    candidate of ``~/.copaw/plugins`` means we'll look for
    ``~/.copaw/plugins/gpt-image2/`` inside it.
    """
    out: list[Path] = []

    override = os.environ.get("QWENPAW_CREATOR_TOOLS_DIR")
    if override:
        out.append(Path(override).expanduser().resolve())

    # Walk up from this file looking for a "plugins/tool/" ancestor
    # — the dev-tree layout.
    here = Path(__file__).resolve()
    for ancestor in here.parents:
        cand = ancestor / "plugins" / "tool"
        if cand.is_dir():
            out.append(cand.resolve())
            break

    # Walk up from this file looking for a flat "plugins/" ancestor
    # — the install layout (each tool plugin sits directly under
    # ``<working_dir>/plugins/`` with no extra "tool/" segment).
    for ancestor in here.parents:
        if ancestor.name == "plugins":
            out.append(ancestor.resolve())
            break

    # Working dir default (covers both ``~/.copaw/plugins`` and
    # ``~/.qwenpaw/plugins`` whichever exists).
    for wd_env in ("QWENPAW_WORKING_DIR", "COPAW_WORKING_DIR"):
        wd = os.environ.get(wd_env)
        if wd:
            cand = Path(wd).expanduser().resolve() / "plugins"
            if cand.is_dir():
                out.append(cand)
    for fallback in (Path("~/.copaw/plugins").expanduser(),
                     Path("~/.qwenpaw/plugins").expanduser()):
        if fallback.is_dir():
            out.append(fallback.resolve())

    # Dedupe while preserving order.
    seen: set[Path] = set()
    unique: list[Path] = []
    for p in out:
        if p in seen:
            continue
        seen.add(p)
        unique.append(p)
    return unique


def find_tool_file(tool_id: str, tool_file: str) -> Path:
    """Find ``<tool_id>/<tool_file>`` in any candidate dir.

    Tries both the bare ``tool_id`` (dev-tree shape) and the
    ``<tool_id>-tool`` suffix (the manifest id used by the installed
    plugins). Raises ``FileNotFoundError`` with a useful install hint
    if neither resolves.
    """
    cands = _candidate_tool_dirs()
    # Manifest IDs of the installed tool plugins have a "-tool" suffix
    # (e.g. "gpt-image2" in the dev tree → "gpt-image2-tool" once
    # registered). Try both names so the same loader works in either
    # deployment shape.
    id_variants = [tool_id]
    if not tool_id.endswith("-tool"):
        id_variants.append(f"{tool_id}-tool")
    tried: list[Path] = []
    for parent in cands:
        for name in id_variants:
            p = parent / name / tool_file
            tried.append(p)
            if p.is_file():
                return p
    raise FileNotFoundError(
        f"could not find {tool_id}/{tool_file} (also tried "
        f"{tool_id}-tool/) in any of:\n  "
        + "\n  ".join(str(p) for p in tried)
        + f"\n\nInstall the tool plugin alongside the bundle:\n"
        f"  qwenpaw plugin install <repo>/plugins/tool/{tool_id}\n"
        f"\nOr set QWENPAW_CREATOR_TOOLS_DIR to a directory containing "
        f"'{tool_id}/' or '{tool_id}-tool/'.",
    )


def load_tool_module(
    *, tool_id: str, tool_file: str, module_name: str,
) -> ModuleType:
    """Locate, import, and return the tool module."""
    path = find_tool_file(tool_id, tool_file)
    # Make the tool plugin's own dir importable so its relative imports
    # (e.g. ``from .helpers import ...``) work.
    if str(path.parent) not in sys.path:
        sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"could not build import spec for {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
