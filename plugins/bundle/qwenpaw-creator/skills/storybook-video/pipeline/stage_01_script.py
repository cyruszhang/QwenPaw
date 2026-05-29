# -*- coding: utf-8 -*-
"""Stage 01 — narration TTS + duration calibration.

Runs FIRST in the pipeline. The Cardinal Rule from director-SKILL.md:
calibrate audio BEFORE expensive Wan calls. TTS costs pennies; Wan
costs dollars. A 12-second narration that won't fit a 10-second scene
is something we catch here, not after burning $1 on the wrong-length
animation.

Output per scene-with-narration:
  - ``output/{##}_{name}_narration.mp3`` — the synthesized audio
  - ``output/_script_audit.json`` — per-scene calibration report:
      duration_s, words, wps, target_video_s, fits

If any scene's narration is longer than ``scene.duration - 1.0`` and
``--allow-overrun`` is not set, the stage exits non-zero. The trailing
1-second buffer matches the director-skill heuristic.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Make sibling modules importable when run as a script.
_HERE = Path(__file__).resolve().parent       # .../pipeline/
_SKILL_DIR = _HERE.parent                      # .../skills/storybook-video/
_REPO_ROOT = _SKILL_DIR.parents[4]             # storybook-video → skills → qwenpaw-creator → bundle → plugins → repo
_REPO_SRC = _REPO_ROOT / "src"
_TOOLS_DIR = _REPO_ROOT / "plugins" / "tool"
sys.path.insert(0, str(_SKILL_DIR))
sys.path.insert(0, str(_REPO_SRC))

from ffmpeg_recipes import probe_duration  # noqa: E402
from spec import ProjectSpec  # noqa: E402

logger = logging.getLogger(__name__)


def _load_cosyvoice_tool():
    from tools_loader import load_tool_module  # type: ignore

    return load_tool_module(
        tool_id="cosyvoice",
        tool_file="cosyvoice_tool.py",
        module_name="cosyvoice_tool",
    )


def _probe_duration_s(media: Path) -> float:
    res = subprocess.run(
        probe_duration(media), capture_output=True, text=True, check=True,
    )
    return float(res.stdout.strip())


def _block_text(block) -> str:
    """Extract the text from a TextBlock, tolerating both dict + object shapes.

    agentscope 1.0.20 returns TextBlock as a TypedDict (subscript access);
    later versions return it as an object (attribute access). We handle
    both so the pipeline survives an agentscope minor-version bump.
    """
    if isinstance(block, dict):
        return block.get("text", "")
    return getattr(block, "text", "")


def _parse_saved_path(tool_response) -> Path:
    """Extract the local file path from the cosyvoice TextBlock summary.

    The tool puts ``Saved to: <path>`` on its own line in the last
    TextBlock. We split on that prefix and take the path.
    """
    text = _block_text(tool_response.content[-1])
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("Saved to:"):
            return Path(line.split("Saved to:", 1)[1].strip())
    raise RuntimeError(
        f"Could not parse 'Saved to:' from cosyvoice response:\n{text}",
    )


async def synthesize_one(
    cosyvoice,
    text: str,
    voice: str,
    fmt: str,
    sample_rate: int,
    speech_rate: float,
    api_key: str,
) -> Path:
    """Call cosyvoice once; return the local mp3 path."""
    resp = await cosyvoice.synthesize_speech_cosyvoice(
        text=text,
        voice=voice,
        format=fmt,
        sample_rate=sample_rate,
        speech_rate=speech_rate,
        api_key=api_key,
    )
    text_summary = _block_text(resp.content[-1])
    if text_summary.startswith("Error:"):
        raise RuntimeError(text_summary)
    return _parse_saved_path(resp)


async def run_stage_01(
    spec: ProjectSpec,
    output_dir: Path,
    *,
    api_key: str,
    only_scene: str | None = None,
    overwrite: bool = False,
    allow_overrun: bool = False,
) -> dict:
    """Generate narration MP3s for every scene with has_narration=True.

    Args:
        spec: ProjectSpec from prompts.py (or v0.5 interactive_setup).
        output_dir: Where to write ``{##}_{name}_narration.mp3``.
        api_key: DashScope key (passed through to cosyvoice).
        only_scene: When set ("01" or "01_solitary_sailor"), processes
            only that scene. Phase B uses this.
        overwrite: When False, skips scenes whose mp3 already exists.
        allow_overrun: When True, downgrade duration-overrun from error
            to warning (lets you iterate without failing the run).

    Returns:
        The audit dict that was also written to _script_audit.json.

    Raises:
        SystemExit(2) if any scene's narration overruns its target and
        allow_overrun=False.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    cv = _load_cosyvoice_tool()

    gc = spec.global_config or {}
    voice = gc.get("voice", "longshu_v2")
    fmt = gc.get("tts_format", "mp3")
    sr = int(gc.get("tts_sample_rate", 22050))
    rate = float(gc.get("tts_speech_rate", 1.0))

    target_scenes = [
        s for s in spec.scenes
        if s.has_narration
        and (only_scene is None or only_scene in (s.scene_id, f"{s.scene_id}_{s.name}"))
    ]

    audit = {}
    any_overrun = False

    for scene in target_scenes:
        narration = spec.narration.get(scene.scene_id, "").strip()
        if not narration:
            logger.warning(
                f"Scene {scene.scene_id} marked has_narration but no text — skipping"
            )
            continue

        target_mp3 = output_dir / f"{scene.scene_id}_{scene.name}_narration.mp3"

        if target_mp3.exists() and target_mp3.stat().st_size > 0 and not overwrite:
            logger.info(f"[skip] {target_mp3.name} exists")
        else:
            logger.info(f"[tts ] {scene.scene_id}_{scene.name}: {len(narration)} chars")
            cv_path = await synthesize_one(
                cv, narration, voice, fmt, sr, rate, api_key,
            )
            shutil.copy2(cv_path, target_mp3)
            logger.info(f"        → {target_mp3.name}")

        duration = _probe_duration_s(target_mp3)
        words = len(narration.split())
        wps = words / duration if duration > 0 else 0.0
        budget_s = scene.duration - 1.0   # 1s buffer per Cardinal Rule
        fits = duration <= budget_s

        audit[scene.scene_id] = {
            "name": scene.name,
            "narration_chars": len(narration),
            "words": words,
            "duration_s": round(duration, 3),
            "wps": round(wps, 3),
            "target_video_s": scene.duration,
            "budget_s": budget_s,
            "fits": fits,
        }

        status = "✓" if fits else "✗"
        logger.info(
            f"  {status} duration={duration:.2f}s / budget={budget_s:.1f}s "
            f"({wps:.2f} wps)"
        )
        if not fits:
            any_overrun = True

    audit_path = output_dir / "_script_audit.json"
    audit_path.write_text(json.dumps(audit, indent=2, ensure_ascii=False))
    logger.info(f"Audit written to {audit_path}")

    if any_overrun and not allow_overrun:
        # In CLI mode the caller catches NarrationOverrunError and exits
        # non-zero; in panel mode the router catches it and surfaces the
        # warning. Never raise ``SystemExit`` here — that would kill the
        # uvicorn worker hosting the panel.
        raise NarrationOverrunError(
            "Narration overrun detected on at least one scene. "
            "Either re-decompose with shorter narration, raise scene "
            "duration, or re-run Stage 1 with allow_overrun=True.",
            audit=audit,
        )
    return {"audit": audit, "any_overrun": any_overrun}


class NarrationOverrunError(RuntimeError):
    """Raised by ``run_stage_01`` when a narration clip exceeds its
    scene budget. Carries the per-scene audit dict so the caller can
    surface specifics."""

    def __init__(self, message: str, *, audit: dict):
        super().__init__(message)
        self.audit = audit


def main():
    """CLI entry: python -m pipeline.stage_01_script ..."""
    import argparse
    from prompts import OLD_MAN_PROJECT  # noqa: E402

    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="output")
    parser.add_argument("--scene", default=None,
                        help="Run only one scene (e.g. '01' or '01_solitary_sailor')")
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--allow-overrun", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    api_key = os.environ.get("DASHSCOPE_API_KEY", "").strip()
    if not api_key:
        print("ERROR: DASHSCOPE_API_KEY not set in environment.")
        sys.exit(1)

    asyncio.run(run_stage_01(
        OLD_MAN_PROJECT,
        Path(args.output_dir),
        api_key=api_key,
        only_scene=args.scene,
        overwrite=args.overwrite,
        allow_overrun=args.allow_overrun,
    ))


if __name__ == "__main__":
    main()
