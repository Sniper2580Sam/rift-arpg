// Hideout art, all drawn in code: stations, portals, decorations and the premium themes' live extras
// (carpet, rune circle, braziers' light, drifting motes). The room itself is the sim's map.
import { HIDEOUT, HideoutLayout, HideoutSpot, HideoutTheme, hideoutTheme, spotTile } from "../sim/data";
import type { TileMap } from "../sim/map";

/** A spot's position in pixels, nudged onto the nearest open floor (round rooms cut corners). */
export function spotPos(m: TileMap, th: HideoutTheme, s: HideoutSpot): [number, number] {
  let [tx, ty] = spotTile(th, s);
  const open = (x: number, y: number) => x > 0 && y > 0 && x < m.w - 1 && y < m.h - 1 && m.tiles[y * m.w + x] === 0;
  if (!open(tx, ty)) {
    const cx = Math.floor(m.w / 2), cy = Math.floor(m.h / 2);
    for (let i = 0; i < 40 && !open(tx, ty); i++) { tx += Math.sign(cx - tx); ty += Math.sign(cy - ty); }
  }
  return [(tx + 0.5) * m.ts, (ty + 0.5) * m.ts];
}
export const allSpots = () => [...HIDEOUT.stations, ...HIDEOUT.portals];

// ---------------------------------------------------------------- pixel art helpers
type Pal = Record<string, string>;
const cache = new Map<string, HTMLCanvasElement>();
function art(key: string, rows: string[], pal: Pal): HTMLCanvasElement {
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = Math.max(...rows.map((r) => r.length)); c.height = rows.length;
  const g = c.getContext("2d")!;
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x, y, 1, 1); } }));
  cache.set(key, c);
  return c;
}
const K = "#140c1c";

const DECOR: Record<string, { rows: string[]; pal: Pal; glow?: string }> = {
  barrel: { rows: [".kkkkk.", "kbBbBbk", "kkkkkkk", "kbBbBbk", "kbBbBbk", "kkkkkkk", "kbBbBbk", ".kkkkk."], pal: { k: K, b: "#6b4a2a", B: "#8a6238" } },
  crate: { rows: ["kkkkkkkk.....", "kBbBbBbk.....", "kbkbBkbk.....", "kBbkkbBkkkkkk", "kbkbBkbkbBbBk", "kkkkkkkkkbkbk", "........kBbBk", "........kkkkk"], pal: { k: K, b: "#7a5a32", B: "#9a7a48" } },
  bones: { rows: ["...w.....", "..wWw.w..", ".w.k.wWw.", "wWwwWw.w.", ".wWkWwWw.", "..wwWw..."], pal: { k: K, w: "#e8dcc0", W: "#b8ac90" } },
  candles: { rows: ["..y...y.", "..w.y.w.", "..w.w.w.", ".ww.w.ww", "kkkkkkkk"], pal: { k: K, w: "#e8dcc0", y: "#ffb347" }, glow: "rgba(255,180,80,0.18)" },
  banner: { rows: ["kkkkkk", "kPPPPk", "kPyyPk", "kPPPPk", "kPyyPk", "kPPPPk", "kP..Pk", "k....k", "n....n", "n....n"], pal: { k: K, P: "#6a3a8a", y: "#ffd23f", n: "#6b4a2a" } },
  rug: { rows: ["rrrrrrrrrrrr", "rRRRRRRRRRRr", "rRyRRyRRyRRr", "rRRRRRRRRRRr", "rrrrrrrrrrrr"], pal: { r: "#5a1a24", R: "#8c2a35", y: "#c9a23a" } },
  torch: { rows: [".y.", "yoy", ".o.", "kkk", ".n.", ".n.", ".n.", "kkk"], pal: { k: K, y: "#ffd23f", o: "#ff8a1f", n: "#6b4a2a" }, glow: "rgba(255,160,60,0.2)" },
  deadtree: { rows: ["n...n..n", ".n.n..n.", "..nn.n..", "...nn...", "...nn...", "...nn...", "..nNNn..", "kkkkkkkk"], pal: { k: K, n: "#4a3a2a", N: "#2e241a" } },
  statue: { rows: ["...yy...", "..yYYy..", "..yYYy..", ".yyYYyy.", "y.yYYy.y", "..yYYy..", "..y..y..", "..y..y..", "wwwwwwww", "WWWWWWWW"], pal: { y: "#e8c050", Y: "#fff0a0", w: "#e2dbd0", W: "#b8ae9e" }, glow: "rgba(255,215,106,0.15)" },
  crystal: { rows: ["...c....", "..cC..c.", "..cCc.cC", ".ccCc.cC", ".cCCccCC", "cccCcccC", "kkkkkkkk"], pal: { k: K, c: "#7ad8ff", C: "#e0f6ff" }, glow: "rgba(122,216,255,0.22)" },
  fountain: { rows: ["....bb....", "...bBBb...", "..wwwwww..", ".wbbbbbbw.", "wbBbBbBbbw", "wbbbbbbbbw", ".wwwwwwww.", "..WWWWWW.."], pal: { w: "#e2dbd0", W: "#b8ae9e", b: "#3a7ac0", B: "#9be0ff" }, glow: "rgba(150,210,255,0.12)" },
  throne: { rows: ["y.y..y.y", "yRyyyyRy", "yRRRRRRy", "yRRRRRRy", "yyyyyyyy", "yRRRRRRy", "y.y..y.y", "y.y..y.y"], pal: { y: "#e8c050", R: "#8c1a2a" }, glow: "rgba(255,215,106,0.12)" },
  brazier: { rows: [".yoOoy.", "yoyOyoy", "yyyyyyy", ".yYYYy.", "..yYy..", "..yYy..", ".yyyyy."], pal: { y: "#e8c050", Y: "#fff0a0", o: "#ff8a1f", O: "#ffd23f" }, glow: "rgba(255,190,90,0.25)" },
  orb: { rows: ["..bbbb..", ".bBCCBb.", "bBCCCCBb", "bBCCCCBb", ".bBBBBb.", "..bbbb..", "..y..y..", ".yyyyyy."], pal: { b: "#3a3aa0", B: "#8a8aff", C: "#e0e8ff", y: "#b08aff" }, glow: "rgba(140,160,255,0.25)" },
  kingskull: { rows: ["y.y.yy.y.y", "yyyyyyyyyy", ".wwwwwwww.", "wwkewwekww", "wwkkwwkkww", ".wwwkkwww.", "..wkwkwk..", "WWWWWWWWWW"], pal: { y: "#ffd23f", w: "#e8dcc0", k: K, e: "#ff3b6b", W: "#6a4f14" }, glow: "rgba(255,59,107,0.12)" },
  chest: { rows: [".yyyyyyyy.", "yBBBBBBBBy", "yBBByyBBBy", "yyyyyyyyyy", "yBBBkkBBBy", "yBBBBBBBBy", "yyyyyyyyyy"], pal: { y: "#e8c050", B: "#6a2a1a", k: K }, glow: "rgba(255,215,106,0.15)" },
};

export function drawDecor(g: CanvasRenderingContext2D, id: string, x: number, y: number, t: number, sel = false) {
  const d = DECOR[id];
  if (!d) return;
  const img = art("d:" + id, d.rows, d.pal);
  const flat = id === "rug";
  if (d.glow) { g.fillStyle = d.glow; g.beginPath(); g.arc(x, y - img.height / 2, 14 + Math.sin(t * 3 + x) * 1.5, 0, Math.PI * 2); g.fill(); }
  if (!flat) { g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(x, y, img.width / 2 + 1, 2, 0, 0, Math.PI * 2); g.fill(); }
  const bob = id === "orb" || id === "crystal" ? Math.round(Math.sin(t * 2 + x) * 1) : 0;
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(flat ? y - img.height / 2 : y - img.height) + bob);
  if (id === "candles" || id === "torch" || id === "brazier") {
    // flicker
    if (Math.random() < 0.3) { g.fillStyle = "#ffd23f"; g.fillRect(Math.round(x + (Math.random() - 0.5) * img.width * 0.6), Math.round(y - img.height - 1 - Math.random() * 3), 1, 1); }
  }
  if (sel) { g.strokeStyle = "#ffd23f"; g.lineWidth = 1; g.strokeRect(Math.round(x - img.width / 2) - 2.5, Math.round(y - img.height) - 2.5, img.width + 5, img.height + 5); }
}
export const DECOR_IDS = Object.keys(DECOR);
/** A small preview canvas for the decoration tray. */
export function decorIcon(id: string): HTMLCanvasElement | null { const d = DECOR[id]; return d ? art("d:" + id, d.rows, d.pal) : null; }

// ---------------------------------------------------------------- stations
const STATION: Record<string, { rows: string[]; pal: Pal }> = {
  blacksmith: { rows: ["....kkkk......", "...kOyOk......", "...kooOk.kkkk.", "...kkkkk.kaak.", "..........kk..", "kkkkkkkkkkkkk.", "kaAAAAAAAAak..", ".kkkaaakkkk...", "...kaaak......", "..kaaaaak.....", "..kkkkkkk....."], pal: { k: K, a: "#565b74", A: "#8d93ab", o: "#ff8a1f", O: "#ffd23f", y: "#fff0a0" } },
  stash: { rows: [".kkkkkkkkkk.", "kbBbBbBbBbBk", "kBkkkkkkkkBk", "kkkkkyykkkkk", "kbBbBkkBbBbk", "kBbBbBbBbBbk", "kbBbBbBbBbBk", "kkkkkkkkkkkk"], pal: { k: K, b: "#6b4a2a", B: "#8a6238", y: "#ffd23f" } },
  board: { rows: ["kkkkkkkkkkkkkk", "kWWWWWWWWWWWWk", "kWpppWwwwWpppk", "kWpwpWwppWpwpk", "kWpppWwwwWpppk", "kWWWWWWWWWWWWk", "kkkkkkkkkkkkkk", "..n........n..", "..n........n..", ".kkk......kkk."], pal: { k: K, W: "#8a6238", p: "#c9b8ff", w: "#e8dcc0", n: "#6b4a2a" } },
  shrine: { rows: ["....kk....", "...kZZk...", "..kZwwZk..", "...kZZk...", "....kk....", "...kwwk...", "..kwWWwk..", "..kwWWwk..", ".kwwWWwwk.", "kkkkkkkkkk"], pal: { k: K, Z: "#7ad8ff", w: "#9a96a8", W: "#c8c4d4" } },
  wardrobe: { rows: ["kkkkkkkkkk", "kbbbbkbbbk", "kbBBbkbBbk", "kbBBbkbBbk", "kbBBykyBbk", "kbBBbkbBbk", "kbBBbkbBbk", "kbbbbkbbbk", "kkkkkkkkkk", "k........k"], pal: { k: K, b: "#5a3f73", B: "#8a68a8", y: "#ffd23f" } },
  shop: { rows: ["yRyRyRyRyRyRy", "RyRyRyRyRyRyR", "k...........k", "k.....g.....k", "k....gGg....k", "kkkkkkkkkkkkk", "kbBbBbBbBbBbk", "kkkkkkkkkkkkk"], pal: { k: K, y: "#ffd23f", R: "#c4334a", g: "#e8c050", G: "#fff0a0", b: "#6b4a2a", B: "#8a6238" } },
  journey: { rows: ["..kkkkkkkk..", ".kyyyyyyyyk.", "kykyOOOOykyk", "kyk.yOOy.kyk", ".kk.yyyy.kk.", "....kyyk....", ".....kk.....", "....kyyk....", "...kkkkkk...", "..kWWWWWWk..", "..kWwwwwWk..", "..kkkkkkkk.."], pal: { k: K, y: "#ffd23f", O: "#fff0a0", W: "#8a7f66", w: "#c9bf9f" } },
  jeweler: { rows: ["....kk....", "...kcCk...", "..kcCCck..", "...kcck...", "....kk....", "kkkkkkkkkk", "kbBbBbBbBk", "kkkkkkkkkk", ".kb....bk.", ".kb....bk.", ".kk....kk."], pal: { k: K, c: "#5ad1a8", C: "#d8fff0", b: "#6b4a2a", B: "#8a6238" } },
  reliquary: { rows: ["...kkkk...", "..kyOOyk..", "..kOooOk..", "..kyOOyk..", "...kkkk...", "..kwwwwk..", ".kwWWWWwk.", ".kwWyyWwk.", ".kwWWWWwk.", "kkkkkkkkkk"], pal: { k: K, y: "#ffd23f", O: "#ff8a1f", o: "#fff0a0", w: "#9a96a8", W: "#c8c4d4" } },
  decorate: { rows: ["...kk....", "..kaak...", "..kaak...", "...kk....", "...nn....", "...nn.kk.", "...nnkyyk", "...nnkyyk", "..kkkkkk."], pal: { k: K, a: "#8d93ab", n: "#6b4a2a", y: "#7ad06a" } },
};

export function drawStation(g: CanvasRenderingContext2D, s: HideoutSpot, x: number, y: number, t: number, near: boolean) {
  const d = STATION[s.id];
  if (!d) return;
  const img = art("s:" + s.id, d.rows, d.pal);
  g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(x, y, img.width / 2 + 2, 3, 0, 0, Math.PI * 2); g.fill();
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height));
  if (s.id === "blacksmith" && Math.random() < 0.15) { g.fillStyle = Math.random() < 0.5 ? "#ffd23f" : "#ff8a1f"; g.fillRect(Math.round(x - 2 + Math.random() * 4), Math.round(y - img.height - Math.random() * 4), 1, 1); }
  label(g, s.name, x, y - img.height - 4, near ? "#ffd23f" : "#c9b8ff", near);
}

export function drawPortal(g: CanvasRenderingContext2D, s: HideoutSpot, x: number, y: number, t: number, near: boolean, sub: string) {
  const r = 11;
  g.save();
  g.globalAlpha = 0.35; g.fillStyle = s.glow!; g.beginPath(); g.ellipse(x, y, r + 6, (r + 6) * 0.5, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1; g.fillStyle = s.color!; g.beginPath(); g.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#0b0710"; g.beginPath(); g.ellipse(x, y, r * 0.55, r * 0.27, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 6; i++) {
    const a = t * 2.5 + (i * Math.PI) / 3, rr = r * (0.55 + 0.4 * ((t * 0.7 + i / 6) % 1));
    g.fillStyle = i % 2 ? s.glow! : "#fff"; g.fillRect(Math.round(x + Math.cos(a) * rr), Math.round(y + Math.sin(a) * rr * 0.5), 1, 1);
  }
  // rising sparks
  for (let i = 0; i < 4; i++) { const k = (t * 0.8 + i / 4) % 1; g.globalAlpha = 1 - k; g.fillStyle = s.glow!; g.fillRect(Math.round(x + Math.sin(i * 7 + t) * r * 0.7), Math.round(y - k * 22), 1, 1); }
  g.restore();
  label(g, s.name, x, y - 14, near ? "#ffd23f" : s.glow!, near);
  if (sub) label(g, sub, x, y + 11, "#b8a8d0", false, 7);
}

/** The Showcase: a lit plinth with the hideout owner's hero standing on it in their gear and looks. */
export function drawShowcase(g: CanvasRenderingContext2D, s: HideoutSpot, x: number, y: number, t: number, near: boolean, hero: (x: number, y: number) => number) {
  g.fillStyle = "rgba(255,215,106,0.12)"; g.beginPath(); g.ellipse(x, y - 2, 16, 7, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2e2838"; g.fillRect(Math.round(x - 9), Math.round(y - 4), 18, 5);
  g.fillStyle = "#c9a23a"; g.fillRect(Math.round(x - 9), Math.round(y - 4), 18, 1); g.fillRect(Math.round(x - 9), Math.round(y), 18, 1);
  const h = hero(x, y - 4);
  for (let i = 0; i < 3; i++) { const k = (t * 0.5 + i / 3) % 1; g.globalAlpha = 0.8 * (1 - k); g.fillStyle = "#ffe9a0"; g.fillRect(Math.round(x - 8 + i * 8), Math.round(y - 4 - k * 18), 1, 1); }
  g.globalAlpha = 1;
  label(g, s.name, x, y - h - 10, near ? "#ffd23f" : "#c9b8ff", near);
}

/** Station and portal names are queued in world units and drawn later at screen resolution, so they stay sharp. */
export const labels: { text: string; x: number; y: number; color: string; bold: boolean; size: number }[] = [];
function label(_g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, bold: boolean, size = 8) {
  labels.push({ text, x, y, color, bold, size });
}

// ---------------------------------------------------------------- premium theme extras
/** Floor-level extras drawn under everyone: the royal carpet and its gold trim, or the astral rune circle. */
export function drawThemeFloor(g: CanvasRenderingContext2D, m: TileMap, th: HideoutTheme, t: number) {
  const ts = m.ts, W = m.w * ts, H = m.h * ts;
  if (th.carpet) {
    const cw = 3 * ts, x0 = W / 2 - cw / 2;
    g.fillStyle = th.carpet; g.fillRect(x0, 3 * ts, cw, H - 6 * ts);
    g.fillStyle = th.trim!; g.fillRect(x0, 3 * ts, 2, H - 6 * ts); g.fillRect(x0 + cw - 2, 3 * ts, 2, H - 6 * ts);
    for (let y = 4 * ts; y < H - 3 * ts; y += ts) { g.fillRect(W / 2 - 2, y + 6, 4, 4); }
    // gold trim along the walls
    g.fillStyle = th.trim!;
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tiles[y * m.w + x] === 0 && m.tiles[(y - 1) * m.w + x] === 1) g.fillRect(x * ts, y * ts, ts, 1);
  }
  if (th.rune) {
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.22, pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
    g.save();
    g.strokeStyle = th.rune; g.globalAlpha = 0.35 + 0.35 * pulse; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(cx, cy, R, R * 0.6, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(cx, cy, R * 0.7, R * 0.42, 0, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 12; i++) {
      const a = t * 0.3 + (i * Math.PI) / 6;
      g.fillStyle = i % 3 ? th.rune : "#ffffff";
      g.fillRect(Math.round(cx + Math.cos(a) * R * 0.85) - 1, Math.round(cy + Math.sin(a) * R * 0.51) - 1, 2, 2);
    }
    const tri = (k: number) => { g.beginPath(); for (let i = 0; i <= 3; i++) { const a = k + t * 0.2 + (i * Math.PI * 2) / 3; const px = cx + Math.cos(a) * R * 0.7, py = cy + Math.sin(a) * R * 0.42; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.stroke(); };
    tri(0); tri(Math.PI);
    g.restore();
  }
}

/** Air-level extras drawn over everyone: light pools from the premium braziers, drifting motes, aurora. */
export function drawThemeAir(g: CanvasRenderingContext2D, m: TileMap, th: HideoutTheme, t: number) {
  if (!th.premium) return;
  const ts = m.ts, W = m.w * ts, H = m.h * ts;
  g.save();
  if (th.id === "gilded") {
    // braziers on gold pillars along the hall, with warm flickering light
    for (const fx of [0.12, 0.88]) for (const fy of [0.3, 0.55, 0.8]) {
      const x = Math.round(fx * W), y = Math.round(fy * H);
      g.globalAlpha = 0.12 + 0.05 * Math.sin(t * 9 + fx * 10 + fy * 7); g.fillStyle = th.light!;
      g.beginPath(); g.arc(x, y - 10, 30, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
      g.fillStyle = "#6a4f14"; g.fillRect(x - 2, y - 12, 4, 12);
      g.fillStyle = th.trim!; g.fillRect(x - 3, y - 14, 6, 3); g.fillRect(x - 3, y - 1, 6, 2);
      g.fillStyle = Math.sin(t * 13 + x) > 0 ? "#ffd23f" : "#ff8a1f"; g.fillRect(x - 2, y - 17, 4, 3); g.fillStyle = "#fff0a0"; g.fillRect(x - 1, y - 18, 2, 2);
    }
  }
  if (th.id === "astral") {
    // slow aurora bands across the top of the room
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = 0.08 + 0.04 * Math.sin(t * 0.7 + i);
      g.fillStyle = ["#7ad8ff", "#b08aff", "#7dffcf"][i];
      g.beginPath();
      g.moveTo(0, H * 0.15 + i * 10);
      for (let x = 0; x <= W; x += 16) g.lineTo(x, H * 0.15 + i * 10 + Math.sin(x * 0.03 + t * 0.6 + i) * 10);
      g.lineTo(W, H * 0.15 + i * 10 + 16); g.lineTo(0, H * 0.15 + i * 10 + 16); g.fill();
    }
    // floating crystals in the corners of the circle
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4, x = W / 2 + Math.cos(a) * W * 0.3, y = H / 2 + Math.sin(a) * H * 0.3 + Math.sin(t * 1.5 + i) * 3;
      g.globalAlpha = 0.25; g.fillStyle = th.light!; g.beginPath(); g.arc(x, y + 8, 6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1; g.fillStyle = "#7ad8ff"; g.fillRect(Math.round(x) - 2, Math.round(y) - 5, 4, 8); g.fillStyle = "#e0f6ff"; g.fillRect(Math.round(x) - 1, Math.round(y) - 4, 2, 5);
    }
  }
  // drifting motes
  const motes = th.motes ?? [];
  for (let i = 0; i < 60; i++) {
    const k = (t * (0.04 + (i % 7) * 0.006) + i * 0.137) % 1;
    const x = ((i * 97.3) % W) + Math.sin(t * 0.8 + i) * 6, y = H - k * H;
    g.globalAlpha = Math.sin(k * Math.PI) * 0.8;
    g.fillStyle = motes[i % motes.length]; g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.restore();
}

export { hideoutTheme };
export type { HideoutLayout };
