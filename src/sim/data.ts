import skillsJson from "../../data/skills.json";
import classesJson from "../../data/classes.json";
import enemiesJson from "../../data/enemies.json";
import riftJson from "../../data/rift.json";
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
export type CosKind = "armor" | "wings" | "weapon" | "petSkin";
export interface Cosmetic { id: string; name: string; [k: string]: string | number }
export const COSMETICS = cosmeticsJson as unknown as Record<CosKind, Cosmetic[]>;
export const COS_KINDS: CosKind[] = ["armor", "wings", "weapon", "petSkin"];
export type CosChoice = Partial<Record<CosKind, string>>;

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
