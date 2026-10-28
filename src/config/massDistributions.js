// GAME estimates, not aircraft weight-and-balance data. The old loaded inertia
// and origin CG are preserved by decomposition in MassProperties. See mass-cg.md.
const p = (x, y, z) => ({ x, y, z });
export const B738_MASS_DISTRIBUTION = {
  referenceMassKg: 66000,
  tanks: [
    { id: 'center', capacityKg: 7200, priority: 0, position: p(0, 0, -1) },
    { id: 'left', capacityKg: 3500, priority: 1, position: p(-7, 0, 1) },
    { id: 'right', capacityKg: 3500, priority: 1, position: p(7, 0, 1) },
  ],
  stations: [
    { id: 'forward', capacityKg: 15000, position: p(0, 0, -6) },
    { id: 'aft', capacityKg: 15000, position: p(0, 0, 6) },
  ],
  parts: [
    { control: 'gear', massKg: 1000, stowed: p(0, -1, 0), deployed: p(0, -2, 0.3) },
    { control: 'flap', massKg: 300, stowed: p(0, 0, 1), deployed: p(0, -0.1, 1.3) },
  ],
};
export const C172_MASS_DISTRIBUTION = {
  referenceMassKg: 1050,
  tanks: [
    { id: 'left', capacityKg: 72, priority: 0, position: p(-2.5, 0, 0) },
    { id: 'right', capacityKg: 72, priority: 0, position: p(2.5, 0, 0) },
  ],
  stations: [
    { id: 'forward', capacityKg: 200, position: p(0, 0, -0.5) },
    { id: 'aft', capacityKg: 150, position: p(0, 0, 0.5) },
  ],
  parts: [{ control: 'flap', massKg: 8, stowed: p(0, 0, 0.4), deployed: p(0, -0.05, 0.5) }],
};
export const F16_MASS_DISTRIBUTION = {
  referenceMassKg: 12000,
  tanks: [{ id: 'internal', capacityKg: 3200, priority: 0, position: p(0, 0, 0) }],
  stations: [{ id: 'payload', capacityKg: 6000, position: p(0, 0, 0) }],
  parts: [{ control: 'gear', massKg: 150, stowed: p(0, -0.3, 0), deployed: p(0, -0.8, 0.1) }],
};
