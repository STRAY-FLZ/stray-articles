import json
import secrets
import sqlite3
import threading
import time


class Store:
    def __init__(self, data):
        self.data = data
        data.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(data / "jobs.sqlite", check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT PRIMARY KEY, owner TEXT, expires REAL, payload TEXT)")
        self.db.execute("CREATE INDEX IF NOT EXISTS record_owner ON records(kind, owner)")
        self.db.commit()
        key = data / "download.key"
        if not key.exists():
            key.write_bytes(secrets.token_bytes(32))
            key.chmod(0o600)
        self.key = key.read_bytes()

    def put(self, kind, record, owner, expires):
        with self.lock:
            self.db.execute("INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?, ?)", (kind, record["id"], owner, expires, json.dumps(record, ensure_ascii=False)))
            self.db.commit()

    def get(self, kind, identifier, owner=None, include_expired=False):
        with self.lock:
            row = self.db.execute("SELECT owner, expires, payload FROM records WHERE kind=? AND id=?", (kind, identifier)).fetchone()
        if not row or (owner is not None and row[0] != owner) or (not include_expired and row[1] <= time.time()):
            return None
        return json.loads(row[2])

    def all(self, kind):
        with self.lock:
            rows = self.db.execute("SELECT owner, expires, payload FROM records WHERE kind=?", (kind,)).fetchall()
        return [(owner, expires, json.loads(payload)) for owner, expires, payload in rows]

    def remove(self, identifier):
        with self.lock:
            self.db.execute("DELETE FROM records WHERE id=?", (identifier,))
            self.db.commit()

    def close(self):
        with self.lock:
            self.db.close()
