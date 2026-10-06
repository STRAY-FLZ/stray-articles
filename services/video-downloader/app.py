import base64
import hashlib
import hmac
import os
import re
import secrets
import shutil
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from typing import Literal
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from engine import Engine, TERMINAL
from formats import normalize_url
from media import safe_title
from settings import Settings
from store import Store


class BodyLimit:
    def __init__(self, app, limit=8192):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        total = 0

        async def bounded_receive():
            nonlocal total
            message = await receive()
            total += len(message.get("body", b""))
            if total > self.limit:
                raise HTTPException(413, "请求内容过长。")
            return message
        await self.app(scope, bounded_receive, send)


class RateLimit:
    def __init__(self):
        self.events = defaultdict(deque)
        self.lock = threading.Lock()

    def check(self, key, limit, period=600):
        now = time.monotonic()
        with self.lock:
            # Bound the number of keys retained, even when session tokens rotate.
            if len(self.events) > 4096:
                for old in list(self.events):
                    if not self.events[old] or self.events[old][-1] < now - 86400:
                        del self.events[old]
                if len(self.events) > 4096:
                    raise HTTPException(429, "服务繁忙，请稍后重试。")
            events = self.events[key]
            while events and events[0] <= now - period:
                events.popleft()
            if len(events) >= limit:
                raise HTTPException(429, "操作太频繁，请稍后重试。", headers={"Retry-After": "60"})
            events.append(now)


class AnalyzeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=10, max_length=4096)


class JobBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analysis_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    quality_id: str = Field(pattern=r"^q\d{1,3}$")
    mode: Literal["video", "audio", "split"]
    audio_format: Literal["original", "mp3"] = "original"


def signature(key, identifier, file_key, expires):
    data = f"{identifier}:{file_key}:{expires}".encode()
    return base64.urlsafe_b64encode(hmac.new(key, data, hashlib.sha256).digest()).decode().rstrip("=")


def create_app(settings=None):
    settings = settings or Settings()
    limits = RateLimit()

    @asynccontextmanager
    async def lifespan(application):
        store = Store(settings.data)
        engine = Engine(settings, store)
        application.state.store = store
        application.state.engine = engine
        yield
        await run_in_threadpool(engine.close)
        store.close()

    application = FastAPI(title="Stray Video", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    application.add_middleware(BodyLimit)
    application.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_methods=["GET", "POST", "DELETE"], allow_headers=["Authorization", "Content-Type"], expose_headers=["Content-Disposition", "Retry-After"], max_age=600)

    @application.middleware("http")
    async def request_headers(request, call_next):
        origin = request.headers.get("origin")
        if origin and origin not in settings.origins:
            return JSONResponse({"detail": "此来源无权访问下载服务。"}, status_code=403)
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def owner(request: Request):
        auth = request.headers.get("authorization", "")
        if not re.fullmatch(r"Bearer [a-f0-9]{64}", auth):
            raise HTTPException(401, "浏览器会话无效，请刷新页面重试。")
        return hashlib.sha256(auth[7:].encode()).hexdigest()

    def rate(request, operation, limit):
        address = request.client.host if request.client else "unknown"
        if settings.trusted_proxy and address == settings.trusted_proxy:
            # Caddy overwrites this header. The API is not publicly exposed.
            address = request.headers.get("x-real-ip", address)
        limits.check((operation, address), limit)

    def public_analysis(item):
        return {k: v for k, v in item.items() if k not in {"url", "audio_id"}} | {"qualities": [{k: v for k, v in q.items() if k not in {"format_ids", "has_audio"}} for q in item["qualities"]]}

    def public_job(item, store):
        clean = {k: v for k, v in item.items() if k not in {"spec", "files"}}
        expires = min(int(item["expires"]), int(time.time()) + 900)
        clean["files"] = [{"key": f["key"], "label": f["label"], "size": f["size"], "url": f"/v1/jobs/{item['id']}/files/{f['key']}?" + urlencode({"expires": expires, "signature": signature(store.key, item["id"], f["key"], expires)})} for f in item["files"]] if item["state"] == "ready" else []
        return clean

    @application.get("/v1/health")
    def health():
        ready = bool(shutil.which(settings.ffmpeg) and shutil.which(settings.ffprobe))
        result = {"status": "ready" if ready else "maintenance", "retention_minutes": settings.retention // 60, "max_bytes": settings.max_bytes, "platforms": ["bilibili", "douyin", "xiaohongshu"]}
        commit = os.environ.get("RENDER_GIT_COMMIT", "")
        if re.fullmatch(r"[a-f0-9]{40}", commit):
            result["build"] = commit
        return result

    @application.post("/v1/analyze")
    def analyze(body: AnalyzeBody, request: Request, identity=Depends(owner)):
        rate(request, "analyze", 12)
        limits.check(("analyze-owner", identity), 8)
        try:
            url, _platform = normalize_url(body.url)
            data = application.state.engine.analyze(url)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        data.update(id=secrets.token_hex(16), url=url)
        application.state.store.put("analysis", data, identity, time.time() + 900)
        return public_analysis(data)

    @application.post("/v1/jobs", status_code=202)
    def submit(body: JobBody, request: Request, identity=Depends(owner)):
        rate(request, "submit", 6)
        store = application.state.store
        analysis = store.get("analysis", body.analysis_id, identity)
        if not analysis:
            raise HTTPException(410, "解析结果已过期，请重新解析链接。")
        quality = next((q for q in analysis["qualities"] if q["id"] == body.quality_id), None)
        if not quality:
            raise HTTPException(422, "清晰度选择无效，请重新解析链接。")
        if body.mode == "audio" and not analysis.get("audio_id"):
            quality = analysis["qualities"][0]
        if body.mode in ("audio", "split") and not quality["has_audio"] and not analysis.get("audio_id"):
            raise HTTPException(422, "此视频没有可导出的音轨。")
        if quality.get("size", 0) and quality["size"] > settings.max_bytes and not (body.mode == "audio" and analysis.get("audio_id")):
            raise HTTPException(422, f"文件超过 {settings.max_bytes // 1024 ** 2} MB 限制，请选择较低清晰度。")
        if sum(o == identity and j["state"] not in TERMINAL for o, _, j in store.all("job")) >= 2:
            raise HTTPException(429, "已有两个任务正在处理，请等待完成后再提交。")
        try:
            limits.check(("submit-global",), 100, 86400)
            job = application.state.engine.submit(analysis, identity, quality, body.mode, body.audio_format)
        except ValueError as error:
            raise HTTPException(429, str(error)) from None
        return public_job(job, store)

    @application.get("/v1/jobs/{identifier}")
    def job(identifier: str, identity=Depends(owner)):
        store = application.state.store
        item = store.get("job", identifier, identity)
        if not item:
            raise HTTPException(404, "任务不存在或已过期。")
        return public_job(item, store)

    @application.delete("/v1/jobs/{identifier}")
    def cancel(identifier: str, identity=Depends(owner)):
        item = application.state.engine.cancel(identifier, identity)
        if not item:
            raise HTTPException(404, "任务不存在或已过期。")
        return public_job(item, application.state.store)

    @application.get("/v1/jobs/{identifier}/files/{file_key}")
    def download(request: Request, identifier: str, file_key: str, expires: int, signature_value: str = Query(alias="signature")):
        # File links carry a short-lived capability, not the browser's owner token.
        supplied = signature_value
        store = application.state.store
        now = int(time.time())
        if expires < now or expires > now + 901 or not hmac.compare_digest(supplied, signature(store.key, identifier, file_key, expires)):
            raise HTTPException(403, "下载链接已失效，请刷新任务列表后重试。")
        item = store.get("job", identifier)
        if not item or item["state"] != "ready":
            raise HTTPException(404, "结果不存在或已过期。")
        file = next((f for f in item["files"] if f["key"] == file_key), None)
        if not file:
            raise HTTPException(404, "文件不存在。")
        root = settings.data / "jobs" / identifier
        target = root / file["path"]
        if target.resolve().parent != root.resolve() or not target.is_file():
            raise HTTPException(404, "文件不存在。")
        rate(request, "file", 30)
        name = f"{safe_title(item['title'])}{' - 音轨' if file_key == 'audio' else ' - 无声视频' if item['mode'] == 'split' else ''}{target.suffix}"
        return FileResponse(target, filename=name, media_type="application/octet-stream")

    return application


app = create_app()
