"""Shared pytest fixtures for the local Klyraudio API."""

from __future__ import annotations

import sys
import time
from collections.abc import Iterator
from pathlib import Path

import pytest

# Allow running the suite from the repository root without installing the package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from klyraudio_api.app import create_app  # noqa: E402


@pytest.fixture()
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(data_dir=tmp_path / "data", workers=True)
    with TestClient(app) as test_client:
        yield test_client


def wait_for_job(client: TestClient, job_id: str, timeout: float = 30.0) -> dict:
    """Poll a generation job until it reaches a terminal status."""

    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        response = client.get(f"/api/jobs/{job_id}")
        assert response.status_code == 200, response.text
        last = response.json()
        if last["status"] in {"completed", "failed", "cancelled"}:
            return last
        time.sleep(0.2)
    raise AssertionError(f"Job {job_id} did not finish in time: {last}")


def generate_asset(client: TestClient, **overrides) -> dict:
    payload = {
        "model_id": "klyraudio-sketch",
        "task": "sfx",
        "prompt": "Short soft confirmation chime, gentle, clean",
        "duration": 1.5,
        "variations": 1,
        "params": {"quality": "fast"},
    }
    payload.update(overrides)
    response = client.post("/api/generations", json=payload)
    assert response.status_code == 200, response.text
    job = wait_for_job(client, response.json()["jobs"][0]["id"])
    assert job["status"] == "completed", job
    asset_id = job["output_asset_ids"][0]
    asset_response = client.get(f"/api/assets/{asset_id}")
    assert asset_response.status_code == 200, asset_response.text
    return asset_response.json()
