import { Rng, next } from "./rng";

export interface TileMap { w: number; h: number; ts: number; tiles: number[] } // 1 = wall, 0 = floor

/** Seeded cave: cellular automaton, then keep only the largest connected region. */
export function genCave(r: Rng, w: number, h: number, ts: number): TileMap {
  let t = new Array(w * h).fill(1);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) t[y * w + x] = next(r) < 0.44 ? 1 : 0;
  for (let it = 0; it < 5; it++) {
    const n = t.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) c += t[(y + dy) * w + x + dx];
      n[y * w + x] = c >= 5 ? 1 : 0;
    }
    t = n;
  }
  keepLargest(t, w, h);
  return { w, h, ts, tiles: t };
}

/** Keep only the largest connected floor region (everything else becomes wall). */
function keepLargest(t: number[], w: number, h: number) {
  const region = new Array(w * h).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < w * h; i++) {
    if (t[i] !== 0 || region[i] !== -1) continue;
    const stack = [i]; region[i] = id; let size = 0;
    while (stack.length) {
      const c = stack.pop()!; size++;
      const cx = c % w, cy = (c / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (t[ni] === 0 && region[ni] === -1) { region[ni] = id; stack.push(ni); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  for (let i = 0; i < w * h; i++) if (t[i] === 0 && region[i] !== best) t[i] = 1;
}

const ri = (r: Rng, lo: number, hi: number) => lo + Math.floor(next(r) * (hi - lo + 1));
function carveRect(t: number[], w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  for (let y = Math.max(1, Math.min(y0, y1)); y <= Math.min(h - 2, Math.max(y0, y1)); y++)
    for (let x = Math.max(1, Math.min(x0, x1)); x <= Math.min(w - 2, Math.max(x0, x1)); x++) t[y * w + x] = 0;
}
/** A corridor `wd` wide: horizontal then vertical, with a little wobble. */
function corridor(r: Rng, t: number[], w: number, h: number, ax: number, ay: number, bx: number, by: number, wd: number) {
  const hw = Math.floor(wd / 2);
  const mid = next(r) < 0.5;
  if (mid) { carveRect(t, w, h, ax, ay - hw, bx, ay - hw + wd - 1); carveRect(t, w, h, bx - hw, ay, bx - hw + wd - 1, by); }
  else { carveRect(t, w, h, ax - hw, ay, ax - hw + wd - 1, by); carveRect(t, w, h, ax, by - hw, bx, by - hw + wd - 1); }
}
/** Rough the edges of carved space so it doesn't look like a grid. */
function erode(r: Rng, t: number[], w: number, h: number, p: number) {
  const n = t.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (t[y * w + x] !== 1) continue;
    let f = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f += t[(y + dy) * w + x + dx] === 0 ? 1 : 0;
    if (f > 0 && next(r) < p) n[y * w + x] = 0;
  }
  for (let i = 0; i < t.length; i++) t[i] = n[i];
}

/** Linear: a chain of rooms snaking from one end of the map to the other. */
export function genLinear(r: Rng, w: number, h: number, ts: number): TileMap {
  const t = new Array(w * h).fill(1);
  let x = 6, y = ri(r, 8, h - 9), px = -1, py = -1;
  while (x < w - 6) {
    const rw = ri(r, 5, 9), rh = ri(r, 5, 9);
    carveRect(t, w, h, x - rw, y - rh, x + rw, y + rh);
    if (px >= 0) corridor(r, t, w, h, px, py, x, y, ri(r, 3, 5));
    px = x; py = y;
    x += ri(r, 14, 20); y = Math.max(8, Math.min(h - 9, y + ri(r, -12, 12)));
  }
  erode(r, t, w, h, 0.25);
  keepLargest(t, w, h);
  return { w, h, ts, tiles: t };
}

/** A wobbly radius: base size bent by a few random waves, so outlines are never circles or boxes. */
function wobble(r: Rng, k: number): (a: number) => number {
  const waves = Array.from({ length: k }, (_, i) => ({ f: i + 2 + Math.floor(next(r) * 3), amp: 0.05 + next(r) * 0.1, ph: next(r) * Math.PI * 2 }));
  return (a) => 1 + waves.reduce((v, w) => v + w.amp * Math.sin(a * w.f + w.ph), 0);
}

/** Open: one huge irregular cavern with scattered pillars and rubble. */
export function genOpen(r: Rng, w: number, h: number, ts: number): TileMap {
  const t = new Array(w * h).fill(1);
  const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) / 2 - 4, f = wobble(r, 4);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const dx = x - cx, dy = (y - cy) * 1.1, d = Math.hypot(dx, dy);
    if (d < R0 * Math.min(1, f(Math.atan2(dy, dx)))) t[y * w + x] = 0;
  }
  const n = Math.floor((w * h) / 90);
  for (let i = 0; i < n; i++) {
    const px = ri(r, 6, w - 7), py = ri(r, 6, h - 7), sz = ri(r, 0, 2);
    for (let y = py - sz; y <= py + sz; y++) for (let x = px - sz; x <= px + sz; x++) if (next(r) < 0.8) t[y * w + x] = 1;
  }
  erode(r, t, w, h, 0.2);
  keepLargest(t, w, h);
  return { w, h, ts, tiles: t };
}

/** Ring: a wide loop around a bottomless central pit, with a few side caves off the outer wall. */
export function genRing(r: Rng, w: number, h: number, ts: number): TileMap {
  const t = new Array(w * h).fill(1);
  const cx = w / 2, cy = h / 2, R0 = Math.min(w, h) / 2 - 4, fo = wobble(r, 3), fi = wobble(r, 3);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (d < R0 * Math.min(1, fo(a)) && d > R0 * 0.45 * fi(a)) t[y * w + x] = 0;
  }
  // side caves bulging outward, and a few pillars in the loop
  for (let i = 0; i < 6; i++) {
    const a = next(r) * Math.PI * 2, d = R0 * 0.85, rr = ri(r, 3, 5);
    const bx = Math.round(cx + Math.cos(a) * d), by = Math.round(cy + Math.sin(a) * d);
    for (let y = by - rr; y <= by + rr; y++) for (let x = bx - rr; x <= bx + rr; x++)
      if (x > 1 && y > 1 && x < w - 2 && y < h - 2 && Math.hypot(x - bx, y - by) <= rr) t[y * w + x] = 0;
  }
  for (let i = 0; i < Math.floor((w * h) / 160); i++) {
    const px = ri(r, 4, w - 5), py = ri(r, 4, h - 5);
    if (next(r) < 0.7) t[py * w + px] = 1;
  }
  erode(r, t, w, h, 0.2);
  keepLargest(t, w, h);
  return { w, h, ts, tiles: t };
}

/** Rooms: a grid of chambers linked by narrow halls (a spanning tree plus a few loops). */
export function genRooms(r: Rng, w: number, h: number, ts: number): TileMap {
  const t = new Array(w * h).fill(1);
  const cell = 16, cw = Math.floor((w - 2) / cell), ch = Math.floor((h - 2) / cell);
  const centers: [number, number][] = [];
  for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
    const ox = 1 + gx * cell, oy = 1 + gy * cell;
    const rw = ri(r, 3, 6), rh = ri(r, 3, 6), cx = ox + ri(r, rw + 1, cell - rw - 2), cy = oy + ri(r, rh + 1, cell - rh - 2);
    carveRect(t, w, h, cx - rw, cy - rh, cx + rw, cy + rh);
    centers.push([cx, cy]);
  }
  const idx = (gx: number, gy: number) => gy * cw + gx;
  for (let gy = 0; gy < ch; gy++) for (let gx = 0; gx < cw; gx++) {
    const [ax, ay] = centers[idx(gx, gy)];
    // always link right in the first row and down everywhere else (a tree), plus random extra loops
    if (gx + 1 < cw && (gy === 0 || next(r) < 0.45)) { const [bx, by] = centers[idx(gx + 1, gy)]; corridor(r, t, w, h, ax, ay, bx, by, 3); }
    if (gy + 1 < ch) { const [bx, by] = centers[idx(gx, gy + 1)]; corridor(r, t, w, h, ax, ay, bx, by, 3); }
  }
  erode(r, t, w, h, 0.2);
  keepLargest(t, w, h);
  return { w, h, ts, tiles: t };
}

export function isWallAt(m: TileMap, px: number, py: number): boolean {
  const tx = Math.floor(px / m.ts), ty = Math.floor(py / m.ts);
  if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true;
  return m.tiles[ty * m.w + tx] === 1;
}

/** Circle-ish (AABB) vs grid. Moves along each axis separately so entities slide on walls. Returns true if blocked. */
export function moveWithWalls(m: TileMap, e: { x: number; y: number; r: number }, dx: number, dy: number): boolean {
  let blocked = false;
  if (dx !== 0) {
    const nx = e.x + dx;
    const edge = nx + (dx > 0 ? e.r : -e.r);
    if (isWallAt(m, edge, e.y - e.r * 0.8) || isWallAt(m, edge, e.y + e.r * 0.8)) {
      blocked = true;
      const tx = Math.floor(edge / m.ts);
      e.x = dx > 0 ? tx * m.ts - e.r - 0.01 : (tx + 1) * m.ts + e.r + 0.01;
    } else e.x = nx;
  }
  if (dy !== 0) {
    const ny = e.y + dy;
    const edge = ny + (dy > 0 ? e.r : -e.r);
    if (isWallAt(m, e.x - e.r * 0.8, edge) || isWallAt(m, e.x + e.r * 0.8, edge)) {
      blocked = true;
      const ty = Math.floor(edge / m.ts);
      e.y = dy > 0 ? ty * m.ts - e.r - 0.01 : (ty + 1) * m.ts + e.r + 0.01;
    } else e.y = ny;
  }
  return blocked;
}

/** BFS distance field (in tiles) from a world point; used by enemies to path around walls. */
export function flowField(m: TileMap, px: number, py: number, maxDist = 40): Int16Array {
  const d = new Int16Array(m.w * m.h).fill(-1);
  const sx = Math.floor(px / m.ts), sy = Math.floor(py / m.ts);
  const q = new Int32Array(m.w * m.h);
  let head = 0, tail = 0;
  const s = sy * m.w + sx;
  if (m.tiles[s] !== 0) return d;
  d[s] = 0; q[tail++] = s;
  while (head < tail) {
    const c = q[head++];
    const cd = d[c];
    if (cd >= maxDist) continue;
    const cx = c % m.w, cy = (c / m.w) | 0;
    if (cx > 0 && m.tiles[c - 1] === 0 && d[c - 1] < 0) { d[c - 1] = cd + 1; q[tail++] = c - 1; }
    if (cx < m.w - 1 && m.tiles[c + 1] === 0 && d[c + 1] < 0) { d[c + 1] = cd + 1; q[tail++] = c + 1; }
    if (cy > 0 && m.tiles[c - m.w] === 0 && d[c - m.w] < 0) { d[c - m.w] = cd + 1; q[tail++] = c - m.w; }
    if (cy < m.h - 1 && m.tiles[c + m.w] === 0 && d[c + m.w] < 0) { d[c + m.w] = cd + 1; q[tail++] = c + m.w; }
  }
  return d;
}

/** Chase boss arena: a big round hall with a few pillars to break line of sight and charges. */
export function genArena(r: Rng, w: number, h: number, ts: number): TileMap {
  const t = new Array(w * h).fill(1);
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 3;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    if (dx * dx + dy * dy < R * R) t[y * w + x] = 0;
  }
  const pillars = [[-8, -6], [8, -6], [-8, 6], [8, 6]];
  for (const [px, py] of pillars) for (let y = -1; y <= 0; y++) for (let x = -1; x <= 0; x++) t[(cy + py + y) * w + cx + px + x] = 1;
  next(r);
  return { w, h, ts, tiles: t };
}
