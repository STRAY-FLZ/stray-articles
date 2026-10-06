"""One bounded subprocess per extraction/download; no user-supplied shell args."""
import json
import shutil
import sys
import time
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.extractor.bilibili import BiliBiliIE
from yt_dlp.extractor.tiktok import DouyinIE
from yt_dlp.extractor.xiaohongshu import XiaoHongShuIE
from yt_dlp.networking import Request

from formats import PLATFORMS, has_audio, normalize_url, quality_options, select_exact
from media import atomic_json, export_media, probe
from network import egress_proxy


class QuietLogger:
    def debug(self, _message):
        pass

    warning = debug
    error = debug


def downloader(options):
    ydl = YoutubeDL(options, auto_init=False)
    for extractor in (BiliBiliIE, DouyinIE, XiaoHongShuIE):
        ydl.add_info_extractor(extractor())
    return ydl


def resolve_share(url, platform, options):
    if not any(host in url for host in ("https://b23.tv/", "https://v.douyin.com/", "https://xhslink.com/", "https://www.xhslink.com/")):
        return url
    with downloader(options) as ydl:
        # Redirect connections are protected by the egress proxy as well.
        with ydl.urlopen(Request(url)) as response:
            resolved = response.url
    canonical, final_platform = normalize_url(resolved)
    if final_platform != platform:
        raise ValueError("分享链接指向了其他平台，请提供原始视频链接。")
    return canonical


def friendly_error(error, platform=""):
    message = str(error).lower()
    if any(s in str(error) for s in ("所选清晰度", "音轨", "没有可下载的视频", "视频过长", "视频超出文件", "源文件没有", "分享链接指向")):
        return str(error)[:180]
    if "cookie" in message or "login" in message or "sign in" in message or "登录" in message:
        return "源站要求登录或更新验证信息，此链接暂时无法提取。请尝试其他公开视频。"
    if "403" in message or "412" in message or "captcha" in message or "challenge" in message:
        return "源站暂时限制了访问，请稍后重试，或更换完整分享链接。"
    if "404" in message or "not found" in message or "not available" in message:
        return "视频可能已删除、设为私密或不在当前地区开放。"
    if "format" in message:
        if platform == "xiaohongshu":
            return "小红书暂未向下载服务返回视频数据，可能需要更新源站验证信息。请稍后重试。"
        return "当前清晰度无法取得，请重新解析并选择其他档位。"
    return "暂时无法提取此视频，请检查分享链接是否完整，或稍后重试。"


def execute(spec, work):
    last_progress = 0

    def progress(hook):
        nonlocal last_progress
        now = time.monotonic()
        if now - last_progress < .5 and hook.get("status") != "finished":
            return
        last_progress = now
        total = hook.get("total_bytes") or hook.get("total_bytes_estimate")
        value = min(99, hook.get("downloaded_bytes", 0) / total * 100) if total else None
        atomic_json(work / "progress.json", {"state": "downloading", "progress": value})

    url, platform = normalize_url(spec["url"])
    with egress_proxy() as proxy:
        opts = {
            "proxy": proxy, "quiet": True, "no_warnings": True, "logger": QuietLogger(),
            "noplaylist": True, "playlist_items": "1", "cachedir": False,
            "socket_timeout": 15, "retries": 1, "fragment_retries": 1,
            "hls_prefer_native": True, "concurrent_fragment_downloads": 1,
            "max_filesize": spec["max_bytes"], "outtmpl": str(work / "source.%(ext)s"),
            "progress_hooks": [progress], "restrictfilenames": True,
            "ffmpeg_location": shutil.which(spec["ffmpeg"]) or spec["ffmpeg"], "overwrites": True,
        }
        cookie = Path(spec["cookie_dir"]) / f"{platform}.txt"
        if cookie.is_file():
            # Copy per task: yt-dlp writes its cookie jar; the admin mount is read-only.
            local_cookie = work / "cookies.txt"
            local_cookie.write_bytes(cookie.read_bytes())
            opts["cookiefile"] = str(local_cookie)
        try:
            url = resolve_share(url, platform, opts)
            if spec["operation"] == "analyze":
                with downloader(opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                if not info or info.get("_type") in {"playlist", "multi_video"} or info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming", "post_live"}:
                    raise ValueError("此链接没有可下载的视频，暂不支持直播或合集。")
                if info.get("duration", 0) and info["duration"] > spec["max_duration"]:
                    raise ValueError("视频过长，请选择 30 分钟以内的视频。")
                options, audio_id = quality_options(info)
                return {"title": str(info.get("title") or "未命名视频")[:300], "uploader": str(info.get("uploader") or "")[:120], "duration": info.get("duration"), "platform": platform, "platform_label": PLATFORMS[platform], "qualities": options, "audio_id": audio_id, "has_audio": any(q["has_audio"] for q in options)}
            picked = spec["quality"]["format_ids"]
            if spec["mode"] == "audio" and spec.get("audio_id"):
                picked = [spec["audio_id"]]
            opts["format"] = select_exact(picked)
            atomic_json(work / "progress.json", {"state": "parsing", "progress": None})
            with downloader(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            candidates = [p for p in work.glob("source.*") if p.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".ogg", ".flac", ".aac", ".mka"}]
            # A skipped over-limit download must not become an empty "success".
            if len(candidates) != 1:
                raise ValueError("视频超出文件限制或下载未完成，请选择较低清晰度。")
            atomic_json(work / "progress.json", {"state": "processing", "progress": None})
            source = candidates[0]
            if spec["mode"] == "audio" and spec.get("audio_id"):
                # Audio-only downloads legitimately have no video stream.
                import subprocess
                result = subprocess.run([spec["ffprobe"], "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", str(source)], capture_output=True, timeout=30, check=True)
                metadata = json.loads(result.stdout)
            else:
                metadata = probe(source, spec["ffprobe"])
            duration = float(metadata.get("format", {}).get("duration", 0) or 0)
            if duration > spec["max_duration"]:
                raise ValueError("视频过长，请选择 30 分钟以内的视频。")
            files = export_media(source, work, spec["mode"], spec["audio_format"], spec["ffmpeg"], metadata)
            for file in files:
                file["size"] = (work / file["path"]).stat().st_size
            return {"files": files}
        finally:
            (work / "cookies.txt").unlink(missing_ok=True)


if __name__ == "__main__":
    directory = Path(sys.argv[1]).resolve()
    payload = json.loads((directory / "spec.json").read_text(encoding="utf-8"))
    try:
        atomic_json(directory / "result.json", {"ok": True, "data": execute(payload, directory)})
    except Exception as error:
        atomic_json(directory / "result.json", {"ok": False, "error": friendly_error(error, normalize_url(payload["url"])[1])})
        sys.exit(1)
