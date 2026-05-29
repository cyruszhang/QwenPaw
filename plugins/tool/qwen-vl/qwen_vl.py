# -*- coding: utf-8 -*-
"""Qwen-VL Vision-Language Tool Plugin Entry Point."""

import importlib.util
import logging
import os

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    """Load qwen_vl_tool.py from this plugin's directory."""
    tool_path = os.path.join(_PLUGIN_DIR, "qwen_vl_tool.py")
    spec = importlib.util.spec_from_file_location("qwen_vl_tool", tool_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class QwenVLToolPlugin:
    """Qwen-VL Vision-Language Tool Plugin.

    Registers vlm_check_image into the Agent's toolkit.
    """

    def register(self, api: PluginApi):
        tool = _load_tool_module()
        api.register_tool(
            tool_name="vlm_check_image",
            tool_func=tool.vlm_check_image,
            description="Ask a yes/no or short-answer question about an image",
            icon="🔍",
        )
        logger.info("Qwen-VL tool plugin registered")


plugin = QwenVLToolPlugin()
