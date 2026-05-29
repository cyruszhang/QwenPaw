# Qwen-Image 2.0 Pro — Model Quirks

The hard-won knowledge from director-SKILL.md, plus anything that bit
us during a benchmark run. Future runs of Stage 02 should pre-flight
against this file.

## Consistency strategy (the v11 trick)

Three layers must all be in place to keep the character/style stable
across panels:

1. **Fixed `seed`** — same noise initialization. Use `seed=42` (v11
   default) or whatever the user picked. Without this, character drift
   begins immediately.
2. **Verbatim character + spatial prefix** on every panel — small
   wording changes ("fisherman" → "old man", "frayed" → "worn") break
   consistency. Copy-paste, don't paraphrase.
3. **`prompt_extend=False`** — DashScope's prompt-rewriter "improves"
   your prompt before generation. That destroys the verbatim prefix
   silently. Disable it.

## Hallucination patterns (Old Man and the Sea calibration)

The model adds things that aren't in the prompt. Negative constraints
("no swords", "no cabin") barely help — describe what IS there instead.

| Hallucination | Fix |
|---|---|
| Cabin on the skiff | `"no cabin"` in spatial_prefix *and* describe the actual hull shape |
| Cross-beams / yards on the mast | `"single straight vertical wooden mast, no cross-beams or yards"` |
| Weapons (sword, saber) instead of oar | Describe the actual object: `"long wooden oar"` — don't say "NO swords" |
| Extra fishermen / boats in background | Anchor character explicitly: `"Old man rows alone"` + `"no large boats or ships"` |

## Negative constraints rule of thumb

```
❌ "ONLY oar and knife, NO swords, NO sabers, NO metal weapons"
   — model ignores it
✅ "wooden oar and a fishing knife"
   — describe what IS there, not what isn't
```

## Relative-size composition

The model struggles with "X is bigger than Y" and defaults to equal
importance. To make one element dominate:

```
❌ "The marlin on the right, the skiff on the left"
   — both compete for attention
✅ "Filling the entire frame, a giant marlin. Far below, the tiny skiff..."
   — dominate by frame coverage in the description
```

## Multi-frame layouts

`qwen-image-2.0-pro` does **not** support storyboard-grid layouts —
"PANEL 1 / PANEL 2" instructions confuse the model. One frame per
call; consistency comes from seed + verbatim prefix, not multi-panel
composition.

(For the GPT-Image-2 alternative pipeline that DOES use single-image
multi-panel storyboards, see director-SKILL.md §3 — different model,
different approach.)

## Sizes that work

DashScope enforces sizes divisible by 16 in both dimensions. Valid
choices on qwen-image-2.0 series:

| Size | Ratio | Use |
|---|---|---|
| `2688*1536` | 16:9 | Default storybook landscape ✓ |
| `1536*2688` | 9:16 | Vertical (TikTok / Reels) |
| `2048*2048` | 1:1 | Square (IG carousel) |
| `2368*1728` | 4:3 | Legacy ratio |

## Pricing (DashScope, 2026-05)

- $0.06 per image (flat)
- Free trial includes a few credits per account

## Per-run additions

*(Run Phase B/C, then append findings here.)*
