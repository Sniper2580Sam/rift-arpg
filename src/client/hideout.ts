// Hideout art, all drawn in code: stations, portals, decorations and the premium themes' live extras
// (carpet, rune circle, braziers' light, drifting motes). The room itself is the sim's map.
import { HIDEOUT, HideoutLayout, HideoutSpot, HideoutTheme, hideoutPads, hideoutTheme, spotTile } from "../sim/data";
import { TileMap, islandMask, nearestOpen } from "../sim/map";

/** A spot's position in pixels for the room's layout, nudged onto the nearest open floor (round rooms cut corners). */
export function spotPos(m: TileMap, th: HideoutTheme, s: HideoutSpot, layout?: string): [number, number] {
  const [tx, ty] = nearestOpen(m, ...spotTile(th, s, layout));
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
  bookshelf: { rows: ["kkkkkkkk", "knnnnnnk", "krbgyrbk", "krbgyrbk", "knnnnnnk", "kgyrbgyk", "kgyrbgyk", "knnnnnnk", "kkkkkkkk"], pal: { k: K, n: "#6b4a2a", r: "#8c2a35", b: "#3a5a9a", g: "#3d6b5a", y: "#c9a23a" } },
  weaponrack: { rows: [".A..A..A.", ".a..a..a.", ".a..a..a.", ".a..a..a.", "nnnnnnnnn", ".a..n..a.", ".n..n..n.", "nnnnnnnnn", "k.......k"], pal: { k: K, a: "#8d93ab", A: "#e0e4f0", n: "#6b4a2a" } },
  cauldron: { rows: ["..g.G.g..", ".gGgGgGg.", "kkkkkkkkk", "kaaaaaaak", "kaAaaaaak", ".kaaaaak.", "..kkkkk..", ".o.o.o.o."], pal: { k: K, g: "#7ad06a", G: "#c8ffb0", a: "#3a3f52", A: "#565b74", o: "#ff8a1f" }, glow: "rgba(122,208,106,0.16)" },
  lantern: { rows: ["..k..", ".kkk.", "kyYyk", "kYOYk", "kyYyk", ".kkk.", "..n..", "..n..", "..n..", ".nnn."], pal: { k: K, y: "#c9a23a", Y: "#ffd23f", O: "#fff0a0", n: "#3a3f52" }, glow: "rgba(255,200,90,0.2)" },
  dummy: { rows: ["..hhh..", "..hHh..", "nnnnnnn", ".hhhhh.", ".hHhHh.", ".hhhhh.", "...n...", "...n...", ".nnnnn."], pal: { h: "#c9a860", H: "#8a7040", n: "#6b4a2a" } },
  campfire: { rows: ["...o....", "..oYo.o.", ".oYOYoo.", ".oYYYYo.", "nNnNnNnN", ".nNnNnN."], pal: { o: "#ff8a1f", Y: "#ffd23f", O: "#fff0a0", n: "#6b4a2a", N: "#4a3a2a" }, glow: "rgba(255,150,60,0.25)" },
  mushrooms: { rows: [".rrr.....", "rRrRr.ss.", ".rrr.sSss", "..w...ww.", "..w...w..", "gggggggg."], pal: { r: "#c4334a", R: "#ffffff", s: "#8a68a8", S: "#e0c8ff", w: "#e8dcc0", g: "#4f7a3a" }, glow: "rgba(176,138,255,0.1)" },
  plant: { rows: ["g..g..g.", ".g.g.g..", "gGgGgGg.", ".gGgGg..", "..kkkk..", "..cCcc..", "..cccc..", "...cc..."], pal: { k: K, g: "#4f7a3a", G: "#7ad06a", c: "#a8603a", C: "#c8804a" } },
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
  if (id === "cauldron" && Math.random() < 0.08) { g.fillStyle = "#c8ffb0"; g.fillRect(Math.round(x - 3 + Math.random() * 6), Math.round(y - img.height - 1 - Math.random() * 5), 1, 1); }
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(flat ? y - img.height / 2 : y - img.height) + bob);
  if (id === "candles" || id === "torch" || id === "brazier" || id === "campfire" || id === "lantern") {
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
  difficulty: { rows: ["....kk....", "...kRRk...", "...kRrk...", "..kssssk..", "..ksRRsk..", "..kssssk..", "..ksRrsk..", "..kssssk..", ".kssssssk.", "kkkkkkkkkk"], pal: { k: K, s: "#4a4458", R: "#ff3b6b", r: "#ffb0c0" } },
  altar: { rows: ["....kk....", "...kOOk...", "..kOooOk..", "...kOOk...", "....kk....", "kkkkkkkkkk", "kpPPPPPPpk", "kpPyyyyPpk", ".kpPPPPpk.", ".kpppppk..", "kkkkkkkkk."], pal: { k: K, O: "#ff8a1f", o: "#ffd23f", p: "#4a3366", P: "#6a4a8a", y: "#c9a23a" } },
  starchart: { rows: ["..kkkkkkkk..", ".kbbbbbbbbk.", "kbbwbbbbybbk", "kbbbbwbbbbbk", "kbybbbbbwbbk", "kbbbbybbbbbk", "kbwbbbbbbybk", ".kbbbbbbbbk.", "..kkkkkkkk..", ".....kk.....", "....knnk....", "...kkkkkk..."], pal: { k: K, b: "#1e2a5a", w: "#e0e8ff", y: "#ffd23f", n: "#6b4a2a" } },
  reliquary: { rows: ["...kkkk...", "..kyOOyk..", "..kOooOk..", "..kyOOyk..", "...kkkk...", "..kwwwwk..", ".kwWWWWwk.", ".kwWyyWwk.", ".kwWWWWwk.", "kkkkkkkkkk"], pal: { k: K, y: "#ffd23f", O: "#ff8a1f", o: "#fff0a0", w: "#9a96a8", W: "#c8c4d4" } },
  decorate: { rows: ["...kk....", "..kaak...", "..kaak...", "...kk....", "...nn....", "...nn.kk.", "...nnkyyk", "...nnkyyk", "..kkkkkk."], pal: { k: K, a: "#8d93ab", n: "#6b4a2a", y: "#7ad06a" } },
};

export function drawStation(g: CanvasRenderingContext2D, s: HideoutSpot, x: number, y: number, t: number, near: boolean, sub = "") {
  const d = STATION[s.id];
  if (!d) return;
  const img = art("s:" + s.id, d.rows, d.pal);
  g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(x, y, img.width / 2 + 2, 3, 0, 0, Math.PI * 2); g.fill();
  g.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height));
  if (s.id === "blacksmith" && Math.random() < 0.15) { g.fillStyle = Math.random() < 0.5 ? "#ffd23f" : "#ff8a1f"; g.fillRect(Math.round(x - 2 + Math.random() * 4), Math.round(y - img.height - Math.random() * 4), 1, 1); }
  label(g, s.name, x, y - img.height - 4, near ? "#ffd23f" : "#c9b8ff", near);
  // unspent points: a gold note under the station, and a pulsing spark above it
  if (sub) { label(g, sub, x, y + 7, "#ffd23f", false, 7); if (Math.floor(t * 2) % 2) { g.fillStyle = "#ffd23f"; g.fillRect(Math.round(x), Math.round(y - img.height - 12), 1, 1); } }
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
// a tiny seeded random for fixed scenery (lava crust, clouds), so it doesn't jump between frames
const seeded = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const under = new Map<string, HTMLCanvasElement>();
function lavaBase(W: number, H: number): HTMLCanvasElement {
  const key = `lava${W}x${H}`;
  let c = under.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!, rnd = seeded(7);
  g.fillStyle = "#6a1806"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < (W * H) / 90; i++) { g.fillStyle = ["#7e2008", "#5a1204", "#962a0a", "#4a0e04"][Math.floor(rnd() * 4)]; g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), 2 + Math.floor(rnd() * 6), 1 + Math.floor(rnd() * 3)); }
  // bright molten veins, then drifting rafts of cooled crust (clumps of overlapping blobs) with glowing rims
  g.strokeStyle = "#ff8a1f"; g.lineWidth = 1;
  for (let i = 0; i < (W * H) / 2500; i++) {
    let x = rnd() * W, y = rnd() * H; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.3) * 18; y += (rnd() - 0.5) * 10; g.lineTo(x, y); }
    g.globalAlpha = 0.6; g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < (W * H) / 1800; i++) {
    const x = rnd() * W, y = rnd() * H, n = 2 + Math.floor(rnd() * 3), blobs: [number, number, number, number][] = [];
    for (let k = 0; k < n; k++) blobs.push([x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 6, 4 + rnd() * 7, 2 + rnd() * 4]);
    for (const [col, grow] of [["#ffb347", 1.5], ["#2a0a04", 0]] as [string, number][]) {
      g.fillStyle = col;
      for (const [bx, by, rx, ry] of blobs) { g.beginPath(); g.ellipse(bx, by, rx + grow, ry + grow, 0, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = "#4a1a0a"; for (const [bx, by, rx] of blobs) g.fillRect(Math.round(bx - rx / 2), Math.round(by - 1), Math.round(rx / 2), 1);
  }
  under.set(key, c); return c;
}
function skyBase(W: number, H: number): HTMLCanvasElement {
  const key = `sky${W}x${H}`;
  let c = under.get(key);
  if (c) return c;
  c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!, rnd = seeded(11);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, "#1c2450"); grd.addColorStop(0.45, "#4a4a8a"); grd.addColorStop(0.8, "#c87a8a"); grd.addColorStop(1, "#f0b080");
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) { g.fillStyle = rnd() < 0.3 ? "#ffffff" : "#c8d0ff"; g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H * 0.4), 1, 1); }
  // distant peaks far below
  for (const [base, col] of [[0.86, "#5a4a7a"], [0.95, "#3e3460"]] as [number, string][]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
    let x = 0; while (x <= W) { g.lineTo(x, H * base - rnd() * H * 0.12); x += 18 + rnd() * 30; g.lineTo(x, H * base + rnd() * 10); x += 18 + rnd() * 30; }
    g.lineTo(W, H); g.fill();
  }
  under.set(key, c); return c;
}
const islandCache = new Map<string, number[]>();
function islands(m: TileMap, th: HideoutTheme, layout?: string): number[] {
  const key = `${th.id}:${layout}:${m.w}x${m.h}`;
  let k = islandCache.get(key);
  if (!k) { k = islandMask(m.w, m.h, hideoutPads(th, layout)); islandCache.set(key, k); }
  return k;
}

/** Under the room, for open-air themes: the lava sea or the sky far below the peak. Drawn before the map. */
export function drawThemeUnder(g: CanvasRenderingContext2D, m: TileMap, th: HideoutTheme, t: number) {
  if (!th.map.open) return;
  const W = m.w * m.ts, H = m.h * m.ts;
  if (th.id === "lava") {
    // tiled past the room's edges too, so the lava sea reaches the horizon
    const base = lavaBase(W, H);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) g.drawImage(base, ox * W, oy * H);
    g.save();
    // slow bright currents and popping bubbles
    for (let i = 0; i < 10; i++) {
      const y = ((i * 53.7 + t * 5) % (H + 30)) - 15;
      g.globalAlpha = 0.18 + 0.1 * Math.sin(t * 1.3 + i); g.fillStyle = i % 2 ? "#ff8a1f" : "#ffd23f";
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x * 0.04 + t * 0.8 + i) * 4);
      g.lineTo(W, y + 3); for (let x = W; x >= 0; x -= 20) g.lineTo(x, y + 3 + Math.sin(x * 0.04 + t * 0.8 + i) * 4); g.fill();
    }
    for (let i = 0; i < 26; i++) {
      const k = (t * 0.6 + i * 0.37) % 1, x = (i * 131.7) % W, y = (i * 71.3) % H;
      g.globalAlpha = Math.sin(k * Math.PI); g.fillStyle = "#ffd23f";
      g.beginPath(); g.arc(x, y, 1 + k * 3, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#6a1806"; g.beginPath(); g.arc(x, y, k * 2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  } else {
    const base = skyBase(W, H);
    for (let ox = -1; ox <= 1; ox++) g.drawImage(base, ox * W, 0);
    g.fillStyle = "#3e3460"; g.fillRect(-W, H, W * 3, H);
    // a sea of cloud drifting past below the summit
    g.save();
    for (let i = 0; i < 16; i++) {
      const sp = 6 + (i % 4) * 3, x = ((i * 97 + t * sp) % (W + 160)) - 80, y = H * (0.25 + ((i * 0.137) % 0.75));
      g.globalAlpha = 0.35 + 0.15 * (i % 3) / 2; g.fillStyle = i % 3 ? "#f4f0ff" : "#ffd8c8";
      for (let j = 0; j < 4; j++) { g.beginPath(); g.ellipse(x + j * 14, y + Math.sin(j * 2 + i) * 3, 18 - j * 2, 6, 0, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }
}
/** Floor-level extras drawn under everyone: the royal carpet and its gold trim, the astral rune circle,
 *  the lava bastion's bridges and glowing pillar bases, or the manor's rugs. */
export function drawThemeFloor(g: CanvasRenderingContext2D, m: TileMap, th: HideoutTheme, t: number, layout?: string) {
  const ts = m.ts, W = m.w * ts, H = m.h * ts;
  if (th.id === "lava") {
    const isl = islands(m, th, layout);
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const i = y * m.w + x, px = x * ts, py = y * ts;
      if (m.tiles[i] === 0 && !isl[i]) {
        // bridge planks, laid across the direction of travel, with rope rails over the lava
        const hor = m.tiles[i - 1] === 0 || m.tiles[i + 1] === 0;
        const vert = m.tiles[i - m.w] === 0 || m.tiles[i + m.w] === 0;
        g.fillStyle = "#3a2414"; g.fillRect(px, py, ts, ts);
        g.fillStyle = "#7a5030";
        if (hor && !vert) for (let k = 0; k < ts; k += 4) g.fillRect(px + k, py + 1, 3, ts - 2);
        else for (let k = 0; k < ts; k += 4) g.fillRect(px + 1, py + k, ts - 2, 3);
        g.fillStyle = "#c9a060";
        if (m.tiles[i - m.w] !== 0) g.fillRect(px, py, ts, 1);
        if (m.tiles[i + m.w] !== 0) g.fillRect(px, py + ts - 1, ts, 1);
        if (m.tiles[i - 1] !== 0) g.fillRect(px, py, 1, ts);
        if (m.tiles[i + 1] !== 0) g.fillRect(px + ts - 1, py, 1, ts);
      } else if (m.tiles[i] !== 0 && m.tiles[i - m.w] === 0 && isl[i - m.w]) {
        // lava lapping at the foot of each pillar
        g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3 + x * 0.7); g.fillStyle = "#ffb347"; g.fillRect(px, py + 11, ts, 2);
        g.globalAlpha = 1;
      }
    }
  }
  if (th.id === "manor") {
    // a rug in every room, and gold trim along the walls
    const xs = [0, Math.round(m.w / 3), Math.round((2 * m.w) / 3), m.w - 1], ys = [0, Math.round(m.h / 2), m.h - 1];
    const cols = ["#5a1a3a", "#1a3a5a", "#3a1a5a", "#1a4a3a", "#5a3a1a", "#4a1a1a"];
    for (let ry = 0; ry < 2; ry++) for (let rx = 0; rx < 3; rx++) {
      const x0 = (xs[rx] + 3) * ts, x1 = (xs[rx + 1] - 2) * ts, y0 = (ys[ry] + 3) * ts, y1 = (ys[ry + 1] - 2) * ts;
      if (x1 - x0 < ts * 2 || y1 - y0 < ts * 2) continue;
      g.fillStyle = cols[ry * 3 + rx]; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.fillStyle = th.trim!; g.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, 1); g.fillRect(x0 + 2, y1 - 3, x1 - x0 - 4, 1); g.fillRect(x0 + 2, y0 + 2, 1, y1 - y0 - 4); g.fillRect(x1 - 3, y0 + 2, 1, y1 - y0 - 4);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      g.fillRect(cx - 4, cy, 9, 1); g.fillRect(cx, cy - 4, 1, 9);
    }
    g.fillStyle = th.trim!;
    for (let y = 1; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.tiles[y * m.w + x] === 0 && m.tiles[(y - 1) * m.w + x] === 1) g.fillRect(x * ts, y * ts, ts, 1);
  }
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
  if (th.id === "lava") {
    // heat shimmer and embers rising off the lava
    for (let i = 0; i < 50; i++) {
      const k = (t * (0.15 + (i % 5) * 0.03) + i * 0.173) % 1, x = (i * 89.1) % W + Math.sin(t * 2 + i) * 4, y = ((i * 57.3) % H) - k * 60;
      g.globalAlpha = Math.sin(k * Math.PI) * 0.9; g.fillStyle = i % 3 ? "#ff8a1f" : "#ffd23f"; g.fillRect(Math.round(x), Math.round(y), 1, i % 4 ? 1 : 2);
    }
    g.globalAlpha = 0.06 + 0.03 * Math.sin(t * 1.7); g.fillStyle = "#ff6a1f"; g.fillRect(0, 0, W, H);
  }
  if (th.id === "peak") {
    // snow blowing across the summit, and wind streaks
    for (let i = 0; i < 70; i++) {
      const k = (t * (0.08 + (i % 6) * 0.015) + i * 0.111) % 1, x = ((i * 61.7) % W) + k * 140 - 40, y = ((i * 37.9) % H) + k * 50;
      g.globalAlpha = Math.sin(k * Math.PI) * 0.9; g.fillStyle = "#ffffff"; g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    for (let i = 0; i < 5; i++) {
      const k = (t * 0.25 + i * 0.21) % 1, y = H * (0.15 + i * 0.17), x = -80 + k * (W + 160);
      g.globalAlpha = 0.25 * Math.sin(k * Math.PI); g.fillStyle = "#ffffff"; g.fillRect(Math.round(x), Math.round(y), 40, 1); g.fillRect(Math.round(x + 12), Math.round(y + 3), 24, 1);
    }
  }
  if (th.id === "manor") {
    // chandeliers: a warm pool of light in each room, and sconces along the walls
    const xs = [0, m.w / 3, (2 * m.w) / 3, m.w], ys = [0, m.h / 2, m.h];
    for (let ry = 0; ry < 2; ry++) for (let rx = 0; rx < 3; rx++) {
      const cx = ((xs[rx] + xs[rx + 1]) / 2) * ts, cy = ((ys[ry] + ys[ry + 1]) / 2) * ts;
      g.globalAlpha = 0.1 + 0.03 * Math.sin(t * 5 + rx + ry * 3); g.fillStyle = th.light!; g.beginPath(); g.ellipse(cx, cy, 60, 40, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.9; g.fillStyle = th.trim!;
      for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + t * 0.2; g.fillRect(Math.round(cx + Math.cos(a) * 8), Math.round(cy - 30 + Math.sin(a) * 3), 1, 2); }
      g.fillStyle = "#fff0a0"; for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2 + t * 0.2; if (Math.sin(t * 11 + k) > -0.6) g.fillRect(Math.round(cx + Math.cos(a) * 8), Math.round(cy - 32 + Math.sin(a) * 3), 1, 1); }
    }
    g.globalAlpha = 1;
    for (let y = 1; y < m.h; y++) for (let x = 2; x < m.w - 2; x += 4) if (m.tiles[y * m.w + x] === 0 && m.tiles[(y - 1) * m.w + x] === 1) {
      const px = x * ts + 8, py = y * ts - 6;
      g.globalAlpha = 0.14 + 0.05 * Math.sin(t * 9 + x); g.fillStyle = th.light!; g.beginPath(); g.arc(px, py, 14, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1; g.fillStyle = th.trim!; g.fillRect(px - 1, py, 3, 3); g.fillStyle = Math.sin(t * 13 + x) > 0 ? "#ffd23f" : "#ff8a1f"; g.fillRect(px, py - 2, 1, 2);
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
