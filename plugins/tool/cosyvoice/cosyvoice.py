# -*- coding: utf-8 -*-
"""CosyVoice TTS Tool Plugin Entry Point."""

import importlib.util
import logging
import os

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    """Load cosyvoice_tool.py from this plugin's directory via importlib."""
    tool_path = os.path.join(_PLUGIN_DIR, "cosyvoice_tool.py")
    spec = importlib.util.spec_from_file_location(
        "cosyvoice_tool",
        tool_path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class CosyVoiceToolPlugin:
    """CosyVoice TTS Tool Plugin.

    Registers synthesize_speech_cosyvoice into the Agent's toolkit.
    """

    def register(self, api: PluginApi):
        """Register the CosyVoice TTS tool.

        Args:
            api: PluginApi instance.
        """
        tool = _load_tool_module()

        api.register_tool(
            tool_name="synthesize_speech_cosyvoice",
            tool_func=tool.synthesize_speech_cosyvoice,
            description=(
                "Generate speech audio from text using CosyVoice"
            ),
            icon="🎙️",
        )

        logger.info("CosyVoice tool plugin registered")


# Export plugin instance
plugin = CosyVoiceToolPlugin()
