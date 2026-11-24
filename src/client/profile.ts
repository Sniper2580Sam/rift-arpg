// Local profile for OFFLINE_TEST builds (live builds keep this on the backend). Versioned save schema with migrations.
import { AFFIX, CLASSES, EquipSlot, RIFT, Rarity, xpForLevel } from "../sim/data";
import { Holder, Item, mintItem } from "../sim/items";
import { makeRng } from "../sim/rng";
import type { PlayerSetup, SimState } from "../sim/sim";

export const SAVE_KEY = "rift-arpg-save";
export const SAVE_VERSION = 2;

export interface CharSave {
  cls: string; level: number; xp: number;
  equipment: Holder["equipment"]; bag: Item[];
  runes: Record<string, string>; uses: Record<string, number>;
  highestTier: number; pityAnc: number; pityPri: number; sigils: number;
  riftsCleared: number; bestTimes: Record<string, number>;
}
export interface Profile {
  version: number; active: string; chars: Record<string, CharSave>;
  materials: number; pet: string; filter: Rarity;
  season: { n: number; started: string }; unlockedPets: string[];
  weekly: { week: string; best: number };
  settings: { mute: boolean; shake: boolean; autoTier: boolean };
}

export function newChar(cls: string): CharSave {
  const starter = mintItem(makeRng(20261124 + cls.length), "starter-" + cls, { rarity: "common", slot: "weapon", ilvl: 1 });
  starter.name = cls === "gloomstalker" ? "Bone Bow" : "Iron Blade";
  return { cls, level: 1, xp: 0, equipment: { weapon: starter }, bag: [], runes: {}, uses: {}, highestTier: 1, pityAnc: 0, pityPri: 0, sigils: 0, riftsCleared: 0, bestTimes: {} };
}

export function newProfile(): Profile {
  return {
    version: SAVE_VERSION, active: "ashknight", chars: { ashknight: newChar("ashknight"), gloomstalker: newChar("gloomstalker") },
    materials: 0, pet: "none", filter: "common", season: { n: 1, started: new Date().toISOString().slice(0, 10) }, unlockedPets: ["none", "bat", "slime", "fox"],
    weekly: { week: "", best: 0 }, settings: { mute: false, shake: true, autoTier: false },
  };
}

function fixItem(it: any): Item {
  it.ilvl ??= 1;
  for (const a of it.affixes ?? []) { a.min ??= AFFIX[a.id]?.min ?? a.value; a.max ??= AFFIX[a.id]?.max ?? a.value; }
  return it as Item;
}

export function migrate(raw: any): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.version === 1) {
    const p = newProfile();
    const c = p.chars.ashknight;
    c.equipment = {};
    for (const [k, v] of Object.entries(raw.equipment ?? {})) c.equipment[k as EquipSlot] = fixItem(v);
    c.bag = (raw.bag ?? []).map(fixItem);
    c.riftsCleared = raw.riftsCleared ?? 0;
    if (raw.bestTime) c.bestTimes["1"] = raw.bestTime;
    p.materials = raw.materials ?? 0;
    return p;
  }
  if (raw.version === SAVE_VERSION) {
    const p = { ...newProfile(), ...raw } as Profile;
    for (const cls of Object.keys(CLASSES)) p.chars[cls] ??= newChar(cls);
    return p;
  }
  return null;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { const p = migrate(JSON.parse(raw)); if (p) return p; }
  } catch { /* private mode etc. */ }
  return newProfile();
}
let lastSave = "";
export function saveProfile(p: Profile) {
  try { const s = JSON.stringify(p); if (s !== lastSave) { localStorage.setItem(SAVE_KEY, s); lastSave = s; } } catch { /* ignore */ }
}

export const char = (p: Profile) => p.chars[p.active];
export function holderOf(p: Profile): Holder {
  const c = char(p);
  return { equipment: c.equipment, bag: c.bag, get materials() { return p.materials; }, set materials(v: number) { p.materials = v; } } as Holder;
}

export function setupFor(p: Profile, pid = 0, name = "You"): PlayerSetup {
  const c = char(p);
  return { pid, name, cls: c.cls, level: c.level, xp: c.xp, equipment: c.equipment, bag: c.bag, materials: p.materials, sigils: c.sigils, runes: c.runes, pet: p.pet, filter: p.filter };
}

/** Pull the player's persistent state back out of a running sim (items picked up, XP, levels). Boons are not kept. */
export function syncFromSim(p: Profile, s: SimState, pid = 0) {
  const me = s.players.find((q) => q.pid === pid);
  if (!me) return;
  const c = char(p);
  c.equipment = JSON.parse(JSON.stringify(me.equipment));
  c.bag = JSON.parse(JSON.stringify(me.bag));
  c.level = me.level; c.xp = me.xp; c.sigils = me.sigils;
  p.materials = me.materials;
  saveProfile(p);
}

export function isoWeek(d = new Date()): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((+t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, "0")}`;
}
export function weeklySeed(week: string) {
  let h = 2166136261;
  for (let i = 0; i < week.length; i++) { h ^= week.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const WEEKLY_TIER = 4;

export function xpProgress(c: CharSave) { return c.level >= RIFT.levels.max ? 1 : c.xp / xpForLevel(c.level); }

/** Season reset: gear and levels reset, cosmetics and pets carry over. Old characters are kept in an archive. */
export function startNewSeason(p: Profile): Profile {
  const n = newProfile();
  n.season = { n: p.season.n + 1, started: new Date().toISOString().slice(0, 10) };
  n.unlockedPets = p.unlockedPets; n.pet = p.pet; n.settings = p.settings; n.filter = p.filter;
  try { localStorage.setItem(`${SAVE_KEY}-season-${p.season.n}`, JSON.stringify(p)); } catch { /* ignore */ }
  return n;
}
