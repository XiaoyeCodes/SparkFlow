"""RapidOCR engine — local, ONNX Runtime based, no API key needed."""

from __future__ import annotations

import numpy as np


class RapidOcrEngine:
    """Local OCR engine using RapidOCR (PaddleOCR-derived, ONNX Runtime)."""

    name = "rapid"

    def __init__(self) -> None:
        self._engine = None

    def is_available(self) -> bool:
        try:
            from rapidocr_onnxruntime import RapidOCR  # type: ignore
            if self._engine is None:
                self._engine = RapidOCR()
            return True
        except ImportError:
            return False

    def recognize(self, image: np.ndarray) -> str:
        if not self.is_available():
            raise RuntimeError("RapidOCR not installed: pip install rapidocr_onnxruntime")
        result, _ = self._engine(image)
        if not result:
            return ""
        return "\n".join(item[1] for item in result)
