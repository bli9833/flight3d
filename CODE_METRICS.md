# 📊 Code Metrics, Conventions & AI Coding Guidelines

This document provides architectural standards, module responsibilities, complexity thresholds, and conventions for human developers and autonomous AI coding agents contributing to the flight simulator codebase.

---

## 1. Codebase Directory Structure & Responsibilities

| Directory / File | Lines | Responsibility & Boundaries |
|:---|:---:|:---|
| `src/main.js` | ~560 | **Simulation Coordinator**: Integrates 120Hz physics substepping, Three.js render loop, HUD DOM updates, preset handlers. |
| `src/physics/Atmosphere.js` | ~90 | **Atmospheric Physics**: ISA 1976 temperature, pressure, density, sound speed, IAS/TAS conversions. Pure math, zero DOM/Three.js dependencies. |
| `src/physics/Aerodynamics.js` | ~330 | **Flight Dynamics Engine**: 6-DOF force/moment integration, stall buffet, ground effect, stability derivatives, live tuning sliders. |
| `src/physics/EngineModel.js` | ~120 | **Jet Propulsion Engine**: Twin turbofan N1/N2 spool latency, altitude lapse, reverser, fuel flow. |
| `src/physics/LandingGear.js` | ~240 | **Ground Contact Dynamics**: 3-point oleo-pneumatic suspension, braking friction, speed-sensitive nosewheel tiller. |
| `src/aircraft/PFDCanvas.js` | ~310 | **Primary Flight Display**: 60 FPS 2D canvas attitude director indicator (ADI), speed tape, altitude tape, VSI, heading tape. |
| `src/aircraft/NDCanvas.js` | ~250 | **Navigation Display**: 60 FPS 2D canvas compass rose, runway 09L extended centerline, waypoints, wind vector. |
| `src/aircraft/EICASCanvas.js` | ~260 | **Engine Indication & Crew Alerting**: Dual N1/EGT dials, flap ladder, landing gear indicator lights, CAS warnings. |
| `src/aircraft/Cockpit.js` | ~270 | **3D Virtual Cockpit**: Glare shield, MCP, animated dual control yokes, throttle levers, flap/spoiler handles, rudder pedals. |
| `src/aircraft/Boeing737.js` | ~280 | **Airliner 3D Model**: Swept wings, winglets, rotating turbofan blades, animated control surfaces (ailerons, flaps, spoilers, elevator, rudder). |
| `src/environment/Terrain.js` | ~130 | **Procedural Terrain**: Simplex multi-octave 20km terrain with plateau airport elevation blending ($y = 12\text{m}$). |
| `src/environment/WaterOcean.js` | ~120 | **Gerstner Ocean**: Custom vertex/fragment shader with multi-frequency waves, Fresnel sun glints, wave height query. |
| `src/environment/Airport.js` | ~230 | **Runway 09L/27R**: Runway markings, sequenced flashing ALS rabbit strobes, PAPI 3° glideslope lights, 65m radar tower. |
| `src/environment/FoliageAndCities.js` | ~160 | **Instanced Scenery**: 3,500+ instanced pine/deciduous trees and 500+ city skyscrapers with airport exclusion zones. |
| `src/environment/Ships.js` | ~190 | **Maritime Traffic**: Container ships, cruise liners, oil tankers, speedboats with buoyant wave tracking and wake trails. |
| `src/environment/SkyAtmosphere.js` | ~110 | **Atmospheric Scattering**: Rayleigh/Mie sky dome, dynamic sun elevation, time-of-day progression, cumulus cloud layer. |
| `src/audio/FlightAudio.js` | ~220 | **Web Audio Engine**: Procedural turbofan RPM whine/rumble, wind slipstream pink noise, touchdown screech, Boeing GPWS voice callouts. |
| `src/controls/FlightControls.js` | ~210 | **Input Management**: Progressive throttle, mouse yoke, keyboard hotkeys, mobile virtual sticks, elevator trim. |
| `src/cameras/CameraSystem.js` | ~220 | **Dynamic Multi-Cam**: Cockpit (G-load head movement, stall buffeting), Chase, Wing, Tower, Flyby camera modes. |
| `src/ui/DiagnosticsInspector.js` | ~315 | **Physics Inspector**: In-game HUD with live telemetry, G-Force/AoA sparkline graph, and live aerodynamic tuning sliders. |
| `src/config/aircraftConfigs.js` | ~80 | **Aircraft Registry**: Centralized aerodynamic parameters, mass inertia tensors, and engine specs for Boeing 737 and future aircraft. |
| `src/config/simConfig.js` | ~60 | **Simulation Configuration**: Physics frequency, airport coordinates, waypoints, and graphic presets. |
| `src/core/EventBus.js` | ~50 | **Decoupled Event Dispatcher**: Pub/sub system for simulation events. |
| `tests/*.test.js` | ~400 | **Automated Unit Test Suite**: Native Node.js test runner verifying atmosphere, aerodynamics, engines, and landing gear. |
| `scripts/test-flight-agent.js` | ~580 | **Autonomous E2E Flight Test Agent**: Headless Chrome CDP driver running automated takeoff, stall recovery, landing rollout, and camera stress tests with real-time physics anomaly detection. |

---

## 2. Code Quality & Complexity Standards

When modifying or expanding the codebase, adhere to the following rules:

### 2.1 Physics Determinism & Substepping
- **Zero Frame-Rate Dependency**: Never integrate velocity or position directly with `requestAnimationFrame` delta. Always accumulate time and pass fixed $dt = 1/120\text{s}$ into `integratePhysics(dt)`.
- **Pure Physics Math**: Keep `src/physics/` modules free from DOM manipulation and HTML elements. All physics modules should accept numerical states or Three.js math vectors and return plain calculation objects.

### 2.2 Modularity & Decoupling
- **No Magic Numbers**: Place aerodynamic derivatives ($C_{L\alpha}, C_{m\alpha}, C_{D0}$), physical dimensions, and mass properties in `src/config/aircraftConfigs.js`.
- **Event Bus for Cross-Cutting Concerns**: Use `EventBus.emit()` for audio callouts, telemetry recording, and milestone achievements rather than tight coupling across modules.

### 2.3 Performance Budget
- **Target Frame Rate**: Consistent 60 FPS on standard desktop GPUs.
- **Garbage Collection Optimization**:
  - Re-use `THREE.Vector3` and `THREE.Quaternion` temporary scratch variables in high-frequency loops (120Hz / 60Hz) to prevent GC pauses.
  - Instrument displays (`PFDCanvas`, `NDCanvas`, `EICASCanvas`) render to offscreen 2D canvas elements with `needsUpdate = true` on their respective `THREE.CanvasTexture`.
  - Scenery trees and buildings MUST use `THREE.InstancedMesh` (draw calls $\le 10$ for thousands of objects).

### 2.4 Testing Requirements
- Every new physics calculation, aerodynamic derivative, or system formula MUST have a corresponding automated unit test in `tests/`.
- Run `npm test` before committing changes; all 4 test suites (20 tests) must pass 100% with zero failures.
- Run `npm run test:flight` to trigger the autonomous CDP flight test agent; all 4 flight scenarios (Takeoff, Stall, Landing, Presets) must pass with 0 physics anomalies and 0 console errors.
- Run `npm run build` to verify Vite bundle compilation.

---

## 3. Environment & Node PATH Notice for Coding Agents
- On this system, Node.js is located at `/opt/node/bin/node` (v22.23.2).
- When executing terminal commands (`run_command`), always prefix with:
  ```bash
  export PATH="/opt/node/bin:$PATH"
  ```
- Dev server is running in background at `http://localhost:5173/`.
