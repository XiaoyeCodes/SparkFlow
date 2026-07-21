"""Qwen-VL vision model OCR engine — cloud, DashScope OpenAI-compatible API."""

from __future__ import annotations

import base64
import io
import logging

import numpy as np

logger = logging.getLogger(__name__)

_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "qwen-vl-plus"

_OCR_SYSTEM_PROMPT = (
    "You are a precise OCR engine. Extract ALL text from the provided image. "
    "Rules:\n"
    "- Preserve the original layout: use newlines for line breaks, "
    "tabs for table columns, markdown tables for structured tables.\n"
    "- Preserve mathematical formulas in LaTeX notation ($...$).\n"
    "- Do NOT add commentary, summaries, or explanations.\n"
    "- Output ONLY the extracted text, nothing else.\n"
    "- If the image contains no readable text, output an empty string."
)


class QwenVisionOcrEngine:
    """Cloud OCR engine using Qwen-VL via DashScope OpenAI-compatible API."""

    name = "qwen-vl"

    def __init__(self) -> None:
        self._client = None

    def is_available(self) -> bool:
        from src.config.accessor import get_env_config

        api_key = get_env_config().data.dashscope_api_key
        if not api_key:
            return False
        try:
            from openai import OpenAI  # type: ignore
            if self._client is None:
                self._client = OpenAI(
                    api_key=api_key,
                    base_url=_DASHSCOPE_BASE_URL,
                )
            return True
        except ImportError:
            return False

    def recognize(self, image: np.ndarray) -> str:
        if not self.is_available():
            raise RuntimeError(
                "Qwen-VL OCR requires DASHSCOPE_API_KEY environment variable"
            )

        b64 = self._numpy_to_base64(image)
        from src.config.accessor import get_env_config

        model = get_env_config().ocr.vibe_trading_ocr_qwen_model or _DEFAULT_MODEL

        try:
            response = self._client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": [{"type": "text", "text": _OCR_SYSTEM_PROMPT}]},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/png;base64,{b64}"},
                            },
                            {"type": "text", "text": "Extract all text from this image."},
                        ],
                    },
                ],
                max_tokens=4096,
                temperature=0.0,
            )
            text = response.choices[0].message.content or ""
            return text.strip()
        except Exception as exc:
            logger.error("Qwen-VL OCR failed: %s", exc)
            return ""

    @staticmethod
    def _numpy_to_base64(image: np.ndarray) -> str:
        from PIL import Image  # type: ignore
        pil_img = Image.fromarray(image)
        buffer = io.BytesIO()
        pil_img.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("utf-8")
