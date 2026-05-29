# -*- coding: utf-8 -*-
"""Doubao Seedance video generation tool plugin entry point."""

import importlib.util
import logging
import os

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    tool_path = os.path.join(_PLUGIN_DIR, "seedance_tool.py")
    spec = importlib.util.spec_from_file_location(
        "seedance_tool", tool_path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SeedanceToolPlugin:
    """ByteDance Seedance 2.0 video generation tools (via DashScope)."""

    def register(self, api: PluginApi):
        tool = _load_tool_module()
        api.register_tool(
            tool_name="text_to_video_seedance",
            tool_func=tool.text_to_video_seedance,
            description="Generate a video from a text prompt with Seedance 2.0",
            icon="🌱",
        )
        api.register_tool(
            tool_name="image_to_video_seedance",
            tool_func=tool.image_to_video_seedance,
            description="Generate a video from a starting image with Seedance 2.0",
            icon="🌱",
        )
        api.register_tool(
            tool_name="reference_to_video_seedance",
            tool_func=tool.reference_to_video_seedance,
            description="Generate a video with multi-modal references using Seedance 2.0",
            icon="🌱",
        )
        logger.info("Seedance tool plugin registered")


plugin = SeedanceToolPlugin()
