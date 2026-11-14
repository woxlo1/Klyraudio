"""Model catalogue, installation state, and adapter availability reporting."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from ..config import Paths, RuntimeSettings
from ..repositories import ModelInstallRepository
from ..schemas import ModelInfo
from .adapters import build_adapter
from .registry import MODELS, ModelDefinition, get_model


def _installed_map(repo: ModelInstallRepository) -> dict[str, dict[str, object]]:
    return {row["model_id"]: row for row in repo.list()}


def _deps_present(definition: ModelDefinition) -> bool:
    if definition.builtin:
        return True
    packages = {
        "torch": "torch",
        "transformers": "transformers",
        "diffusers": "diffusers",
    }
    for runtime in definition.runtime:
        module = packages.get(runtime)
        if module and importlib.util.find_spec(module) is None:
            return False
    return True


def describe_model(
    definition: ModelDefinition,
    *,
    install: dict[str, object] | None,
    settings: RuntimeSettings,
    install_repo: ModelInstallRepository,
) -> ModelInfo:
    installed = install is not None
    install_path = str(install["path"]) if install else None
    acknowledged = definition.id in settings.model_license_acknowledgements

    if definition.builtin:
        availability = "ready"
        detail = None
    elif not installed:
        availability = "not-installed"
        detail = "Download the model files from the Model Manager to use it."
    else:
        adapter = build_adapter(definition, install_path, "cpu")
        available, reason = adapter.availability()
        if available:
            availability = "ready"
            detail = None
        elif not _deps_present(definition):
            availability = "installed-missing-deps"
            detail = reason
        else:
            availability = "unsupported"
            detail = reason

    return ModelInfo(
        id=definition.id,
        name=definition.name,
        family=definition.family,
        description=definition.description,
        tasks=definition.tasks,  # type: ignore[arg-type]
        capabilities=definition.capabilities,
        runtime=definition.runtime,
        operating_systems=definition.operating_systems,
        acceleration=definition.acceleration,
        vram_estimate_mb=definition.vram_estimate_mb,
        ram_estimate_mb=definition.ram_estimate_mb,
        size_bytes=definition.size_bytes,
        source_url=definition.source_url,
        license_name=definition.license_name,
        license_url=definition.license_url,
        commercial_use=definition.commercial_use,  # type: ignore[arg-type]
        redistribution=definition.redistribution,  # type: ignore[arg-type]
        bundling=definition.bundling,  # type: ignore[arg-type]
        known_limitations=definition.known_limitations,
        builtin=definition.builtin,
        installed=installed,
        availability=availability,  # type: ignore[arg-type]
        availability_detail=detail,
        requires_license_acknowledgement=definition.requires_license_acknowledgement,
        license_acknowledged=acknowledged,
        gated=definition.gated,
        installed_path=install_path,
    )


def list_models(
    settings: RuntimeSettings, install_repo: ModelInstallRepository
) -> list[ModelInfo]:
    installs = _installed_map(install_repo)
    return [
        describe_model(
            definition,
            install=installs.get(definition.id),
            settings=settings,
            install_repo=install_repo,
        )
        for definition in MODELS
    ]


def model_info(
    model_id: str, settings: RuntimeSettings, install_repo: ModelInstallRepository
) -> ModelInfo | None:
    definition = get_model(model_id)
    if not definition:
        return None
    install = install_repo.get(model_id)
    return describe_model(definition, install=install, settings=settings, install_repo=install_repo)


def installed_path(paths: Paths, model_id: str) -> Path:
    return paths.models / model_id
