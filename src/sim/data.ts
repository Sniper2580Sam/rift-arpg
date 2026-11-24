import skillsJson from "../../data/skills.json";
import enemiesJson from "../../data/enemies.json";
import riftJson from "../../data/rift.json";
import affixesJson from "../../data/affixes.json";
import itemsJson from "../../data/items.json";
import legendariesJson from "../../data/legendaries.json";

export type Slot = "weapon" | "helm" | "chest" | "gloves" | "boots";
export type Rarity = "common" | "magic" | "rare" | "legendary";
export type Tag = "melee" | "physical" | "pierce" | "fire" | "projectile" | "dash" | "summon" | "explosion";

export interface SkillDef {
  id: string; name: string; slot: string; key: string; tags: Tag[]; desc: string;
  cooldown: number; damage: number;
  interval?: number; range?: number; arcCos?: number; knockback?: number;
  speed?: number; radius?: number; distance?: number; duration?: number;
  count?: number; attackInterval?: number;
}
export interface EnemyDef {
  name: string; hp: number; damage: number; speed: number; radius: number;
  attackRange: number; attackCooldown: number; windup: number; progress: number; dropChance: number;
  projectileSpeed?: number; slamRadius?: number; enrageAfter?: number; novaCount?: number; novaSpeed?: number; chargeSpeed?: number;
}
export interface AffixDef { id: string; text: string; min: number; max: number; slots: Slot[] }
export interface LegendaryDef { id: string; name: string; slot: Slot; tag: Tag; power: string; text: string; params: Record<string, number> }

export const SKILLS = skillsJson as SkillDef[];
export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillDef>;
export const ENEMIES = enemiesJson as Record<string, EnemyDef>;
export const RIFT = riftJson;
export const AFFIXES = affixesJson as AffixDef[];
export const AFFIX = Object.fromEntries(AFFIXES.map((a) => [a.id, a])) as Record<string, AffixDef>;
export const ITEMS = itemsJson as typeof itemsJson & { slots: Slot[] };
export const LEGENDARIES = legendariesJson as LegendaryDef[];
export const LEGENDARY = Object.fromEntries(LEGENDARIES.map((l) => [l.id, l])) as Record<string, LegendaryDef>;
