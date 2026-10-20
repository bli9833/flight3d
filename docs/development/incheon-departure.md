# Incheon departure scenario

Select **🇰🇷 인천 출발** to switch environments and start the departure demo.
Use **P / 데모 비행** to restart and **Esc / 직접 조종하기** to take control.
The coastal and Lukla scenes remain independently selectable.

This is an Incheon-inspired training environment, not a reconstruction of RKSI.
It reuses the coastal terrain, east–west 09L runway, tower and lighting. The
terminal has arrivals and elevated boarding levels, three jet bridges, moving
passengers, a retractable gate bridge, and a pushback tug. Runway designation,
layout, dimensions, radio messages and timings are fictional. ATC is displayed
as scripted bilingual text; there is no radio recognition or recorded voice.

The demo advances through boarding (10s), bridge retraction (6s), pushback (16s),
taxi (100s), hold-short / tower exchange (8s), line-up (14s), takeoff clearance,
and initial climb. Ground handling uses a continuous authored position path
and updates heading, ground speed and engine telemetry. It bypasses aerodynamic
integration only during ground service stages; cancellation immediately restores
normal physics. Runway acceleration and rotation use normal flight physics.
Rotation requires at least 132 KIAS; completion requires 500ft radio altitude.

Validation:

- `node --test tests/incheonDeparture.test.js` covers service reset, the full
  ground sequence, continuous position, clearance ordering, airspeed gating,
  completion and cancellation/restart.
- Run the standard `npm run check`, `npm test`, `npm run build` gate.
- Browser acceptance: select Incheon, inspect boarding level/passengers/bridge,
  follow bridge retraction and tug movement, confirm the aircraft stops at the
  hold-short bars, then enters the runway and takes off after tower clearance.
  Check that every stage appears in order, there is no crash, and completion
  occurs above 500ft AGL. Repeat P, Esc, and airport switching during ground
  handling to confirm manual control and environment visibility restore.
