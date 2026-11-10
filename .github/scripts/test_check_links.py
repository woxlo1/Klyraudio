"""Tests for the Markdown link checker."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check_links


def write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("heading", "slug"),
    [
        ("Getting Started", "getting-started"),
        ("API (v2)", "api-v2"),
        ("Use `npm` now", "use-npm-now"),
        ("日本語の見出し", "日本語の見出し"),
        ("A & B", "a--b"),
        ("Already-slugged", "already-slugged"),
        ("_private_name", "_private_name"),
    ],
)
def test_slugify_matches_common_github_anchors(heading: str, slug: str) -> None:
    assert check_links.slugify(heading) == slug


def test_duplicate_headings_get_suffixes() -> None:
    lines = ["# Title", "## Title", "## Title", "## Title-1"]
    assert check_links.heading_slugs(lines) == {
        "title",
        "title-1",
        "title-2",
        "title-1-1",
    }


def test_document_anchors_include_explicit_html_anchors() -> None:
    lines = ["# Title", '<a name="custom"></a>', '<div id="section"></div>']
    assert check_links.document_anchors(lines) == {"title", "custom", "section"}


def test_strip_fenced_blocks_preserves_line_numbers() -> None:
    lines = ["one", "```", "two", "```", "three"]
    assert check_links.strip_fenced_blocks(lines) == ["one", "", "", "", "three"]


def test_extract_links_reads_markdown_images_and_html_links() -> None:
    text = (
        '[guide](<docs/a b.md> "Guide")\n'
        "![image](img/pic.png)\n"
        '<a href="docs/b.md">b</a>\n'
        '<img src="img/other.png">\n'
    )
    assert [link.target for link in check_links.extract_links(text)] == [
        "docs/a b.md",
        "img/pic.png",
        "docs/b.md",
        "img/other.png",
    ]


def test_code_blocks_and_inline_code_are_ignored() -> None:
    text = (
        "```text\n"
        "[fenced](missing.md)\n"
        "```\n"
        "`[inline](missing.md)`\n"
        '`<a href="missing.md">x</a>`\n'
    )
    assert check_links.extract_links(text) == []


def test_check_document_accepts_valid_files_and_anchors(tmp_path: Path) -> None:
    write(tmp_path / "docs" / "guide.md", "# Getting Started\n\n## API (v2)\n")
    document = write(
        tmp_path / "README.md",
        "[guide](docs/guide.md)\n"
        "[anchor](docs/guide.md#api-v2)\n"
        "[self](#local)\n"
        "[external](https://example.com)\n"
        "[mail](mailto:someone@example.com)\n"
        "[protocol relative](//example.com)\n"
        "\n"
        "# Local\n",
    )

    assert check_links.check_document(tmp_path, document) == []


def test_check_document_reports_missing_files_and_anchors(tmp_path: Path) -> None:
    write(tmp_path / "docs" / "guide.md", "# Guide\n")
    document = write(
        tmp_path / "README.md",
        "[missing](docs/missing.md)\n"
        "[missing anchor](docs/guide.md#nope)\n"
        "[self anchor](#nope)\n",
    )

    issues = check_links.check_document(tmp_path, document)

    assert [(issue.line, issue.target, issue.message) for issue in issues] == [
        (1, "docs/missing.md", "linked file does not exist"),
        (2, "docs/guide.md#nope", "anchor '#nope' does not exist in guide.md"),
        (3, "#nope", "anchor '#nope' does not exist in README.md"),
    ]


def test_check_document_rejects_links_outside_the_root(tmp_path: Path) -> None:
    root = tmp_path / "repo"
    root.mkdir()
    write(tmp_path / "outside.md", "# Outside\n")
    document = write(root / "README.md", "[outside](../outside.md)\n")

    issues = check_links.check_document(root, document)

    assert len(issues) == 1
    assert issues[0].message == "link points outside the repository"


def test_relative_links_resolve_from_the_document_directory(tmp_path: Path) -> None:
    write(tmp_path / "docs" / "guide.md", "# Guide\n")
    document = write(tmp_path / "docs" / "nested" / "page.md", "[guide](../guide.md)\n")

    assert check_links.check_document(tmp_path, document) == []


def test_percent_encoded_paths_and_anchors_are_decoded(tmp_path: Path) -> None:
    write(tmp_path / "docs" / "a b.md", "# Getting Started\n")
    document = write(tmp_path / "README.md", "[a](docs/a%20b.md#getting-started)\n")

    assert check_links.check_document(tmp_path, document) == []


def test_query_strings_are_ignored(tmp_path: Path) -> None:
    write(tmp_path / "docs" / "guide.md", "# Guide\n")
    document = write(tmp_path / "README.md", "[guide](docs/guide.md?raw=1)\n")

    assert check_links.check_document(tmp_path, document) == []


def test_collect_markdown_skips_generated_directories(tmp_path: Path) -> None:
    write(tmp_path / "README.md", "# Root\n")
    write(tmp_path / "docs" / "guide.md", "# Guide\n")
    write(tmp_path / "node_modules" / "pkg" / "README.md", "# Package\n")
    write(tmp_path / "apps" / "web" / "dist" / "README.md", "# Build\n")
    write(tmp_path / ".venv" / "README.md", "# Environment\n")

    files = check_links.collect_markdown(tmp_path, [])

    assert {path.relative_to(tmp_path).as_posix() for path in files} == {
        "README.md",
        "docs/guide.md",
    }


def test_collect_markdown_accepts_a_directory_argument(tmp_path: Path) -> None:
    write(tmp_path / "README.md", "# Root\n")
    write(tmp_path / "docs" / "guide.md", "# Guide\n")

    files = check_links.collect_markdown(tmp_path, [tmp_path / "docs"])

    assert [path.name for path in files] == ["guide.md"]


def test_main_returns_zero_for_valid_documents(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    write(tmp_path / "docs" / "guide.md", "# Guide\n")
    write(tmp_path / "README.md", "[guide](docs/guide.md)\n")

    assert check_links.main(["--root", str(tmp_path)]) == 0
    assert "0 broken link(s)" in capsys.readouterr().out


def test_main_returns_one_for_broken_documents(tmp_path: Path, capsys: pytest.CaptureFixture) -> None:
    write(tmp_path / "README.md", "[missing](docs/missing.md)\n")

    assert check_links.main(["--root", str(tmp_path)]) == 1
    assert "docs/missing.md" in capsys.readouterr().out
