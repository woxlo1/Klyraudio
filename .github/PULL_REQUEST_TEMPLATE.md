## Summary

Describe the behavior this pull request changes and why.

## Changes

-

## Testing

List the commands you ran and any manual verification.

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run format:check`
- [ ] `npm run build`
- [ ] `python -m pytest services/api/tests -q`
- [ ] `python -m ruff check services/api`

If a check could not run, explain why instead of leaving it silently unchecked.

## Checklist

- [ ] The change is limited to this pull request's scope.
- [ ] New user-visible strings exist in both `en.ts` and `ja.ts`, with a real Japanese translation.
- [ ] Behavior changes are reflected in `README.md`, `README.ja.md`, and the relevant `docs/` page.
- [ ] No telemetry, analytics, accounts, cloud sync, or hidden network calls were added.
- [ ] No model weights, generated audio, tokens, private prompts, or user data are committed.
- [ ] New dependencies and models are recorded in `NOTICE.md` with a compatible license.
- [ ] The service still binds to loopback by default and keeps origin and path checks intact.
- [ ] Commit messages are in English and the branch is not `main`.

## Related issues

Closes #
