/** SI units, model-origin body axes: right X, up Y, aft Z.
 * Quasi-static diagonal inertia; no slosh, products of inertia or mass-flow torque.
 * Reference loaded inertia is decomposed once, never added again as dry inertia.
 */
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const AXES = ['x', 'y', 'z'];
function bounded(value, max, label) {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new RangeError(label);
  return value;
}
function addPoint(I, m, p) {
  I.x += m * (p.y * p.y + p.z * p.z);
  I.y += m * (p.x * p.x + p.z * p.z);
  I.z += m * (p.x * p.x + p.y * p.y);
}

export class MassProperties {
  constructor(config) {
    const m = config.massProperties || {};
    const d = config.massDistribution || {};
    this.maxMassKg = m.maxTakeoffWeightKg ?? Infinity;
    const referenceMass = d.referenceMassKg ?? m.currentMassKg ?? 66000;
    this.emptyMassKg = m.emptyWeightKg ?? referenceMass - (config.propulsion?.fuelCapacityKg ?? 14200);
    this.tanks = (d.tanks ?? [{ id: 'main', capacityKg: config.propulsion?.fuelCapacityKg ?? 14200, position: vec(), priority: 0 }])
      .map(t => ({ ...t, position: { ...t.position }, massKg: t.capacityKg }));
    this.capacityKg = this.tanks.reduce((s, t) => s + t.capacityKg, 0);
    this.stations = (d.stations ?? [{ id: 'payload', position: vec(), capacityKg: this.maxMassKg }])
      .map(s => ({ ...s, position: { ...s.position }, massKg: 0 }));
    this.parts = (d.parts ?? []).map(p => ({ ...p, position: { ...p.stowed } }));
    const ids = new Set();
    for (const item of [...this.tanks, ...this.stations]) {
      if (!item.id || ids.has(item.id)) throw new RangeError('unique loading IDs required');
      ids.add(item.id);
      if (!(item.capacityKg > 0)) throw new RangeError('positive capacity required');
      if (!AXES.every(a => Number.isFinite(item.position[a]))) throw new RangeError('finite position required');
    }
    for (const t of this.tanks) if (t.priority !== 0 && t.priority !== 1) throw new RangeError('tank priority must be 0 or 1');
    for (const p of this.parts) {
      bounded(p.massKg, this.emptyMassKg, 'moving part mass');
      if (!['gear', 'flap'].includes(p.control) || !AXES.every(a => Number.isFinite(p.stowed[a]) && Number.isFinite(p.deployed[a]))) {
        throw new RangeError('moving part configuration');
      }
    }
    this.structureMass = this.emptyMassKg - this.parts.reduce((s, p) => s + p.massKg, 0);
    if (!(this.structureMass > 0)) throw new RangeError('empty structure mass');
    const referencePayload = referenceMass - this.emptyMassKg - this.capacityKg;
    bounded(referencePayload, this.maxMassKg, 'reference payload');
    this.stations.forEach(s => { s.massKg = referencePayload / this.stations.length; });
    // Existing inertia is about the reference CG (the model origin), gear down.
    this.gear = 1;
    this.flap = 0;
    for (const p of this.parts) Object.assign(p.position, p.control === 'gear' ? p.deployed : p.stowed);
    this.dryCg = vec();
    for (const p of [...this.tanks, ...this.stations, ...this.parts]) {
      for (const axis of AXES) this.dryCg[axis] -= p.massKg * p.position[axis] / this.structureMass;
    }
    this.dryInertia = vec(m.Iyy ?? 2650000, m.Izz ?? 3900000, m.Ixx ?? 1380000);
    const pointInertia = vec();
    for (const p of [...this.tanks, ...this.stations, ...this.parts]) addPoint(pointInertia, p.massKg, p.position);
    addPoint(pointInertia, this.structureMass, this.dryCg);
    for (const a of AXES) {
      this.dryInertia[a] -= pointInertia[a];
      if (!(this.dryInertia[a] > 0)) throw new RangeError(`invalid dry inertia ${a}`);
    }
    this.cg = vec();
    this.inertia = vec();
    this.inverseInertia = vec();
    this.revision = 0;
    this.initialFuelKg = d.initialFuelKg ?? this.capacityKg;
    this.initialPayloadKg = d.initialPayloadKg ?? referencePayload;
    this.reset();
  }

  reset() {
    const payload = Object.fromEntries(this.stations.map(s => [s.id, this.initialPayloadKg / this.stations.length]));
    this.setLoading({ fuelKg: this.initialFuelKg, payloadKg: payload });
  }

  /** Validate the whole LMC before committing any field. Omitted fields stay put. */
  setLoading({ fuelKg = this.fuelKg, payloadKg = {} } = {}) {
    bounded(fuelKg, this.capacityKg, 'fuel capacity');
    for (const key of Object.keys(payloadKg)) {
      if (!this.stations.some(s => s.id === key)) throw new RangeError(`unknown station ${key}`);
    }
    let total = this.emptyMassKg + fuelKg;
    for (const s of this.stations) total += bounded(payloadKg[s.id] ?? s.massKg, s.capacityKg, `payload ${s.id}`);
    bounded(total, this.maxMassKg, 'gross mass');
    for (const s of this.stations) s.massKg = payloadKg[s.id] ?? s.massKg;
    // Fill wings before center. Consumption reverses that order. Same-priority
    // tanks share fuel in proportion to capacity: symmetric tanks stay symmetric.
    let remaining = fuelKg;
    const priorities = [...new Set(this.tanks.map(t => t.priority))].sort((a, b) => b - a);
    for (const priority of priorities) {
      const group = this.tanks.filter(t => t.priority === priority);
      const capacity = group.reduce((s, t) => s + t.capacityKg, 0);
      const fill = Math.min(remaining, capacity);
      for (const t of group) t.massKg = fill * t.capacityKg / capacity;
      remaining -= fill;
    }
    this.recompute();
  }

  /** Shared-feed approximation; all engines can draw from all tanks. */
  consume(requestKg) {
    bounded(requestKg, Infinity, 'fuel demand');
    const supplied = Math.min(requestKg, this.fuelKg);
    let remaining = supplied;
    // Small fixed configuration array, no per-tick allocations.
    for (let priority = 0; priority <= 1 && remaining > 0; priority++) {
      let available = 0;
      for (const t of this.tanks) if (t.priority === priority) available += t.massKg;
      const take = Math.min(remaining, available);
      if (available > 0) for (const t of this.tanks) {
        if (t.priority === priority) t.massKg = Math.max(0, t.massKg * (1 - take / available));
      }
      remaining -= take;
    }
    if (supplied > 0) this.recompute();
    return supplied;
  }

  setConfiguration(gear, flap) {
    bounded(gear, 1, 'gear deployment');
    bounded(flap, 1, 'flap deployment');
    if (gear === this.gear && flap === this.flap) return;
    this.gear = gear;
    this.flap = flap;
    for (const p of this.parts) {
      const fraction = p.control === 'gear' ? gear : flap;
      for (const a of AXES) p.position[a] = p.stowed[a] + fraction * (p.deployed[a] - p.stowed[a]);
    }
    this.recompute();
  }

  recompute() {
    this.fuelKg = 0;
    this.zeroFuelMassKg = this.emptyMassKg;
    for (const t of this.tanks) this.fuelKg += t.massKg;
    for (const s of this.stations) this.zeroFuelMassKg += s.massKg;
    this.massKg = this.zeroFuelMassKg + this.fuelKg;
    for (const a of AXES) {
      this.cg[a] = this.structureMass * this.dryCg[a];
      this.inertia[a] = this.dryInertia[a];
    }
    this.accumulate(this.tanks);
    this.accumulate(this.stations);
    this.accumulate(this.parts);
    addPoint(this.inertia, this.structureMass, this.dryCg);
    for (const a of AXES) this.cg[a] /= this.massKg;
    addPoint(this.inertia, -this.massKg, this.cg);
    for (const a of AXES) {
      if (!(this.inertia[a] > 0)) throw new RangeError(`invalid inertia ${a}`);
      this.inverseInertia[a] = 1 / this.inertia[a];
    }
    this.revision++;
  }

  accumulate(items) {
    for (const p of items) {
      this.cg.x += p.massKg * p.position.x;
      this.cg.y += p.massKg * p.position.y;
      this.cg.z += p.massKg * p.position.z;
      addPoint(this.inertia, p.massKg, p.position);
    }
  }
}
