"""Command-line entry point for the local Klyraudio service."""

from __future__ import annotations

import argparse
import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

from .config import APP_VERSION, allow_lan, is_loopback_host


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="klyraudio-api",
        description="Run the local Klyraudio API and web interface.",
    )
    parser.add_argument("--host", default=os.environ.get("KLYRAUDIO_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("KLYRAUDIO_PORT", "8765")))
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--open-browser", action="store_true")
    parser.add_argument("--no-workers", action="store_true", help="Do not process the job queue")
    parser.add_argument("--version", action="version", version=APP_VERSION)
    return parser


def _open_later(url: str) -> None:
    def open_it() -> None:
        time.sleep(1.5)
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Thread(target=open_it, daemon=True).start()


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if not is_loopback_host(args.host) and not allow_lan():
        print(
            "Refusing to bind to a non-loopback address. Klyraudio is local-first. "
            "Set KLYRAUDIO_ALLOW_LAN=1 only if you understand the security implications.",
            file=sys.stderr,
        )
        return 2
    if not 1 <= args.port <= 65535:
        print("Port must be between 1 and 65535.", file=sys.stderr)
        return 2
    if args.data_dir:
        os.environ.setdefault("KLYRAUDIO_DATA_DIR", str(args.data_dir))

    import uvicorn

    from .app import create_app

    app = create_app(args.data_dir, workers=not args.no_workers)
    url = f"http://{'127.0.0.1' if args.host in {'0.0.0.0', '::'} else args.host}:{args.port}"
    print(f"Klyraudio {APP_VERSION} local service")
    print(f"  API + UI: {url}")
    if not args.no_workers:
        print("  Generation queue: enabled")
    print("Press Ctrl+C to stop.")
    if args.open_browser:
        _open_later(url)
    try:
        uvicorn.run(app, host=args.host, port=args.port, log_config=None)
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
