import json
import subprocess

import pytest

from media import export_media, probe


def inspect(path, ffprobe):
    result = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-of", "json", str(path)], capture_output=True, check=True)
    return json.loads(result.stdout)["streams"]


@pytest.fixture
def sample(tmp_path, binaries):
    ffmpeg, ffprobe = binaries
    source = tmp_path / "source.mp4"
    subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-threads", "1", "-c:a", "aac", str(source)], check=True)
    return source, ffmpeg, ffprobe


@pytest.mark.parametrize("mode,format,expected", [("video", "original", [{"video", "audio"}]), ("audio", "original", [{"audio"}]), ("audio", "mp3", [{"audio"}]), ("split", "original", [{"video"}, {"audio"}]), ("split", "mp3", [{"video"}, {"audio"}])])
def test_real_media_exports(sample, mode, format, expected):
    source, ffmpeg, ffprobe = sample
    files = export_media(source, source.parent, mode, format, ffmpeg, probe(source, ffprobe))
    assert [{s["codec_type"] for s in inspect(source.parent / f["path"], ffprobe)} for f in files] == expected
    if format == "mp3":
        assert inspect(source.parent / files[-1]["path"], ffprobe)[0]["codec_name"] == "mp3"
    if mode == "split":
        assert inspect(source.parent / files[0]["path"], ffprobe)[0]["codec_name"] == "h264"
    if mode != "video" and format == "original":
        assert inspect(source.parent / files[-1]["path"], ffprobe)[0]["codec_name"] == "aac"


def test_missing_audio_fails(sample):
    source, ffmpeg, _ = sample
    with pytest.raises(ValueError, match="音轨"):
        export_media(source, source.parent, "audio", "mp3", ffmpeg, {"streams": [{"codec_type": "video", "codec_name": "h264"}]})
