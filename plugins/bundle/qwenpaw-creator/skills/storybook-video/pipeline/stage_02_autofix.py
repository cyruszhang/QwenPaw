# -*- coding: utf-8 -*-
"""Stage 02 auto-fix loop.

Runs the frame validator, converts determinate visual failures into
``regen_notes``, regenerates failing Stage 02 frames, then validates
again. The final validation is part of the contract: callers get a
clear ``converged`` boolean and unresolved scene ids instead of a
"regenerated, probably fine" result.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Optional

import yaml  # type: ignore

_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
sys.path.insert(0, str(_SKILL_DIR))

from pipeline.stage_00_script import draft_to_yaml  # noqa: E402
from pipeline.stage_02_5_validate import run_stage_02_5  # noqa: E402
from pipeline.stage_02_v15_compose import run_stage_02_v15  # noqa: E402
from yaml_loader import load_project_spec_from_dict  # type: ignore  # noqa: E402

logger = logging.getLogger(__name__)


class ValidatorUnavailableError(RuntimeError):
    """Raised when Qwen-VL cannot produce any determinate checks."""


def _read_draft(project_dir: Path) -> dict:
    project_yml = project_dir / "project.yml"
    return yaml.safe_load(project_yml.read_text(encoding="utf-8")) or {}


def _write_draft(project_dir: Path, draft: dict) -> None:
    (project_dir / "project.yml").write_text(
        draft_to_yaml(draft),
        encoding="utf-8",
    )


def _hydrate_refs(spec, project_dir: Path) -> None:
    """Back-fill generated ref paths into a ProjectSpec loaded from YAML."""
    refs_dir = project_dir / "refs"
    if not refs_dir.exists():
        return
    for cid, ch in getattr(spec.assets, "characters", {}).items():
        path = refs_dir / f"{cid}_ref.png"
        if path.exists() and path.stat().st_size > 0:
            ch.reference_image = path
    for pid, prop in getattr(spec.assets, "props", {}).items():
        path = refs_dir / f"prop_{pid}_ref.png"
        if path.exists() and path.stat().st_size > 0:
            prop.reference_image = path
    for sid, scene_ref in getattr(spec.assets, "scene_refs", {}).items():
        path = refs_dir / f"scene_{sid}_ref.png"
        if path.exists() and path.stat().st_size > 0:
            scene_ref.reference_image = path
    if getattr(spec.assets, "style", None):
        path = refs_dir / "style_ref.png"
        if path.exists() and path.stat().st_size > 0:
            spec.assets.style.reference_image = path


def _draft_to_spec(draft: dict, project_dir: Path):
    spec = load_project_spec_from_dict(draft)
    _hydrate_refs(spec, project_dir)
    return spec


def real_failures(scene_report: dict) -> list[dict]:
    """Return determinate validation failures from one scene report."""
    return [
        check for check in (scene_report.get("failures") or [])
        if not check.get("indeterminate")
    ]


def _validation_health(report: dict) -> tuple[bool, int, str]:
    any_determinate = False
    indeterminate_total = 0
    sample = ""
    for sid, info in report.items():
        if sid == "_summary":
            continue
        for check in info.get("checks") or []:
            if check.get("indeterminate"):
                indeterminate_total += 1
                if not sample:
                    sample = str(check.get("vlm_answer", ""))[:160]
            else:
                any_determinate = True
    return any_determinate, indeterminate_total, sample


def _failing_scenes(report: dict) -> list[tuple[str, dict]]:
    return [
        (sid, info) for sid, info in report.items()
        if sid != "_summary"
        and info.get("rule_count", 0) > 0
        and real_failures(info)
    ]


def _scene_matches(scene: dict, only_scene: Optional[str]) -> bool:
    if only_scene is None:
        return True
    sid = str(scene.get("id"))
    return only_scene in (sid, f"{sid}_{scene.get('name')}")


def _target_scene_ids(draft: dict, only_scene: Optional[str]) -> list[str]:
    return [
        str(scene.get("id"))
        for scene in (draft.get("scenes") or [])
        if scene.get("id") is not None and _scene_matches(scene, only_scene)
    ]


def _format_failure_lines(scene_report: dict) -> list[str]:
    lines: list[str] = []
    for check in real_failures(scene_report)[:5]:
        rule = (check.get("rule") or "").strip()
        if not rule:
            continue
        kind = check.get("kind", "")
        if kind == "must_not_contain":
            lines.append(f"Remove from frame: {rule}")
        elif kind == "composition":
            lines.append(f"Fix composition: {rule}")
        else:
            lines.append(f"Make clearly visible: {rule}")
    return lines


def append_autofix_notes(draft: dict, failing: list[tuple[str, dict]]) -> dict:
    """Append actionable auto-fix notes to failing scenes.

    Existing user-authored notes are preserved; previous auto-fix notes
    are replaced so stale validator feedback does not accumulate.
    """
    by_sid = {sid: info for sid, info in failing}
    for scene in draft.get("scenes") or []:
        sid = str(scene.get("id"))
        info = by_sid.get(sid)
        if not info:
            continue
        fail_lines = _format_failure_lines(info)
        if not fail_lines:
            continue
        existing = scene.get("regen_notes") or ""
        user_lines = [
            line for line in existing.splitlines()
            if not line.strip().startswith("[auto-fix")
        ]
        kept = "\n".join(user_lines).strip()
        fail_block = "[auto-fix] " + "; ".join(fail_lines)
        scene["regen_notes"] = (
            f"{kept}\n{fail_block}".strip() if kept else fail_block
        )
    return draft


def _passed_scene_ids(report: dict) -> list[str]:
    return sorted(
        sid for sid, info in report.items()
        if sid != "_summary" and info.get("passed")
    )


async def run_stage_02_autofix(
    project_dir: Path,
    *,
    qwen_vl_api_key: str,
    keys: dict[str, str],
    max_iters: int = 2,
    only_scene: Optional[str] = None,
) -> dict:
    """Validate/regenerate Stage 02 frames until they pass or hit budget.

    ``max_iters`` is the number of regeneration attempts. Validation
    runs once before the first attempt and once after each attempt.
    """
    project_yml = project_dir / "project.yml"
    if not project_yml.is_file():
        raise FileNotFoundError("project.yml missing")

    iterations: list[dict] = []
    regen_errors: list[dict] = []
    regenerated_scene_ids: set[str] = set()
    final_report: dict = {}

    initial_draft = _read_draft(project_dir)
    target_scene_ids = _target_scene_ids(initial_draft, only_scene)
    if only_scene and not target_scene_ids:
        raise ValueError(f"scene {only_scene!r} not found")

    for validation_pass in range(max_iters + 1):
        draft = _read_draft(project_dir)
        spec = _draft_to_spec(draft, project_dir)
        report = await run_stage_02_5(
            spec,
            project_dir,
            api_key=qwen_vl_api_key,
            only_scene=only_scene,
        )
        final_report = report

        any_determinate, indeterminate_total, sample = _validation_health(
            report,
        )
        if not any_determinate and indeterminate_total > 0:
            raise ValidatorUnavailableError(
                "the Qwen-VL validator could not evaluate any rule "
                "(every check errored). Sample error: " + sample,
            )

        failing = _failing_scenes(report)
        checked_scene_ids = sorted(
            sid for sid in report.keys() if sid != "_summary"
        )
        missing_checked = sorted(
            set(target_scene_ids) - set(checked_scene_ids)
        )
        iteration = {
            "validation_pass": validation_pass,
            "scenes_checked": report.get("_summary", {}).get(
                "scenes_checked", 0,
            ),
            "scenes_passed": report.get("_summary", {}).get(
                "scenes_passed", 0,
            ),
            "scenes_failed": len(failing),
            "indeterminate_checks": indeterminate_total,
            "failing_scene_ids": [sid for sid, _ in failing],
            "unchecked_scene_ids": missing_checked,
        }
        iterations.append(iteration)

        if not failing:
            converged = not missing_checked
            return {
                "ok": True,
                "converged": converged,
                "max_iters": max_iters,
                "iterations": iterations,
                "fixed_scenes": _passed_scene_ids(report),
                "final_failed_scenes": [],
                "unchecked_scene_ids": missing_checked,
                "regenerated_scene_ids": sorted(regenerated_scene_ids),
                "regen_errors": regen_errors,
            }

        if validation_pass >= max_iters:
            break

        draft = append_autofix_notes(draft, failing)
        _write_draft(project_dir, draft)

        spec = _draft_to_spec(_read_draft(project_dir), project_dir)
        regenerated_this_pass: list[str] = []
        for sid, _ in failing:
            try:
                await run_stage_02_v15(
                    spec,
                    project_dir,
                    keys=keys,
                    only_scene=sid,
                    overwrite=True,
                )
                regenerated_scene_ids.add(sid)
                regenerated_this_pass.append(sid)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "[autofix] scene %s regen failed at validation pass %d",
                    sid,
                    validation_pass,
                )
                regen_errors.append({"scene_id": sid, "error": str(exc)})
        iteration["regenerated_scene_ids"] = regenerated_this_pass

    final_failing = _failing_scenes(final_report)
    return {
        "ok": True,
        "converged": False,
        "max_iters": max_iters,
        "iterations": iterations,
        "fixed_scenes": _passed_scene_ids(final_report),
        "final_failed_scenes": [sid for sid, _ in final_failing],
        "unchecked_scene_ids": sorted(
            set(target_scene_ids)
            - {sid for sid in final_report.keys() if sid != "_summary"}
        ),
        "regenerated_scene_ids": sorted(regenerated_scene_ids),
        "regen_errors": regen_errors,
    }
