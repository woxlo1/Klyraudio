# Contributing to Klyraudio

Thanks for helping build a local-first audio studio. This project values
correct, tested behavior over impressive-looking placeholders.

## Ground rules

- Klyraudio is licensed under **GPL-3.0-only**. By contributing, you agree that
  your contribution is licensed under the same terms.
- Keep `main` stable. Never commit or push feature work directly to `main`.
  Work on a branch and open a pull request.
- Do not add telemetry, analytics, accounts, cloud sync, or hidden network
  calls. The application is local-first by contract.
- Do not bundle model weights, generated audio, secrets, private prompts, or
  user data.
- Write commit messages and source comments in English.
- Do not claim a feature is complete unless it works end to end and has tests
  where practical.

## Workflow

1. Update `main` and create a branch:

   ```bash
   git switch main
   git pull
   git switch -c feature/short-description
   ```

2. Make one coherent change, split into small logical commits.
3. Add or update tests and documentation.
4. Run the relevant checks locally (see below).
5. Review `git diff` and confirm no generated or private files are staged.
6. Commit with a conventional message, push, and open a pull request to `main`.
7. Fix failing checks on the same branch.

Use branch prefixes such as `feature/`, `fix/`, `refactor/`, `docs/`, `ci/`, and
`test/`.

## Commit messages

```text
feat(web): add multitrack clip fades
fix(api): reject non-loopback origins
docs: document model license acknowledgement
test(desktop): cover backend restart after health failure
chore(ci): add backend test workflow
```

Keep the subject under about 72 characters. Explain the reason in the body when
it is not obvious.

### Commit granularity

A pull request should contain several small, logical commits instead of one
large commit. For a substantial change, aim for roughly three to seven commits.
That range is a guideline, not a quota: a one-line typo fix can stay a single
commit, and no one should split a change into artificial fragments to reach a
number.

- Commit each step that can be reviewed on its own, such as documentation,
  implementation, tests, and CI wiring.
- Keep every commit coherent, and leave the tree buildable where practical. Do
  not commit knowingly broken code as an intermediate step.
- Use `wip` or `fixup` commits only while working locally, then squash purely
  mechanical noise before opening the pull request.
- Keep meaningful review fixes as additional commits. Do not rewrite published
  history after review unless a maintainer asks for it; rebase merges preserve
  the commits, so the history is part of the review.

### Co-author trailers

When two people genuinely pair on a commit, credit the second person with a
trailer on its own line at the end of the commit message:

```text
Co-authored-by: Name <email@example.com>
```

- Add one trailer per co-author.
- Only credit someone who contributed to that commit and agreed to the credit.
- Never add a person's name or email address without consent.
- AI-assisted commits use the project assistant identity
  `Co-authored-by: opencode <221189863+opencode-agent@users.noreply.github.com>`.
  The address belongs to the public OpenCode assistant account. The trailer
  discloses tool assistance; it is not a claim that a human wrote the commit.

### Pull request comments

Write the description for reviewers, then use comments for the parts that change
while the branch is under review.

- Post a short comment when the pull request is ready for review: decisions,
  trade-offs, and the checks you ran. Keep the description as the stable
  summary.
- Reply in the existing review thread instead of starting a parallel discussion.
- Comment when you push a fix so reviewers know what changed and which check to
  re-run.
- Leave a final comment when the work is complete: follow-ups, known
  limitations, and anything a future contributor needs.
- Keep comments in English. Do not paste secrets, private prompts, tokens, user
  data, or long generated logs.
- Do not claim a check passed when it did not run.

## Development checks

Frontend and desktop:

```bash
npm run typecheck
npm run lint
npm run test
npm run format:check
npm run build
```

Backend (activate the virtualenv first):

```bash
python -m pytest services/api/tests -q
python -m ruff check services/api
```

Repository automation:

```bash
python -m pytest .github/scripts -q
python .github/scripts/check_links.py
```

If a check cannot run in your environment, say so in the pull request instead of
silently skipping it.

## Code guidelines

- Keep boundaries clear: UI, API routing, domain services, persistence, audio
  processing, model adapters, and platform integration are separate modules.
- Prefer typed interfaces and explicit error types. Avoid broad
  catch-and-ignore blocks.
- Validate file paths against the configured data roots. Never trust a client
  supplied path.
- Keep the Python service loopback-only by default. Do not weaken origin,
  CORS, or path checks without a security review.
- Do not run untrusted executables from user-writable locations.
- Log structured events without prompts, audio contents, tokens, or personal
  data.
- Avoid monolithic files and circular imports.

## Localization

- Every user-visible string belongs in the translation tree.
- Add English and Japanese entries together. Japanese must be a real
  translation, not an untranslated placeholder.
- English is the fallback for any missing key.
- Run the i18n parity tests before opening a pull request.

## Models and licenses

Before adding a model or dependency:

1. Identify the exact license.
2. Check GPL-3.0 distribution compatibility.
3. Check attribution, notice, gating, and commercial-use conditions.
4. Record the result in `NOTICE.md` and the relevant documentation.
5. Do not bundle weights; keep downloads user-initiated and verified.

## Documentation

Behavior changes need documentation updates. Document only what is implemented.
Update `README.md`, `README.ja.md`, and the relevant file under `docs/` when a
user-facing behavior or setup step changes.

## Reporting security issues

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](SECURITY.md).
