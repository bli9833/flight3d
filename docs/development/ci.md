# CI and verification

The GitHub Actions gate runs on main pushes, pull requests, and manual dispatch.
It uses Node 22.23.2 (Vite 8 requires at least 22.12.0), npm's lockfile-based install and cache, syntax/action-pin checks,
Node logic tests, and a Vite production build. Run the same gate locally:

```sh
npm ci
npm run check
npm test
npm run build
```

Actions use full commit SHAs, the token has read-only contents permission, and
checkout does not retain credentials. New runs cancel superseded runs for the
same ref. Update pinned actions deliberately and keep the gate executable locally.
No repository secrets, deployment, or external-service accounts are required.

## Browser acceptance

The existing browser scripts are separate acceptance tools, not portable CI yet.
They expect a Vite server on port 5173, CDP ports, and WebGL/SwiftShader support.
`test:flight` and `test:crash` launch `google-chrome-stable` from PATH;
`test:mobile` and `test:demo` launch `/usr/bin/google-chrome`. Provide both
executables (or matching symlinks) before following the commands below. Inspect the chosen script for its exact
ports and paths before running it. Some capture tools have machine-specific
output paths; test-flight-agent.js accepts ARTIFACT_DIR. Use a writable output
directory and preserve evidence relevant to the change.

Start `npm run dev -- --host 127.0.0.1` separately, then run the applicable
`npm run test:flight`, `test:crash`, `test:mobile`, or `test:demo` command. Coordinate
ports and browser profiles with other sessions. Inspect assertions, browser
errors, and produced images; a script exit code alone does not establish visual
acceptance. Node tests and a successful build do not verify WebGL rendering.

## Selection and provenance

Adapted from the sibling Keepory (historically Stash) repository at commit
ac310ff9751f5c85c99e451d2cf67439f086d950:

| Source | Flight3d adaptation |
| --- | --- |
| AGENTS.md, CLAUDE.md, docs/development/agent-working-rules.md | Short orientation, scoped edits, evidence-based diagnosis and verification |
| docs/development/agent-task-map.md | Task routing rebuilt for Flight3d modules and tests |
| .github/workflows/ci.yml, .circleci/config.yml | Lockfile install, runtime selection, cache, tests and web build |
| scripts/check-workflow-actions.mjs | Copied immutable-action-reference check |

Keepory's Expo/pnpm, Supabase, Play release, account/sync invariants, CI_PROVIDER
switch, and mirrored operational skills are specific to that project and omitted.
The agent-efficiency script hardcodes Keepory directories and historical line
budgets; task routing is useful here without inheriting those arbitrary gates.
CircleCI configuration is omitted because there is no Flight3d integration to
preserve. Browser acceptance must be made portable before adding it to CI.

The original package.json declared Vite 6 while the existing lockfile and local
installation used Vite 8. The declaration now matches the existing lockfile
(^8.3.4), allowing npm ci without replacing the resolved dependency graph.
