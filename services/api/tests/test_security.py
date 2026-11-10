"""Security-focused tests for host/origin checks and filesystem containment."""

from __future__ import annotations

import io
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from klyraudio_api.config import SUPPORTED_IMPORT_EXTENSIONS, Paths
from klyraudio_api.security import (
    check_upload_name,
    ensure_allowed_existing,
    hostname_from_header,
    resolve_managed,
    resolve_within,
)


def wav_bytes(seconds: float = 0.1, sample_rate: int = 8000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(b"\x00\x00" * int(sample_rate * seconds))
    return buffer.getvalue()


def test_allows_loopback_hosts_with_ports_and_ipv6(client: TestClient) -> None:
    for host in ("127.0.0.1:8765", "localhost:8765", "[::1]:8765"):
        response = client.get("/api/health", headers={"host": host})
        assert response.status_code == 200, (host, response.text)


def test_allows_loopback_and_null_origins(client: TestClient) -> None:
    for origin in (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://[::1]:5173",
        "null",
    ):
        response = client.get("/api/health", headers={"origin": origin})
        assert response.status_code == 200, (origin, response.text)


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1.evil.example",
        "localhost.evil.example:8765",
        "evil.example",
        "0.0.0.0",
        "[::1].evil.example",
    ],
)
def test_rejects_spoofed_hosts(client: TestClient, host: str) -> None:
    response = client.get("/api/health", headers={"host": host})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "host_not_allowed"


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example",
        "http://localhost.evil.example",
        "http://127.0.0.1.evil.example",
        "https://127.0.0.1:5173",
    ],
)
def test_rejects_external_origins(client: TestClient, origin: str) -> None:
    response = client.get("/api/health", headers={"origin": origin})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_not_allowed"


def test_lan_mode_allows_other_hosts_but_not_other_origins(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("KLYRAUDIO_ALLOW_LAN", "1")
    allowed = client.get("/api/health", headers={"host": "192.168.1.20:8765"})
    assert allowed.status_code == 200

    blocked = client.get("/api/health", headers={"origin": "http://192.168.1.20:5173"})
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "origin_not_allowed"


def test_request_id_is_echoed_and_errors_carry_it(client: TestClient) -> None:
    health = client.get("/api/health", headers={"x-request-id": "fixed-request-id"})
    assert health.headers["X-Request-Id"] == "fixed-request-id"

    missing = client.get("/api/assets/does-not-exist")
    assert missing.status_code == 404
    error = missing.json()["error"]
    assert error["code"] == "not_found"
    assert error["request_id"]


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("127.0.0.1:8765", "127.0.0.1"),
        ("localhost:8765", "localhost"),
        ("[::1]", "::1"),
        ("[::1]:8765", "::1"),
        ("[::1].evil.example", "[::1].evil.example"),
        ("[::1]:not-a-port", "[::1]:not-a-port"),
        ("localhost:not-a-port", "localhost:not-a-port"),
        ("", ""),
    ],
)
def test_hostname_from_header_is_strict(header: str, expected: str) -> None:
    assert hostname_from_header(header) == expected


def test_upload_name_keeps_base_name_and_rejects_dangerous_values() -> None:
    assert check_upload_name("../song.wav", SUPPORTED_IMPORT_EXTENSIONS) == "song.wav"
    assert check_upload_name("folder/song.WAV", SUPPORTED_IMPORT_EXTENSIONS) == "song.WAV"

    for name in ("", ".", "..", "notes.txt", "song"):
        with pytest.raises(ValueError):
            check_upload_name(name, SUPPORTED_IMPORT_EXTENSIONS)


def test_import_sanitizes_a_traversal_filename(client: TestClient, tmp_path: Path) -> None:
    response = client.post(
        "/api/assets/import",
        files={"file": ("../../escape.wav", io.BytesIO(wav_bytes()), "audio/wav")},
        data={"media_type": "other"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "escape"
    assert body["origin"] == "imported"

    data_dir = tmp_path / "data"
    stored = [path for path in data_dir.rglob("*") if path.is_file()]
    assert stored
    for path in stored:
        path.resolve().relative_to(data_dir.resolve())


def test_import_rejects_an_empty_file(client: TestClient) -> None:
    response = client.post(
        "/api/assets/import",
        files={"file": ("empty.wav", io.BytesIO(b""), "audio/wav")},
        data={"media_type": "other"},
    )
    assert response.status_code == 422


def test_resolve_managed_accepts_allowed_folders(tmp_path: Path) -> None:
    paths = Paths(tmp_path / "data")
    paths.ensure()
    inside = paths.imports / "song.wav"
    inside.write_bytes(b"x")

    assert resolve_managed(paths, "imports/song.wav") == inside.resolve()


def test_resolve_managed_rejects_traversal_absolute_and_unknown_folders(tmp_path: Path) -> None:
    paths = Paths(tmp_path / "data")
    paths.ensure()

    for relative in ("../outside.wav", "imports/../../outside.wav", "", "logs/service.log"):
        with pytest.raises(PermissionError):
            resolve_managed(paths, relative)

    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"x")
    with pytest.raises(PermissionError):
        resolve_managed(paths, str(outside.resolve()))


def test_resolve_within_and_ensure_allowed_existing_reject_outside_paths(tmp_path: Path) -> None:
    paths = Paths(tmp_path / "data")
    paths.ensure()
    outside = tmp_path / "outside"
    outside.mkdir()
    outside_file = outside / "secret.wav"
    outside_file.write_bytes(b"x")

    with pytest.raises(PermissionError):
        resolve_within(paths.data_dir, outside_file)
    with pytest.raises(PermissionError):
        ensure_allowed_existing(paths, outside_file)

    inside = paths.media / "clip.wav"
    inside.write_bytes(b"x")
    assert resolve_within(paths.data_dir, inside) == inside.resolve()
    assert ensure_allowed_existing(paths, inside) == inside.resolve()


def test_symlink_escape_is_rejected(tmp_path: Path) -> None:
    paths = Paths(tmp_path / "data")
    paths.ensure()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "secret.wav").write_bytes(b"x")
    link = paths.data_dir / "linked"
    try:
        link.symlink_to(outside, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("Symbolic links are not available on this platform.")

    with pytest.raises(PermissionError):
        resolve_within(paths.data_dir, link / "secret.wav")


def test_docs_and_openapi_can_be_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from klyraudio_api.app import create_app

    monkeypatch.setenv("KLYRAUDIO_DISABLE_DOCS", "1")
    app = create_app(data_dir=tmp_path / "data", workers=False)
    with TestClient(app) as client:
        assert client.get("/api/docs").status_code == 404
        assert client.get("/api/openapi.json").status_code == 404


def test_default_data_dir_honours_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from klyraudio_api.config import default_data_dir

    custom = tmp_path / "custom-data"
    monkeypatch.setenv("KLYRAUDIO_DATA_DIR", str(custom))
    assert default_data_dir() == custom.resolve()

    monkeypatch.delenv("KLYRAUDIO_DATA_DIR", raising=False)
    assert default_data_dir().is_absolute()
