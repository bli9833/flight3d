# Mass / CG verification — 2026-10-28 (Asia/Seoul)

Browser-check base: `3d94b01`; final merged base: `e4f7725` (upstream main).
Runtime: Node 22.23.2, Windows, local Vite
and the connected in-app browser. No production deployment was performed.

- Final `npm run check`: 293 JavaScript files, zero syntax failures; 11 pinned actions.
- Final `npm test`: 700 passed, zero failed, skipped or cancelled (689 before main refresh).
- Final `npm run build`: success (146 modules); existing large-chunk advisory remains.
- `git diff --check`: clean.

An initial terrain checksum failure was traced to checkout CRLF conversion.
`coastline.json` and `patch.json` were restored to the exact LF bytes in Git;
their stored checksums then passed. These assets have no content changes in this PR.

## Browser evidence

Start `npm run dev -- --host 127.0.0.1`, then open
`/scripts/verify-mass-cg.html` and click **Run checks** after startup. This executes
the real simulator at 120 Hz, with the wall-clock animation paused for determinism.
Reload to resume animation. The final observed PASS output is transcribed in
[browser-results.json](browser-results.json).

- Fuel 7000 kg, forward payload 6000 kg, aft payload 3000 kg: gross mass
  57413 kg, ZFW 50413 kg, longitudinal CG -0.187915 m.
- LMC synchronously updates mass and the same PFD/CDU performance snapshot;
  invalid/airborne LMC leaves the ledger unchanged.
- Ten-second loaded ground hold: final speed 0 m/s, mass 57411.055556 kg.
- Thirty-second hands-off B738 cruise: altitude 750 → 750.201931 m, sampled
  G around 0.995, no crash or non-finite state. Reset restores ZFW 51800 kg.
- Native UI interaction separately opened the loading form, filled all three
  fields and applied the same load. A 319×480 viewport showed a contained,
  scrollable panel. [loading.png](loading.png) records the input area during
  that check, before the final axis-label wording. The full result was verified
  in the accessibility tree. A 1440×1000 viewport was also used for the harness.

The browser log once reported a MutationObserver `observe` type error during
navigation/tool inspection; no source URL was attached, so it is not attributed
to the application or claimed resolved. The explicit acceptance assertions
completed successfully. Subsequent Work settings disabled browser use; additional
C172/F16 browser switching and a final screenshot could not be collected.
Browser acceptance was not rerun after merging the latest startup/build-info/
crash-breakup features; the combined head passed the final Node/check/build gate.
All three aircraft's reference mass/CG/inertia are covered by Node tests.

These checks do not certify full takeoff/landing, Lukla circuits, engine-out
performance, real-aircraft data, touch flight controls or the complete envelope.
V1 is unsupported; VR~/V2~ and the PFD 1g low-speed boundary are game estimates.
