"""Data-access repositories. SQL lives here; API mapping lives in services."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from .database import Database


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _row_to_dict(row: Any) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


class AssetRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(self, asset: Dict[str, Any]) -> Dict[str, Any]:
        with self._db.connect() as connection:
            connection.execute(
                """
                INSERT INTO assets (
                    id, name, path, origin, media_type, duration, sample_rate, channels,
                    format, size_bytes, created_at, updated_at, source_job_id,
                    parent_asset_id, favorite, notes, checksum
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    asset["id"],
                    asset["name"],
                    asset["path"],
                    asset["origin"],
                    asset["media_type"],
                    asset["duration"],
                    asset["sample_rate"],
                    asset["channels"],
                    asset["format"],
                    asset["size_bytes"],
                    asset["created_at"],
                    asset["updated_at"],
                    asset.get("source_job_id"),
                    asset.get("parent_asset_id"),
                    int(bool(asset.get("favorite", False))),
                    asset.get("notes", ""),
                    asset.get("checksum"),
                ),
            )
        return self.get(asset["id"])  # type: ignore[return-value]

    def get(self, asset_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
            if not row:
                return None
            asset = _row_to_dict(row)
            asset["tags"] = self._tags(connection, asset_id)
            return asset

    def find_by_path(self, path: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute("SELECT * FROM assets WHERE path = ?", (path,)).fetchone()
            return _row_to_dict(row) if row else None

    def list(
        self,
        *,
        query: str = "",
        media_type: Optional[str] = None,
        origin: Optional[str] = None,
        favorite: Optional[bool] = None,
        tag: Optional[str] = None,
        sort: str = "newest",
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[List[Dict[str, Any]], int]:
        clauses: List[str] = []
        params: List[Any] = []
        if query:
            clauses.append("(a.name LIKE ? OR a.notes LIKE ?)")
            like = f"%{query}%"
            params.extend([like, like])
        if media_type:
            clauses.append("a.media_type = ?")
            params.append(media_type)
        if origin:
            clauses.append("a.origin = ?")
            params.append(origin)
        if favorite is not None:
            clauses.append("a.favorite = ?")
            params.append(int(favorite))
        if tag:
            clauses.append(
                "a.id IN (SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id "
                "WHERE t.name = ? COLLATE NOCASE)"
            )
            params.append(tag)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        order = {
            "oldest": "a.created_at ASC",
            "name": "a.name COLLATE NOCASE ASC",
            "duration": "a.duration DESC",
            "size": "a.size_bytes DESC",
        }.get(sort, "a.created_at DESC")
        with self._db.connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) AS count FROM assets a {where}", params
            ).fetchone()["count"]
            rows = connection.execute(
                f"SELECT a.* FROM assets a {where} ORDER BY {order} LIMIT ? OFFSET ?",
                [*params, max(1, min(limit, 500)), max(0, offset)],
            ).fetchall()
            assets = []
            for row in rows:
                asset = _row_to_dict(row)
                asset["tags"] = self._tags(connection, asset["id"])
                assets.append(asset)
            return assets, int(total)

    def update(self, asset_id: str, changes: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed = {"name", "favorite", "notes", "media_type"}
        fields = {key: value for key, value in changes.items() if key in allowed and value is not None}
        tags = changes.get("tags")
        with self._db.connect() as connection:
            if fields:
                if "favorite" in fields:
                    fields["favorite"] = int(bool(fields["favorite"]))
                fields["updated_at"] = now_iso()
                assignments = ", ".join(f"{key} = ?" for key in fields)
                connection.execute(
                    f"UPDATE assets SET {assignments} WHERE id = ?",
                    [*fields.values(), asset_id],
                )
            if tags is not None:
                self._set_tags(connection, asset_id, tags)
        return self.get(asset_id)

    def delete(self, asset_id: str) -> Optional[Dict[str, Any]]:
        asset = self.get(asset_id)
        if not asset:
            return None
        with self._db.connect() as connection:
            connection.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
        return asset

    def all_tags(self) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT t.name, COUNT(at.asset_id) AS count FROM tags t "
                "LEFT JOIN asset_tags at ON at.tag_id = t.id GROUP BY t.id ORDER BY t.name"
            ).fetchall()
            return [{"name": row["name"], "count": row["count"]} for row in rows]

    def _tags(self, connection: Any, asset_id: str) -> List[str]:
        rows = connection.execute(
            "SELECT t.name FROM tags t JOIN asset_tags at ON at.tag_id = t.id "
            "WHERE at.asset_id = ? ORDER BY t.name",
            (asset_id,),
        ).fetchall()
        return [row["name"] for row in rows]

    def _set_tags(self, connection: Any, asset_id: str, tags: Sequence[str]) -> None:
        cleaned = []
        for tag in tags:
            value = " ".join(str(tag).strip().split())[:40]
            if value and value.lower() not in {item.lower() for item in cleaned}:
                cleaned.append(value)
        connection.execute("DELETE FROM asset_tags WHERE asset_id = ?", (asset_id,))
        for value in cleaned:
            connection.execute("INSERT OR IGNORE INTO tags(name) VALUES (?)", (value,))
            row = connection.execute(
                "SELECT id FROM tags WHERE name = ? COLLATE NOCASE", (value,)
            ).fetchone()
            if row:
                connection.execute(
                    "INSERT OR IGNORE INTO asset_tags(asset_id, tag_id) VALUES (?, ?)",
                    (asset_id, row["id"]),
                )


class JobRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(self, job: Dict[str, Any]) -> Dict[str, Any]:
        with self._db.connect() as connection:
            connection.execute(
                """
                INSERT INTO jobs (
                    id, model_id, task, prompt, negative_prompt, params_json, status,
                    progress, progress_label, created_at, started_at, finished_at,
                    error_json, output_asset_ids, seed, requested_variations,
                    cancel_requested, retry_of, backend, duration_requested
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job["id"],
                    job["model_id"],
                    job["task"],
                    job["prompt"],
                    job.get("negative_prompt", ""),
                    json.dumps(job.get("params", {}), ensure_ascii=False),
                    job.get("status", "queued"),
                    job.get("progress"),
                    job.get("progress_label"),
                    job["created_at"],
                    job.get("started_at"),
                    job.get("finished_at"),
                    json.dumps(job["error"], ensure_ascii=False) if job.get("error") else None,
                    json.dumps(job.get("output_asset_ids", [])),
                    job.get("seed"),
                    job.get("requested_variations", 1),
                    int(bool(job.get("cancel_requested", False))),
                    job.get("retry_of"),
                    job.get("backend"),
                    job.get("duration_requested", 0),
                ),
            )
        return self.get(job["id"])  # type: ignore[return-value]

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
            return _job_row(row) if row else None

    def list(self, *, status: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            if status:
                rows = connection.execute(
                    "SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                    (status, max(1, min(limit, 500))),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?",
                    (max(1, min(limit, 500)),),
                ).fetchall()
            return [_job_row(row) for row in rows]

    def update(self, job_id: str, changes: Dict[str, Any]) -> None:
        normalized = dict(changes)
        if "params" in normalized:
            normalized["params_json"] = json.dumps(normalized.pop("params"), ensure_ascii=False)
        if "error" in normalized:
            normalized["error_json"] = (
                json.dumps(normalized.pop("error"), ensure_ascii=False)
                if normalized["error"] is not None
                else None
            )
        if "output_asset_ids" in normalized:
            normalized["output_asset_ids"] = json.dumps(normalized["output_asset_ids"])
        if "cancel_requested" in normalized:
            normalized["cancel_requested"] = int(bool(normalized["cancel_requested"]))
        if not normalized:
            return
        assignments = ", ".join(f"{key} = ?" for key in normalized)
        with self._db.connect() as connection:
            connection.execute(
                f"UPDATE jobs SET {assignments} WHERE id = ?",
                [*normalized.values(), job_id],
            )

    def delete(self, job_id: str) -> bool:
        with self._db.connect() as connection:
            result = connection.execute(
                "DELETE FROM jobs WHERE id = ? AND status IN ('completed','failed','cancelled')",
                (job_id,),
            )
            return result.rowcount > 0

    def reset_queued(self) -> None:
        with self._db.connect() as connection:
            connection.execute(
                "UPDATE jobs SET status = 'queued', progress = NULL, progress_label = NULL, "
                "started_at = NULL, cancel_requested = 0 WHERE status = 'running'"
            )

    def recover_interrupted(self) -> List[str]:
        """Mark jobs interrupted by a previous crash as failed and return their ids."""
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT id FROM jobs WHERE status IN ('queued','running')"
            ).fetchall()
            ids = [row["id"] for row in rows]
            if ids:
                error = json.dumps(
                    {
                        "code": "interrupted",
                        "message": "The local service stopped before this job finished.",
                        "remediation": "Retry the job from the queue.",
                    }
                )
                connection.execute(
                    "UPDATE jobs SET status = 'failed', error_json = ?, finished_at = ? "
                    "WHERE status IN ('queued','running')",
                    (error, now_iso()),
                )
            return ids


def _job_row(row: Any) -> Dict[str, Any]:
    job = _row_to_dict(row)
    job["params"] = json.loads(job.pop("params_json") or "{}")
    job["output_asset_ids"] = json.loads(job.get("output_asset_ids") or "[]")
    raw_error = job.pop("error_json", None)
    job["error"] = json.loads(raw_error) if raw_error else None
    job["cancel_requested"] = bool(job.get("cancel_requested"))
    return job


class DownloadRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(self, item: Dict[str, Any]) -> Dict[str, Any]:
        with self._db.connect() as connection:
            connection.execute(
                """
                INSERT INTO downloads (
                    id, model_id, status, progress, total_bytes, downloaded_bytes,
                    current_file, error, created_at, finished_at, files_json, cancel_requested
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    item["model_id"],
                    item.get("status", "queued"),
                    item.get("progress", 0),
                    item.get("total_bytes"),
                    item.get("downloaded_bytes", 0),
                    item.get("current_file"),
                    item.get("error"),
                    item["created_at"],
                    item.get("finished_at"),
                    json.dumps(item.get("files", [])),
                    0,
                ),
            )
        return self.get(item["id"])  # type: ignore[return-value]

    def get(self, download_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute(
                "SELECT * FROM downloads WHERE id = ?", (download_id,)
            ).fetchone()
            return _download_row(row) if row else None

    def list(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM downloads ORDER BY created_at DESC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
            return [_download_row(row) for row in rows]

    def active_for_model(self, model_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute(
                "SELECT * FROM downloads WHERE model_id = ? AND status IN ('queued','running') "
                "ORDER BY created_at DESC LIMIT 1",
                (model_id,),
            ).fetchone()
            return _download_row(row) if row else None

    def update(self, download_id: str, changes: Dict[str, Any]) -> None:
        normalized = dict(changes)
        if "files" in normalized:
            normalized["files_json"] = json.dumps(normalized.pop("files"))
        if "cancel_requested" in normalized:
            normalized["cancel_requested"] = int(bool(normalized["cancel_requested"]))
        if not normalized:
            return
        assignments = ", ".join(f"{key} = ?" for key in normalized)
        with self._db.connect() as connection:
            connection.execute(
                f"UPDATE downloads SET {assignments} WHERE id = ?",
                [*normalized.values(), download_id],
            )


def _download_row(row: Any) -> Dict[str, Any]:
    item = _row_to_dict(row)
    item["files"] = json.loads(item.pop("files_json") or "[]")
    item["cancel_requested"] = bool(item.get("cancel_requested"))
    return item


class ModelInstallRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def get(self, model_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute(
                "SELECT * FROM model_installs WHERE model_id = ?", (model_id,)
            ).fetchone()
            return _row_to_dict(row) if row else None

    def list(self) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            rows = connection.execute("SELECT * FROM model_installs ORDER BY installed_at DESC").fetchall()
            return [_row_to_dict(row) for row in rows]

    def upsert(self, model_id: str, version: str, path: str, size_bytes: int) -> None:
        with self._db.connect() as connection:
            connection.execute(
                """
                INSERT INTO model_installs(model_id, version, path, installed_at, size_bytes)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(model_id) DO UPDATE SET version = excluded.version,
                    path = excluded.path, installed_at = excluded.installed_at,
                    size_bytes = excluded.size_bytes
                """,
                (model_id, version, path, now_iso(), size_bytes),
            )

    def delete(self, model_id: str) -> None:
        with self._db.connect() as connection:
            connection.execute("DELETE FROM model_installs WHERE model_id = ?", (model_id,))


class ProjectRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(self, project_id: str, name: str, document: Dict[str, Any], version: int) -> Dict[str, Any]:
        timestamp = now_iso()
        with self._db.connect() as connection:
            connection.execute(
                "INSERT INTO projects(id, name, document_json, version, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (project_id, name, json.dumps(document, ensure_ascii=False), version, timestamp, timestamp),
            )
        return self.get(project_id)  # type: ignore[return-value]

    def get(self, project_id: str) -> Optional[Dict[str, Any]]:
        with self._db.connect() as connection:
            row = connection.execute(
                "SELECT * FROM projects WHERE id = ?", (project_id,)
            ).fetchone()
            return _project_row(row) if row else None

    def list(self) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            rows = connection.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
            return [_project_row(row) for row in rows]

    def update(
        self,
        project_id: str,
        *,
        document: Dict[str, Any],
        version: int,
        autosave: bool = False,
        name: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        serialized = json.dumps(document, ensure_ascii=False)
        timestamp = now_iso()
        with self._db.connect() as connection:
            if autosave:
                # Autosave stores the working document so reopening the project never loses
                # changes. The autosave columns still mark that the state was not saved
                # explicitly, and an explicit save clears them.
                connection.execute(
                    "UPDATE projects SET document_json = ?, version = ?, updated_at = ?, "
                    "name = COALESCE(?, name), autosave_json = ?, autosave_at = ? WHERE id = ?",
                    (serialized, version, timestamp, name, serialized, timestamp, project_id),
                )
            else:
                connection.execute(
                    "UPDATE projects SET document_json = ?, version = ?, updated_at = ?, "
                    "name = COALESCE(?, name), autosave_json = NULL, autosave_at = NULL WHERE id = ?",
                    (serialized, version, timestamp, name, project_id),
                )
        return self.get(project_id)

    def delete(self, project_id: str) -> bool:
        with self._db.connect() as connection:
            result = connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return result.rowcount > 0


def _project_row(row: Any) -> Dict[str, Any]:
    item = _row_to_dict(row)
    item["document"] = json.loads(item.pop("document_json"))
    autosave = item.pop("autosave_json", None)
    item["autosave"] = json.loads(autosave) if autosave else None
    return item


class ExportRepository:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(self, record: Dict[str, Any]) -> Dict[str, Any]:
        with self._db.connect() as connection:
            connection.execute(
                "INSERT INTO export_records(id, asset_id, format, path, settings_json, size_bytes, "
                "created_at, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    record["id"],
                    record.get("asset_id"),
                    record["format"],
                    record["path"],
                    json.dumps(record.get("settings", {})),
                    record.get("size_bytes", 0),
                    record.get("created_at", now_iso()),
                    int(bool(record.get("verified", False))),
                ),
            )
        return record

    def list(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._db.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM export_records ORDER BY created_at DESC LIMIT ?",
                (max(1, min(limit, 200)),),
            ).fetchall()
            results = []
            for row in rows:
                item = _row_to_dict(row)
                item["settings"] = json.loads(item.pop("settings_json"))
                item["verified"] = bool(item["verified"])
                results.append(item)
            return results
