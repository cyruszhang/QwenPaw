# -*- coding: utf-8 -*-
"""Storybook-video pipeline stages — each module is invokable as a step.

Stage order (and runtime dependency order):

1. ``stage_01_script`` — narration TTS + duration calibration (cheapest)
2. ``stage_02_assets`` — Qwen-Image frame generation
3. ``stage_03_shots`` — Wan 2.7 I2V animation per scene
4. ``stage_04_assemble`` — overlays + audio mix + uniform scale + concat

Stage 01 runs *before* 02/03 on purpose: TTS costs pennies, video gen
costs dollars. Catching oversize narration before any Wan call is the
Cardinal Rule from the director-SKILL.md cookbook.
"""
