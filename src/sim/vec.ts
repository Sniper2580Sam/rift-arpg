// Only +,-,*,/ and sqrt are used in the sim: these are exact in IEEE754 on every engine,
// which keeps host and backend results identical. Angles come from a fixed direction table.
export function len(x: number, y: number): number { return Math.sqrt(x * x + y * y); }

export function norm(x: number, y: number): [number, number] {
  const l = Math.sqrt(x * x + y * y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
export const DIRS = 32;
export const DIR_TABLE: ReadonlyArray<readonly [number, number]> = Array.from({ length: DIRS }, (_, i) => {
  const a = (i / DIRS) * Math.PI * 2;
  return [r6(Math.cos(a)), r6(Math.sin(a))] as const;
});

/** Rotate (x,y) by k steps of the 32-direction table (k may be negative). */
export function rotSteps(x: number, y: number, k: number): [number, number] {
  const [c, s] = DIR_TABLE[((k % DIRS) + DIRS) % DIRS];
  return [x * c - y * s, x * s + y * c];
}

const FINE = 256;
const FINE_TABLE: ReadonlyArray<readonly [number, number]> = Array.from({ length: FINE }, (_, i) => {
  const a = (i / FINE) * Math.PI * 2;
  return [r6(Math.cos(a)), r6(Math.sin(a))] as const;
});
/** Rotate by k/256 of a turn (k rounded to an integer). */
export function rotFine(x: number, y: number, k: number): [number, number] {
  const i = ((Math.round(k) % FINE) + FINE) % FINE;
  const [c, s] = FINE_TABLE[i];
  return [x * c - y * s, x * s + y * c];
}
