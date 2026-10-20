# Landing damage acceptance

Runtime tested after integration with main `07a4c09`; runtime source at `88ce7ad`.

- Syntax/action checks and production build passed; 238 Node tests passed.
- Six deterministic browser landing cases passed, including normal touchdown,
  severe gear failure, the first asymmetric impact, unlocked gear loading,
  controlled gear-up scraping to rest, catastrophic body impact, and reset.
- Controlled gear-up landing stopped after approximately 569 m without exploding.
- Existing browser flight suite passed all five takeoff, stall recovery, trimmed
  landing/braking, preset/camera, and demo handover scenarios; no anomalies or
  console errors were reported.
- `asymmetric.png` shows the first left-main collapse and HUD FAIL warning.
  `belly.png` shows the controlled landing at rest. Captures were inspected.
- `scenarios.json` contains the sampled landing trajectories; `summary.json`
  records final states and `flight-regression.json` records the existing suite.

Commands used with Vite on port 5186:

```sh
PORT=5186 CDP_PORT=9468 FORCE_GPU=1 ARTIFACT_DIR=/tmp/flight3d-landing-evidence-final npm run test:landing -- --screenshots
PORT=5186 CDP_PORT=9470 FORCE_GPU=1 ARTIFACT_DIR=/tmp/flight3d-landing-flight-regression npm run test:flight
```

Browser acceptance used the coastal runway and ANGLE/Intel Vulkan. Sloped
contact velocity and suspension behavior were exercised in Node tests; this run
does not establish complete Lukla approach/circuit acceptance. See
[model scope and limits](../../docs/development/landing-damage.md).
