import socket

import pytest

from formats import normalize_url, quality_options, select_exact
from network import UnsafeAddress, public_addresses


@pytest.mark.parametrize("link,platform", [
    ("分享 https://b23.tv/ABc123，", "bilibili"),
    ("https://m.bilibili.com/video/BV1xx411c7mD?p=2", "bilibili"),
    ("https://v.douyin.com/abcDEF/", "douyin"),
    ("https://www.douyin.com/?modal_id=123456789", "douyin"),
    ("https://www.iesdouyin.com/share/video/123456/", "douyin"),
    ("https://xhslink.com/a/abcdef", "xiaohongshu"),
    ("https://www.xiaohongshu.com/explore/674051740000000007027a15?xsec_token=a-b%3D", "xiaohongshu"),
])
def test_supported_share_links(link, platform):
    url, result = normalize_url(link)
    assert result == platform
    assert url.startswith("https://")
    if "xsec_token" in link:
        assert "xsec_token=a-b%3D" in url
    if "modal_id" in link or "share/video" in link:
        assert "/video/" in url


@pytest.mark.parametrize("link", [
    "http://127.0.0.1/video/1", "https://www.bilibili.com.attacker.test/video/BV123",
    "https://evil@www.bilibili.com/video/BV123", "https://www.bilibili.com:444/video/BV123",
    "https://www.bilibili.com/", "file:///etc/passwd", "https://www.douyin.com/user/123",
    "https://www.xiaohongshu.com/user/profile/123", "https://b23.tv/a https://b23.tv/b",
])
def test_reject_other_targets(link):
    with pytest.raises(ValueError):
        normalize_url(link)


def answer(ip):
    return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))


@pytest.mark.parametrize("ip", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.2", "192.168.2.1", "0.0.0.0", "224.0.0.1", "100.64.0.1", "192.0.2.1"])
def test_blocks_private_reserved_and_multicast(ip):
    with pytest.raises(UnsafeAddress):
        public_addresses("cdn.test", 443, resolver=lambda *_: [answer(ip)])


def test_reject_mixed_dns_answers():
    with pytest.raises(UnsafeAddress):
        public_addresses("cdn.test", 443, resolver=lambda *_: [answer("8.8.8.8"), answer("127.0.0.1")])
    assert public_addresses("cdn.test", 443, resolver=lambda *_: [answer("8.8.8.8")]) == ["8.8.8.8"]


def stream(identifier, w, h, v="h264", a="none", **extra):
    return {"format_id": identifier, "width": w, "height": h, "vcodec": v, "acodec": a, "url": "https://cdn.test/video", "protocol": "https", "ext": "mp4", **extra}


def test_native_resolution_and_audio_are_selected_exactly():
    formats = [stream("1080av1", 1920, 1080, v="av1", tbr=2000), stream("1080avc", 1920, 1080, tbr=1000), stream("720", 1280, 720), stream("audio", 0, 0, v="none", a="aac", ext="m4a", abr=128), stream("drm4k", 3840, 2160, has_drm=True)]
    options, audio_id = quality_options({"formats": formats})
    assert [q["label"] for q in options] == ["1080P · 1920 × 1080", "720P · 1280 × 720"]
    assert options[0]["format_ids"] == ["1080avc", "audio"]
    assert audio_id == "audio"
    selected = list(select_exact(options[0]["format_ids"])({"formats": formats}))
    assert selected[0]["requested_formats"] == [formats[1], formats[3]]
    with pytest.raises(ValueError):
        list(select_exact(["missing"])({"formats": formats}))


def test_portrait_resolution_and_unknown_metadata():
    options, _ = quality_options({"formats": [stream("portrait", 1080, 1920, a="aac"), stream("original", 0, 0, v=None, a=None)]})
    assert options[0]["label"] == "1080P · 1080 × 1920"
    assert options[1]["label"] == "源文件 · 清晰度未标注"
    assert options[1]["has_audio"] is True


def test_muxed_video_and_silent_video():
    options, audio_id = quality_options({"formats": [stream("muxed", 1280, 720, a="aac")]})
    assert options[0]["format_ids"] == ["muxed"] and audio_id is None
    assert options[0]["has_audio"]
    options, _ = quality_options({"formats": [stream("silent", 1280, 720)]})
    assert not options[0]["has_audio"]
