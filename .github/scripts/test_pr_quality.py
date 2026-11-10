"""Tests for the pull request quality script."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import pr_quality


@pytest.mark.parametrize(
    "title",
    [
        "feat(web): add waveform zoom",
        "fix(api): reject non-loopback origins",
        "chore(deps-dev): bump pytest to 9.2.0",
        "ci!: drop Node.js 20",
        "docs: explain model downloads",
    ],
)
def test_accepts_conventional_titles(title: str) -> None:
    assert pr_quality.validate_title(title) == []


@pytest.mark.parametrize(
    "title",
    [
        "Add waveform zoom",
        "feat add waveform zoom",
        "feat(): add waveform zoom",
        "FEAT: add waveform zoom",
        "feat: ",
        "feat: trailing space ",
    ],
)
def test_rejects_non_conventional_titles(title: str) -> None:
    assert pr_quality.validate_title(title)


def test_rejects_multiline_and_long_titles() -> None:
    assert pr_quality.validate_title("feat: first\nfix: second")
    assert pr_quality.validate_title("feat: " + "x" * pr_quality.MAX_TITLE_LENGTH)


def test_classifies_areas_by_path() -> None:
    labels = pr_quality.classify_areas(
        [
            "apps/web/src/App.tsx",
            "services/api/klyraudio_api/app.py",
            "apps/desktop/src/main.cjs",
            ".github/workflows/ci.yml",
            "docs/editing.md",
            "README.ja.md",
        ]
    )
    assert labels == {
        "area: web",
        "area: api",
        "area: desktop",
        "area: ci",
        "area: docs",
    }


def test_size_label_uses_changed_lines() -> None:
    assert pr_quality.size_label([{"filename": "src/a.ts", "additions": 5, "deletions": 4}]) == (
        "size: xs"
    )
    assert pr_quality.size_label([{"filename": "src/a.ts", "additions": 60, "deletions": 0}]) == (
        "size: s"
    )
    assert pr_quality.size_label([{"filename": "src/a.ts", "additions": 300, "deletions": 0}]) == (
        "size: m"
    )
    assert pr_quality.size_label([{"filename": "src/a.ts", "additions": 900, "deletions": 0}]) == (
        "size: l"
    )
    assert pr_quality.size_label([{"filename": "src/a.ts", "additions": 1000, "deletions": 0}]) == (
        "size: xl"
    )


def test_size_label_ignores_lockfiles_and_build_output() -> None:
    files = [
        {"filename": "package-lock.json", "additions": 5000, "deletions": 4000},
        {"filename": "apps/web/dist/assets/index.js", "additions": 900, "deletions": 0},
        {"filename": "apps/web/src/App.tsx", "additions": 3, "deletions": 1},
    ]
    assert pr_quality.size_label(files) == "size: xs"


def test_translation_sync_labels() -> None:
    assert pr_quality.sync_labels(["README.md"]) == {"needs: ja update"}
    assert pr_quality.sync_labels(["README.ja.md"]) == {"needs: en update"}
    assert pr_quality.sync_labels(["README.md", "README.ja.md"]) == set()
    assert pr_quality.sync_labels(["apps/web/src/i18n/en.ts"]) == {"needs: ja update"}
    assert (
        pr_quality.sync_labels(["apps/web/src/i18n/en.ts", "apps/web/src/i18n/ja.ts"]) == set()
    )


def test_triage_combines_area_size_and_sync_labels() -> None:
    files = [
        {"filename": "apps/web/src/i18n/en.ts", "additions": 25, "deletions": 0},
        {"filename": "docs/editing.md", "additions": 5, "deletions": 0},
    ]
    assert pr_quality.triage_labels(files) == {
        "area: web",
        "area: docs",
        "needs: ja update",
        "size: s",
    }


def test_managed_labels_only_matches_triage_prefixes() -> None:
    labels = [
        "area: web",
        "size: m",
        "needs: ja update",
        "bug",
        "documentation",
        "dependencies",
    ]
    assert pr_quality.managed_labels(labels) == {
        "area: web",
        "size: m",
        "needs: ja update",
    }
