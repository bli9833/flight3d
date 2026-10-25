const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Audio RPM estimate from the simulator's normalized shaft-speed telemetry.
 * This is a sound mapping, not a replacement piston/propeller physics model.
 */
export function pistonSoundState(engine, iasKnots, profile) {
  const n1 = Math.max(0, engine?.n1 ?? profile.idleN1);
  const power = clamp((n1 - profile.idleN1) / Math.max(1, profile.maxN1 - profile.idleN1), 0, 1);
  const runningRpm = n1 < profile.idleN1
    ? profile.idleRpm * n1 / profile.idleN1
    : profile.idleRpm + power * (profile.maxRpm - profile.idleRpm);
  // A failed engine has no firing pulses. Only an airborne windmilling prop
  // contributes a quieter air pulse; a parked failed engine must become silent.
  const combustion = engine?.failed ? 0 : clamp(n1 / profile.idleN1, 0, 1);
  const rpm = engine?.failed ? runningRpm * clamp(iasKnots / 60, 0, 1) : runningRpm;
  return { power, rpm, combustion, firingHz: rpm / 60 * profile.cylinders / 2,
    bladeHz: rpm / 60 * profile.propellerBlades };
}
