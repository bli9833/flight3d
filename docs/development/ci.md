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
They expect a Vite server on port 5173, CDP ports, and WebGL support.
`test:flight` and `test:crash` launch `google-chrome-stable` from PATH;
`test:mobile` and `test:demo` launch `/usr/bin/google-chrome`. Provide both
executables (or matching symlinks) before following the commands below. Inspect the chosen script for its exact
ports and paths before running it. Some capture tools have machine-specific
output paths; test-flight-agent.js accepts ARTIFACT_DIR. Use a writable output
directory and preserve evidence relevant to the change.

For loaded-DEM Lukla contact, damage, and full-circuit acceptance, see
[lukla-physics.md](lukla-physics.md). `test:lukla` now fails incomplete flights
and checks three complete circuits plus a 10-second parking hold.

### Hardware GPU acceleration & performance

Hardware GPU acceleration is enabled for user accounts in the `render` (991) and `video` (44) groups with read/write access to `/dev/dri/renderD128`:

- **Headless Chrome GPU Flag**: On headless Linux (Ozone/no X11/no Wayland), desktop flags like `--use-gl=egl` fail. Use ANGLE with the Vulkan backend:
  ```sh
  --use-gl=angle --use-angle=vulkan
  ```
  This binds directly to the onboard Intel GPU (`ANGLE (Intel, Vulkan ... (Intel(R) Graphics (ADL-N)...)`). Avoid `--enable-gpu-rasterization --enable-zero-copy` without a window compositor as they peg CPU cores in 2D UI raster loops.
- **Flight test execution speed**:
  - `npm run test:flight`: Runs all 5 flight scenarios at **~8.25x real-time** (simulates 101s of 120Hz physics in ~12–13 seconds real duration).
  - Routine screenshots are opt-in to eliminate software raster stalls: `npm run test:flight:visual` or `npm run test:flight -- --screenshots`.
  - Failure/anomaly fallback: If any scenario fails or an anomaly occurs (excessive G-load, terrain clipping, NaN coordinates), a screenshot is automatically captured regardless of flags.
- **Screenshot latency benchmark**:
  - Software SwiftShader: ~7,380 ms per screenshot.
  - Hardware Intel GPU (ADL-N Vulkan): ~310–560 ms per screenshot (~13x–24x faster).
- **Performance metrics profile**:
  Each run exports structured benchmarks to `flight-test-performance.json` recording simulated vs real durations, speed multipliers, and substepping latency (typically ~2ms per 250ms slice).

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
