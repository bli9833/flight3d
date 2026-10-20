# Lukla physics acceptance

Validated on upstream main `3ca7119` plus this change, using Node 22.23.2 and
Chrome's Intel Vulkan renderer (identity retained in report.json).

- `npm run check`: pass.
- `npm test`: 222 tests pass.
- `npm run build`: pass (existing bundle-size advisory).
- `PORT=5181 npm run test:lukla -- --screenshots`: three full 120 Hz circuits,
  loaded DEM, zero stall frames, peak contact speed approximately 1.61 m/s,
  approximately 87 m of runway remaining, zero drift over the 10-second hold.
- Negative integrated cases: 20 m/s descent and 7.59 m/s surface-normal uphill
  impact both crash before position correction; manual presets restore 66 t.

The report and screenshot come from the same final visual run. The screenshot
shows main-gear contact. `flight-regression.json` records five passing general
flight scenarios (including takeoff, stall recovery, landing, presets/cameras,
and director handover), with zero anomalies or browser errors. The landing
fixture now starts trimmed with landing flaps already deployed, uses continuous
flight controls, and observes 60 seconds to include the full braking sequence. The 43 t demonstration loading and uncalibrated damage-envelope
limitations are documented in ../../docs/development/lukla-physics.md.

Review lifecycle regressions are recorded in `review-lifecycle.json`: the real
constructor stays pending with the DEM request intercepted, resumes automatically
on load without a test-injected start, and the real `triggerCrash()` call records
`failed` synchronously before stopping. Three additional full circuits and both
negative contact cases pass in that run. The general-flight report and touchdown
screenshot above are retained from the pre-review validation; flight physics and
guidance are unchanged by this lifecycle follow-up.

The next review follow-up is recorded in `review-followup.json`: HTTP 503 and
network-rejection startup both terminate as failed with parking released; actual
Esc, preset selection, and airport switching cancel the running demo. Three full
circuits, impact rejection, and synchronous crash recording still pass.

`root-flags-verification.json` records the UID-0 argument branch running the full
harness successfully with `process.getuid` mocked to zero. Actual UID-0 execution
was unavailable because sudo requires interactive authentication; this is launch-
argument verification, not a claim of testing a root-owned container. Non-root
launches retain the sandbox.

After #68 merged, this follow-up was integrated with main `d069cdd` and revalidated: all 222 tests, build, and three browser circuits pass. `review-followup.json` records that final run.
