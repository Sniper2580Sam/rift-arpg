// All art is drawn in code: palette-indexed string arrays rendered once to offscreen canvases and cached.
import { COSMETICS, Rarity, SlotType as Slot } from "../sim/data";

export type Sprite = { img: HTMLCanvasElement; flash: HTMLCanvasElement; w: number; h: number };

const BASE: Record<string, string> = {
  k: "#140c1c", // outline
  A: "#8d93ab", a: "#565b74", // steel
  y: "#ffd23f", o: "#ff8a1f", O: "#ff5a1f", // ember glow
  R: "#8c2a35", r: "#c4473a", // tabard
  B: "#3b2d3a", b: "#5a4656", // boots / leather
  G: "#6f8f5a", g: "#4a6640", // ghoul
  e: "#ff3b3b", // red eyes
  w: "#f2ead3", W: "#c9bf9f", d: "#8a7f66", // bone
  n: "#7a4a2a", // wood
  P: "#6b4f7a", p: "#4a3456", q: "#9a7aa8", // brute
  V: "#2b1f3a", v: "#463559", // robe
  C: "#ffffff", c: "#999999", // item colour placeholders (recoloured per rarity)
  s: "#d9d4c8",
  H: "#2f5a3a", h: "#447a4f", // ranger cloak
  F: "#c8763a", f: "#8a4a22", // fox / leather
  L: "#7dd6c8", l: "#3e8f86", // slime
  M: "#5a3f73", m: "#8a68a8", // bat
  Z: "#9be0ff", // frost
  T: "#2c4a8a", t: "#4f7ad0", // storm robe
};

function make(rows: string[], pal: Record<string, string> = BASE): Sprite {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const img = document.createElement("canvas"); img.width = w; img.height = h;
  const flash = document.createElement("canvas"); flash.width = w; flash.height = h;
  const g = img.getContext("2d")!, f = flash.getContext("2d")!;
  f.fillStyle = "#ffffff";
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x];
    if (ch === "." || ch === " ") continue;
    g.fillStyle = pal[ch] ?? "#ff00ff";
    g.fillRect(x, y, 1, 1);
    f.fillRect(x, y, 1, 1);
  }
  return { img, flash, w, h };
}

const HERO_TOP = [
  "....kkkkk...",
  "...kAAAAAk..",
  "..kAAAAAAAk.",
  "..kAkkkkkAk.",
  "..kAkyykyAk.",
  "..kaAAAAAak.",
  "...kkoookk..",
  "..kRRrrrRRk.",
  ".kaRrrrrrRak",
  ".kaRRrrrRRak",
  "..kRRRRRRRk.",
  "..kkBkkkBkk.",
];
const HERO_LEGS = [
  ["...kBk.kBk..", "...kBk.kBk..", "..kBBk.kBBk.", "..kkkk.kkkk."],
  ["..kBk...kBk.", "..kBk...kBk.", ".kBBk..kBBk.", ".kkkk..kkkk."],
  ["....kBkBk...", "....kBkBk...", "...kBBkBBk..", "...kkkkkkk.."],
];

const GHOUL = [
  [
    "...kkkk...",
    "..kGGGGk..",
    ".kGeGGeGk.",
    ".kGGGGGGk.",
    "kGgkwkwgGk",
    ".kGGGGGGk.",
    "kGkgGGgkGk",
    "k.kgkkgk.k",
    "..kk..kk..",
  ],
  [
    "...kkkk...",
    "..kGGGGk..",
    ".kGeGGeGk.",
    ".kGGGGGGk.",
    "kGgkwkwgGk",
    ".kGGGGGGk.",
    ".kGgGGgGk.",
    ".kkgkkgkk.",
    ".kk....kk.",
  ],
];

const ARCHER = [
  [
    "...kkkk...",
    "..kwwwwk..",
    "..kwkwkk.n",
    "..kwwwwk.n",
    "...kddk..n",
    "..kwWWwk.n",
    ".kwkWWkwkn",
    "..kwWWwk.n",
    "...kWWk..n",
    "...kddk...",
    "...kwkwk..",
    "..kwk.kwk.",
    "..kk...kk.",
  ],
  [
    "...kkkk...",
    "..kwwwwk..",
    "..kwkwkk.n",
    "..kwwwwk.n",
    "...kddk..n",
    "..kwWWwk.n",
    ".kwkWWkwkn",
    "..kwWWwk.n",
    "...kWWk..n",
    "...kddk...",
    "...kwkwk..",
    "...kwkwk..",
    "...kk.kk..",
  ],
];

const BRUTE = [
  [
    "..kk........kk..",
    ".kqk.kkkkkk.kqk.",
    ".kqkkPPPPPPkkqk.",
    "..kPPPePPePPPk..",
    ".kPPPPPPPPPPPPk.",
    "kPPkwkwkwkwkPPPk",
    "kPpPPPPPPPPPPpPk",
    "kPpPPqqqqqqPPpPk",
    "kPpPqqqqqqqqPpPk",
    "kkpPqqqqqqqqPpkk",
    ".kkPPqqqqqqPPkk.",
    "..kPPPPPPPPPPk..",
    "..kpppk..kpppk..",
    "..kpppk..kpppk..",
    "..kkkkk..kkkkk..",
  ],
  [
    "..kk........kk..",
    ".kqk.kkkkkk.kqk.",
    ".kqkkPPPPPPkkqk.",
    "..kPPPePPePPPk..",
    ".kPPPPPPPPPPPPk.",
    "kPPkwkwkwkwkPPPk",
    "kPpPPPPPPPPPPpPk",
    "kPpPPqqqqqqPPpPk",
    "kPpPqqqqqqqqPpPk",
    "kkpPqqqqqqqqPpkk",
    ".kkPPqqqqqqPPkk.",
    "..kPPPPPPPPPPk..",
    "...kpppkkpppk...",
    "...kpppkkpppk...",
    "...kkkkkkkkkk...",
  ],
];

const GUARDIAN = [
  "......y..y..y..y.......",
  "......yk.yk.yk.yk......",
  ".....kykkykkykkyk......",
  "....kyyyyyyyyyyyyk.....",
  "....kkwwwwwwwwwwkk.....",
  "...kwwwwwwwwwwwwwwk....",
  "...kwwwwwwwwwwwwwwk....",
  "...kwwkkkwwwwkkkwwk....",
  "...kwkkeekwwkeekkwk....",
  "...kwkkeekwwkeekkwk....",
  "...kwwkkkwwwwkkkwwk....",
  "....kwwwwwkkwwwwwk.....",
  "....kWwkwkwkwkwkWk.....",
  ".....kWwkwkwkwkWk......",
  "..kkkkkkWWWWWWkkkkkk...",
  ".kvvvVVVkkkkkkVVVvvvk..",
  "kvvVVVVVVVwwVVVVVVVvvk.",
  "kvVVVVVVVwWWwVVVVVVVvk.",
  "kVVkVVVVVVwwVVVVVVkVVk.",
  "kVk.kVVVVVVVVVVVVk.kVk.",
  "kwk.kVVVVVVVVVVVVk.kwk.",
  ".k..kVVVVVVVVVVVVk..k..",
  "....kVVVvVVVVvVVVk.....",
  "...kVVVvVVVVVVvVVVk....",
  "...kVVvVVVkkVVVvVVk....",
  "...kkkkkkk..kkkkkkk....",
];

const IMP = [
  ["..y.y..", ".kyoyk.", "kooOook", "kokOkok", ".kOOOk.", "..kok..", "..k.k.."],
  ["...y...", ".kyoyk.", "kooOook", "kokOkok", ".kOOOk.", ".kok.k.", "..k...."],
];

const ICONS: Record<Slot, string[]> = {
  offhand: [
    ".kkkkkkkk.",
    "kCCCCCCCCk",
    "kCCcyycCCk",
    "kCCcyycCCk",
    "kCCCCCCCCk",
    ".kCCCCCCk.",
    ".kcCCCCck.",
    "..kccccK..",
    "...kkkk...",
    "..........",
  ],
  shoulders: [
    "..........",
    "..kkk.kkk.",
    ".kCCCkCCCk",
    "kCCcCkCcCC",
    "kCCCk.kCCC",
    "kcck...kcc",
    ".kk.....kk",
    "..........",
    "..........",
    "..........",
  ],
  bracers: [
    "..........",
    "...kkkkk..",
    "..kCCCCCk.",
    "..kcyycCk.",
    "..kCCCCCk.",
    "..kcyycCk.",
    "..kCCCCCk.",
    "...kkkkk..",
    "..........",
    "..........",
  ],
  belt: [
    "..........",
    "..........",
    "kkkkkkkkkk",
    "kCCCkykCCk",
    "kcccyCyccK",
    "kCCCkykCCk",
    "kkkkkkkkkk",
    "..........",
    "..........",
    "..........",
  ],
  pants: [
    ".kkkkkkkk.",
    ".kCCCCCCk.",
    ".kCCkkCCk.",
    ".kCCk.kCCk",
    ".kCCk.kCCk",
    ".kcCk.kCck",
    ".kcck.kcck",
    ".kkkk.kkkk",
    "..........",
    "..........",
  ],
  amulet: [
    "..k....k..",
    "...k..k...",
    "....kk....",
    "...kCCk...",
    "..kCyyCk..",
    "..kCyyCk..",
    "...kccK...",
    "....kk....",
    "..........",
    "..........",
  ],
  ring: [
    "..........",
    "....kk....",
    "...kyyk...",
    "..kCkkCk..",
    ".kC....Ck.",
    ".kC....Ck.",
    "..kc..ck..",
    "...kcck...",
    "....kk....",
    "..........",
  ],
  weapon: [
    "........kk",
    ".......kCk",
    "......kCck",
    ".....kCck.",
    "..k.kCck..",
    "..kkCck...",
    "...kck....",
    "..kkkkk...",
    ".knkk.....",
    "kkk.......",
  ],
  helm: [
    "...kkkk...",
    "..kCCCCk..",
    ".kCCCCCCk.",
    ".kCkkkkCk.",
    ".kCkyykCk.",
    ".kCCCCCCk.",
    ".kcCCCCck.",
    "..kccccK..",
    "...kkkk...",
    "..........",
  ],
  chest: [
    ".kk....kk.",
    "kCCkkkkCCk",
    "kCCCCCCCCk",
    ".kCCccCCk.",
    ".kCCccCCk.",
    ".kCCCCCCk.",
    ".kcCCCCck.",
    ".kccccccck",
    "..kkkkkkk.",
    "..........",
  ],
  gloves: [
    "..........",
    "..kkkk....",
    ".kCCCCk...",
    ".kCCCCCkk.",
    ".kCCCCCCCk",
    ".kCCCCkkk.",
    ".kccccck..",
    ".kccccck..",
    "..kkkkk...",
    "..........",
  ],
  boots: [
    "..........",
    "..kkkk....",
    "..kCCk....",
    "..kCCk....",
    "..kCCk....",
    "..kCCCkk..",
    ".kCCCCCCk.",
    ".kccccccck",
    ".kkkkkkkk.",
    "..........",
  ],
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: "#d8d8d8",
  magic: "#5b8cff",
  rare: "#ffd84a",
  legendary: "#ff8a1f",
  set: "#3ddc84",
  mythic: "#ff3b6b",
};
const RARITY_DARK: Record<Rarity, string> = { common: "#7d7d7d", magic: "#2f4ea8", rare: "#b38b16", legendary: "#b04a0a", set: "#1d7a46", mythic: "#8f1233" };

const RANGER_TOP = [
  "....kkkk....",
  "...kHHHHk...",
  "..kHhhhhHk..",
  "..kHkkkkHk..",
  "..kHksskHk..",
  "...kkkkkk.n.",
  "..kHHhhHHkn.",
  ".kbHhhhhHbn.",
  ".kbHHhhHHkn.",
  "..kHHHHHHk..",
  "..kkbkkbkk..",
];
const RANGER_LEGS = [
  ["...kbk.kbk..", "...kbk.kbk..", "..kbbk.kbbk.", "..kkkk.kkkk."],
  ["..kbk...kbk.", "..kbk...kbk.", ".kbbk..kbbk.", ".kkkk..kkkk."],
  ["....kbkbk...", "....kbkbk...", "...kbbkbbk..", "...kkkkkkk.."],
];
const MAGE_TOP = [
  ".....kk...Z.",
  "....kTk..kZk",
  "...kTtTk..n.",
  "..kTTTTTk.n.",
  ".kkkkkkkkkn.",
  "..kksskk..n.",
  "..kTttTk..n.",
  ".kTtTTtTk.n.",
  ".ksTttTsk.n.",
  "..kTTTTk..n.",
  "..kTTTTTk...",
];
const MAGE_LEGS = [
  ["..kTTTTTk...", "..kTTTTTTk..", "..kbk..kbk..", "..kkk..kkk.."],
  ["..kTTTTTk...", ".kTTTTTTk...", ".kbk...kbk..", ".kkk...kkk.."],
  ["..kTTTTTk...", "..kTTTTTk...", "...kbkkbk...", "...kkkkkk..."],
];
const RAVEN = [["k.....k", "kk...kk", ".kkkkk.", "..kek..", "...k..."], [".......", "kk...kk", "kkkkkkk", "..kek..", "...k..."]];
const PETS: Record<string, string[][]> = {
  bat: [["m.....m", "mM.k.Mm", ".MMMMM.", "..MeM..", "...M..."], [".......", "mM.k.Mm", "mMMMMMm", "..MeM..", "...M..."]],
  slime: [["..LLL..", ".LLLLL.", "LLkLkLL", "LLLLLLL", "lllllll"], ["...L...", ".LLLLL.", "LLkLkLL", "LLLLLLL", ".lllll."]],
  fox: [["k.....k.", "Fk...kF.", "FFFFFFk.", "FkFFkF..", ".FFFFFFF", "..F..F.f"], ["k.....k.", "Fk...kF.", "FFFFFFk.", "FkFFkF..", ".FFFFFFF", ".F....Ff"]],
};
// wings: the left wing, body side on the right; the pair is this plus its mirror. Two flap frames.
const WING: Record<string, string[][]> = {
  feather: [
    ["k........", "Uk.......", "UXk......", "UXXk.....", ".UXXkk...", ".UXXXXkk.", "..UxXXXXk", "..UxxxXk.", "...UxXk..", "....kk..."],
    [".........", ".........", ".........", "kk.......", "UXkk.....", "UXXXkk...", ".UXXXXkkk", ".UxxXXXXk", "..UxxxXk.", "...Uxxk..", "....kk..."],
  ],
  membrane: [
    ["k........", "kUk......", "kXXk.....", "kXxXk....", "kXxXXkk..", "kXxXxXXkk", "kXkXxXXXk", "k.kkXkXk.", "....k.k.."],
    [".........", ".........", "kk.......", "kUXk.....", "kXxXXk...", "kXxXxXXkk", "kXxXxXXXk", ".kkXkXkk.", "...k.k..."],
  ],
};
const WING_GAP = 4;
function wingPair(left: string[], gap: number): string[] {
  const h = left.length, w = Math.max(...left.map((r) => r.length));
  return left.map((r) => { const l = r.padEnd(w, "."); return l + ".".repeat(gap) + [...l].reverse().join(""); }).concat([]).slice(0, h);
}
const HERO_KEYS: Record<string, (c: Record<string, string>) => Record<string, string>> = {
  ashknight: (c) => ({ A: c.m, a: c.d, R: c.t2, r: c.t1 }),
  gloomstalker: (c) => ({ H: c.d, h: c.m, b: c.t2 }),
  stormcaller: (c) => ({ T: c.d, t: c.m }),
};
const PET_KEYS: Record<string, (c: Record<string, string>) => Record<string, string>> = {
  bat: (c) => ({ M: c.a, m: c.b, e: c.eye }),
  slime: (c) => ({ L: c.a, l: c.b }),
  fox: (c) => ({ F: c.a, f: c.b }),
};
const cosOf = (kind: "armor" | "wings" | "weapon" | "petSkin", id: string | undefined) => COSMETICS[kind].find((x) => x.id === id) as Record<string, any> | undefined;

const PYLON = ["..kk..", ".kwwk.", ".kwyk.", "kwwwwk", "kwyywk", "kwwwwk", "kWWWWk", "kkkkkk"];

export interface SpriteBank {
  hero: Sprite[]; ranger: Sprite[]; mage: Sprite[]; raven: Sprite[]; pets: Record<string, Sprite[]>; pylon: Sprite[];
  ghoul: Sprite[]; archer: Sprite[]; brute: Sprite[]; guardian: Sprite[]; imp: Sprite[];
  icon: (slot: Slot, rarity: Rarity) => Sprite;
  /** hero frames in an armour + weapon skin */
  heroSkin: (cls: string, armor?: string, weapon?: string) => Sprite[];
  /** wing pair frames (up, down), or null for none */
  wings: (id?: string) => Sprite[] | null;
  pet: (pet: string, skin?: string) => Sprite[] | null;
}

export function buildSprites(): SpriteBank {
  const hero = HERO_LEGS.map((legs) => make([...HERO_TOP, ...legs]));
  const iconCache = new Map<string, Sprite>();
  const skinCache = new Map<string, Sprite[] | null>();
  const cached = (key: string, f: () => Sprite[] | null) => { if (!skinCache.has(key)) skinCache.set(key, f()); return skinCache.get(key)!; };
  const heroRows = (cls: string) => (cls === "gloomstalker" ? RANGER_LEGS.map((l) => [...RANGER_TOP, ...l]) : cls === "stormcaller" ? MAGE_LEGS.map((l) => [...MAGE_TOP, ...l]) : HERO_LEGS.map((l) => [...HERO_TOP, ...l]));
  return {
    hero,
    ranger: RANGER_LEGS.map((legs) => make([...RANGER_TOP, ...legs])),
    mage: MAGE_LEGS.map((legs) => make([...MAGE_TOP, ...legs])),
    raven: RAVEN.map((r) => make(r)),
    pets: Object.fromEntries(Object.entries(PETS).map(([k, v]) => [k, v.map((r) => make(r))])),
    pylon: [make(PYLON)],
    ghoul: GHOUL.map((r) => make(r)),
    archer: ARCHER.map((r) => make(r)),
    brute: BRUTE.map((r) => make(r)),
    guardian: [make(GUARDIAN)],
    imp: IMP.map((r) => make(r)),
    heroSkin(cls, armor, weapon) {
      return cached(`h:${cls}:${armor}:${weapon}`, () => {
        const a = cosOf("armor", armor), w = cosOf("weapon", weapon);
        const pal = { ...BASE, ...(a?.m ? (HERO_KEYS[cls] ?? HERO_KEYS.ashknight)(a) : {}), ...(w?.wood ? { n: w.wood, Z: w.gem } : {}) };
        return heroRows(cls).map((r) => make(r, pal));
      })!;
    },
    wings(id) {
      return cached(`w:${id}`, () => {
        const c = cosOf("wings", id);
        if (!c?.shape) return null;
        return WING[c.shape].map((left) => make(wingPair(left, WING_GAP), { ...BASE, X: c.X, x: c.x, U: c.U }));
      });
    },
    pet(pet, skin) {
      return cached(`p:${pet}:${skin}`, () => {
        if (!PETS[pet]) return null;
        const c = cosOf("petSkin", skin);
        const pal = { ...BASE, ...(c?.a ? (PET_KEYS[pet]?.(c) ?? {}) : {}) };
        return PETS[pet].map((r) => make(r, pal));
      });
    },
    icon(slot, rarity) {
      const key = slot + rarity;
      let s = iconCache.get(key);
      if (!s) {
        s = make(ICONS[slot], { ...BASE, C: RARITY_COLOR[rarity], c: RARITY_DARK[rarity], K: "#140c1c" });
        iconCache.set(key, s);
      }
      return s;
    },
  };
}

/** Pre-renders the whole rift map (floor with noise, walls with a lit front face) to one canvas. */
export function renderMap(tiles: number[], w: number, h: number, ts: number, seed: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w * ts; c.height = h * ts;
  const g = c.getContext("2d")!;
  let rs = seed >>> 0;
  const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296; };
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 1 : tiles[y * w + x]);
  const floorCols = ["#2a2233", "#2e2538", "#272030"];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x * ts, py = y * ts;
    if (at(x, y) === 0) {
      g.fillStyle = floorCols[Math.floor(rnd() * 3)];
      g.fillRect(px, py, ts, ts);
      // cracks / pebbles / bones
      for (let i = 0; i < 3; i++) {
        g.fillStyle = rnd() < 0.5 ? "#342a40" : "#211a29";
        g.fillRect(px + Math.floor(rnd() * 14), py + Math.floor(rnd() * 14), 2, 1);
      }
      if (rnd() < 0.04) { g.fillStyle = "#8a7f66"; g.fillRect(px + 5, py + 8, 5, 1); g.fillRect(px + 4, py + 7, 1, 3); g.fillRect(px + 10, py + 7, 1, 3); }
      if (rnd() < 0.03) { g.fillStyle = "#3d6b5a"; g.fillRect(px + 3, py + 3, 1, 2); g.fillRect(px + 4, py + 2, 1, 2); }
      // shadow under walls above
      if (at(x, y - 1) === 1) { g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(px, py, ts, 4); }
    } else {
      g.fillStyle = "#0e0a14";
      g.fillRect(px, py, ts, ts);
      if (at(x, y + 1) === 0) {
        // front face (bricks)
        g.fillStyle = "#4a3b5a"; g.fillRect(px, py + 6, ts, 10);
        g.fillStyle = "#5c4a6e"; g.fillRect(px, py + 6, ts, 1);
        g.fillStyle = "#2f2540";
        g.fillRect(px, py + 10, ts, 1); g.fillRect(px, py + 15, ts, 1);
        const o = (x % 2) * 4;
        g.fillRect(px + o + 3, py + 6, 1, 4); g.fillRect(px + o + 11, py + 6, 1, 4);
        g.fillRect(px + o + 7, py + 11, 1, 4);
        g.fillStyle = "#1c1526"; g.fillRect(px, py, ts, 6);
        g.fillStyle = "#3a2e4a"; g.fillRect(px, py + 5, ts, 1);
      } else {
        g.fillStyle = "#1c1526";
        g.fillRect(px + 1, py + 1, ts - 2, ts - 2);
        if (rnd() < 0.3) { g.fillStyle = "#241b30"; g.fillRect(px + 4 + Math.floor(rnd() * 6), py + 4 + Math.floor(rnd() * 6), 3, 2); }
      }
    }
  }
  return c;
}
