# -*- coding: utf-8 -*-
"""QwenPaw Creator bundle plugin — entry point.

v0.2 status: PANEL UI.

The bundle now ships a full console panel for the storybook-video skill:

  Frontend  →  ``ui/dist/index.js``   (Vite/React, registered as a
                                       /plugin/qwenpaw-creator/storybook
                                       route in the console.)
  Backend   →  ``routers/creator.py`` (FastAPI APIRouter mounted under
                                       /api/creator/*).

The panel walks a user through:

  1. Source upload (drag-drop file OR pasted text).
  2. Decompose (Stage 00 — LLM splits the source into characters /
     scenes / settings → emits a v15 ProjectSpec YAML).
  3. Review + edit the draft.
  4. Run Stage 0 (gpt-image-2 generates ref images for each anchor).
  5. HITL review the refs in the panel.
  6. Run Stage 2 (gpt-image-2 multi-ref edit composes each frame).
  7. HITL review composed panels.
  8. Run Stage 3 (per-scene I2V via Wan / HappyHorse / Seedance).
  9. Run Stage 4 (ffmpeg assembly).
"""

import logging
import sys
from pathlib import Path

# When the plugin loader execs this file as a plain module (no package
# context), sibling files like ``creator_paths`` and ``routers`` are
# only importable after pushing the bundle dir onto sys.path.
_BUNDLE_DIR = str(Path(__file__).resolve().parent)
if _BUNDLE_DIR not in sys.path:
    sys.path.insert(0, _BUNDLE_DIR)

from qwenpaw.plugins.api import PluginApi  # noqa: E402

logger = logging.getLogger("qwenpaw.creator")


class QwenPawCreatorBundle:
    """Creator bundle plugin — mounts /api/creator routes + console panel."""

    def register(self, api: PluginApi) -> None:
        """Register the Creator panel's HTTP routes.

        The console frontend (``ui/dist/index.js``) registers itself
        via ``window.QwenPaw.registerRoutes`` at load time; no extra
        plumbing is needed here for it. We just need to expose the
        backend API the panel talks to.
        """
        try:
            from routers.creator import build_router  # type: ignore[import]
        except Exception:  # noqa: BLE001
            logger.exception(
                "Creator: failed to import routers.creator — "
                "panel will be inert (no /api/creator/*)",
            )
            return

        try:
            api.register_http_router(
                build_router(),
                prefix="/creator",
                tags=["qwenpaw-creator"],
            )
            logger.info(
                "QwenPaw Creator bundle: mounted /api/creator/* routes",
            )
        except Exception:  # noqa: BLE001
            logger.exception(
                "Creator: failed to register HTTP router — "
                "console panel will not be able to reach the backend",
            )


plugin = QwenPawCreatorBundle()
