"""Project persistence, autosave, rendering, and export tests."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from conftest import generate_asset


def create_project(client: TestClient, name: str = "Test project") -> dict:
    response = client.post("/api/projects", json={"name": name, "sample_rate": 44100})
    assert response.status_code == 200, response.text
    return response.json()


def project_with_clip(client: TestClient, asset: dict, duration: float = 3.0) -> dict:
    project = create_project(client)
    document = project["document"]
    document["tracks"] = [
        {
            "id": "trk_test",
            "name": "Track 1",
            "volume": 1.0,
            "pan": 0.0,
            "mute": False,
            "solo": False,
            "clips": [
                {
                    "id": "clip_test",
                    "asset_id": asset["id"],
                    "start": 0.0,
                    "offset": 0.0,
                    "duration": duration,
                    "fade_in": 0.0,
                    "fade_out": 0.0,
                    "gain": 1.0,
                }
            ],
        }
    ]
    saved = client.put(
        f"/api/projects/{document['id']}",
        json={"document": document, "autosave": False},
    )
    assert saved.status_code == 200, saved.text
    return saved.json()["document"]


def test_project_create_and_list(client: TestClient) -> None:
    project = create_project(client, "Arrangement")
    assert project["name"] == "Arrangement"
    assert project["track_count"] == 0
    assert project["document"]["version"] == 1

    listing = client.get("/api/projects")
    assert listing.status_code == 200
    assert [item["id"] for item in listing.json()] == [project["id"]]


def test_autosave_persists_the_working_document(client: TestClient) -> None:
    asset = generate_asset(client, duration=3.0)
    document = project_with_clip(client, asset)
    project_id = document["id"]

    autosaved = client.put(
        f"/api/projects/{project_id}",
        json={"document": document, "autosave": True},
    )
    assert autosaved.status_code == 200, autosaved.text
    body = autosaved.json()
    assert body["track_count"] == 1
    assert body["duration"] == 3.0
    assert body["has_autosave"] is True
    assert body["document"]["tracks"][0]["clips"][0]["asset_id"] == asset["id"]

    reloaded = client.get(f"/api/projects/{project_id}").json()
    assert reloaded["document"]["tracks"][0]["clips"][0]["asset_id"] == asset["id"]

    document["tracks"][0]["volume"] = 0.5
    explicit = client.put(
        f"/api/projects/{project_id}",
        json={"document": document, "autosave": False},
    )
    assert explicit.status_code == 200
    assert explicit.json()["has_autosave"] is False
    assert explicit.json()["document"]["tracks"][0]["volume"] == 0.5


def test_project_rejects_dangling_clips_and_invalid_fades(client: TestClient) -> None:
    project = create_project(client)
    document = project["document"]
    document["tracks"] = [
        {
            "id": "trk_missing",
            "name": "Broken",
            "volume": 1.0,
            "pan": 0.0,
            "mute": False,
            "solo": False,
            "clips": [
                {
                    "id": "clip_missing",
                    "asset_id": "as_does_not_exist",
                    "start": 0.0,
                    "offset": 0.0,
                    "duration": 1.0,
                    "fade_in": 0.0,
                    "fade_out": 0.0,
                    "gain": 1.0,
                }
            ],
        }
    ]
    missing = client.put(
        f"/api/projects/{project['id']}",
        json={"document": document, "autosave": False},
    )
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "validation_failed"

    asset = generate_asset(client, duration=2.0)
    document = project_with_clip(client, asset, duration=1.0)
    document["tracks"][0]["clips"][0]["fade_in"] = 0.8
    document["tracks"][0]["clips"][0]["fade_out"] = 0.8
    fades = client.put(
        f"/api/projects/{document['id']}",
        json={"document": document, "autosave": False},
    )
    assert fades.status_code == 422


def test_dry_render_matches_project_length_and_time_effects_add_tail(
    client: TestClient,
) -> None:
    asset = generate_asset(client, duration=3.0)
    document = project_with_clip(client, asset)
    project_id = document["id"]

    dry = client.post(
        f"/api/projects/{project_id}/render",
        json={"master_effects": False, "normalize": False},
    )
    assert dry.status_code == 200, dry.text
    dry_asset = dry.json()
    assert dry_asset["origin"] == "rendered"
    assert abs(dry_asset["duration"] - 3.0) < 0.05

    document["master"]["effects"] = [
        {"type": "reverb", "enabled": True, "params": {"room_size": 0.5, "wet": 0.3}}
    ]
    saved = client.put(
        f"/api/projects/{project_id}",
        json={"document": document, "autosave": False},
    )
    assert saved.status_code == 200, saved.text
    wet = client.post(
        f"/api/projects/{project_id}/render",
        json={"master_effects": True, "normalize": False},
    )
    assert wet.status_code == 200, wet.text
    assert wet.json()["duration"] > 3.0


def test_export_writes_and_verifies_a_wav_file(client: TestClient, tmp_path: Path) -> None:
    asset = generate_asset(client, duration=2.0)
    response = client.post(
        "/api/export",
        json={
            "asset_id": asset["id"],
            "format": "wav",
            "sample_rate": 44100,
            "bit_depth": 16,
            "channels": 2,
            "filename": "verified-export",
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["verified"] is True
    assert result["format"] == "wav"
    assert result["size_bytes"] > 1000
    assert Path(result["path"]).is_file()

    history = client.get("/api/export/history", params={"limit": 5})
    assert history.status_code == 200
    assert any(item["id"] == result["id"] for item in history.json())

    capabilities = client.get("/api/export/capabilities")
    assert capabilities.status_code == 200
    formats = {item["id"]: item for item in capabilities.json()["formats"]}
    assert formats["wav"]["available"] is True


def test_render_empty_project_fails_clearly(client: TestClient) -> None:
    project = create_project(client, "Empty")
    response = client.post(f"/api/projects/{project['id']}/render", json={})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"
