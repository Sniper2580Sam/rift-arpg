// Deterministic RNG (mulberry32). State is a single uint32 stored in sim state,
// so the whole simulation can be snapshotted and replayed.
export interface Rng { s: number }

export function makeRng(seed: number): Rng { return { s: seed >>> 0 }; }

export function next(r: Rng): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(r: Rng, min: number, max: number): number { return min + (max - min) * next(r); }
export function int(r: Rng, min: number, maxIncl: number): number { return min + Math.floor(next(r) * (maxIncl - min + 1)); }
export function pick<T>(r: Rng, arr: readonly T[]): T { return arr[Math.floor(next(r) * arr.length)]; }
export function chance(r: Rng, p: number): boolean { return next(r) < p; }
export function weighted<T extends { weight: number }>(r: Rng, arr: readonly T[]): T {
  let total = 0;
  for (const a of arr) total += a.weight;
  let x = next(r) * total;
  for (const a of arr) { x -= a.weight; if (x < 0) return a; }
  return arr[arr.length - 1];
}
