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
  // largest region
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
