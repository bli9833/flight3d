/**
 * Derives the yawing moment (body +Y axis, positive yaws the nose LEFT) produced
 * by asymmetric thrust between the left and right engine.
 *
 * Forces act at each engine's moment arm from the centerline; the differential
 * is the classic engine-out yaw: losing the left engine removes a right-turning
 * moment, so the aircraft yaws toward the dead side (nose left).
 *   moment = arm * (T_right - T_left)
 */
export function asymmetricThrustYawMoment(thrustLeft, thrustRight, armMeters = 4.5) {
  if (thrustLeft === undefined || thrustRight === undefined || armMeters === 0) return 0;
  return armMeters * (thrustRight - thrustLeft);
}

/**
 * High-Bypass Turbofan and Piston Engine Simulation
 * Simulates 1, 2, or multi-engine configurations with realistic spool latency, thrust lapse with altitude/speed,
 * EGT, N1%, N2%, Fuel Flow, thrust reversers, engine failure (windmilling) and fuel burn.
 */
export class EngineModel {
  constructor(config = null) {
    this.throttleCommand = 0.0; // 0.0 to 1.0 (Idle to TOGA)
    this.reverserActive = false;
    this.reverserDeployment = 0.0; // 0.0 to 1.0

    this.loadConfig(config);
  }

  loadConfig(config = null) {
    const propulsion = config?.propulsion || config || {};
    this.numEngines = propulsion.numEngines ?? 2;
    this.maxStaticThrustPerEngine = propulsion.maxStaticThrustPerEngineN ?? propulsion.maxStaticThrustPerEngine ?? 121000;
    this.idleN1 = propulsion.idleN1Percent ?? 22.0;
    this.togaN1 = propulsion.togaN1Percent ?? 100.0;
    this.spoolUpTime = propulsion.spoolUpTimeSec ?? propulsion.spoolUpTime ?? 3.2;
    this.spoolDownTime = propulsion.spoolDownTimeSec ?? propulsion.spoolDownTime ?? 2.4;
    this.reverseThrustEfficiency = propulsion.reverseThrustEfficiency ?? 0.45;
    this.fuelCapacityKg = propulsion.fuelCapacityKg ?? 14200;
    this.fuelKg = this.fuelCapacityKg;
    this.appliedFuelLoadKg = 0;
    this.windmillingN1 = propulsion.windmillingN1 ?? 9.0;
    this.momentArmMeters = propulsion.momentArmMeters ?? (this.numEngines > 1 ? 4.5 : 0.0);

    const baseFuelFlow = propulsion.baseFuelFlowKgPerHour ?? 350.0;

    this.n1 = new Array(this.numEngines).fill(this.idleN1);
    this.targetN1 = new Array(this.numEngines).fill(this.idleN1);
    this.n2 = new Array(this.numEngines).fill(62.0);
    this.egt = new Array(this.numEngines).fill(420.0);
    this.fuelFlow = new Array(this.numEngines).fill(baseFuelFlow);
    this.thrust = new Array(this.numEngines).fill(0.0);
    this.contactDamage = new Array(this.numEngines).fill(0);
    this.failed = new Array(this.numEngines).fill(false);
  }

  setThrottle(val) {
    this.throttleCommand = Math.max(0.0, Math.min(1.0, val));
  }

  /**
   * Shed the fuel burned since the previous call from the airframe mass.
   * Accounted as a delta against the fuel load so a scenario that replaces
   * `aero.mass` with its own configured value mid-flight keeps that baseline
   * instead of being fought by absolute accounting.
   */
  shedBurnedFuelMass(aero) {
    const fuelLoadKg = this.fuelCapacityKg - this.fuelKg;
    aero.mass += this.appliedFuelLoadKg - fuelLoadKg;
    this.appliedFuelLoadKg = fuelLoadKg;
  }

  /** Start a fresh segment with full tanks at the aircraft's configured mass. */
  refuel(aero) {
    this.fuelKg = this.fuelCapacityKg;
    this.appliedFuelLoadKg = 0;
    aero.mass = aero.massBaselineKg;
  }

  setEngineFailure(index, on) {
    if (index < 0 || index >= this.numEngines) return false;
    this.failed[index] = !!on;
    return this.failed[index];
  }

  toggleReverser(onGround) {
    if (onGround) {
      this.reverserActive = !this.reverserActive;
    } else {
      this.reverserActive = false;
    }
    return this.reverserActive;
  }

  setReverser(active, onGround) {
    this.reverserActive = onGround && active;
  }

  update(dt, altitudeMeters, tas, densityRatio) {
    // Reverser mechanical deployment rate
    const reverserTarget = this.reverserActive ? 1.0 : 0.0;
    this.reverserDeployment += (reverserTarget - this.reverserDeployment) * Math.min(1.0, dt * 2.5);

    // Target N1 based on throttle and reverser
    let targetN1Value;
    if (this.reverserDeployment > 0.5 && this.reverseThrustEfficiency > 0) {
      // Reverser spool to ~75% N1
      targetN1Value = this.idleN1 + (this.throttleCommand > 0.1 ? this.throttleCommand : 0.65) * (this.togaN1 - this.idleN1) * 0.70;
    } else {
      targetN1Value = this.idleN1 + this.throttleCommand * (this.togaN1 - this.idleN1);
    }

    const altitudeLapse = Math.pow(Math.max(0.1, densityRatio), 0.75);
    // Ram drag / airspeed lapse: slight decrease in net thrust as TAS increases
    const ramLapse = Math.max(0.7, 1.0 - (tas / 300.0) * 0.25);

    const fuelStarved = this.fuelKg <= 0.0;
    let totalThrust = 0;

    for (let i = 0; i < this.numEngines; i++) {
      // A shutdown engine (or any engine when the tanks run dry) windmills:
      // no combustion, and the fan is held down by the airstream.
      const out = this.failed[i] || fuelStarved;
      const integrity = 1 - this.contactDamage[i];
      this.targetN1[i] = out ? this.windmillingN1
        : this.windmillingN1 + (targetN1Value - this.windmillingN1) * integrity;

      // Realistic non-linear spool inertia
      const diff = this.targetN1[i] - this.n1[i];
      const rate = diff > 0 ? (2.5 / this.spoolUpTime) : (2.2 / this.spoolDownTime);
      this.n1[i] += diff * Math.min(1.0, dt * rate * (0.8 + 0.4 * (this.n1[i] / 100.0)));

      // Core N2 tracks N1 closely with slight lag; with the core offline it
      // decays toward the fraction of fan speed it sees windmilling.
      const runningN2 = 60.0 + (this.n1[i] - 22.0) * (38.0 / 78.0);
      const targetN2 = out ? this.n1[i] * 0.4
        : this.n1[i] * 0.4 + (runningN2 - this.n1[i] * 0.4) * integrity;
      this.n2[i] += (targetN2 - this.n2[i]) * Math.min(1.0, dt * 1.5);

      // EGT correlates with fuel burn and compressor load; an engine without
      // combustion cools toward ambient.
      const n1NormEgt = Math.max(0.0, (this.n1[i] - 20.0) / 80.0);
      const targetEgt = out ? 15.0 : 15.0 + (385.0 + Math.pow(n1NormEgt, 1.4) * 450.0) * integrity;
      this.egt[i] += (targetEgt - this.egt[i]) * Math.min(1.0, dt * 1.8);

      // Fuel Flow (kg/hour per engine); a flamed-out engine eases to zero burn
      const runningFuelFlow = 300.0 + Math.pow(this.n1[i] / 100.0, 2.5) * 2200.0 * altitudeLapse;
      const targetFF = out ? 0.0 : runningFuelFlow * integrity;
      this.fuelFlow[i] += (targetFF - this.fuelFlow[i]) * Math.min(1.0, dt * (out ? 2.0 : 12.0));

      // Net Thrust calculation
      // Normalized thrust factor from N1: ~0 at 22% idle, 1.0 at 100% N1
      const n1Norm = Math.max(0.0, (this.n1[i] - 20.0) / 80.0);
      const thrustFactor = Math.pow(n1Norm, 2.1);
      let grossThrust = this.maxStaticThrustPerEngine * thrustFactor * altitudeLapse * ramLapse;

      // Reverse thrust effect
      if (this.reverserDeployment > 0.05 && this.reverseThrustEfficiency > 0) {
        grossThrust = -grossThrust * this.reverseThrustEfficiency * this.reverserDeployment;
      }

      this.thrust[i] = grossThrust * integrity;
      totalThrust += this.thrust[i];
    }

    // Burn the fuel the running engines metered this step
    let stepFuelBurn = 0;
    for (let i = 0; i < this.numEngines; i++) {
      stepFuelBurn += this.fuelFlow[i];
    }
    this.fuelKg = Math.max(0.0, this.fuelKg - stepFuelBurn * dt / 3600.0);

    const makeEngineState = (idx) => {
      if (idx >= this.numEngines) {
        return {
          n1: 0,
          n2: 0,
          egt: 15.0,
          fuelFlow: 0,
          thrust: 0,
          failed: true
        };
      }
      return {
        n1: this.n1[idx],
        n2: this.n2[idx],
        egt: this.egt[idx],
        fuelFlow: this.fuelFlow[idx],
        thrust: this.thrust[idx],
        failed: this.failed[idx] || fuelStarved || this.contactDamage[idx] >= 1
      };
    };

    return {
      totalThrust,
      fuelKg: this.fuelKg,
      engine1: makeEngineState(0),
      engine2: makeEngineState(1),
      engines: Array.from({ length: this.numEngines }, (_, i) => makeEngineState(i)),
      reverserActive: this.reverserActive,
      reverserDeployment: this.reverserDeployment
    };
  }
}
