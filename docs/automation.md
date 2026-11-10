# Automation and AI-assisted review

Klyraudio uses repository automation to catch regressions and supply-chain risk
early. Automation is advisory: it never replaces tests, CodeQL, Dependabot, or
human review, and it must never be able to merge its own changes.

## GitHub Actions

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `ci.yml` | Pull requests, pushes to `main`, manual | Typecheck, lint, formatting, tests, and production build for the web UI; syntax checks and tests for the Electron shell; ruff and pytest for the API across supported Python versions; ruff and pytest for repository automation scripts; Markdown link checks for documentation. |
| `codeql.yml` | Pull requests, pushes to `main`, weekly, manual | CodeQL analysis for JavaScript/TypeScript and Python. |
| `dependency-review.yml` | Pull requests | Blocks high-severity dependency changes. The job probes the dependency-graph API first and publishes a notice instead of failing when the graph is unavailable. |
| `ai-review.yml` | Pull request activity | Posts or refreshes an advisory AI review comment. |
| `pr-quality.yml` | Pull request activity | Validates the Conventional Commits title and applies area, size, and translation-sync labels. |

All third-party actions are pinned to full commit SHAs and updated through
Dependabot. Workflows request the least privilege they need.

## Dependabot

`.github/dependabot.yml` tracks npm, pip, and GitHub Actions updates weekly and
groups routine patches and minors. Only patch and minor updates join a group;
major updates open as individual pull requests so breaking changes are reviewed
on their own. Dependency updates are never merged automatically: every update
runs the same required checks as a human change.

## Security automation

Secret scanning and push protection are enabled for the repository. Security
reports go to private GitHub advisories; the issue forms link there instead of
accepting public vulnerability reports.

## AI review

`ai-review.yml` runs `.github/scripts/ai_review.py` on same-repository pull
requests. The script requests changed-file patches from the GitHub API and sends
only those text diffs to GitHub Models through the workflow's own `GITHUB_TOKEN`.
It uses the `models: read` permission, so no personal token, third-party account,
or paid subscription is needed.

Guardrails:

- Draft pull requests, Dependabot pull requests, and fork pull requests are
  skipped. Fork pull requests receive a read-only token and cannot be commented
  on.
- Lockfiles, build output, coverage reports, virtual environments, and binary
  files are excluded to keep prompts small and reviewable.
- The diff is treated as untrusted data. The system prompt tells the model to
  ignore instructions embedded in code or comments.
- One comment per pull request is maintained through a hidden marker; reruns
  update it instead of stacking comments.
- Every failure path exits successfully with a workflow notice. An unavailable
  or rate-limited model service cannot block a pull request, and the job is not
  a required status check.
- No audio, prompts, projects, model weights, or user data are ever sent.

The default model is `openai/gpt-4.1`. Set the repository variable
`AI_REVIEW_MODEL` to another GitHub Models chat model to change it.

GitHub Models access depends on the repository owner's account, region, and
service availability. When the service returns a response that is not a chat
completion, the step exits with an `AI review skipped` notice and posts no
comment. The workflow stays enabled so review resumes when model access becomes
available; the job log shows the reason for each skip.

## Pull request quality

`pr-quality.yml` runs `.github/scripts/pr_quality.py` on pull request activity.
It validates the title against Conventional Commits and applies triage labels
for same-repository pull requests authored by people.

- Titles use a type such as `feat`, `fix`, `docs`, `test`, `ci`, or `chore`, an
  optional lowercase scope, and a short description. An invalid title fails the
  `PR quality` job with an annotation that explains the expected form.
- `area: web`, `area: api`, `area: desktop`, `area: docs`, and `area: ci` follow
  the changed paths.
- `size: xs` through `size: xl` use added and removed lines, ignoring lockfiles,
  build output, coverage, and virtual environments.
- `needs: ja update` and `needs: en update` flag a changed translation pair
  (`README.md`/`README.ja.md`, `en.ts`/`ja.ts`) when only one side changed.
- Fork and bot pull requests receive the title check only, because their token
  cannot write labels. A failure to create or apply a label produces a warning,
  not a failed check.
- Only labels under the `area: `, `size: `, and `needs: ` prefixes are managed
  or removed. Other labels are left untouched.

The bot checks the pull request title, not individual commit subjects. A pull
request may contain several logical commits; reviewers still read the commit
outline and the commit messages. Commit granularity, co-author trailers, and
review-comment expectations are documented in
[CONTRIBUTING.md](../CONTRIBUTING.md).

The title, path, size, and translation logic is covered by
`.github/scripts/test_pr_quality.py` in the `Automation scripts` CI job.

## Documentation links

`ci.yml` runs `.github/scripts/check_links.py` in the `Docs links` job. The
checker is offline and uses only the Python standard library.

- Relative links, images, and HTML `href`/`src` values must resolve to a file
  inside the repository.
- Heading anchors must match an ATX heading (`# Heading`) or an explicit HTML
  `id`/`name` anchor in the target Markdown file. Setext headings are not
  recognized.
- External URLs are not fetched, so their availability is not checked.
- Fenced code blocks, inline code, `node_modules`, `dist`, `coverage`, and
  virtual environments are ignored.

The link and anchor logic is covered by
`.github/scripts/test_check_links.py` in the `Automation scripts` CI job.

### Review workflow

1. Wait for ordinary CI to finish.
2. Read the AI review comment as a list of hypotheses.
3. Verify each finding against the code and tests.
4. Fix confirmed issues on the same feature branch.
5. Re-run tests and CI.
6. Merge only after required checks pass and a human has reviewed the change.

Delete or ignore findings that are wrong; do not treat the comment as approval.
AI review must not be used as a substitute for CodeQL, Dependabot, tests, or
human review.

## Optional external assistants

GitHub Copilot code review, CodeRabbit, Sourcery, and similar tools can add value
but require a maintainer to install a GitHub App or enable a paid feature. Before
enabling one:

- Confirm the service does not train on private repository data and record its
  retention policy.
- Grant the narrowest repository permissions that still allow review.
- Keep the tool optional: building and using Klyraudio must never depend on it.
- Do not give assistants secrets, signing keys, private prompts, or user data.
- Never let an assistant merge its own pull request or bypass branch protection.

Any enabled assistant must follow the review workflow above.
