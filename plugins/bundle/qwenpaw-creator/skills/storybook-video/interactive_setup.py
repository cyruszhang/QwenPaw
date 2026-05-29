# -*- coding: utf-8 -*-
"""Interactive Stage 0 — anchor-by-anchor selection (v0.5, deferred).

v0 ships hardcoded prompts in ``prompts.py``. This module is the v0.5
plug-in point — it produces a ProjectSpec by walking the user through
three authoring modes per anchor:

| Mode | What it does                                                        |
|------|---------------------------------------------------------------------|
| 1    | Text-only PE — user writes the anchor text directly                 |
| 2    | Generate-and-approve — user writes a description, agent generates,  |
|      | user iterates with feedback until approved                          |
| 3    | Upload reference — user provides image; agent vision-describes it   |

The v0.5 implementation will land alongside the agentic wrapper. When
the qwenpaw-creator bundle plugin ships, this stdin-driven flow becomes
an agent + ``proposal_choice`` pause-and-pick primitive — the data
shape (ProjectSpec) stays identical.

The stubs below exist now so that:
- The dataclass shape compiles end-to-end.
- A type-checker confirms the function signatures match what the agent
  wrapper will need.
- The benchmark runner can swap in this module in place of prompts.py
  once the v0.5 work lands.
"""

from __future__ import annotations

from pathlib import Path

from spec import AnchorSet, ProjectSpec, SceneSpec


def elicit_text_anchor(prompt: str, default: str = "") -> str:
    """Mode 1 — text-only PE. Read anchor text from stdin.

    Args:
        prompt: User-facing prompt explaining what anchor we're eliciting.
        default: Default value if user just hits enter.

    Returns:
        The user's anchor text (verbatim, no transformation).
    """
    raise NotImplementedError(
        "v0.5 stub — implement in the interactive Stage 0 work."
    )


def elicit_generated_anchor(
    description: str,
    anchor_kind: str,
    style_bookend: str,
    dashscope_api_key: str,
) -> tuple[str, Path]:
    """Mode 2 — generate-and-approve.

    Iterates: call generate_image_qwen with (description + style_bookend),
    show the result, ask the user to approve / iterate-with-feedback /
    discard. On approve, returns (description, image_path).

    Args:
        description: Initial description the user typed.
        anchor_kind: "character", "style", "spatial" — picks the prompt
            template used during iteration.
        style_bookend: Style suffix appended to every generation call.
        dashscope_api_key: DashScope key for generate_image_qwen.

    Returns:
        (approved_description, locked_image_path)
    """
    raise NotImplementedError(
        "v0.5 stub — implement using generate_image_qwen iteratively."
    )


def elicit_from_reference(
    image_path: Path,
    anchor_kind: str,
    dashscope_api_key: str,
) -> tuple[str, Path]:
    """Mode 3 — upload reference + vision-describe.

    Calls a vlm_describe helper (Qwen-VL on DashScope) to extract a
    verbatim physical-description of the reference, suitable as an
    anchor prefix. Shows it to the user for confirmation.

    Args:
        image_path: Local path to the user's reference image.
        anchor_kind: "character", "style", "spatial" — chooses the
            vision prompt template.
        dashscope_api_key: DashScope key for Qwen-VL.

    Returns:
        (verbatim_description, image_path)
    """
    raise NotImplementedError(
        "v0.5 stub — implement with qwen-vl-max-latest."
    )


def run_interactive_setup(dashscope_api_key: str) -> ProjectSpec:
    """v0.5 entry point — walk the user through anchor selection and
    scene authoring, return a fully-built ProjectSpec.

    Replaces ``from prompts import OLD_MAN_PROJECT`` with a live flow.
    """
    raise NotImplementedError(
        "v0.5 stub. Today, import OLD_MAN_PROJECT from prompts.py for "
        "the benchmark. This function will land with the agent wrapper."
    )


# Silence unused-import warnings on this stub module — the symbols are
# documented contract pieces, not yet exercised by the v0 benchmark.
__all__ = [
    "AnchorSet",
    "SceneSpec",
    "ProjectSpec",
    "elicit_text_anchor",
    "elicit_generated_anchor",
    "elicit_from_reference",
    "run_interactive_setup",
]
