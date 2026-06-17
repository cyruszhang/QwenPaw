# -*- coding: utf-8 -*-
"""HappyHorse video generation tool plugin entry point."""

import importlib.util
import logging
import os

from qwenpaw.plugins.api import PluginApi

logger = logging.getLogger(__name__)

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_tool_module():
    tool_path = os.path.join(_PLUGIN_DIR, "happyhorse_tool.py")
    spec = importlib.util.spec_from_file_location(
        "happyhorse_tool",
        tool_path,
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HappyHorseToolPlugin:
    """HappyHorse video generation tools — t2v / i2v / r2v variants."""

    def register(self, api: PluginApi):
        tool = _load_tool_module()
        api.register_tool(
            tool_name="text_to_video_happyhorse",
            tool_func=tool.text_to_video_happyhorse,
            description="Generate videos from text prompts using HappyHorse 1.0 t2v",  # noqa: E501
            icon="🐎",
        )
        api.register_tool(
            tool_name="image_to_video_happyhorse",
            tool_func=tool.image_to_video_happyhorse,
            description=(
                "Generate videos from a starting image using "
                "HappyHorse 1.0 i2v"
            ),
            icon="🎞️",
        )
        api.register_tool(
            tool_name="reference_to_video_happyhorse",
            tool_func=tool.reference_to_video_happyhorse,
            description="Generate videos with references using HappyHorse 1.0 r2v",  # noqa: E501
            icon="🎭",
        )
        logger.info("HappyHorse tool plugin registered")


plugin = HappyHorseToolPlugin()
