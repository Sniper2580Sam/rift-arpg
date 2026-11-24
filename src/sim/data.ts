import skillsJson from "../../data/skills.json";
import classesJson from "../../data/classes.json";
import enemiesJson from "../../data/enemies.json";
import riftJson from "../../data/rift.json";
import vfxJson from "../../data/vfx.json";
import hideoutJson from "../../data/hideout.json";
import guardiansJson from "../../data/guardians.json";
import mapsJson from "../../data/maps.json";
import affixesJson from "../../data/affixes.json";
import itemsJson from "../../data/items.json";
import legendariesJson from "../../data/legendaries.json";
import mythicsJson from "../../data/mythics.json";
import setsJson from "../../data/sets.json";
import elitesJson from "../../data/elites.json";
import modifiersJson from "../../data/modifiers.json";
import boonsJson from "../../data/boons.json";
import petsJson from "../../data/pets.json";
import cosmeticsJson from "../../data/cosmetics.json";

export type SlotType = "weapon" | "offhand" | "helm" | "shoulders" | "chest" | "bracers" | "gloves" | "belt" | "pants" | "boots" | "amulet" | "ring";
export type EquipSlot = Exclude<SlotType, "ring"> | "ring1" | "ring2";
export type Rarity = "common" | "magic" | "rare" | "legendary" | "set" | "mythic";
export type Tag = string;
export type Num = Record<string, number>;

export interface ModDef { tag?: string; skill?: string; set?: Num; add?: Num; mul?: Num; addTags?: string[]; player?: boolean; text?: string }
export interface RuneDef { id: string; name: string; uses: number; desc: string; set?: Num; add?: Num; mul?: Num; addTags?: string[]; removeTags?: string[] }
export type SkillType = "generator" | "core" | "support" | "ultimate";
export interface SkillDef { id: string; name: string; kind: string; slot: string; type: SkillType; unlock: number; tags: string[]; desc: string; p: Num; runes: RuneDef[] }
export interface ClassDef { name: string; role: string; desc: string; baseHp: number; hpPerLevel: number; speed: number; fists: [number, number]; skills: string[]; loadout: string[]; resource: ResourceDef }
export interface ResourceDef { id: string; name: string; max: number; start: number; regen: number; decayAfter: number; decay: number; onHurt: number; color: string }
export interface EnemyDef {
  name: string; hp: number; damage: number; speed: number; radius: number; xp: number;
  attackRange: number; attackCooldown: number; windup: number; progress: number; dropChance: number;
  projectileSpeed?: number; slamRadius?: number; enrageAfter?: number; novaSpeed?: number; chargeSpeed?: number;
}
export interface AffixDef { id: string; text: string; min: number; max: number; slots: SlotType[]; flat?: boolean }
export interface LegendaryDef extends ModDef { id: string; name: string; slot: SlotType; tag: string; text: string; scales?: string[]; pct?: string[]; mythic?: boolean }
export interface SetDef { id: string; name: string; tag: string; skill: string; color: string; pieces: Partial<Record<SlotType, string>>; bonuses: Record<string, ModDef & { text: string }> }
export interface ModifierDef { id: string; name: string; desc: string; packMult?: number; enemySpeed?: number; enemyHp?: number; dropMult?: number; playerDmg?: number; playerTaken?: number; eliteMult?: number; dark?: boolean; xpMult?: number }
export interface BoonDef { id: string; name: string; desc: string; stats?: Num; mod?: ModDef }

export const SKILLS = skillsJson as unknown as SkillDef[];
export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillDef>;
export const CLASSES = classesJson as unknown as Record<string, ClassDef>;
export const ENEMIES = enemiesJson as unknown as Record<string, EnemyDef>;
export const RIFT = riftJson;
/** Tiers a clear unlocks: fast clears skip ahead (under 3 min: +3, under 5 min: +2, in time: +1). */
export function tierJump(time: number): number {
  for (const [secs, n] of (RIFT as any).tierJumps as [number, number][]) if (time < secs) return n;
  return 1;
}
export interface MapTheme { floor: string[]; speck: string[]; wallTop: string; wallFace: string; wallLight: string; wallLine: string; void: string; deco: string; pattern?: string }
export interface MapDef {
  id: string; name: string; layout: "cave" | "linear" | "open" | "rooms" | "ring" | "arena"; w: number; h: number; weight: number; desc: string; egg?: boolean;
  packMult?: number; dropMult?: number; legendaryWeightMult?: number; density?: [number, number]; enemyCap?: number; theme: MapTheme;
}
export const MAPS = mapsJson as MapDef[];
export const MAP: Record<string, MapDef> = Object.fromEntries(MAPS.map((m) => [m.id, m]));
export const AFFIXES = affixesJson as unknown as AffixDef[];
export const AFFIX = Object.fromEntries(AFFIXES.map((a) => [a.id, a])) as Record<string, AffixDef>;
export const ITEMS = itemsJson as typeof itemsJson & { slots: SlotType[]; equipSlots: EquipSlot[] };
export const LEGENDARIES = legendariesJson as unknown as LegendaryDef[];
export const MYTHICS = (mythicsJson as unknown as LegendaryDef[]).map((m) => ({ ...m, mythic: true }));
export const LEGENDARY = Object.fromEntries([...LEGENDARIES, ...MYTHICS].map((l) => [l.id, l])) as Record<string, LegendaryDef>;
export const SETS = setsJson as unknown as SetDef[];
export const SET = Object.fromEntries(SETS.map((s) => [s.id, s])) as Record<string, SetDef>;
export const ELITES = elitesJson;
export const MODIFIERS = modifiersJson as unknown as ModifierDef[];
export const MODIFIER = Object.fromEntries(MODIFIERS.map((m) => [m.id, m])) as Record<string, ModifierDef>;
export const BOONS = boonsJson as unknown as BoonDef[];
export const BOON = Object.fromEntries(BOONS.map((b) => [b.id, b])) as Record<string, BoonDef>;
export const PETS = petsJson as unknown as { id: string; name: string; desc?: string }[];
/** Visual-only cosmetics. Each entry carries its own colours; the client draws them. */
export type CosKind = "armor" | "wings" | "weapon" | "petSkin" | "dye";
export interface Cosmetic { id: string; name: string; [k: string]: string | number }
export const COSMETICS = cosmeticsJson as unknown as Record<CosKind, Cosmetic[]>;
export const COS_KINDS: CosKind[] = ["armor", "wings", "weapon", "petSkin", "dye"];

// ------------------------------------------------------------------ ownership (shop, earnables)
/** What the unlock rules need from a profile: owned premium keys and per-character progress. */
export interface UnlockCtx { owned?: string[]; chars: Record<string, { highestTier: number; bestWave?: number; kings?: number }> }
export interface Earn { tier?: number; wave?: number; king?: number }
export const earnText = (e: Earn) => e.tier ? `Clear tier ${e.tier}` : e.wave ? `Reach Endless wave ${e.wave}` : e.king ? "Slay the Ossuary King" : "";
export function earned(p: UnlockCtx, e: Earn): boolean {
  const cs = Object.values(p.chars ?? {});
  if (e.tier && !cs.some((c) => c.highestTier > e.tier!)) return false;
  if (e.wave && !cs.some((c) => (c.bestWave ?? 0) >= e.wave!)) return false;
  if (e.king && !cs.some((c) => (c.kings ?? 0) >= e.king!)) return false;
  return true;
}
/** Every premium thing has a shop key: "cos:armor:gilded", "fx:cleave:voidfire", "theme:gilded", "decor:statue". */
export type Access = { ok: true } | { ok: false; why: "premium" | "earn" | "class"; text: string };
export function cosAccess(p: UnlockCtx, kind: CosKind, id: string, cls?: string): Access {
  const c = COSMETICS[kind]?.find((x) => x.id === id) as unknown as { unlock?: string; earn?: Earn; cls?: string } | undefined;
  if (!c) return { ok: false, why: "premium", text: "unknown" };
  if (c.cls && cls && c.cls !== cls) return { ok: false, why: "class", text: `${CLASSES[c.cls]?.name ?? c.cls} only` };
  if (c.unlock === "free") return { ok: true };
  if (c.unlock === "earn") return earned(p, c.earn ?? {}) ? { ok: true } : { ok: false, why: "earn", text: earnText(c.earn ?? {}) };
  return (p.owned ?? []).includes(`cos:${kind}:${id}`) ? { ok: true } : { ok: false, why: "premium", text: "Premium · in the Shop" };
}
export const ownsKey = (p: UnlockCtx, key: string) => (p.owned ?? []).includes(key);
/** All premium shop keys, with a display name and section. Prices are 0 in the test build. */
export function shopCatalogue(): { key: string; section: string; name: string; desc: string; price: number; cls?: string }[] {
  const out: { key: string; section: string; name: string; desc: string; price: number; cls?: string }[] = [];
  const sec: Record<string, string> = { armor: "Armour", wings: "Wings", weapon: "Weapons", petSkin: "Pet skins", dye: "Dyes" };
  for (const k of COS_KINDS) for (const c of COSMETICS[k]) if ((c as any).unlock === "premium") out.push({ key: `cos:${k}:${c.id}`, section: sec[k], name: String(c.name), desc: String(c.desc ?? ""), price: 0, cls: (c as any).cls });
  for (const t of HIDEOUT.themes) if (t.premium) out.push({ key: `theme:${t.id}`, section: "Hideout themes", name: t.name, desc: t.desc, price: 0 });
  for (const d of HIDEOUT.decor) if (d.premium) out.push({ key: `decor:${d.id}`, section: "Hideout decor", name: d.name, desc: "", price: 0 });
  for (const [skill, styles] of Object.entries(VFX.perSkill)) for (const st of styles) out.push({ key: `fx:${skill}:${st}`, section: "Skill effects", name: `${VFX.styles[st].name} ${SKILL[skill]?.name ?? skill}`, desc: "", price: 0, cls: Object.keys(CLASSES).find((c) => CLASSES[c].skills.includes(skill)) });
  return out;
}
export type CosChoice = Partial<Record<CosKind, string>> & { fx?: Record<string, string> };
/** Premium skill effects: a style re-colours one skill's projectiles, casts, blasts and trails. Visual only. */
export interface VfxStyle { name: string; main: string; accent: string; core: string; trail: string }
export interface HideoutTheme { id: string; name: string; premium: boolean; w: number; h: number; shape: "rect" | "rough" | "hall" | "round"; desc: string; pattern?: string; carpet?: string; trim?: string; light?: string; rune?: string; motes?: string[]; map: MapTheme }
export interface HideoutSpot { id: string; name: string; fx: number; fy: number; tab?: string; desc?: string; kind?: string; color?: string; glow?: string }
/** A player's hideout: theme and placed decorations (tile coordinates). Visual only. */
export interface HideoutLayout { theme: string; decor: { id: string; x: number; y: number }[] }
export const HIDEOUT = hideoutJson as unknown as { maxDecor: number; stations: HideoutSpot[]; portals: HideoutSpot[]; themes: HideoutTheme[]; decor: { id: string; name: string; premium: boolean }[] };
export const hideoutTheme = (id?: string) => HIDEOUT.themes.find((t) => t.id === id) ?? HIDEOUT.themes[0];
/** Where a station or portal sits in a theme's room, in tiles. */
export const spotTile = (th: HideoutTheme, s: HideoutSpot): [number, number] => [Math.round(s.fx * (th.w - 1)), Math.round(s.fy * (th.h - 1))];
export const VFX = vfxJson as { styles: Record<string, VfxStyle>; perSkill: Record<string, string[]> };

export const RARITY_ORDER: Rarity[] = ["common", "magic", "rare", "legendary", "set", "mythic"];
export const slotTypeOf = (e: EquipSlot): SlotType => (e === "ring1" || e === "ring2" ? "ring" : e);

export function xpForLevel(l: number): number { return Math.round(RIFT.levels.xpBase * Math.pow(l, RIFT.levels.xpExp)); }
export function levelPower(l: number): number { return 1 + RIFT.levels.powerPerLevel * (l - 1); }

export const LOADOUT_SIZE = 4;
/** 4 distinct class skills, at most one ultimate; anything invalid falls back to the class default. */
export function validLoadout(cls: string, want: string[] | undefined): string[] {
  const C = CLASSES[cls], out: string[] = [];
  for (const id of want ?? []) {
    if (out.length >= LOADOUT_SIZE || !C.skills.includes(id) || out.includes(id)) continue;
    if (SKILL[id].type === "ultimate" && out.some((x) => SKILL[x].type === "ultimate")) continue;
    out.push(id);
  }
  for (const id of C.loadout) if (out.length < LOADOUT_SIZE && !out.includes(id)) out.push(id);
  return out;
}

/** Smart loot: how much a class wants gear for a tag. 1 = its skills have it, 0.35 = only a rune adds it, 0.05 = no use. */
const affinityCache: Record<string, Record<string, number>> = {};
export function classAffinity(cls: string, tag: string | undefined): number {
  if (!tag || tag === "any" || !CLASSES[cls]) return 1;
  let a = affinityCache[cls];
  if (!a) {
    a = affinityCache[cls] = {};
    for (const id of CLASSES[cls].skills) {
      const d = SKILL[id];
      for (const r of d.runes) for (const t of r.addTags ?? []) a[t] = Math.max(a[t] ?? 0, 0.35);
      for (const t of d.tags) a[t] = 1;
    }
  }
  return a[tag] ?? 0.05;
}

/** Rift guardians: one per rift, picked from the seed. Multipliers apply to the base guardian. */
export interface GuardianDef { id: string; name: string; sub: string; weight: number; minTier: number; hp: number; dmg: number; speed: number; scale: number; kite?: number; pattern: string[]; adds: string[]; pal: Record<string, string>; tip: string }
export const GUARDIANS = (guardiansJson as unknown as { list: GuardianDef[] }).list;
export const guardianDef = (id?: string) => GUARDIANS.find((g) => g.id === id) ?? GUARDIANS[0];
