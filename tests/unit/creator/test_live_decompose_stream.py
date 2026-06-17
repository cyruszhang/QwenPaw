# -*- coding: utf-8 -*-
"""Unit tests for the live Pass-1 decompose streaming primitives.

Covers the two pure helpers behind the SSE live-decompose feature:

  * ``stage_00_script._sse_delta_content`` — parse one DashScope
    OpenAI-compatible streaming ``data:`` line into its content delta.
  * ``progress.StreamCoalescer`` — throttle token deltas into
    low-frequency, drop-robust full-text snapshots.

Both helpers are import-light (stdlib only at module load), so the test
adds the plugin dirs to ``sys.path`` and imports them directly — it does
not need the ``qwenpaw`` package. It runs either under pytest or
standalone (``python test_live_decompose_stream.py``), which is handy
while the repo's pytest/venv setup is being sorted out.
"""

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
_PLUGIN = _REPO / "plugins" / "bundle" / "qwenpaw-creator"
for _p in (_PLUGIN, _PLUGIN / "skills" / "storybook-video" / "pipeline"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

# Imports follow the sys.path setup above (the plugin dirs aren't an
# installed package), so they intentionally aren't at module top.
# pylint: disable=wrong-import-position,protected-access
from progress import StreamCoalescer  # noqa: E402
import stage_00_script as s00  # noqa: E402

_delta = s00._sse_delta_content


# ── _sse_delta_content ──────────────────────────────────────────────


def test_delta_extracts_content():
    line = 'data: {"choices":[{"delta":{"content":"hello"}}]}'
    assert _delta(line) == "hello"


def test_delta_handles_leading_whitespace_and_crlf():
    line = '  data: {"choices":[{"delta":{"content":"x"}}]}\r'
    assert _delta(line) == "x"


def test_delta_done_sentinel_is_none():
    assert _delta("data: [DONE]") is None


def test_delta_blank_and_comment_lines_are_none():
    assert _delta("") is None
    assert _delta("\n") is None
    assert _delta(": keep-alive comment") is None
    assert _delta("event: message") is None


def test_delta_role_only_chunk_is_none():
    # First streamed chunk often carries role but no content.
    line = 'data: {"choices":[{"delta":{"role":"assistant"}}]}'
    assert _delta(line) is None


def test_delta_empty_content_string_is_none():
    line = 'data: {"choices":[{"delta":{"content":""}}]}'
    assert _delta(line) is None


def test_delta_malformed_json_is_none():
    assert _delta("data: {not json") is None
    assert _delta("data: {}") is None
    assert _delta('data: {"choices":[]}') is None


def test_delta_preserves_literal_data_prefix_in_value():
    # A content delta that itself contains "data:" must round-trip.
    payload = {"choices": [{"delta": {"content": "see data: here"}}]}
    assert _delta("data: " + json.dumps(payload)) == "see data: here"


def test_delta_stream_reassembles_to_valid_json():
    # Split a small JSON object across content deltas the way the API
    # would, then confirm joining the deltas reproduces the object.
    obj = {"project_id": "p", "beats": [{"name": "a"}, {"name": "b"}]}
    full = json.dumps(obj)
    pieces = [full[i : i + 5] for i in range(0, len(full), 5)]
    lines = [
        "data: " + json.dumps({"choices": [{"delta": {"content": p}}]})
        for p in pieces
    ]
    lines.append("data: [DONE]")
    acc = "".join(d for ln in lines if (d := _delta(ln)) is not None)
    assert json.loads(acc) == obj


# ── StreamCoalescer ─────────────────────────────────────────────────


def test_coalescer_buffers_until_threshold():
    c = StreamCoalescer(min_chars=10)
    assert c.push("1234") is None  # 4 chars buffered
    assert c.push("5678") is None  # 8 chars buffered
    snap = c.push("9abc")  # crosses 10 → flush
    assert snap == "123456789abc"
    assert c.text == "123456789abc"


def test_coalescer_snapshot_is_full_text_not_delta():
    c = StreamCoalescer(min_chars=4)
    assert c.push("aaaa") == "aaaa"
    # Next flush returns the FULL accumulated text, not just new chars —
    # this is what makes dropped SSE events safe.
    assert c.push("bbbb") == "aaaabbbb"


def test_coalescer_newline_forces_flush_under_threshold():
    c = StreamCoalescer(min_chars=1000)
    assert c.push("hi\n") == "hi\n"  # newline boundary flushes


def test_coalescer_flush_returns_unflushed_tail_once():
    c = StreamCoalescer(min_chars=1000)
    assert c.push("abc") is None  # below threshold, buffered
    assert c.flush() == "abc"  # tail emitted
    assert c.flush() is None  # nothing new since


def test_coalescer_flush_noop_when_everything_emitted():
    c = StreamCoalescer(min_chars=2)
    assert c.push("xy") == "xy"  # emitted via threshold
    assert c.flush() is None  # nothing pending


def test_coalescer_ignores_empty_pushes():
    c = StreamCoalescer(min_chars=2)
    assert c.push("") is None
    assert c.text == ""


def test_coalescer_min_chars_floor():
    # A non-positive min_chars must not wedge the coalescer.
    c = StreamCoalescer(min_chars=0)
    assert c.push("a") == "a"


def _run_standalone() -> int:
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ok   {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ERR  {fn.__name__}: {exc!r}")
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_run_standalone())
