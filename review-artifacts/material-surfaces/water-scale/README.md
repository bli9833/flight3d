# Wave scale and perspective refinement

Baseline: `064ec06`, the first version of PR #74. Captured with
`verify-material-surfaces.mjs` at 1200×800, 55° vertical FOV, fixed time 12.5s,
and identical downward viewing angles at 3m, 35m, 250m and 1000m height.

Wind ripples now have 16cm–1.1m wavelengths; the remaining 2.4m/5.6m waves have
much smaller slopes than the original 12–48m waves. Phase derivatives account
for projected wavelength, including viewing angle and resolution. Unresolved
waves merge into reflection roughness rather than retaining large ring patterns.

The GPU diagnostic uses a separate material output to sample horizontal normal
energy in a fixed 128×128 water patch. It exercises the production wave-normal
calculation independently of sun colour and glare:

| Height | Before | After |
| --- | ---: | ---: |
| 3m | 0.006874 | 0.002919 |
| 35m | 0.032825 | 0.000409 |
| 250m | 0.029259 | 0.000045 |
| 1000m | 0.022662 | 0.000031 |

At 1000m the measured normal energy is approximately 1.1% of the close-up value.
The regression gate requires less than 20%; the previous shader fails that gate.
The 8-bit readback has a quantization floor, so these values are a regression
indicator, not a physical ocean-energy measurement. All 16 before/after scenes
(including terrain high/low, sunset and night) compiled without browser errors.
Ocean remains 1 draw call and 64,800 triangles. Mobile frame time is unmeasured.

| View | Before | After |
| --- | --- | --- |
| 3m | [Image](before-ocean-close.png) | [Image](after-ocean-close.png) |
| 35m | [Image](before-ocean-low.png) | [Image](after-ocean-low.png) |
| 250m | [Image](before-ocean-mid.png) | [Image](after-ocean-mid.png) |
| 1000m | [Image](before-ocean-high.png) | [Image](after-ocean-high.png) |
