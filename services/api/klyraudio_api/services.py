"""Shared service container wiring repositories, domain services, and managers."""

from __future__ import annotations

from dataclasses import dataclass

from .config import ConfigStore, ServiceContext
from .database import Database
from .assets_service import AssetService
from .export_service import ExportService
from .jobs import JobManager
from .models.downloads import DownloadManager
from .projects_service import ProjectService
from .repositories import (
    AssetRepository,
    DownloadRepository,
    ExportRepository,
    JobRepository,
    ModelInstallRepository,
    ProjectRepository,
)


@dataclass
class Services:
    context: ServiceContext
    config: ConfigStore
    database: Database
    assets_repo: AssetRepository
    jobs_repo: JobRepository
    projects_repo: ProjectRepository
    exports_repo: ExportRepository
    installs_repo: ModelInstallRepository
    downloads_repo: DownloadRepository
    assets: AssetService
    projects: ProjectService
    exports: ExportService
    jobs: JobManager
    downloads: DownloadManager


def build_services(context: ServiceContext) -> Services:
    database = Database(context.paths.database)
    config = context.config
    assets_repo = AssetRepository(database)
    jobs_repo = JobRepository(database)
    projects_repo = ProjectRepository(database)
    exports_repo = ExportRepository(database)
    installs_repo = ModelInstallRepository(database)
    downloads_repo = DownloadRepository(database)

    assets = AssetService(context, assets_repo)
    projects = ProjectService(context, projects_repo, assets_repo)
    exports = ExportService(context, assets, exports_repo)
    jobs = JobManager(context, jobs_repo, assets_repo, installs_repo, config)
    downloads = DownloadManager(context.paths, config, downloads_repo, installs_repo)
    return Services(
        context=context,
        config=config,
        database=database,
        assets_repo=assets_repo,
        jobs_repo=jobs_repo,
        projects_repo=projects_repo,
        exports_repo=exports_repo,
        installs_repo=installs_repo,
        downloads_repo=downloads_repo,
        assets=assets,
        projects=projects,
        exports=exports,
        jobs=jobs,
        downloads=downloads,
    )
