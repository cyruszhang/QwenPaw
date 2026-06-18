# -*- coding: utf-8 -*-
"""Unit tests for the Pass-2 craft language pin.

The craft step fans out one independent LLM call per beat; with nothing
pinning the language, a single story ends up with some scenes in English
and some in Chinese. ``_dominant_language`` / ``_language_directive``
sample the source once so every beat call is pinned to one language.

These helpers are pure, but ``stage_00_v2`` pulls heavier deps at import,
so the test extracts just the two functions via ``ast`` and execs them in
isolation. Runs under pytest or standalone
(``python test_language_consistency.py``).
"""

import ast
from pathlib import Path

# pylint: disable=wrong-import-position
_REPO = Path(__file__).resolve().parents[3]
_SRC = (
    _REPO
    / "plugins"
    / "bundle"
    / "qwenpaw-creator"
    / "skills"
    / "storybook-video"
    / "pipeline"
    / "stage_00_v2.py"
)


def _load_helpers():
    tree = ast.parse(_SRC.read_text(encoding="utf-8"))
    wanted = {"_dominant_language", "_language_directive"}
    mod = ast.Module(
        body=[
            n
            for n in tree.body
            if isinstance(n, ast.FunctionDef) and n.name in wanted
        ],
        type_ignores=[],
    )
    ns: dict = {}
    exec(compile(mod, "<helpers>", "exec"), ns)  # noqa: S102
    return ns["_dominant_language"], ns["_language_directive"]


_dominant_language, _language_directive = _load_helpers()


def test_detects_chinese():
    zh = "林浩站在更衣室中央，目光坚定地扫视队友们。他举起拳头，大声鼓励大家。"
    assert _dominant_language(zh) == "Chinese (中文)"


def test_detects_english():
    en = "Lin Hao stands up, his teammates follow. They bump shoulders."
    assert _dominant_language(en) == "English"


def test_short_or_ambiguous_is_none():
    assert _dominant_language("ok") is None
    assert _dominant_language("") is None


def test_directive_pins_chinese_for_chinese_beats():
    beats = [
        {"summary": "林浩站在更衣室中央，目光坚定地扫视队友们"},
        {"summary": "林浩在中场敏锐地断下对方的传球，迅速转身"},
    ]
    out = _language_directive(beats, {})
    assert "Chinese (中文)" in out
    assert "EVERY scene" in out


def test_directive_falls_back_when_unsure():
    out = _language_directive([{"summary": "ok"}], {})
    assert "dominant language of the source story" in out


def test_directive_samples_story_anchor_when_beats_thin():
    # Beats are terse but the story anchor is clearly Chinese.
    beats = [{"summary": "go"}]
    gc = {"story_anchor": "一个关于足球队的故事，讲述他们如何团结一致赢得比赛。"}
    out = _language_directive(beats, gc)
    assert "Chinese (中文)" in out


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok: {fn.__name__}")
    print(f"\nAll {len(fns)} language-consistency tests passed.")
