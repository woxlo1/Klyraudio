"""Contract tests for system, models, settings, generation, and editing endpoints."""

from __future__ import annotations

import io

from conftest import generate_asset
from fastapi.testclient import TestClient


def test_health_reports_local_only_service(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["local_only"] is True
    assert body["database_version"] >= 1
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Request-Id"]


def test_system_info_and_storage(client: TestClient) -> None:
    info = client.get("/api/system/info")
    assert info.status_code == 200
    system = info.json()
    assert system["data_dir"]
    assert system["ram_total_mb"] > 0
    assert "warnings" in system

    storage = client.get("/api/storage")
    assert storage.status_code == 200
    assert storage.json()["managed_bytes"] >= 0


def test_model_catalogue_labels_builtin_and_license_limits(client: TestClient) -> None:
    response = client.get("/api/models")
    assert response.status_code == 200
    models = {model["id"]: model for model in response.json()}

    sketch = models["klyraudio-sketch"]
    assert sketch["builtin"] is True
    assert sketch["availability"] == "ready"
    assert sketch["size_bytes"] == 0
    assert sketch["commercial_use"] == "permitted"

    musicgen = models["musicgen-small"]
    assert musicgen["builtin"] is False
    assert musicgen["commercial_use"] == "prohibited"
    assert musicgen["requires_license_acknowledgement"] is True

    stable = models["stable-audio-open-1.0"]
    assert stable["gated"] is True
    assert stable["commercial_use"] == "varies"
    assert stable["license_url"].startswith("https://")


def test_settings_validation_and_onboarding_flag(client: TestClient) -> None:
    updated = client.patch("/api/settings", json={"onboarding_complete": True, "language": "ja"})
    assert updated.status_code == 200
    assert updated.json()["onboarding_complete"] is True
    assert updated.json()["language"] == "ja"

    telemetry = client.patch("/api/settings", json={"telemetry": True})
    assert telemetry.status_code == 422

    language = client.patch("/api/settings", json={"language": "fr"})
    assert language.status_code == 422


def test_generation_produces_playable_asset(client: TestClient) -> None:
    response = client.post(
        "/api/generations",
        json={
            "model_id": "klyraudio-sketch",
            "task": "sfx",
            "prompt": "Short soft confirmation chime, gentle, clean",
            "duration": 1.5,
            "variations": 1,
            "params": {"quality": "fast"},
        },
    )
    assert response.status_code == 200, response.text
    job = response.json()["jobs"][0]
    assert job["status"] in {"queued", "running", "completed"}

    from conftest import wait_for_job

    finished = wait_for_job(client, job["id"])
    assert finished["status"] == "completed"
    assert finished["progress"] == 1.0
    # The backend is selected when the worker picks the job up, so it is only
    # guaranteed to be reported once the job has finished.
    assert finished["backend"] in {"cpu", "cuda", "mps"}

    asset_id = finished["output_asset_ids"][0]
    asset = client.get(f"/api/assets/{asset_id}").json()
    assert asset["origin"] == "generated"
    assert asset["media_type"] == "sfx"
    assert asset["duration"] > 1.0
    assert asset["sample_rate"] == 44100

    audio = client.get(f"/api/assets/{asset_id}/audio")
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/wav"
    assert len(audio.content) > 1000

    ranged = client.get(f"/api/assets/{asset_id}/audio", headers={"Range": "bytes=0-1023"})
    assert ranged.status_code == 206
    assert ranged.headers["content-range"].startswith("bytes 0-1023/")
    assert len(ranged.content) == 1024

    waveform = client.get(f"/api/assets/{asset_id}/waveform", params={"points": 64})
    assert waveform.status_code == 200
    peaks = waveform.json()["peaks"]
    assert len(peaks) == 2
    # Each point is a (min, max) pair, so 64 points produce 128 values.
    assert len(peaks[0]) == 128
    assert all(-1.0 <= value <= 1.0 for value in peaks[0])


def test_editor_operation_keeps_source_asset(client: TestClient) -> None:
    source = generate_asset(client, duration=2.0)
    response = client.post(
        f"/api/assets/{source['id']}/operations",
        json={"operation": "fade_in", "duration": 0.5},
    )
    assert response.status_code == 200, response.text
    edited = response.json()["assets"][0]
    assert edited["origin"] == "edited"
    assert edited["parent_asset_id"] == source["id"]
    assert edited["id"] != source["id"]

    still_there = client.get(f"/api/assets/{source['id']}")
    assert still_there.status_code == 200
    assert still_there.json()["origin"] == "generated"


def test_asset_listing_rejects_out_of_range_limit(client: TestClient) -> None:
    assert client.get("/api/assets", params={"limit": 500}).status_code == 200
    assert client.get("/api/assets", params={"limit": 1000}).status_code == 422


def test_import_rejects_unsupported_extension(client: TestClient) -> None:
    response = client.post(
        "/api/assets/import",
        files={"file": ("notes.txt", io.BytesIO(b"not audio"), "text/plain")},
    )
    assert response.status_code in {400, 415, 422}


def test_local_only_middleware_blocks_external_hosts(client: TestClient) -> None:
    blocked = client.get("/api/health", headers={"host": "evil.example"})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "host_not_allowed"

    origin = client.get("/api/health", headers={"origin": "https://evil.example"})
    assert origin.status_code == 403
    assert origin.json()["error"]["code"] == "origin_not_allowed"

    allowed = client.get("/api/health", headers={"origin": "http://127.0.0.1:5173"})
    assert allowed.status_code == 200
