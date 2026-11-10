"""SQLite persistence with explicit schema migrations."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, List

MIGRATIONS: List[str] = [
    # 1: initial schema
    """
    CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        origin TEXT NOT NULL,
        media_type TEXT NOT NULL DEFAULT 'other',
        duration REAL NOT NULL DEFAULT 0,
        sample_rate INTEGER NOT NULL DEFAULT 44100,
        channels INTEGER NOT NULL DEFAULT 2,
        format TEXT NOT NULL DEFAULT 'wav',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_job_id TEXT,
        parent_asset_id TEXT,
        favorite INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        checksum TEXT
    );
    CREATE INDEX idx_assets_created ON assets(created_at DESC);
    CREATE INDEX idx_assets_type ON assets(media_type);

    CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
    );
    CREATE TABLE asset_tags (
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (asset_id, tag_id)
    );

    CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        task TEXT NOT NULL,
        prompt TEXT NOT NULL,
        negative_prompt TEXT NOT NULL DEFAULT '',
        params_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL,
        progress REAL,
        progress_label TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        error_json TEXT,
        output_asset_ids TEXT NOT NULL DEFAULT '[]',
        seed INTEGER,
        requested_variations INTEGER NOT NULL DEFAULT 1,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        retry_of TEXT,
        backend TEXT,
        duration_requested REAL
    );
    CREATE INDEX idx_jobs_status ON jobs(status);
    CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

    CREATE TABLE downloads (
        id TEXT PRIMARY KEY,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress REAL NOT NULL DEFAULT 0,
        total_bytes INTEGER,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        current_file TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        finished_at TEXT,
        files_json TEXT NOT NULL DEFAULT '[]',
        cancel_requested INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE model_installs (
        model_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        path TEXT NOT NULL,
        installed_at TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        license_acknowledged_at TEXT
    );

    CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        document_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        autosave_json TEXT,
        autosave_at TEXT
    );

    CREATE TABLE export_records (
        id TEXT PRIMARY KEY,
        asset_id TEXT,
        format TEXT NOT NULL,
        path TEXT NOT NULL,
        settings_json TEXT NOT NULL DEFAULT '{}',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX idx_exports_created ON export_records(created_at DESC);
    """,
]


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(str(self.path), timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = NORMAL")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _migrate(self) -> None:
        with self.connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            applied = {
                row["version"]
                for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
            }
            for index, script in enumerate(MIGRATIONS, start=1):
                if index in applied:
                    continue
                connection.executescript(script)
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at) "
                    "VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                    (index,),
                )

    def schema_version(self) -> int:
        with self.connect() as connection:
            row = connection.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
            return int(row["v"] or 0)
