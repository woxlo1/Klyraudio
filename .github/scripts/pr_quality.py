"""Validate pull request titles and apply advisory triage labels.

The workflow runs with the repository token, so no third-party app or secret is
required. Title validation always runs; labels are applied only for same-repo
pull requests opened by people, because fork and bot tokens are read-only or
not useful for triage.

The module keeps its logic in pure functions so the checks can be tested without
network access.
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

API = "https://api.github.com"
API_VERSION = "2022-11-28"

TYPES = (
    "build",
    "chore",
    "ci",
    "docs",
    "feat",
    "fix",
    "perf",
    "refactor",
    "revert",
    "style",
    "test",
)
TITLE_PATTERN = re.compile(
    r"^(?P<type>" + "|".join(TYPES) + r")"
    r"(?:\((?P<scope>[a-z0-9][a-z0-9._/-]*)\))?"
    r"(?P<breaking>!)?: (?P<description>\S.*)$"
)
MAX_TITLE_LENGTH = 100

MANAGED_PREFIXES = ("area: ", "size: ", "needs: ")

AREA_PREFIXES: tuple[tuple[str, str], ...] = (
    ("apps/web/", "area: web"),
    ("apps/desktop/", "area: desktop"),
    ("services/api/", "area: api"),
    (".github/", "area: ci"),
    ("docs/", "area: docs"),
)

LABEL_COLORS = {
    "area: web": "1d76db",
    "area: api": "0e8a16",
    "area: desktop": "5319e7",
    "area: docs": "0075ca",
    "area: ci": "000000",
    "size: xs": "c2e0c6",
    "size: s": "bfd4f2",
    "size: m": "fbca04",
    "size: l": "d93f0b",
    "size: xl": "b60205",
    "needs: ja update": "d4c5f9",
    "needs: en update": "d4c5f9",
}

LABEL_DESCRIPTIONS = {
    "area: web": "Changes the React web UI or its build",
    "area: api": "Changes the Python service",
    "area: desktop": "Changes the Electron shell",
    "area: docs": "Changes documentation",
    "area: ci": "Changes workflows, automation, or repository configuration",
    "size: xs": "Up to 19 changed lines",
    "size: s": "20 to 99 changed lines",
    "size: m": "100 to 399 changed lines",
    "size: l": "400 to 999 changed lines",
    "size: xl": "1000 or more changed lines",
    "needs: ja update": "English text changed; check the Japanese counterpart",
    "needs: en update": "Japanese text changed; check the English counterpart",
}

SIZE_EXCLUDED_NAMES = {
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Cargo.lock",
}
SIZE_EXCLUDED_DIRECTORIES = {"dist", "coverage", "node_modules", ".venv"}

TRANSLATION_PAIRS: tuple[tuple[str, str], ...] = (
    ("README.md", "README.ja.md"),
    ("apps/web/src/i18n/en.ts", "apps/web/src/i18n/ja.ts"),
)


def validate_title(title: str) -> list[str]:
    """Return human-readable problems with a pull request title."""
    problems: list[str] = []
    if "\n" in title or "\r" in title:
        problems.append("The title must be a single line.")
        return problems
    match = TITLE_PATTERN.match(title)
    if not match:
        problems.append(
            "Use a Conventional Commits title such as "
            '"fix(web): keep the editor state after reload".'
        )
    if len(title) > MAX_TITLE_LENGTH:
        problems.append(f"Keep the title at or below {MAX_TITLE_LENGTH} characters.")
    if title != title.strip():
        problems.append("Remove leading or trailing whitespace from the title.")
    return problems


def classify_areas(paths: Iterable[str]) -> set[str]:
    """Map changed paths to the labels that describe the affected area."""
    labels: set[str] = set()
    for path in paths:
        for prefix, label in AREA_PREFIXES:
            if path.startswith(prefix):
                labels.add(label)
        if path.endswith(".md") and not path.startswith("apps/"):
            labels.add("area: docs")
    return labels


def is_size_ignored(path: str) -> bool:
    parts = path.split("/")
    if parts[-1] in SIZE_EXCLUDED_NAMES:
        return True
    return any(part in SIZE_EXCLUDED_DIRECTORIES for part in parts[:-1])


def size_label(files: Sequence[dict[str, Any]]) -> str | None:
    """Return a size label based on changed lines, ignoring generated files."""
    lines = 0
    for item in files:
        if is_size_ignored(str(item.get("filename", ""))):
            continue
        lines += int(item.get("additions", 0)) + int(item.get("deletions", 0))
    if lines < 20:
        return "size: xs"
    if lines < 100:
        return "size: s"
    if lines < 400:
        return "size: m"
    if lines < 1000:
        return "size: l"
    return "size: xl"


def sync_labels(paths: Iterable[str]) -> set[str]:
    """Flag translation pairs where only one side changed."""
    changed = set(paths)
    labels: set[str] = set()
    for english, japanese in TRANSLATION_PAIRS:
        if english in changed and japanese not in changed:
            labels.add("needs: ja update")
        if japanese in changed and english not in changed:
            labels.add("needs: en update")
    return labels


def triage_labels(files: Sequence[dict[str, Any]]) -> set[str]:
    paths = [str(item.get("filename", "")) for item in files]
    labels = classify_areas(paths) | sync_labels(paths)
    size = size_label(files)
    if size:
        labels.add(size)
    return labels


def managed_labels(labels: Iterable[str]) -> set[str]:
    return {label for label in labels if label.startswith(MANAGED_PREFIXES)}


def github_request(
    method: str,
    path: str,
    token: str,
    payload: dict | None = None,
) -> tuple[int, Any]:
    """Call the GitHub API without raising for expected client errors."""
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": "klyraudio-pr-quality",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
            return response.status, json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            parsed = body
        return exc.code, parsed


def fetch_changed_files(repo: str, number: int, token: str) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    page = 1
    while page <= 3:
        status, data = github_request(
            "GET",
            f"/repos/{repo}/pulls/{number}/files?per_page=100&page={page}",
            token,
        )
        if status != 200 or not isinstance(data, list):
            print(f"::warning::Could not read pull request files (HTTP {status}).")
            break
        files.extend(data)
        if len(data) < 100:
            break
        page += 1
    return files


def response_detail(body: Any) -> str:
    if isinstance(body, dict) and body.get("message"):
        return f": {body['message']}"
    return ""


def ensure_label(repo: str, name: str, token: str) -> None:
    status, body = github_request(
        "POST",
        f"/repos/{repo}/labels",
        token,
        {
            "name": name,
            "color": LABEL_COLORS[name],
            "description": LABEL_DESCRIPTIONS[name],
        },
    )
    if status not in (201, 422):
        print(
            f"::warning::Could not create label {name!r} "
            f"(HTTP {status}{response_detail(body)})."
        )


def apply_labels(
    repo: str,
    number: int,
    current: Iterable[str],
    desired: set[str],
    token: str,
) -> None:
    """Add missing triage labels and remove stale managed ones."""
    current_set = set(current)
    missing = sorted(desired - current_set)
    stale = sorted(managed_labels(current_set) - desired)

    for name in missing:
        ensure_label(repo, name, token)
    if missing:
        status, body = github_request(
            "POST",
            f"/repos/{repo}/issues/{number}/labels",
            token,
            {"labels": missing},
        )
        if status != 200:
            print(f"::warning::Could not add labels (HTTP {status}{response_detail(body)}).")
    for name in stale:
        encoded = urllib.parse.quote(name, safe="")
        status, body = github_request(
            "DELETE",
            f"/repos/{repo}/issues/{number}/labels/{encoded}",
            token,
        )
        if status not in (200, 204, 404):
            print(
                f"::warning::Could not remove label {name!r} "
                f"(HTTP {status}{response_detail(body)})."
            )

    print(f"Labels: desired={sorted(desired)} added={missing} removed={stale}")


def load_event() -> dict[str, Any]:
    path = os.environ.get("GITHUB_EVENT_PATH", "")
    if not path:
        return {}
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def main() -> int:
    event_name = os.environ.get("GITHUB_EVENT_NAME", "")
    if event_name != "pull_request":
        print(f"::notice::Skipping PR quality: event is {event_name or 'unknown'}.")
        return 0

    event = load_event()
    pull = event.get("pull_request", {})
    title = str(pull.get("title", ""))
    number = int(pull.get("number") or 0)
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GITHUB_TOKEN", "")

    problems = validate_title(title)
    if problems:
        for problem in problems:
            print(f"::error title=PR title::{problem}")
        return 1
    print(f"Title ok: {title}")

    if not token or not repo or not number:
        print("::warning::Missing repository context; labels were not applied.")
        return 0

    head_repo = ((pull.get("head") or {}).get("repo") or {}).get("full_name")
    user_type = (pull.get("user") or {}).get("type")
    if head_repo != repo:
        print("::notice::Fork pull request: labels are skipped because the token is read-only.")
        return 0
    if user_type == "Bot":
        print("::notice::Bot pull request: labels are skipped.")
        return 0

    files = fetch_changed_files(repo, number, token)
    desired = triage_labels(files)
    current = [str(label.get("name", "")) for label in pull.get("labels", [])]
    apply_labels(repo, number, current, desired, token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
