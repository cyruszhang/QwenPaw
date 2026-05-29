# -*- coding: utf-8 -*-
"""Stage 02 with N-candidate take-selection.

The cheap-precursor pattern from the director-SKILL.md cookbook, taken
one step further: instead of generating ONE frame per scene and hoping
it passes validation, generate N candidates per scene, validate each
via Stage 02.5, and copy the best one as the canonical frame. The
rejected candidates stay under ``output/candidates/`` for inspection.

Per-scene loop (this is the user's "select/validate before moving on
to next page" requirement):

    for scene in scenes:
        N = scene.n_candidates
        for i in range(N):
            seed = base_seed + i             # deterministic + varied
            candidate = generate(scene, seed=seed)
            validation = validate(candidate, scene_rules)
            log to per-scene candidates list
        best = pick_best(candidates)         # fewest failures, ties to seed_offset 0
        copy best.frame → {sid}_{name}_frame.png
        write _selection_report.json
        ← move on to next scene

Cost model: N candidates per scene = N × $0.06 frame cost + ~$0.05 in
validation. Worth it whenever single-shot Qwen-Image has >40% chance
of producing a non-validating frame for that scene.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent       # .../pipeline/
_SKILL_DIR = _HERE.parent                      # .../skills/storybook-video/
_REPO_ROOT = _SKILL_DIR.parents[4]
_REPO_SRC = _REPO_ROOT / "src"
_TOOLS_DIR = _REPO_ROOT / "plugins" / "tool"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from spec import ProjectSpec, assemble_frame_prompt  # noqa: E402

# Reuse the validate-one-image helper (and the qwen-vl loader) from Stage 02.5.
from pipeline.stage_02_5_validate import (  # noqa: E402
    _load_qwen_vl_tool,
    validate_one_image,
)

logger = logging.getLogger(__name__)

# Cost constants (matching run_benchmark.py).
_COST_PER_FRAME_USD = 0.06
_COST_PER_VLM_QUERY_USD = 0.001

# Standalone scenes (00, 07) skip anchor concatenation — same rule as
# stage_02_assets._full_prompt_for.
def _full_prompt_for(spec_proj: ProjectSpec, scene) -> str:
    if scene.standalone:
        return scene.scene_description
    return assemble_frame_prompt(spec_proj.anchors, scene)


def _load_qwen_image_tool():
    plugin_path = _TOOLS_DIR / "qwen-image" / "qwen_image_tool.py"
    spec = importlib.util.spec_from_file_location(
        "qwen_image_tool", plugin_path,
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _block_text(block) -> str:
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_saved_path(tool_response) -> Path:
    """Extract local PNG path from qwen-image TextBlock 'Saved to:' line."""
    text = _block_text(tool_response.content[-1])
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Saved to:"):
            paths = line.split("Saved to:", 1)[1].strip()
            return Path(paths.split(",", 1)[0].strip())
    raise RuntimeError(
        f"Could not parse 'Saved to:' from qwen-image response:\n{text}",
    )


async def generate_one_candidate(
    qi,
    project_spec: ProjectSpec,
    scene,
    *,
    candidates_dir: Path,
    seed: int,
    candidate_index: int,
    api_key: str,
) -> Path:
    """Generate one candidate frame; save under ``candidates_dir`` and return path."""
    full_prompt = _full_prompt_for(project_spec, scene)
    size = project_spec.global_config["image_size"]
    prompt_extend = project_spec.global_config["image_prompt_extend"]

    logger.info(
        f"  [gen cand{candidate_index} seed={seed}] {scene.scene_id}_{scene.name}",
    )

    resp = await qi.generate_image_qwen(
        prompt=full_prompt,
        size=size,
        n=1,
        negative_prompt="",
        prompt_extend=prompt_extend,
        seed=seed,
        api_key=api_key,
    )
    summary = _block_text(resp.content[-1])
    if summary.startswith("Error:"):
        raise RuntimeError(summary)
    qi_path = _parse_saved_path(resp)

    candidates_dir.mkdir(parents=True, exist_ok=True)
    target = candidates_dir / (
        f"{scene.scene_id}_{scene.name}_cand{candidate_index}_seed{seed}.png"
    )
    shutil.copy2(qi_path, target)
    return target


def _score_candidate(validation: dict, seed_offset: int) -> tuple[int, int]:
    """Higher = better. Sort key for picking the best candidate.

    Primary: passes (rule_count - failures); higher = better.
    Tie-break: prefer seed_offset 0 (the locked base seed) — keeps
    cross-scene character consistency when multiple candidates tie.
    """
    passes = validation["rule_count"] - len(validation["failures"])
    return (passes, -seed_offset)


async def select_best_for_scene(
    qi,
    qvl,
    project_spec: ProjectSpec,
    scene,
    output_dir: Path,
    *,
    n_candidates: int,
    api_key: str,
    overwrite: bool = False,
) -> dict:
    """Generate N candidates for one scene, validate each, copy best as canonical.

    Returns the per-scene record for the selection report.
    """
    canonical = output_dir / f"{scene.scene_id}_{scene.name}_frame.png"
    if canonical.exists() and canonical.stat().st_size > 0 and not overwrite:
        logger.info(f"[skip] {canonical.name} exists (use --overwrite)")
        return {
            "scene_id": scene.scene_id,
            "name": scene.name,
            "skipped": True,
            "canonical": str(canonical),
        }

    candidates_dir = output_dir / "candidates"
    base_seed = int(project_spec.global_config["seed"])

    logger.info(
        f"[scene {scene.scene_id}_{scene.name}] generating {n_candidates} candidate(s)",
    )

    # ── Phase 1: generate all candidates (cheap-precursor: image-only) ──
    cand_paths: list[Path] = []
    for i in range(n_candidates):
        seed = base_seed + i
        path = await generate_one_candidate(
            qi, project_spec, scene,
            candidates_dir=candidates_dir,
            seed=seed,
            candidate_index=i,
            api_key=api_key,
        )
        cand_paths.append(path)

    # ── Phase 2: validate each candidate independently (parallel within scene) ──
    logger.info(
        f"[scene {scene.scene_id}] validating {len(cand_paths)} candidate(s)",
    )
    validations = await asyncio.gather(
        *(
            validate_one_image(qvl, p, project_spec, scene.scene_id, api_key)
            for p in cand_paths
        ),
    )

    # ── Phase 3: score + pick ──
    enriched = []
    for i, (path, v) in enumerate(zip(cand_paths, validations)):
        enriched.append({
            "candidate_index": i,
            "seed": base_seed + i,
            "path": str(path),
            "rule_count": v["rule_count"],
            "passes": v["rule_count"] - len(v["failures"]),
            "failures": v["failures"],
            "score": list(_score_candidate(v, i)),
        })

    enriched.sort(key=lambda c: tuple(c["score"]), reverse=True)
    best = enriched[0]
    logger.info(
        f"[scene {scene.scene_id}] picked candidate {best['candidate_index']} "
        f"(seed={best['seed']}, "
        f"{best['passes']}/{best['rule_count']} pass)",
    )

    # ── Phase 4: copy best → canonical ──
    shutil.copy2(best["path"], canonical)

    return {
        "scene_id": scene.scene_id,
        "name": scene.name,
        "n_candidates": n_candidates,
        "base_seed": base_seed,
        "canonical": str(canonical),
        "picked_candidate_index": best["candidate_index"],
        "picked_seed": best["seed"],
        "picked_passes": best["passes"],
        "picked_failures": best["failures"],
        "rule_count": best["rule_count"],
        "all_candidates": enriched,
    }


async def run_stage_02_select(
    project_spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene: Optional[str] = None,
    overwrite: bool = False,
    n_candidates_override: Optional[int] = None,
) -> dict:
    """Per-scene generate-N → validate-each → pick-best.

    Args:
        project_spec: ProjectSpec; per-scene ``n_candidates`` field
            determines how many candidates to generate.
        output_dir: Where canonical frames + candidates/ + report go.
        api_key: DashScope key.
        only_scene: Process only one scene id when set.
        overwrite: Force regeneration even if canonical frame exists.
        n_candidates_override: CLI override — applies to every scene
            (overrides per-scene n_candidates in the YAML).

    Returns:
        Full selection report (also written to ``_selection_report.json``).
    """
    qi = _load_qwen_image_tool()
    qvl = _load_qwen_vl_tool()

    target_scenes = [
        s for s in project_spec.scenes
        if only_scene is None
        or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}")
    ]

    report: dict = {}
    total_frames = 0
    total_vlm_queries = 0

    for scene in target_scenes:
        n = (
            n_candidates_override
            if n_candidates_override is not None
            else scene.n_candidates
        )
        if n < 1:
            logger.warning(f"[skip] scene {scene.scene_id}: n_candidates < 1")
            continue

        scene_report = await select_best_for_scene(
            qi, qvl, project_spec, scene, output_dir,
            n_candidates=n, api_key=api_key, overwrite=overwrite,
        )
        report[scene.scene_id] = scene_report

        if not scene_report.get("skipped"):
            total_frames += n
            # Each candidate ran rule_count VLM queries.
            total_vlm_queries += sum(
                c["rule_count"] for c in scene_report.get("all_candidates", [])
            )

    summary = {
        "scenes_processed": len(report),
        "total_candidates_generated": total_frames,
        "total_vlm_queries": total_vlm_queries,
        "estimated_cost_usd": round(
            total_frames * _COST_PER_FRAME_USD
            + total_vlm_queries * _COST_PER_VLM_QUERY_USD,
            4,
        ),
    }
    report["_summary"] = summary

    out = output_dir / "_selection_report.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    logger.info(
        f"Selection report → {out}  "
        f"({summary['scenes_processed']} scenes, "
        f"{summary['total_candidates_generated']} candidates, "
        f"{summary['total_vlm_queries']} VLM queries, "
        f"~${summary['estimated_cost_usd']})",
    )
    return report


def main():
    import argparse
    import os

    sys.path.insert(0, str(_REPO_ROOT / "examples" / "storybook-video"))
    from prompts import OLD_MAN_PROJECT  # noqa: E402

    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--scene", default=None,
                        help="Only process this scene (e.g. '04' or '04_the_catch')")
    parser.add_argument("--n-candidates", type=int, default=None,
                        help="Override per-scene n_candidates (applies to all)")
    parser.add_argument("--overwrite", action="store_true")
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

    asyncio.run(run_stage_02_select(
        OLD_MAN_PROJECT,
        Path(args.output_dir),
        api_key=api_key,
        only_scene=args.scene,
        overwrite=args.overwrite,
        n_candidates_override=args.n_candidates,
    ))


if __name__ == "__main__":
    main()
