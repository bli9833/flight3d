# Issue #86: English and Korean UI acceptance

Verified 2026-10-21 using local Vite and an isolated headless Chrome with ANGLE /
Vulkan. Desktop viewport: 1440 × 1000; mobile viewport: 390 × 844.

- Both locale options are present; the initial browser preference resolves to English.
- English labels, tooltips, help and diagnostics contain no Korean text.
- Switching to Korean preserves the active airport, aircraft position, camera
  and crash state; preset and yoke labels update to reflect their current state.
- Changing languages during the coastal demo updates the existing stage title
  and description without changing its stage or active state.
- Typing P while the language selector is focused does not start a demo.
- All four audio modes display translated current state.
- A real control-tower collision result retains its type and impact speed while
  the crash title, description and aircraft part change languages in place.
- Reloading retains the explicit English selection.
- The selector is reachable in the mobile menu, fits within the viewport, and
  switches back to Korean. No uncaught browser exceptions were recorded.

`results.json` contains the assertions' observed values. Screenshots show the
English desktop flight guide and the English/Korean mobile settings menus.
Existing avionics abbreviations and diagnostic codes remain in English.
