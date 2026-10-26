/**
 * Distance acoustics for exterior camera views: sound pressure falls off with
 * distance and air absorbs high frequencies first, so far views get quieter
 * and duller. Values are tuned for scene units in meters (chase 20-140 m,
 * drone 16-85 m, tower several hundred meters).
 */

export const NEAR_FIELD_GAIN = 1.0;
const GAIN_FLOOR = 0.08;
const GAIN_HALF_DISTANCE = 60;
const NEAR_FIELD_CUTOFF = 8800;
const CUTOFF_FLOOR = 1500;
const CUTOFF_HALF_DISTANCE = 220;

export function exteriorDistanceGain(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return NEAR_FIELD_GAIN;
  return Math.max(GAIN_FLOOR, 1 / (1 + (meters / GAIN_HALF_DISTANCE) ** 2));
}

export function exteriorAirCutoff(meters) {
  if (!Number.isFinite(meters) || meters <= 0) return NEAR_FIELD_CUTOFF;
  return Math.max(CUTOFF_FLOOR, NEAR_FIELD_CUTOFF / (1 + (meters / CUTOFF_HALF_DISTANCE) ** 2));
}
