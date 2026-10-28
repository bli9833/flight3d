# F-16 Lukla and near-surface terrain

`chrome-session --project flight3d node scripts/verify-f16-lukla.mjs` against
Vite on 5186 completed the physical F-16 pass and climb-out in 26.62 simulation
seconds. Minimum clearance sampled by the director: 151.52 m. No sampled
crashes/stalls, runtime exceptions or reported shader compilation failures.
Restart/cancellation released virtual inputs. See `results.json`.

`flight-10.png` shows the cockpit during the valley pass; `terrain-close.png`
shows the metre-scale procedural grain at a fixed near-surface camera. Captures
were inspected at 1440×900. Satellite imagery remains visibly low resolution;
the added detail supplies artistic shading, not higher resolution imagery or DEM.
Node: full 692-test suite passed before the additional routing regression;
the final focused 24-test suite includes that new F-16 loading/cancel test.
Syntax/action checks and production build passed.

This bounded check does not establish mobile performance, audio acceptance,
real-world obstacle clearance or manual flight stability after handoff.
