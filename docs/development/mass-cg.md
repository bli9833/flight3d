# Dynamic mass, CG and inertia

Issue #131 Task 1-2, implemented in the current JS integrator at 120 Hz.
This does not introduce Rapier, 240 Hz stepping or a certified performance model.

## One loading ledger

`MassProperties` owns tanks, payload stations, gross mass, zero-fuel mass,
CG and body-axis diagonal inertia. `EngineModel` consumes this ledger; it no
longer subtracts fuel from a second mass counter. B738 shared feed drains the
center tank before both wings, including a tick that crosses the boundary.
Equal-priority tanks share demand proportionally. There is no crossfeed control,
fuel imbalance, slosh or unusable-fuel model.

All values use kg, m, s and kg m². In structural body coordinates, X is right,
Y is up and Z is aft. Thus forward CG is negative Z. The model origin is an
existing aerodynamic reference, **not a surveyed 25% MAC location**.

For components i at positions r_i:

```
m = Σ m_i                          ZFW = empty mass + payload
c = Σ(m_i r_i) / m
I_x = Σ[I_x,i + m_i ((y_i-c_y)² + (z_i-c_z)²)]
```

The other two diagonal moments follow by cyclic permutation. Legacy config
names differ from body axes: `Iyy` is body-X pitch inertia, `Izz` body-Y yaw,
and `Ixx` body-Z roll. Do not map them by spelling alone.

The old loaded reference inertia is decomposed into dry-structure inertia and
point-mass contributions once. Adding fuel inertia onto that loaded number
would double count it. Dry-structure CG is calibrated to reproduce the old
origin CG with full fuel, reference payload, gear down and flaps zero. Moving
gear/flap masses are already inside empty weight; deployment moves them without
adding weight. `massDistributions.js` explicitly labels positions, masses and
tail parameters as game estimates, not manufacturer weight-and-balance data.

Lukla's 43 t scenario is 41413 kg empty + 1587 kg fuel + zero payload. It uses
the same dry structure and tank decomposition rather than scaling every inertia
by 43/66 while simultaneously retaining 14.2 t of fuel.

## Forces, moments and the Three.js origin

CG does not directly choose a force direction. Gravity points down, thrust
follows the body, lift is normal to the local relative airflow, and drag opposes
it. Net force changes velocity through a = F/m. CG changes the moment arm:

```
M_CG = M_O - c × F
v_contact = v_CG + (R ω_body) × R(r_contact - c)
α_body ≈ I_body⁻¹ M_body
```

Aerodynamic and effective thrust moments are shifted once. Wheel forces, body
supports and constraint impulses use the same CG arms and inverse inertia.
Geometry remains in structural coordinates so wheels and terrain probes do not
jump when loading changes. `position` remains the model origin; linear velocity
denotes the instantaneous CG. With fixed c during a step:

```
origin_new = origin_old + v_CG dt + R_old c - R_new c
```

When c changes between ticks, velocity is relabelled by R(ω × Δc), preserving
the structural velocity field. This is a quasi-static approximation, not an
internal fluid/moving-mass simulation. Products of inertia, gyroscopic coupling,
I-dot and angular-momentum flux are omitted, as in the diagonal game integrator.
Existing angular damping remains. Large or rapid redistribution is not validated.

## Tail load and trim

The legacy CL/CD represent an already trimmed whole aircraft. Adding a complete
second tail would double count its baseline load. `longitudinalForces` adds only
the difference from the inferred reference-CG, power-off tail load:

```
q = ρ V² / 2
F_tail,reference = q S c̄ (Cm0 + Cma α) / (l_tail cos α)
F_tail,actual    = q S c̄ Cm_de δ_e / (l_tail cos α)
ΔL = F_tail,actual - F_tail,reference
ΔD = k_tail (F_tail,actual² - F_tail,reference²) / (q S_tail)
```

The projected arm is bounded outside the attached-flow envelope; q=0 contributes
zero tail force/drag. This is a calibrated incremental model, not a geometric
tail/downwash solver. The live model retains continuous separation-dependent
control effectiveness, pitch damping and stall break. The steady solver assumes
attached flow, zero rates, no wind and no ground effect. It solves normal force,
path force and pitch moment together with the same tail/CG formulas.

Forward CG requires greater downward tail load and higher wing demand in the
tested conventional-aircraft range; induced drag and the 1g stall estimate rise.
It also adds restoring pitch stiffness. Aft CG reverses these trends in that
range; extreme CG can leave the trim wheel unable to hold equilibrium.
`handsOffFeasible` requires adequate wheel/surface travel and available thrust.
An idle-clamped descent is retained as `feasible` for legacy callers but is not
reported as an exact hands-off equilibrium.

The PFD low-speed strip uses a power-off, 1g attached-flow boundary estimate with
the tail load needed at the current CG. It ignores control limits and maneuver
load. Actual stall annunciation still follows live flow separation. At fixed CG
and configuration the estimate scales with sqrt(m), as the lift equation predicts.

## Loading and cockpit synchronization

The **중량 / Loading** toolbar button edits fuel and station payload, in kg.
Apply requires a stopped aircraft on the ground. Capacity, finite/nonnegative
mass, known station and maximum gross mass checks complete before mutation.
Applying updates mass/CG/inertia, performance, telemetry, PFD and CDU in the
same call. Reset restores the aircraft/scenario's initial loading.

Ground performance is refreshed once per simulated second and immediately on
LMC. CDU/PFD use one snapshot. TOW~ means gross mass if taking off at that
snapshot; no planned taxi fuel is deducted. Actual liftoff mass is recorded after
a real ground-contact to airborne transition. The last takeoff snapshot is held
in flight; the low-speed estimate continues to follow fuel/configuration changes.

VR~/V2~ are **educational estimates**, respectively 1.05 and 1.15 times the first
attached-flow, hands-off trim boundary found by a bracketed search. That boundary
may be control/thrust limited rather than stall limited. These are not real
rotation or engine-out safety speeds. Damaged/failed engines, reverse operation,
dry tanks or no feasible bracket produce unavailable estimates. V1 is explicitly
unavailable because accelerate-stop/go, runway friction/slope/length and engine
failure performance are not modeled. The issue remains open for these gaps and
its other tasks; no AFM/POH or real-aircraft accuracy is claimed.

## Verification

`node --test tests/massProperties.test.js tests/trimSolver.test.js tests/engine.test.js`
checks conservation, reference inertia, tank exhaustion/boundaries, invalid LMC
atomicity, geometry/CG kinematics, force/impulse moment shifts, forward/aft trim,
live residuals, static pitch stiffness, starvation and speed estimates.

For browser acceptance start Vite and open `/scripts/verify-mass-cg.html`.
Click **Run checks** after loading. It freezes wall-clock rendering and steps
the actual simulator: LMC/CDU/PFD synchronization, 10-second ground hold,
30-second hands-off cruise, airborne LMC rejection and runway reset. Reload to
restore normal animation. See [recorded evidence](../../review-artifacts/mass-cg/README.md).
This bounded check does not establish complete takeoff/landing, Lukla demo,
engine-out, full envelope or mobile touch-flight acceptance.
