import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from media import atomic_json

TERMINAL = {"ready", "error", "cancelled"}


def directory_bytes(directory):
    total = 0
    for path in directory.rglob("*"):
        try:
            if path.is_file():
                total += path.stat().st_size
        except FileNotFoundError:
            # Downloads rename their parts and cleanup can run concurrently.
            pass
    return total


class Engine:
    def __init__(self, settings, store):
        self.settings = settings
        self.store = store
        self.stop = threading.Event()
        self.lock = threading.RLock()
        self.analyze_slots = threading.BoundedSemaphore(2)
        self.pool = ThreadPoolExecutor(max_workers=settings.workers, thread_name_prefix="video")
        self.jobs_dir = settings.data / "jobs"
        self.analysis_dir = settings.data / "analysis"
        self.jobs_dir.mkdir(exist_ok=True, mode=0o700)
        self.analysis_dir.mkdir(exist_ok=True, mode=0o700)
        self.cleanup()
        for owner, expires, job in self.store.all("job"):
            if job["state"] not in TERMINAL:
                # Restart stale work rather than leave a permanent spinning task.
                job["state"] = "queued"
                job["progress"] = None
                self.store.put("job", job, owner, expires)
                self.pool.submit(self.run_job, job["id"], owner)
        self.maintenance = threading.Thread(target=self.maintain, daemon=True)
        self.maintenance.start()

    def spec(self, source):
        return {**source, "max_bytes": self.settings.max_bytes, "max_duration": self.settings.max_duration, "ffmpeg": self.settings.ffmpeg, "ffprobe": self.settings.ffprobe, "cookie_dir": str(self.settings.cookie_dir)}

    def cleanup(self):
        with self.lock:
            for kind in ("analysis", "job"):
                for _owner, expires, item in self.store.all(kind):
                    if expires <= time.time() and (kind != "job" or item["state"] in TERMINAL):
                        if kind == "job":
                            target = self.jobs_dir / item["id"]
                            self.remove_directory(target)
                        self.store.remove(item["id"])
            # Remove abandoned analysis folders (e.g. container terminated mid-parse).
            for directory in self.analysis_dir.iterdir():
                if directory.is_dir() and time.time() - directory.stat().st_mtime > self.settings.analyze_timeout + 120:
                    self.remove_directory(directory)

    def remove_directory(self, target):
        target = target.resolve()
        root = self.settings.data.resolve()
        if root not in target.parents:
            raise ValueError("Storage path escaped its root")
        shutil.rmtree(target, ignore_errors=True)

    def maintain(self):
        while not self.stop.wait(30):
            self.cleanup()

    def kill(self, process):
        if process.poll() is not None:
            return
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            process.kill()
        process.wait(timeout=5)

    def run_worker(self, work, payload, timeout, job_id=None, owner=None):
        atomic_json(work / "spec.json", self.spec(payload))
        # Clear stale process results before a retry after a service restart.
        for name in ("progress.json", "result.json"):
            (work / name).unlink(missing_ok=True)
        env = dict(os.environ)
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"):
            env.pop(key, None)
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("worker.py")), str(work)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=os.name == "posix")
        deadline = time.monotonic() + timeout
        last_progress = None
        try:
            while process.poll() is None:
                if self.stop.is_set():
                    raise ValueError("服务正在重启，请重新提交任务。")
                if time.monotonic() > deadline:
                    raise ValueError("处理超时，请选择较低清晰度或较短视频后重试。")
                if directory_bytes(work) > self.settings.max_bytes * 3:
                    raise ValueError("文件超过处理限制，请选择较低清晰度。")
                if directory_bytes(self.settings.data) > self.settings.disk_limit:
                    raise ValueError("服务存储空间暂时不足，请稍后重试。")
                if job_id:
                    with self.lock:
                        job = self.store.get("job", job_id, owner, include_expired=True)
                        if not job or job["state"] == "cancelled":
                            raise ValueError("已取消")
                        try:
                            progress = json.loads((work / "progress.json").read_text(encoding="utf-8"))
                            if progress != last_progress:
                                last_progress = progress
                                job.update(progress)
                                self.store.put("job", job, owner, job["expires"])
                        except (OSError, json.JSONDecodeError):
                            pass
                time.sleep(.3)
        finally:
            self.kill(process)
        result_file = work / "result.json"
        if not result_file.is_file() or result_file.stat().st_size > 1024 * 1024:
            raise ValueError("服务未能完成处理，请稍后重试。")
        result = json.loads(result_file.read_text(encoding="utf-8"))
        if not result.get("ok"):
            raise ValueError(result.get("error", "视频提取失败。"))
        return result["data"]

    def analyze(self, url):
        if not self.analyze_slots.acquire(blocking=False):
            raise ValueError("解析服务繁忙，请稍后重试。")
        work = self.analysis_dir / uuid.uuid4().hex
        work.mkdir(mode=0o700)
        try:
            return self.run_worker(work, {"operation": "analyze", "url": url}, self.settings.analyze_timeout)
        finally:
            self.remove_directory(work)
            self.analyze_slots.release()

    def submit(self, analysis, owner, quality, mode, audio_format):
        with self.lock:
            self.cleanup()
            if sum(j["state"] not in TERMINAL for _, _, j in self.store.all("job")) >= self.settings.queue_limit:
                raise ValueError("下载队列已满，请稍后重试。")
            if sum(o == owner and j["state"] not in TERMINAL for o, _, j in self.store.all("job")) >= 2:
                raise ValueError("已有两个任务正在处理，请等待完成后再提交。")
            if directory_bytes(self.settings.data) > self.settings.disk_limit - self.settings.max_bytes:
                raise ValueError("服务存储空间暂时不足，请稍后重试。")
            identifier = uuid.uuid4().hex
            job = {"id": identifier, "title": analysis["title"], "platform_label": analysis["platform_label"], "mode": mode, "quality_label": "最佳可用音轨" if mode == "audio" else quality["label"], "state": "queued", "progress": None, "error": "", "files": [], "expires": time.time() + self.settings.retention + self.settings.job_timeout, "spec": {"operation": "download", "url": analysis["url"], "quality": quality, "audio_id": analysis["audio_id"], "mode": mode, "audio_format": audio_format}}
            self.store.put("job", job, owner, job["expires"])
            self.pool.submit(self.run_job, identifier, owner)
            return job

    def run_job(self, identifier, owner):
        with self.lock:
            job = self.store.get("job", identifier, owner, include_expired=True)
            if not job or job["state"] == "cancelled":
                return
            job["state"] = "parsing"
            self.store.put("job", job, owner, job["expires"])
        work = self.jobs_dir / identifier
        work.mkdir(exist_ok=True, mode=0o700)
        try:
            # Failed/restarted jobs must not retain old download fragments.
            for old in work.iterdir():
                if old.is_file():
                    old.unlink()
            result = self.run_worker(work, job["spec"], self.settings.job_timeout, identifier, owner)
            files = result["files"]
            for file in files:
                path = work / file["path"]
                if path.resolve().parent != work.resolve() or not path.is_file() or not 0 < path.stat().st_size <= self.settings.max_bytes:
                    raise ValueError("文件超出下载限制，请选择较低清晰度。")
            keep = {f["path"] for f in files}
            for path in work.iterdir():
                if path.is_file() and path.name not in keep:
                    path.unlink()
            with self.lock:
                fresh = self.store.get("job", identifier, owner, include_expired=True)
                if not fresh or fresh["state"] == "cancelled":
                    self.remove_directory(work)
                    return
                fresh.update(state="ready", progress=100, files=files, expires=time.time() + self.settings.retention)
                self.store.put("job", fresh, owner, fresh["expires"])
        except Exception as error:
            self.remove_directory(work)
            with self.lock:
                fresh = self.store.get("job", identifier, owner, include_expired=True)
                if fresh and fresh["state"] != "cancelled":
                    fresh.update(state="error", error=str(error)[:200], expires=time.time() + self.settings.retention)
                    self.store.put("job", fresh, owner, fresh["expires"])

    def cancel(self, identifier, owner):
        with self.lock:
            job = self.store.get("job", identifier, owner)
            if not job:
                return None
            if job["state"] not in TERMINAL:
                job.update(state="cancelled", error="", files=[])
                self.store.put("job", job, owner, job["expires"])
            return job

    def close(self):
        self.stop.set()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.maintenance.join(timeout=3)
