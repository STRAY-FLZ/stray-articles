import re
from urllib.parse import parse_qs, urlsplit, urlunsplit

PLATFORMS = {"bilibili": "哔哩哔哩", "douyin": "抖音", "xiaohongshu": "小红书"}
HOSTS = {
    "bilibili.com": "bilibili", "www.bilibili.com": "bilibili", "m.bilibili.com": "bilibili", "b23.tv": "bilibili",
    "douyin.com": "douyin", "www.douyin.com": "douyin", "v.douyin.com": "douyin", "iesdouyin.com": "douyin", "www.iesdouyin.com": "douyin",
    "xiaohongshu.com": "xiaohongshu", "www.xiaohongshu.com": "xiaohongshu", "xhslink.com": "xiaohongshu", "www.xhslink.com": "xiaohongshu",
}


def normalize_url(text):
    links = re.findall(r'https?://[^\s<>"\'“”]+', text)
    if len(links) != 1:
        raise ValueError("请提供一条视频分享链接。")
    url = urlsplit(links[0].rstrip("，。；、！!）)】]"))
    try:
        port = url.port
    except ValueError:
        raise ValueError("链接的端口不正确。") from None
    platform = HOSTS.get(url.hostname)
    if not platform or url.username or url.password or port not in (None, 80, 443) or "\\" in url.netloc:
        raise ValueError("目前只支持哔哩哔哩、抖音和小红书的链接。")
    host = url.hostname
    path = url.path
    if host == "b23.tv" or host.endswith("xhslink.com") or host == "v.douyin.com":
        valid = bool(re.fullmatch(r"/[A-Za-z0-9/_-]{1,160}", path))
    elif platform == "bilibili":
        valid = bool(re.fullmatch(r"/video/(?:BV[A-Za-z0-9]+|av\d+)/?", path, re.I))
        host = "www.bilibili.com"
    elif platform == "douyin":
        modal = parse_qs(url.query).get("modal_id", [])
        if path in ("", "/") and len(modal) == 1 and modal[0].isdigit():
            path = "/video/" + modal[0]
        valid = bool(re.fullmatch(r"/(?:video|share/video)/\d+/?", path))
        host = "www.douyin.com"
        path = path.replace("/share/video/", "/video/")
    else:
        valid = bool(re.fullmatch(r"/(?:explore|discovery/item)/[a-fA-F0-9]{24}/?", path))
        host = "www.xiaohongshu.com"
    if not valid:
        raise ValueError("请提供单条视频链接，暂不支持直播、合集、用户主页或图文笔记。")
    # Preserve XHS xsec_token and Bilibili p; never expose the source in job JSON.
    return urlunsplit(("https", host, path, url.query, "")), platform


def video_stream(f):
    return f.get("vcodec") != "none" and not f.get("has_drm") and f.get("url") and f.get("protocol", "https") in {"http", "https", "m3u8", "m3u8_native", "http_dash_segments"}


def has_audio(f):
    # Some extractors omit codec metadata for an ordinary muxed MP4.
    return f.get("acodec") != "none"


def rank(f):
    codec = str(f.get("vcodec", "")).lower()
    return (int(codec.startswith(("avc", "h264"))), f.get("tbr") or 0, f.get("fps") or 0)


def quality_options(info):
    formats = info.get("formats") or ([info] if info.get("url") else [])
    audio = [f for f in formats if f.get("vcodec") == "none" and has_audio(f) and not f.get("has_drm") and f.get("url")]
    audio.sort(key=lambda f: (int(f.get("ext") == "m4a"), f.get("abr") or f.get("tbr") or 0), reverse=True)
    best_audio = str(audio[0]["format_id"]) if audio else None
    groups = {}
    for f in formats:
        if not video_stream(f) or not f.get("format_id"):
            continue
        w, h = f.get("width") or 0, f.get("height") or 0
        dimensions = (int(w), int(h))
        if dimensions not in groups or rank(f) > rank(groups[dimensions]):
            groups[dimensions] = f
    options = []
    for f in sorted(groups.values(), key=lambda f: (min(f.get("width") or f.get("height") or 0, f.get("height") or f.get("width") or 0), f.get("height") or 0, rank(f)), reverse=True):
        w, h = int(f.get("width") or 0), int(f.get("height") or 0)
        resolution = min(w, h) if w and h else h or w
        label = f"{resolution}P · {w} × {h}" if w and h else f"{resolution}P" if resolution else "源文件 · 清晰度未标注"
        ids = [str(f["format_id"])]
        size = f.get("filesize") or f.get("filesize_approx")
        if not has_audio(f) and best_audio:
            ids.append(best_audio)
            extra = audio[0].get("filesize") or audio[0].get("filesize_approx")
            size = size + extra if size and extra else None
        options.append({"id": f"q{len(options) + 1}", "label": label, "size": size, "format_ids": ids, "has_audio": has_audio(f) or bool(best_audio)})
    if not options:
        raise ValueError("此链接没有可下载的视频，可能是图文、直播、受限内容或已失效。")
    return options, best_audio


def select_exact(format_ids):
    """A callable selector avoids interpreting arbitrary IDs as a format query."""
    def selector(context):
        by_id = {str(f["format_id"]): f for f in context["formats"]}
        if any(i not in by_id or by_id[i].get("has_drm") for i in format_ids):
            raise ValueError("所选清晰度已发生变化，请重新解析链接。")
        picked = [by_id[i] for i in format_ids]
        if len(picked) == 1:
            yield picked[0]
        else:
            yield {"format_id": "+".join(format_ids), "ext": "mp4" if all(f.get("ext") in ("mp4", "m4a") for f in picked) else "mkv", "protocol": "+".join(f.get("protocol", "https") for f in picked), "requested_formats": picked}
    return selector
