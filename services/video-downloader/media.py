import json
import re
import subprocess
from pathlib import Path


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    temp.replace(path)


def probe(source, ffprobe):
    result = subprocess.run([ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(source)], capture_output=True, timeout=30, check=True)
    data = json.loads(result.stdout)
    if not any(s.get("codec_type") == "video" for s in data.get("streams", [])):
        raise ValueError("源文件没有视频画面。")
    return data


def safe_title(title):
    clean = re.sub(r'[\x00-\x1f\x7f<>:"/\\|?*]', "_", title or "视频").strip(" .")
    return (clean or "视频")[:90]


def export_media(source: Path, work: Path, mode, audio_format, ffmpeg, metadata):
    streams = metadata.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if mode in ("audio", "split") and not audio:
        raise ValueError("此视频没有可导出的音轨。")
    if mode == "video":
        return [{"key": "video", "path": source.name, "label": "下载完整视频"}]
    outputs = []

    def convert(output, args):
        # Inputs are downloaded local files. Disallow nested remote protocols.
        subprocess.run([ffmpeg, "-nostdin", "-hide_banner", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", str(source), *args, "-threads", "1", str(output)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300, check=True)

    if mode == "split":
        if not video:
            raise ValueError("此文件没有可导出的视频画面。")
        ext = "mp4" if video.get("codec_name") in {"h264", "hevc", "av1", "mpeg4"} else "mkv"
        out = work / f"video.{ext}"
        convert(out, ["-map", "0:v:0", "-an", "-c:v", "copy"])
        outputs.append({"key": "video", "path": out.name, "label": "下载无声视频"})
    if audio_format == "mp3":
        ext = "mp3"
        args = ["-map", "0:a:0", "-vn", "-c:a", "libmp3lame", "-b:a", "192k"]
    else:
        ext = {"aac": "m4a", "mp3": "mp3", "opus": "ogg", "vorbis": "ogg", "flac": "flac", "pcm_s16le": "wav"}.get(audio.get("codec_name"), "mka")
        args = ["-map", "0:a:0", "-vn", "-c:a", "copy"]
    out = work / f"audio.{ext}"
    convert(out, args)
    outputs.append({"key": "audio", "path": out.name, "label": "下载音轨"})
    return outputs
