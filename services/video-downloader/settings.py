import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    data: Path = field(default_factory=lambda: Path(os.getenv("VIDEO_DATA_DIR", "/data")))
    origins: tuple[str, ...] = field(default_factory=lambda: tuple(os.getenv("VIDEO_ALLOWED_ORIGINS", "https://stray-flz.github.io").split(",")))
    workers: int = field(default_factory=lambda: int(os.getenv("VIDEO_WORKERS", "2")))
    queue_limit: int = 12
    max_bytes: int = field(default_factory=lambda: int(os.getenv("VIDEO_MAX_BYTES", str(512 * 1024 * 1024))))
    disk_limit: int = field(default_factory=lambda: int(os.getenv("VIDEO_DISK_LIMIT", str(4 * 1024 ** 3))))
    max_duration: int = 1800
    job_timeout: int = 1200
    analyze_timeout: int = 45
    retention: int = field(default_factory=lambda: int(os.getenv("VIDEO_RETENTION_MINUTES", "60")) * 60)
    cookie_dir: Path = field(default_factory=lambda: Path(os.getenv("VIDEO_COOKIE_DIR", "/cookies")))
    ffmpeg: str = field(default_factory=lambda: os.getenv("VIDEO_FFMPEG", "ffmpeg"))
    ffprobe: str = field(default_factory=lambda: os.getenv("VIDEO_FFPROBE", "ffprobe"))
    trusted_proxy: str = field(default_factory=lambda: os.getenv("VIDEO_TRUSTED_PROXY", ""))

    def __post_init__(self):
        if not 1 <= self.workers <= 4 or self.retention < 60 or self.max_bytes < 1024 or self.disk_limit < self.max_bytes:
            raise ValueError("Invalid video service resource limits")
