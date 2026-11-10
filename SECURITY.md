# Security policy

## Supported versions

Klyraudio is in early development. Security fixes are applied to the latest
release and the `main` branch. Older development snapshots are not supported.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting for this repository:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Describe the issue, affected version or commit, and reproduction steps.

If private reporting is unavailable, contact the maintainer listed on the
repository profile and ask for a private channel before sharing details.

Include only what is needed to reproduce the issue. Never attach private
prompts, personal audio, model weights, access tokens, or user databases.

## What to expect

- Acknowledgement of the report as soon as practical.
- An assessment of impact and affected versions.
- A fix on a private or feature branch, tests where feasible, and a coordinated
  release.
- Credit in the release notes if you want it.

Please allow time for a fix before public disclosure.

## Security model

Klyraudio is designed to run on a single user's computer:

- The local service binds to `127.0.0.1` by default and refuses non-loopback
  hosts unless `KLYRAUDIO_ALLOW_LAN=1` is explicitly set.
- Remote-origin requests are rejected by middleware, and CORS is limited to
  loopback origins.
- The desktop window uses context isolation, sandboxing, no Node integration,
  no webviews, denied permission requests, and navigation restricted to the
  local origin. External HTTPS links open in the default browser.
- File access is restricted to configured data roots; client-supplied paths are
  validated.
- Model downloads are user-initiated and verified with a checksum before use.
- No telemetry, analytics, accounts, or cloud sync exist. The settings API
  rejects enabling telemetry.

## Out of scope

- Vulnerabilities that require the attacker to already control the local user
  account or the machine.
- Risks from running Klyraudio with `KLYRAUDIO_ALLOW_LAN=1` on an untrusted
  network.
- Model behavior, output quality, or rights in generated audio.
- Third-party model or dependency licenses (report those as regular issues).
- Unsigned development builds presented as signed releases.

## Dependency and release hygiene

- Keep dependencies updated through Dependabot and review security advisories.
- Do not commit secrets, tokens, model weights, or user audio.
- Run tests, builds, CodeQL, and dependency review before release.
- Document any accepted risk in the pull request or release notes.
