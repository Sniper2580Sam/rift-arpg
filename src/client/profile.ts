// Local profile for OFFLINE_TEST builds (live builds keep this on the backend). Versioned save schema with migrations.
import { AFFIX, CLASSES, CosChoice, EquipSlot, HideoutLayout, Life, RIFT, Rarity, lifeStats, paragonXp, xpForLevel } from "../sim/data";
import { Holder, Item, mintItem } from "../sim/items";
import { makeRng } from "../sim/rng";
import type { PlayerSetup, SimState } from "../sim/sim";

export const SAVE_KEY = "rift-arpg-save";
export const SAVE_VERSION = 2;

export interface CharSave {
  /** gear slot upgrades (+1..+5) */
  slotPlus?: Partial<Record<EquipSlot, number>>;
  /** masterwork crit affix per slot, and how many times each slot's crit was rolled */
  slotCrit?: Partial<Record<EquipSlot, string>>; slotCritRolls?: Partial<Record<EquipSlot, number>>;
  cls: string; level: number; xp: number;
  equipment: Holder["equipment"]; bag: Item[];
  runes: Record<string, string>; uses: Record<string, number>;
  loadout?: string[];
  highestTier: number; bestWave?: number; kings?: number; seraphs?: number;
  /** paragon levels after max level, XP toward the next, and points spent per stat */
  paragon?: number; pxp?: number; pAlloc?: Partial<Record<string, number>>; pityAnc: number; pityPri: number; sigils: number; feathers?: number;
  riftsCleared: number; bestTimes: Record<string, number>;
  /** arsenal: saved builds (equipped item ids, skill bar, runes) */
  builds?: (Build | null)[];
}
export interface Build { name: string; equipment: Partial<Record<EquipSlot, string>>; loadout: string[]; runes: Record<string, string> }
export const STASH_SIZE = 60;
export const BUILD_SLOTS = 5;
export interface Profile {
  version: number; active: string; chars: Record<string, CharSave>;
  materials: number; pet: string; filter: Rarity; cos: CosChoice;
  /** premium things this account owns (shop keys like "cos:armor:gilded"); free in the test build */
  owned?: string[];
  /** hideout theme and placed decorations */
  hideout?: HideoutLayout;
  /** Rift Shards (account-wide, like materials) */
  shards?: number;
  /** storage shared by every character */
  stash: Item[];
  season: { n: number; started: string }; unlockedPets: string[];
  /** feats (achievements) done, and the lifetime counters they read; both survive season resets */
  feats?: string[]; life?: Partial<Life>;
  weekly: { week: string; best: number };
  settings: { mute: boolean; shake: boolean; autoTier: boolean };
  /** ms timestamp of the last real change (used to pick the newer of the device and cloud copies) */
  savedAt?: number;
}

export function newChar(cls: string): CharSave {
  const starter = mintItem(makeRng(20261124 + cls.length), "starter-" + cls, { rarity: "common", slot: "weapon", ilvl: 1, cls });
  starter.name = cls === "gloomstalker" ? "Bone Bow" : cls === "stormcaller" ? "Ashwood Staff" : cls === "bonewright" ? "Bone Wrench" : "Iron Blade";
  return { cls, level: 1, xp: 0, equipment: { weapon: starter }, bag: [], runes: {}, uses: {}, highestTier: 1, pityAnc: 0, pityPri: 0, sigils: 0, riftsCleared: 0, bestTimes: {} };
}

export function newProfile(): Profile {
  return {
    version: SAVE_VERSION, active: "ashknight", chars: Object.fromEntries(Object.keys(CLASSES).map((c) => [c, newChar(c)])),
    materials: 0, pet: "none", filter: "common", cos: {}, stash: [], season: { n: 1, started: new Date().toISOString().slice(0, 10) }, unlockedPets: ["none", "bat", "slime", "fox"],
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
    // the old per-item + (merging) moves onto the slot the item is worn in
    for (const c of Object.values(p.chars)) {
      c.slotPlus ??= {};
      for (const [sl, it] of Object.entries(c.equipment)) if ((it as any)?.plus) c.slotPlus[sl as EquipSlot] = Math.max(c.slotPlus[sl as EquipSlot] ?? 0, (it as any).plus);
      for (const it of [...Object.values(c.equipment), ...c.bag]) if (it) { delete (it as any).plus; delete (it as any).charges; }
    }
    for (const it of p.stash ?? []) { delete (it as any).plus; delete (it as any).charges; }
    // cosmetics were all free before the shop: whatever you were wearing stays yours
    if (!p.owned) {
      p.owned = [];
      for (const [k, v] of Object.entries(p.cos ?? {})) if (typeof v === "string" && v !== "default" && v !== "none") p.owned.push(`cos:${k}:${v}`);
      for (const [sk, st] of Object.entries(p.cos?.fx ?? {})) p.owned.push(`fx:${sk}:${st}`);
    }
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
let localSaves = true;
/** The live build keeps the profile on the server, so nothing is written to this device. */
export function setLocalSaves(v: boolean) { localSaves = v; }
/** Called after every real change (the artifact page mirrors the save to the cloud). */
export let onSaved: ((p: Profile) => void) | null = null;
export function setOnSaved(f: ((p: Profile) => void) | null) { onSaved = f; }
export function saveProfile(p: Profile) {
  if (!localSaves) return;
  const s = JSON.stringify({ ...p, savedAt: 0 });
  if (s === lastSave) return;
  lastSave = s; p.savedAt = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(p)); } catch { /* private mode / storage blocked: the cloud copy still works */ }
  onSaved?.(p);
}
/** True when a profile has no progress worth keeping (a fresh install). */
export function isFresh(p: Profile) {
  return p.materials === 0 && Object.values(p.chars).every((c) => c.level <= 1 && c.xp === 0 && c.bag.length === 0 && c.riftsCleared === 0);
}

export const char = (p: Profile) => p.chars[p.active];
export function holderOf(p: Profile): Holder {
  const c = char(p);
  c.slotPlus ??= {}; c.slotCrit ??= {};
  return { equipment: c.equipment, bag: c.bag, slotPlus: c.slotPlus, slotCrit: c.slotCrit, get materials() { return p.materials; }, set materials(v: number) { p.materials = v; }, get shards() { return p.shards ?? 0; }, set shards(v: number) { p.shards = v; } } as Holder;
}

export function setupFor(p: Profile, pid = 0, name = "You"): PlayerSetup {
  const c = char(p);
  return { pid, name, cls: c.cls, level: c.level, xp: c.xp, equipment: c.equipment, bag: c.bag, materials: p.materials, shards: p.shards ?? 0, slotPlus: c.slotPlus ?? {}, slotCrit: c.slotCrit ?? {}, sigils: c.sigils, feathers: c.feathers ?? 0, runes: c.runes, pet: p.pet, filter: p.filter, loadout: c.loadout, cos: p.cos, paragon: c.paragon ?? 0, pxp: c.pxp ?? 0, pAlloc: c.pAlloc ?? {} };
}

/** Pull the player's persistent state back out of a running sim (items picked up, XP, levels). Boons are not kept. */
export function syncFromSim(p: Profile, s: SimState, pid = 0) {
  const me = s.players.find((q) => q.pid === pid);
  if (!me) return;
  const c = char(p);
  c.equipment = JSON.parse(JSON.stringify(me.equipment));
  c.bag = JSON.parse(JSON.stringify(me.bag));
  c.level = me.level; c.xp = me.xp; c.sigils = me.sigils; c.feathers = me.feathers; c.paragon = me.paragon; c.pxp = me.pxp;
  p.materials = me.materials; p.shards = me.shards ?? p.shards ?? 0;
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

export function xpProgress(c: CharSave) { return c.level >= RIFT.levels.max ? (c.pxp ?? 0) / paragonXp(c.paragon ?? 0) : c.xp / xpForLevel(c.level); }

/** Season reset: gear and levels reset, cosmetics and pets carry over. Old characters are kept in an archive. */
export function startNewSeason(p: Profile): Profile {
  const n = newProfile();
  n.season = { n: p.season.n + 1, started: new Date().toISOString().slice(0, 10) };
  n.unlockedPets = p.unlockedPets; n.pet = p.pet; n.cos = p.cos; n.settings = p.settings; n.filter = p.filter;
  // account-wide things carry over: purchases, the hideout, feats and the lifetime counters (baked from the old heroes)
  n.owned = p.owned; n.hideout = p.hideout; n.feats = p.feats; n.life = lifeStats(p);
  try { localStorage.setItem(`${SAVE_KEY}-season-${p.season.n}`, JSON.stringify(p)); } catch { /* ignore */ }
  return n;
}
