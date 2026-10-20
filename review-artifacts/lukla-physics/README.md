# Lukla physics acceptance

Validated on upstream main `1e4666a` plus this change, using Node 22.23.2 and
Chrome's Intel Vulkan renderer (identity retained in report.json).

- `npm run check`: pass.
- `npm test`: 190 tests pass.
- `npm run build`: pass (existing bundle-size advisory).
- `PORT=5181 npm run test:lukla -- --screenshots`: three full 120 Hz circuits,
  loaded DEM, zero stall frames, peak contact speed approximately 1.62 m/s,
  approximately 87 m of runway remaining, zero drift over the 10-second hold.
- Negative integrated cases: 20 m/s descent and 7.59 m/s surface-normal uphill
  impact both crash before position correction; manual presets restore 66 t.

The report contains a subsequent run of the same three circuits and integrated
negative cases. The screenshot shows the first main-gear contact in the first
visual run. The 43 t demonstration loading and uncalibrated damage-envelope
limitations are documented in ../../docs/development/lukla-physics.md.
