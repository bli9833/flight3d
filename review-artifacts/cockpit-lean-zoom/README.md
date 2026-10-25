# Cockpit zoom head lean

Zoom now moves the 3D cockpit eye up to 12 cm forward and 2 cm up in aircraft coordinates. The lean follows `(1 - 1 / zoom) / 0.75`; the existing gaze lift is reduced to 0.08 radians per zoom unit so the zoomed gaze stays near the horizon. Reverse zoom, reset and view changes restore the seated eye. Photo mode retains its fixed eye.

## Verification

- Node 22.23.2: `npm run check`, `npm test` (508 passing), `npm run build` passed.
- Chrome via the shared Flight3d CDP session: loaded B737 cockpit GLB, fixed physics position near the coastal airport, native CDP mouse-wheel input at 1x, 1.5x, 2x and 4x; 1440×900 and 600×900 viewports. Eye readings are in [results.json](results.json).
- Inspected the captured images: forward views retain the outside scene through 4x without moving through the roof. Portrait framing retains the existing windscreen pillar and overhead trim; this change does not remove cockpit geometry.
- Node coverage checks reset, reverse pinch, repeated held frames, banked aircraft coordinates and the fixed photo/tower eyes. Browser evidence covers wheel input and framing, not native touch hardware or a complete flight.

[Seated 1x](desktop-1x.png) · [Lean 2x](desktop-2x.png) · [Lean 4x](desktop-4x.png) · [Portrait 4x](portrait-4x.png)
