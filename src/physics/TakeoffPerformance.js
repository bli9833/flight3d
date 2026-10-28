import { solveTrim } from './TrimSolver.js';

/** Educational VR/V2 estimates from the attached-flow trim boundary, not AFM
 * performance. V1 deliberately unavailable: no accelerate-stop runway model.
 */
export function takeoffPerformance(aero, engines, state = {}) {
  const mass = aero.massProperties;
  const common = { revision: mass.revision, massKg: mass.massKg,
    zeroFuelMassKg: mass.zeroFuelMassKg, fuelKg: mass.fuelKg,
    cg: { ...mass.cg }, v1: null, vr: null, v2: null, status: 'unavailable' };
  if (engines.failed.some(Boolean) || engines.contactDamage.some(d => d > 0)
    || mass.fuelKg <= 0 || engines.reverserActive || mass.gear < 0.99) return common;
  let lo = 10, hi = 400;
  const trial = speed => solveTrim(aero, engines, { ...state, gearState: 1, iasKnots: speed });
  // Find the first feasible attached-flow solution; high-speed drag can make
  // the top of the range infeasible too, so first bracket with an ascending scan.
  let found = false;
  for (let v = 15; v <= hi; v += 5) {
    const t = trial(v);
    if (t.feasible && t.handsOffFeasible) { hi = v; found = true; break; }
    lo = v;
  }
  if (!found) return common;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2, t = trial(mid);
    if (t.feasible && t.handsOffFeasible) hi = mid; else lo = mid;
  }
  const vr = hi * 1.05, v2 = hi * 1.15;
  if (![vr, v2].every(v => { const t = trial(v); return t.feasible && t.handsOffFeasible; })) return common;
  return { ...common, status: 'estimate', trimBoundaryKnots: hi, vr, v2 };
}
