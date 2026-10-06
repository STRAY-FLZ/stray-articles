import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def binaries():
    import shutil
    ffmpeg = os.environ.get("VIDEO_FFMPEG") or shutil.which("ffmpeg")
    ffprobe = os.environ.get("VIDEO_FFPROBE") or shutil.which("ffprobe")
    if not ffmpeg or not ffprobe:
        pytest.skip("Media integration tests require FFmpeg and FFprobe")
    return ffmpeg, ffprobe
