# -*- coding: utf-8 -*-
"""Stage 02.5 — frame validation via Qwen-VL.

For each scene's frame, asks Qwen-VL one yes/no question per rule from
the project's ValidationRules. Emits a per-scene pass/fail report so
the agent (or human) can decide whether to proceed to Stage 03 ($0.60
per shot) or iterate on Stage 02 first ($0.06 per frame).

v0.2 scope: REPORT ONLY. No auto-fix loop, no retries, no HITL
escalation. Those land in v0.2.5 and v0.3 respectively.

Output: ``output/_validation_report.json`` with structure:

    {
      "<scene_id>": {
        "name": "the_catch",
        "frame_path": "...",
        "rule_count": 7,
        "checks": [
          {"kind": "must_contain", "rule": "...", "vlm_answer": "yes", "passed": true},
          {"kind": "composition",  "rule": "...", "vlm_answer": "no",  "passed": false},
          ...
        ],
        "passed": false,
        "failures": [{"kind": "...", "rule": "...", "vlm_answer": "..."}]
      },
      "_summary": {
        "scenes_checked": 6,
        "scenes_passed": 2,
        "scenes_failed": 4,
        "total_questions": 42,
        "estimated_cost_usd": 0.04
      }
    }
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import sys
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
_SKILL_DIR = _HERE.parent
_REPO_ROOT = _SKILL_DIR.parents[4]
_REPO_SRC = _REPO_ROOT / "src"
_TOOLS_DIR = _REPO_ROOT / "plugins" / "tool"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from spec import ProjectSpec, SceneValidationRules  # noqa: E402

logger = logging.getLogger(__name__)

# Approximate per-question cost on qwen-vl-max-latest.
_COST_PER_QUERY_USD = 0.001


def _load_qwen_vl_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="qwen-vl",
        tool_file="qwen_vl_tool.py",
        module_name="qwen_vl_tool",
    )


def _block_text(block) -> str:
    """TextBlock can be dict (agentscope 1.0.x) or object."""
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_yes_no(answer: str) -> Optional[bool]:
    """Parse a yes/no answer from the model.

    Tolerates Mandarin (是/否), case, punctuation. Returns None when
    the answer isn't recognizable as yes-or-no — caller should mark the
    check as "indeterminate" rather than auto-failing.
    """
    a = answer.strip().lower().rstrip(".!,;:'\"")
    if not a:
        return None
    if a in ("yes", "y", "true", "是", "对", "yeah", "yep"):
        return True
    if a in ("no", "n", "false", "否", "不是", "nope"):
        return False
    # Leading word — model sometimes says "yes, because ..." or "no — ..."
    first = a.split(None, 1)[0].rstrip(".,;:'\"")
    if first in ("yes", "y", "true", "是", "对"):
        return True
    if first in ("no", "n", "false", "否", "不是"):
        return False
    return None


def _format_question(kind: str, rule: str) -> str:
    """Format a yes/no question for Qwen-VL based on the rule kind."""
    if kind == "must_contain":
        return (
            f"Looking at this image, is the following clearly visible "
            f"or unambiguously present: \"{rule}\"? Answer ONLY 'yes' "
            f"or 'no'."
        )
    if kind == "must_not_contain":
        return (
            f"Looking at this image, is the following present anywhere "
            f"in the image: \"{rule}\"? Answer ONLY 'yes' or 'no'."
        )
    if kind == "composition":
        return (
            f"Looking at this image, evaluate this claim: \"{rule}\". "
            f"Answer ONLY 'yes' if the claim is true of the image, or "
            f"'no' if the claim is false."
        )
    # Fallback — treat as composition.
    return (
        f"Looking at this image, is this claim true: \"{rule}\"? "
        f"Answer ONLY 'yes' or 'no'."
    )


def _expected_for(kind: str) -> bool:
    """The yes/no answer that means the rule passed."""
    if kind == "must_not_contain":
        return False
    return True   # must_contain, composition both expect yes


def _rules_for_scene(
    project_spec: ProjectSpec,
    scene_id: str,
) -> list[tuple[str, str]]:
    """Return [(kind, rule_text), ...] for a scene, merging global + per-scene rules.

    Global rules are skipped on standalone scenes (no character, no
    skiff — most global rules wouldn't apply anyway).
    """
    rules: list[tuple[str, str]] = []
    scene = next((s for s in project_spec.scenes if s.scene_id == scene_id), None)
    if scene is None:
        return rules

    v = project_spec.validation
    if not scene.standalone:
        for r in v.global_must_not_contain:
            rules.append(("must_not_contain", r))
        for r in v.global_must_contain:
            rules.append(("must_contain", r))

    per = v.per_scene.get(scene_id, SceneValidationRules())
    for r in per.must_contain:
        rules.append(("must_contain", r))
    for r in per.must_not_contain:
        rules.append(("must_not_contain", r))
    for r in per.composition:
        rules.append(("composition", r))
    return rules


async def _validate_one_rule(
    qvl,
    frame_path: Path,
    kind: str,
    rule: str,
    api_key: str,
) -> dict:
    """Run one Qwen-VL question; return a check-result dict."""
    question = _format_question(kind, rule)
    resp = await qvl.vlm_check_image(
        image_path=str(frame_path),
        question=question,
        api_key=api_key,
    )
    answer_text = _block_text(resp.content[-1]) if resp.content else ""
    if answer_text.startswith("Error:"):
        return {
            "kind": kind,
            "rule": rule,
            "question": question,
            "vlm_answer": answer_text,
            "passed": False,
            "indeterminate": True,
        }
    parsed = _parse_yes_no(answer_text)
    expected = _expected_for(kind)
    if parsed is None:
        return {
            "kind": kind,
            "rule": rule,
            "question": question,
            "vlm_answer": answer_text,
            "passed": False,
            "indeterminate": True,
        }
    passed = (parsed == expected)
    return {
        "kind": kind,
        "rule": rule,
        "question": question,
        "vlm_answer": answer_text,
        "passed": passed,
        "indeterminate": False,
    }


async def validate_one_image(
    qvl,
    frame_path: Path,
    project_spec: ProjectSpec,
    scene_id: str,
    api_key: str,
) -> dict:
    """Run every rule for ``scene_id`` against one image; return a result dict.

    Reusable atomic unit shared by:
      - ``run_stage_02_5()`` — whole-project report
      - ``stage_02_select.choose_best_candidate()`` — score N candidates

    Args:
        qvl: Loaded qwen-vl tool module (from ``_load_qwen_vl_tool``).
        frame_path: PNG file to validate.
        project_spec: ProjectSpec (used for rule lookup).
        scene_id: Which scene's rules to apply.
        api_key: DashScope API key.

    Returns:
        ``{
            "checks": [{kind, rule, question, vlm_answer, passed, indeterminate}, ...],
            "rule_count": int,
            "failures": [<subset of checks where passed=False>],
            "passed": bool,
        }``
    """
    rules = _rules_for_scene(project_spec, scene_id)
    if not rules:
        return {
            "checks": [],
            "rule_count": 0,
            "failures": [],
            "passed": True,
        }
    # Rule-checks are independent — run concurrently for speed.
    checks = await asyncio.gather(
        *(
            _validate_one_rule(qvl, frame_path, kind, rule, api_key)
            for kind, rule in rules
        ),
        return_exceptions=False,
    )
    failures = [c for c in checks if not c["passed"]]
    return {
        "checks": list(checks),
        "rule_count": len(checks),
        "failures": failures,
        "passed": len(failures) == 0,
    }


async def run_stage_02_5(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene: Optional[str] = None,
    report_path: Optional[Path] = None,
) -> dict:
    """Validate every scene's frame against its rules.

    Args:
        project_spec: ProjectSpec (with validation rules loaded).
        output_dir: Where frame PNGs live and where the report goes.
        api_key: DashScope key (passed to qwen-vl plugin).
        only_scene: When set, validate only this scene id.
        report_path: Override the default report location.

    Returns:
        The full report dict (also written to disk).
    """
    qvl = _load_qwen_vl_tool()
    report: dict = {}
    total_questions = 0

    target = [
        s for s in project_spec.scenes
        if only_scene is None
        or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}")
    ]

    for scene in target:
        rules = _rules_for_scene(project_spec, scene.scene_id)
        if not rules:
            logger.info(f"[skip] scene {scene.scene_id}: no validation rules")
            continue
        frame_path = output_dir / f"{scene.scene_id}_{scene.name}_frame.png"
        if not frame_path.exists():
            logger.warning(
                f"[skip] scene {scene.scene_id}: frame not found at {frame_path}",
            )
            continue

        logger.info(
            f"[validate] scene {scene.scene_id}_{scene.name}: "
            f"{len(rules)} rule(s)",
        )

        result = await validate_one_image(
            qvl, frame_path, project_spec, scene.scene_id, api_key,
        )
        total_questions += result["rule_count"]
        report[scene.scene_id] = {
            "name": scene.name,
            "frame_path": str(frame_path),
            "rule_count": result["rule_count"],
            "checks": result["checks"],
            "passed": result["passed"],
            "failures": result["failures"],
        }
        status = "✓" if result["passed"] else "✗"
        logger.info(
            f"  {status} scene {scene.scene_id}: "
            f"{result['rule_count'] - len(result['failures'])}/{result['rule_count']} rules pass",
        )

    summary = {
        "scenes_checked": len(report),
        "scenes_passed": sum(1 for s in report.values() if s["passed"]),
        "scenes_failed": sum(1 for s in report.values() if not s["passed"]),
        "total_questions": total_questions,
        "estimated_cost_usd": round(total_questions * _COST_PER_QUERY_USD, 4),
    }
    report["_summary"] = summary

    out = report_path or (output_dir / "_validation_report.json")
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    logger.info(
        f"Validation report → {out}  "
        f"({summary['scenes_passed']}/{summary['scenes_checked']} passed, "
        f"{summary['total_questions']} queries, "
        f"~${summary['estimated_cost_usd']})",
    )
    return report


def main():
    import argparse
    import os

    sys.path.insert(0, str(_REPO_ROOT / "examples" / "storybook-video"))
    from prompts import OLD_MAN_PROJECT  # noqa: E402

    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="output",
                        help="Where frame PNGs live and where the report goes")
    parser.add_argument("--scene", default=None,
                        help="Validate only one scene (e.g. '04' or '04_the_catch')")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: DASHSCOPE_API_KEY not set")
        sys.exit(1)

    asyncio.run(run_stage_02_5(
        OLD_MAN_PROJECT,
        Path(args.output_dir),
        api_key=api_key,
        only_scene=args.scene,
    ))


if __name__ == "__main__":
    main()
