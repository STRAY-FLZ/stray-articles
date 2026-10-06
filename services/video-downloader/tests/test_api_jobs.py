import hashlib
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import create_app, signature
from engine import Engine
from settings import Settings
from store import Store

TOKEN = "a" * 64
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Origin": "https://stray-flz.github.io"}
OWNER = hashlib.sha256(TOKEN.encode()).hexdigest()


def analysis():
    return {"title": "测试视频", "uploader": "Stray", "platform_label": "哔哩哔哩", "platform": "bilibili", "duration": 1, "audio_id": "a1", "has_audio": True, "qualities": [{"id": "q1", "label": "1080P", "size": 1000, "format_ids": ["v1", "a1"], "has_audio": True}]}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(Engine, "analyze", lambda *_: analysis())

    def process(self, work, spec, timeout, *args):
        (work / "source.mp4").write_bytes(b"test-media-output")
        return {"files": [{"key": "video", "path": "source.mp4", "label": "下载视频", "size": 17}]}

    monkeypatch.setattr(Engine, "run_worker", process)
    app = create_app(Settings(data=tmp_path / "data", origins=("https://stray-flz.github.io",)))
    with TestClient(app) as test:
        yield test


def create_analysis(client):
    response = client.post("/v1/analyze", json={"url": "https://www.bilibili.com/video/BV123"}, headers=HEADERS)
    assert response.status_code == 200
    return response.json()


def test_analysis_privacy_and_origin(client):
    data = create_analysis(client)
    assert "url" not in data and "audio_id" not in data
    assert "format_ids" not in data["qualities"][0]
    assert client.post("/v1/analyze", json={"url": "https://www.bilibili.com/video/BV123"}).status_code == 401
    assert client.get("/v1/health", headers={"Origin": "https://evil.test"}).status_code == 403
    response = client.options("/v1/analyze", headers={"Origin": HEADERS["Origin"], "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == HEADERS["Origin"]


def test_job_isolation_signed_delivery_and_expiry(client):
    data = create_analysis(client)
    other = {"Authorization": "Bearer " + "b" * 64}
    body = {"analysis_id": data["id"], "quality_id": "q1", "mode": "video"}
    assert client.post("/v1/jobs", json=body, headers=other).status_code == 410
    response = client.post("/v1/jobs", json=body, headers=HEADERS)
    assert response.status_code == 202
    identifier = response.json()["id"]
    for _ in range(100):
        item = client.get(f"/v1/jobs/{identifier}", headers=HEADERS).json()
        if item["state"] == "ready":
            break
        time.sleep(.01)
    assert item["state"] == "ready"
    assert "spec" not in item
    assert client.get(f"/v1/jobs/{identifier}", headers=other).status_code == 404
    link = item["files"][0]["url"]
    file = client.get(link)
    assert file.content == b"test-media-output"
    assert file.headers["Cache-Control"] == "private, no-store"
    assert "filename" in file.headers["Content-Disposition"]
    assert client.get(link.replace("/files/video?", "/files/audio?")).status_code == 403
    assert client.get(link + "invalid").status_code == 403
    expires = int(time.time()) - 1
    signed = signature(client.app.state.store.key, identifier, "video", expires)
    assert client.get(f"/v1/jobs/{identifier}/files/video?expires={expires}&signature={signed}").status_code == 403


def test_invalid_quality_size_and_unrecognized_options(client):
    data = create_analysis(client)
    body = {"analysis_id": data["id"], "quality_id": "q99", "mode": "split"}
    assert client.post("/v1/jobs", json=body, headers=HEADERS).status_code == 422
    assert client.post("/v1/jobs", json=body | {"quality_id": "q1", "command": "bad"}, headers=HEADERS).status_code == 422
    store = client.app.state.store
    stored = store.get("analysis", data["id"], OWNER)
    stored["qualities"][0]["size"] = 1024 ** 3
    store.put("analysis", stored, OWNER, time.time() + 300)
    assert client.post("/v1/jobs", json=body | {"quality_id": "q1"}, headers=HEADERS).status_code == 422


def test_payload_limits(client):
    response = client.post("/v1/analyze", content=b"x" * 10000, headers=HEADERS | {"Content-Type": "application/json"})
    assert response.status_code in (400, 413)


def test_rate_limiting(client):
    responses = [client.post("/v1/analyze", json={"url": "https://www.bilibili.com/video/BV123"}, headers=HEADERS) for _ in range(9)]
    assert responses[-1].status_code == 429


def test_completed_jobs_survive_restart_and_cleanup(tmp_path):
    directory = tmp_path / "data"
    store = Store(directory)
    identifier = "1" * 32
    work = directory / "jobs" / identifier
    work.mkdir(parents=True)
    (work / "video.mp4").write_bytes(b"retained")
    job = {"id": identifier, "state": "ready", "expires": time.time() + 60, "files": []}
    store.put("job", job, OWNER, job["expires"])
    key = store.key
    store.close()
    store = Store(directory)
    engine = Engine(Settings(data=directory), store)
    assert store.get("job", identifier, OWNER)["state"] == "ready"
    assert store.key == key
    store.put("job", job, OWNER, time.time() - 1)
    engine.cleanup()
    assert not work.exists() and store.get("job", identifier) is None
    engine.close()
    store.close()


def test_cancelled_jobs_do_not_run(tmp_path, monkeypatch):
    store = Store(tmp_path)
    engine = Engine(Settings(data=tmp_path), store)
    identifier = "2" * 32
    job = {"id": identifier, "state": "queued", "expires": time.time() + 60}
    store.put("job", job, OWNER, job["expires"])
    assert engine.cancel(identifier, OWNER)["state"] == "cancelled"
    monkeypatch.setattr(engine, "run_worker", lambda *_: pytest.fail("Cancelled job ran"))
    engine.run_job(identifier, OWNER)
    engine.close()
    store.close()


def test_queued_job_stays_visible_during_long_wait(tmp_path, monkeypatch):
    store = Store(tmp_path)
    engine = Engine(Settings(data=tmp_path), store)
    # Hold all workers to simulate a full queue of slow preceding downloads.
    monkeypatch.setattr(engine.pool, "submit", lambda *_: None)
    source = analysis() | {"url": "https://www.bilibili.com/video/BV123"}
    for visitor in range(12):
        identity = str(visitor)
        last = engine.submit(source, identity, source["qualities"][0], "video", "original")
    later = time.time() + 90 * 60
    with monkeypatch.context() as clock:
        clock.setattr(time, "time", lambda: later)
        assert store.get("job", last["id"], identity)["state"] == "queued"
    engine.close()
    store.close()
