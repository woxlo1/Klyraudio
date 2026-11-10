"""Persistent generation job queue with honest progress and cancellation."""

from __future__ import annotations

import logging
import queue
import threading
import time
import uuid
from typing import Dict, List, Optional

from .assets_service import AssetService
from .audio import io
from .config import ConfigStore, ServiceContext, sanitize_filename
from .errors import ApiError, NotFound, ValidationFailed
from .hardware import detect_system, select_device
from .models.adapters import (
    AudioResult,
    GenerationCancelled,
    build_adapter,
)
from .models.catalog import model_info
from .models.registry import ModelDefinition, get_model, task_capability
from .repositories import AssetRepository, JobRepository, ModelInstallRepository, now_iso
from .schemas import (
    GenerationRequest,
    HardwareWarning,
    JobInfo,
)

logger = logging.getLogger("klyraudio.jobs")

TERMINAL_STATUSES = {"completed", "failed", "cancelled"}


class JobManager:
    def __init__(
        self,
        context: ServiceContext,
        jobs: JobRepository,
        assets: AssetRepository,
        installs: ModelInstallRepository,
        config: ConfigStore,
    ) -> None:
        self.context = context
        self.jobs = jobs
        self.installs = installs
        self.config = config
        self.assets = AssetService(context, assets)
        self._queue: queue.Queue[Optional[str]] = queue.Queue()
        self._workers: List[threading.Thread] = []
        self._stopping = threading.Event()
        self._cancels: Dict[str, threading.Event] = {}
        self._lock = threading.RLock()
        self._gpu_lock = threading.Lock()
        self._worker_count = max(1, min(4, config.settings.max_concurrent_jobs))

    # ------------------------------------------------------------------ lifecycle
    def start(self) -> None:
        running = self.jobs.list(status="running", limit=500)
        for job in running:
            self.jobs.update(
                job["id"],
                {
                    "status": "failed",
                    "finished_at": now_iso(),
                    "error": {
                        "code": "interrupted",
                        "message": "The local service stopped before this job finished.",
                        "remediation": "Retry this job from the queue.",
                    },
                },
            )
        queued = self.jobs.list(status="queued", limit=500)
        for job in reversed(queued):
            self._queue.put(job["id"])
        for index in range(self._worker_count):
            thread = threading.Thread(
                target=self._worker,
                name=f"generation-worker-{index + 1}",
                daemon=True,
            )
            thread.start()
            self._workers.append(thread)
        logger.info("Job queue started", extra={"event": "queue_started"})

    def shutdown(self) -> None:
        self._stopping.set()
        with self._lock:
            for event in self._cancels.values():
                event.set()
        for _ in self._workers:
            self._queue.put(None)
        deadline = time.time() + 8.0
        for thread in self._workers:
            thread.join(timeout=max(0.1, deadline - time.time()))

    # ------------------------------------------------------------------ public API
    def submit(self, request: GenerationRequest) -> tuple[List[JobInfo], List[HardwareWarning]]:
        definition = get_model(request.model_id)
        if not definition:
            raise NotFound("Model", request.model_id)
        capability = task_capability(definition, request.task)
        if not capability:
            raise ValidationFailed(
                f"{definition.name} does not support {request.task} generation.",
                {"supported_tasks": definition.tasks},
            )
        if not capability.duration_min <= request.duration <= capability.duration_max:
            raise ValidationFailed(
                f"{definition.name} supports durations from {capability.duration_min:g} to "
                f"{capability.duration_max:g} seconds for {request.task}.",
                {"duration": request.duration, "max": capability.duration_max},
            )
        if request.variations > capability.max_variations:
            raise ValidationFailed(
                f"{definition.name} supports at most {capability.max_variations} variations per job."
            )
        if request.negative_prompt and not capability.supports_negative_prompt:
            raise ValidationFailed(
                f"{definition.name} does not support negative prompts.",
                {"supported_parameters": capability.supported_parameters},
            )

        info = model_info(request.model_id, self.config.settings, self.installs)
        if not info:
            raise NotFound("Model", request.model_id)
        if info.availability != "ready":
            raise ApiError(
                "model_not_ready",
                f"{definition.name} is not ready to generate audio.",
                status_code=409,
                details={
                    "availability": info.availability,
                    "detail": info.availability_detail,
                },
                remediation=(
                    "Open the Model Manager to download the model, install its optional Python "
                    "dependencies, or choose the built-in Sketch engine."
                ),
            )
        if definition.requires_license_acknowledgement and not info.license_acknowledged:
            raise ValidationFailed(
                "Review and acknowledge this model's license before generating audio.",
                {"license_name": definition.license_name, "license_url": definition.license_url},
            )

        seed = request.seed
        if seed is None:
            seed = int.from_bytes(uuid.uuid4().bytes[:4], "big") & 0x7FFFFFFF
        job_id = f"job_{uuid.uuid4().hex[:20]}"
        record = self.jobs.create(
            {
                "id": job_id,
                "model_id": request.model_id,
                "task": request.task,
                "prompt": request.prompt,
                "negative_prompt": request.negative_prompt,
                "params": request.params.model_dump(),
                "status": "queued",
                "created_at": now_iso(),
                "output_asset_ids": [],
                "seed": seed,
                "requested_variations": request.variations,
                "duration_requested": request.duration,
            }
        )
        self._queue.put(job_id)
        warnings = self._hardware_warnings(definition)
        logger.info(
            "Generation queued",
            extra={"job_id": job_id, "model_id": request.model_id, "event": "job_queued"},
        )
        return [self.to_info(record)], warnings

    def list(self, status: Optional[str] = None) -> List[JobInfo]:
        return [self.to_info(job) for job in self.jobs.list(status=status)]

    def get(self, job_id: str) -> JobInfo:
        job = self.jobs.get(job_id)
        if not job:
            raise NotFound("Job", job_id)
        return self.to_info(job)

    def cancel(self, job_id: str) -> JobInfo:
        job = self.jobs.get(job_id)
        if not job:
            raise NotFound("Job", job_id)
        if job["status"] in TERMINAL_STATUSES:
            return self.to_info(job)
        with self._lock:
            event = self._cancels.get(job_id)
            if event:
                event.set()
        self.jobs.update(job_id, {"cancel_requested": True})
        if job["status"] == "queued":
            self.jobs.update(
                job_id,
                {
                    "status": "cancelled",
                    "finished_at": now_iso(),
                    "progress_label": "Cancelled before starting",
                },
            )
        return self.get(job_id)

    def retry(self, job_id: str) -> JobInfo:
        job = self.jobs.get(job_id)
        if not job:
            raise NotFound("Job", job_id)
        if job["status"] not in {"failed", "cancelled"}:
            raise ValidationFailed("Only failed or cancelled jobs can be retried.")
        request = GenerationRequest(
            model_id=job["model_id"],
            task=job["task"],
            prompt=job["prompt"],
            negative_prompt=job["negative_prompt"],
            duration=float(job["duration_requested"]),
            seed=job["seed"],
            variations=int(job["requested_variations"]),
            params=job["params"],
        )
        new_jobs, _warnings = self.submit(request)
        self.jobs.update(new_jobs[0].id, {"retry_of": job_id})
        return self.get(new_jobs[0].id)

    def delete(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if not job:
            raise NotFound("Job", job_id)
        if job["status"] not in TERMINAL_STATUSES:
            raise ValidationFailed("Cancel the job before deleting it.")
        if not self.jobs.delete(job_id):
            raise ApiError("job_delete_failed", "The job could not be deleted.", status_code=500)

    # ------------------------------------------------------------------ workers
    def _worker(self) -> None:
        while not self._stopping.is_set():
            try:
                job_id = self._queue.get(timeout=1.0)
            except queue.Empty:
                continue
            if job_id is None:
                return
            try:
                self._run_job(job_id)
            except Exception:
                logger.exception("Unexpected job worker failure", extra={"job_id": job_id})
            finally:
                self._queue.task_done()

    def _run_job(self, job_id: str) -> None:
        job = self.jobs.get(job_id)
        if not job:
            return
        if job["status"] != "queued":
            return
        if job.get("cancel_requested"):
            self.jobs.update(job_id, {"status": "cancelled", "finished_at": now_iso()})
            return
        definition = get_model(job["model_id"])
        if not definition:
            self.jobs.update(
                job_id,
                {
                    "status": "failed",
                    "finished_at": now_iso(),
                    "error": {
                        "code": "model_not_found",
                        "message": "The model used by this job is no longer available.",
                    },
                },
            )
            return

        cancel_event = threading.Event()
        with self._lock:
            self._cancels[job_id] = cancel_event
        device = select_device(self.config.settings.gpu_preference)
        self.jobs.update(
            job_id,
            {
                "status": "running",
                "started_at": now_iso(),
                "progress": 0.0,
                "progress_label": "Preparing",
                "backend": device,
            },
        )
        logger.info(
            "Generation started",
            extra={"job_id": job_id, "model_id": job["model_id"], "event": "job_started"},
        )
        written: List[str] = []
        try:
            install = self.installs.get(definition.id)
            adapter = build_adapter(
                definition, str(install["path"]) if install else None, device
            )
            available, detail = adapter.availability()
            if not available:
                raise ApiError(
                    "model_not_ready",
                    detail or "The model is not ready.",
                    status_code=409,
                    remediation="Open the Model Manager to install the model or its dependencies.",
                )
            request = GenerationRequest(
                model_id=job["model_id"],
                task=job["task"],
                prompt=job["prompt"],
                negative_prompt=job["negative_prompt"],
                duration=float(job["duration_requested"]),
                seed=job["seed"],
                variations=int(job["requested_variations"]),
                params=job["params"],
            )
            last_update = {"time": 0.0}

            def progress(value: Optional[float], label: str) -> None:
                now = time.monotonic()
                if now - last_update["time"] < 0.25 and value is not None:
                    return
                last_update["time"] = now
                self.jobs.update(
                    job_id,
                    {"progress": value, "progress_label": label[:200]},
                )

            def cancelled() -> bool:
                return cancel_event.is_set()

            use_lock = not definition.builtin
            if use_lock:
                with self._gpu_lock:
                    results = adapter.generate_batch(
                        request, request.variations, progress, cancelled
                    )
            else:
                results = adapter.generate_batch(request, request.variations, progress, cancelled)
            if cancelled():
                raise GenerationCancelled()
            progress(0.99, "Saving generated audio")
            output_ids = self._save_results(job, request, results)
            written = output_ids
            self.jobs.update(
                job_id,
                {
                    "status": "completed",
                    "progress": 1.0,
                    "progress_label": "Completed",
                    "finished_at": now_iso(),
                    "output_asset_ids": output_ids,
                },
            )
            logger.info(
                "Generation completed",
                extra={"job_id": job_id, "model_id": job["model_id"], "event": "job_completed"},
            )
        except GenerationCancelled:
            self.jobs.update(
                job_id,
                {
                    "status": "cancelled",
                    "progress_label": "Cancelled",
                    "finished_at": now_iso(),
                    "output_asset_ids": [],
                },
            )
            logger.info("Generation cancelled", extra={"job_id": job_id, "event": "job_cancelled"})
        except ApiError as exc:
            self.jobs.update(
                job_id,
                {
                    "status": "failed",
                    "finished_at": now_iso(),
                    "error": {
                        "code": exc.code,
                        "message": exc.message,
                        "details": exc.details,
                        "remediation": exc.remediation,
                    },
                },
            )
            logger.warning(
                f"Generation failed: {exc.code}",
                extra={"job_id": job_id, "model_id": job["model_id"], "event": "job_failed"},
            )
        except Exception as exc:
            logger.exception("Unhandled generation failure", extra={"job_id": job_id})
            self.jobs.update(
                job_id,
                {
                    "status": "failed",
                    "finished_at": now_iso(),
                    "error": {
                        "code": "generation_crashed",
                        "message": f"The generation worker stopped unexpectedly ({exc.__class__.__name__}).",
                        "remediation": "Retry the job. If it keeps failing, check the local service log.",
                    },
                },
            )
        finally:
            with self._lock:
                self._cancels.pop(job_id, None)
            if written and self.jobs.get(job_id) and self.jobs.get(job_id)["status"] != "completed":
                for asset_id in written:
                    try:
                        self.assets.delete(asset_id, delete_file=True)
                    except Exception:
                        pass

    def _save_results(
        self,
        job: Dict[str, object],
        request: GenerationRequest,
        results: List[AudioResult],
    ) -> List[str]:
        output_ids: List[str] = []
        base = sanitize_filename(str(job["prompt"]).strip().splitlines()[0][:60], "Klyraudio audio")
        for index, result in enumerate(results):
            target = (
                self.context.paths.media
                / "generated"
                / f"{job['id']}-{index + 1}-{uuid.uuid4().hex[:6]}.wav"
            )
            io.write(target, result.audio, result.sample_rate, subtype="PCM_24")
            name = f"{base} {index + 1}" if len(results) > 1 else base
            asset = self.assets.register(
                target,
                name=name,
                origin="generated",
                media_type=str(job["task"]),
                source_job_id=str(job["id"]),
                notes="",
            )
            self.assets.repository.update(
                str(asset["id"]),
                {"tags": ["generated", str(job["task"]), str(job["model_id"])]},
            )
            output_ids.append(str(asset["id"]))
        return output_ids

    def to_info(self, job: Dict[str, object]) -> JobInfo:
        return JobInfo(
            id=str(job["id"]),
            model_id=str(job["model_id"]),
            task=job["task"],  # type: ignore[arg-type]
            prompt=str(job["prompt"]),
            negative_prompt=str(job.get("negative_prompt") or ""),
            status=job["status"],  # type: ignore[arg-type]
            progress=job.get("progress"),  # type: ignore[arg-type]
            progress_label=job.get("progress_label"),  # type: ignore[arg-type]
            created_at=str(job["created_at"]),
            started_at=job.get("started_at"),  # type: ignore[arg-type]
            finished_at=job.get("finished_at"),  # type: ignore[arg-type]
            error=job.get("error"),  # type: ignore[arg-type]
            output_asset_ids=list(job.get("output_asset_ids") or []),  # type: ignore[arg-type]
            seed=job.get("seed"),  # type: ignore[arg-type]
            requested_variations=int(job.get("requested_variations") or 1),
            retry_of=job.get("retry_of"),  # type: ignore[arg-type]
            backend=job.get("backend"),  # type: ignore[arg-type]
            duration_requested=float(job.get("duration_requested") or 0),
            params=dict(job.get("params") or {}),  # type: ignore[arg-type]
        )

    def _hardware_warnings(self, definition: ModelDefinition) -> List[HardwareWarning]:
        warnings: List[HardwareWarning] = []
        try:
            system = detect_system(
                self.context.paths.data_dir,
                self.context.ffmpeg_path,
                None,
            )
        except Exception:
            return warnings
        gpus = [gpu for gpu in system.gpus if gpu.backend == "cuda"]
        if definition.vram_estimate_mb and gpus:
            largest = max((gpu.free_vram_mb or 0) for gpu in gpus)
            if definition.vram_estimate_mb > largest:
                warnings.append(
                    HardwareWarning(
                        level="warning",
                        message=(
                            f"{definition.name} is estimated to need about "
                            f"{definition.vram_estimate_mb / 1024:.1f} GB of VRAM, but only "
                            f"{largest / 1024:.1f} GB appears free. The job may fail with an "
                            "out-of-memory error."
                        ),
                    )
                )
        if definition.adapter != "procedural" and not gpus and system.recommended_backend == "cpu":
            warnings.append(
                HardwareWarning(
                    level="info",
                    message=(
                        "No supported GPU was detected. This model will run on CPU and may take "
                        "a long time."
                    ),
                )
            )
        if definition.ram_estimate_mb and system.ram_available_mb:
            if definition.ram_estimate_mb > system.ram_available_mb:
                warnings.append(
                    HardwareWarning(
                        level="warning",
                        message=(
                            "Available system RAM may be lower than this model's estimated "
                            "requirement."
                        ),
                    )
                )
        return warnings
