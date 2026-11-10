"""Check that relative Markdown links and anchors resolve inside the repository.

The checker is dependency-free and offline. It walks Markdown files, ignores
links inside fenced code blocks and inline code, and reports a missing file, a
target outside the repository, or an unknown anchor. External URLs are not
fetched; their availability is not this check's responsibility.

GitHub derives heading anchors from the heading text, so the anchor logic
mirrors that conversion, including duplicate suffixes such as ``-1`` and
explicit HTML ``id``/``name`` anchors.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote

SKIPPED_DIRECTORIES = {".git", ".venv", "coverage", "dist", "node_modules"}
EXTERNAL_PREFIXES = (
    "http://",
    "https://",
    "mailto:",
    "tel:",
    "data:",
    "ftp://",
    "ssh://",
    "file:",
)

FENCE_PATTERN = re.compile(r"^\s*(```+|~~~+)")
HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.*?)\s*$")
CLOSING_HASHES = re.compile(r"\s+#+\s*$")
INLINE_CODE = re.compile(r"`+[^`]*`+")
IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
LINK_TEXT = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HTML_TAG = re.compile(r"<[^>]+>")
LINK = re.compile(
    r"!?\[[^\]]*\]\(\s*(<[^>]*>|[^()\s]+)"
    r"(?:\s+(?:\"[^\"]*\"|'[^']*'|\([^)]*\)))?\s*\)"
)
HTML_LINK = re.compile(r"""(?:href|src)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)
HTML_ANCHOR = re.compile(r"""(?:id|name)\s*=\s*["']([^"']+)["']""", re.IGNORECASE)


@dataclass(frozen=True)
class LinkIssue:
    """A relative link that does not resolve."""

    path: Path
    line: int
    target: str
    message: str


@dataclass(frozen=True)
class Link:
    """A link destination and the line it appears on."""

    line: int
    target: str


def strip_markup_for_slug(text: str) -> str:
    """Remove the inline markup that GitHub excludes from heading anchors."""
    text = html.unescape(text)
    text = IMAGE.sub(r"\1", text)
    text = LINK_TEXT.sub(r"\1", text)
    text = HTML_TAG.sub("", text)
    return text.replace("`", "")


def slugify(text: str) -> str:
    """Convert heading text to the anchor GitHub generates for it."""
    text = strip_markup_for_slug(text).strip().lower()
    kept: list[str] = []
    for character in text:
        category = unicodedata.category(character)
        if character in {" ", "-", "_"} or category[0] in {"L", "M", "N"}:
            kept.append(character)
    return "".join(kept).replace(" ", "-")


def strip_fenced_blocks(lines: Iterable[str]) -> list[str]:
    """Blank fenced code blocks while preserving line numbers."""
    result: list[str] = []
    fence: tuple[str, int] | None = None
    for line in lines:
        match = FENCE_PATTERN.match(line)
        if fence is None:
            if match:
                marker = match.group(1)
                fence = (marker[0], len(marker))
                result.append("")
                continue
            result.append(line)
        else:
            if match:
                marker = match.group(1)
                if marker[0] == fence[0] and len(marker) >= fence[1]:
                    fence = None
            result.append("")
    return result


def heading_slugs(lines: Iterable[str]) -> set[str]:
    """Return every heading anchor GitHub would generate for the document."""
    slugs: set[str] = set()
    used: set[str] = set()
    for line in strip_fenced_blocks(lines):
        match = HEADING_PATTERN.match(line)
        if not match:
            continue
        text = CLOSING_HASHES.sub("", match.group(2)).strip()
        if not text:
            continue
        base = slugify(text)
        slug = base
        suffix = 1
        while slug in used:
            slug = f"{base}-{suffix}"
            suffix += 1
        used.add(slug)
        slugs.add(slug)
    return slugs


def document_anchors(lines: Iterable[str]) -> set[str]:
    """Return heading slugs plus explicit HTML id and name anchors."""
    text = list(lines)
    anchors = heading_slugs(text)
    for line in strip_fenced_blocks(text):
        anchors.update(HTML_ANCHOR.findall(line))
    return anchors


def strip_inline_code(line: str) -> str:
    return INLINE_CODE.sub("", line)


def extract_links(text: str) -> list[Link]:
    """Extract Markdown links and HTML href/src values with line numbers."""
    links: list[Link] = []
    for number, line in enumerate(strip_fenced_blocks(text.splitlines()), start=1):
        line = strip_inline_code(line)
        for match in LINK.finditer(line):
            target = match.group(1).strip()
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1].strip()
            links.append(Link(number, target))
        for match in HTML_LINK.finditer(line):
            links.append(Link(number, match.group(1).strip()))
    return links


def is_external(target: str) -> bool:
    lowered = target.lower()
    return lowered.startswith(EXTERNAL_PREFIXES) or lowered.startswith("//")


def collect_markdown(root: Path, paths: Sequence[Path]) -> list[Path]:
    """Return Markdown files to check, skipping generated and dependency trees."""
    candidates: list[Path] = []
    if paths:
        for path in paths:
            resolved = path.resolve()
            if resolved.is_dir():
                candidates.extend(resolved.rglob("*.md"))
            else:
                candidates.append(resolved)
    else:
        candidates = list(root.rglob("*.md"))

    selected: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        try:
            parts = resolved.relative_to(root).parts
        except ValueError:
            continue
        if any(part in SKIPPED_DIRECTORIES for part in parts):
            continue
        if resolved.suffix.lower() != ".md" or not resolved.is_file():
            continue
        selected.append(resolved)
    return sorted(set(selected))


def check_anchor(target: Path, fragment: str) -> str | None:
    if not fragment or target.suffix.lower() != ".md":
        return None
    anchors = document_anchors(target.read_text(encoding="utf-8").splitlines())
    if unquote(fragment) in anchors:
        return None
    return f"anchor '#{fragment}' does not exist in {target.name}"


def check_document(root: Path, path: Path) -> list[LinkIssue]:
    """Return every unresolved relative link in one Markdown file."""
    issues: list[LinkIssue] = []
    text = path.read_text(encoding="utf-8")
    for link in extract_links(text):
        target = link.target
        if not target:
            issues.append(LinkIssue(path, link.line, target, "link target is empty"))
            continue
        if is_external(target):
            continue

        destination, _, fragment = target.partition("#")
        destination = unquote(destination.partition("?")[0])
        if not destination:
            message = check_anchor(path, fragment)
            if message:
                issues.append(LinkIssue(path, link.line, target, message))
            continue

        if destination.startswith("/"):
            candidate = root / destination.lstrip("/")
        else:
            candidate = (path.parent / destination).resolve()
        try:
            candidate.resolve().relative_to(root)
        except ValueError:
            issues.append(
                LinkIssue(path, link.line, target, "link points outside the repository")
            )
            continue

        if not candidate.exists():
            issues.append(LinkIssue(path, link.line, target, "linked file does not exist"))
            continue

        if fragment:
            message = check_anchor(candidate, fragment)
            if message:
                issues.append(LinkIssue(path, link.line, target, message))
    return issues


def report(issues: Sequence[LinkIssue], root: Path) -> None:
    for issue in issues:
        relative = issue.path.relative_to(root).as_posix()
        if os.environ.get("GITHUB_ACTIONS"):
            print(
                f"::error file={relative},line={issue.line}::"
                f"{issue.message}: {issue.target}"
            )
        else:
            print(f"{relative}:{issue.line}: {issue.target}: {issue.message}")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Markdown files or directories to check (default: every Markdown file)",
    )
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)

    root = args.root.resolve()
    documents = collect_markdown(root, args.paths)
    issues = [
        issue for document in documents for issue in check_document(root, document)
    ]
    report(issues, root)
    print(f"Checked {len(documents)} Markdown files: {len(issues)} broken link(s).")
    return 1 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
