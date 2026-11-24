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
import achievementsJson from "../../data/achievements.json";
import seasonJson from "../../data/season.json";
import gemsJson from "../../data/gems.json";
import talentsJson from "../../data/talents.json";
import shopJson from "../../data/shop.json";

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
  blastRadius?: number; blastDelay?: number; chargeTime?: number; shieldBlock?: number;
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
type CharProgress = { level?: number; highestTier: number; bestWave?: number; kings?: number; seraphs?: number; paragon?: number };
export interface UnlockCtx { owned?: string[]; chars: Record<string, CharProgress>; feats?: string[]; life?: Partial<Life> }

// ------------------------------------------------------------------ achievements (feats)
/** Account-wide lifetime counters. They survive season resets. */
export interface Life { bounties: number; rifts: number; tier: number; level: number; legendaries: number; kills: number; elites: number; flawless: number; kings: number; seraphs: number; wave: number; mythics: number; ancestrals: number; paragon: number; maxed: number; party6: number }
export type LifeStat = keyof Life;
export interface Achievement { id: string; name: string; desc: string; stat: LifeStat; goal: number; reward?: string; /** premium currency given once */ aether?: number }
export const ACHIEVEMENTS = achievementsJson as Achievement[];
/** The counters an achievement reads: what's stored, topped up from the current heroes (so old saves count). */
export function lifeStats(p: UnlockCtx): Life {
  const L = p.life ?? {}, cs = Object.values(p.chars ?? {});
  const max = (f: (c: CharProgress) => number) => cs.reduce((m, c) => Math.max(m, f(c)), 0);
  const sum = (f: (c: CharProgress) => number) => cs.reduce((m, c) => m + f(c), 0);
  return {
    bounties: L.bounties ?? 0, rifts: L.rifts ?? 0, legendaries: L.legendaries ?? 0, kills: L.kills ?? 0, elites: L.elites ?? 0, flawless: L.flawless ?? 0, mythics: L.mythics ?? 0, ancestrals: L.ancestrals ?? 0, party6: L.party6 ?? 0,
    tier: Math.max(L.tier ?? 0, max((c) => c.highestTier - 1)),
    wave: Math.max(L.wave ?? 0, max((c) => c.bestWave ?? 0)),
    level: Math.max(L.level ?? 0, max((c) => c.level ?? 0)),
    kings: Math.max(L.kings ?? 0, sum((c) => c.kings ?? 0)),
    seraphs: Math.max(L.seraphs ?? 0, sum((c) => c.seraphs ?? 0)),
    paragon: Math.max(L.paragon ?? 0, max((c) => c.paragon ?? 0)),
    maxed: Math.max(L.maxed ?? 0, cs.filter((c) => (c.level ?? 0) >= RIFT.levels.max).length),
  };
}
// ------------------------------------------------------------------ rift gems
export interface GemDef { id: string; name: string; color: string; text: string; a: [number, number]; b?: [number, number] }
export const GEMS = gemsJson as { slots: number; maxLevel: number; fromTier: number; dropChance: number; levelCapPerTier: number; gems: GemDef[] };
export const GEM: Record<string, GemDef> = Object.fromEntries(GEMS.gems.map((g) => [g.id, g]));
/** A gem's two values at a level (level 1 = base). */
export function gemVals(id: string, level: number): [number, number] {
  const g = GEM[id]; if (!g) return [0, 0];
  const v = (x?: [number, number]) => (x ? +(x[0] + x[1] * (level - 1)).toFixed(2) : 0);
  return [v(g.a), v(g.b)];
}
export const gemText = (id: string, level: number) => { const [a, b] = gemVals(id, level); return GEM[id]?.text.replace("{a}", String(a)).replace("{b}", String(b)) ?? ""; };
// ------------------------------------------------------------------ talents (points from Trials)
export interface TalentNode { id: string; name: string; max: number; stat: string; per: number; text: string }
export interface TalentBranch { name: string; color: string; nodes: TalentNode[] }
export const TALENTS = talentsJson as { gate: number; note: string; classes: Record<string, TalentBranch[]> };
/** The Trial level you face next: one past your best, up to the cap. */
export const nextTrial = (best: number | undefined) => Math.min(RIFT.trial.maxLevel, (best ?? 0) + 1);
export const talentSpent = (a: Record<string, number> | undefined) => Object.values(a ?? {}).reduce((x, y) => x + y, 0);
/** One point per Trial level cleared in time. */
export const talentPoints = (trialBest: number | undefined) => Math.max(0, Math.min(RIFT.trial.maxLevel, trialBest ?? 0));
/** Can one more rank go into this node? Rows open at 0, 3, 6, 9 points spent in that branch. */
export function talentCanAdd(cls: string, a: Record<string, number>, id: string, points: number): boolean {
  for (const b of TALENTS.classes[cls] ?? []) {
    const j = b.nodes.findIndex((n) => n.id === id);
    if (j < 0) continue;
    const inBranch = b.nodes.reduce((x, n) => x + (a[n.id] ?? 0), 0);
    return (a[id] ?? 0) < b.nodes[j].max && inBranch >= j * TALENTS.gate && talentSpent(a) < points;
  }
  return false;
}
/** Can a rank come out of this node without stranding a higher row of its branch? */
export function talentCanRemove(cls: string, a: Record<string, number>, id: string): boolean {
  if (!(a[id] > 0)) return false;
  for (const b of TALENTS.classes[cls] ?? []) {
    if (!b.nodes.some((n) => n.id === id)) continue;
    const b2 = { ...a, [id]: a[id] - 1 };
    let run = 0;
    for (let j = 0; j < b.nodes.length; j++) { if ((b2[b.nodes[j].id] ?? 0) > 0 && run < j * TALENTS.gate) return false; run += b2[b.nodes[j].id] ?? 0; }
    return true;
  }
  return false;
}
/** Talent totals by stat key for a class (ranks outside the tree are ignored). */
export function talentStats(cls: string, a: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of TALENTS.classes[cls] ?? []) for (const n of b.nodes) { const r = Math.min(n.max, a?.[n.id] ?? 0); if (r) out[n.stat] = (out[n.stat] ?? 0) + r * n.per; }
  return out;
}

/** The highest level a gem can reach from a timed clear of this tier. */
export const gemCap = (tier: number) => Math.min(GEMS.maxLevel, tier * GEMS.levelCapPerTier);

// ------------------------------------------------------------------ season journey
export interface JourneyTask { stat: LifeStat; goal: number; desc: string }
export interface JourneyChapter { name: string; tasks: JourneyTask[]; reward?: string }
export const SEASON_JOURNEY = seasonJson as { id: string; name: string; desc: string; chapters: JourneyChapter[] };
/** A chapter's done key, kept in the feats list so its reward outlives the season. Chapters count from 1. */
export const chapterKey = (i: number) => `journey:${SEASON_JOURNEY.id}:${i + 1}`;
/** Chapters complete under these season counters but not yet in the done list. */
export function newChapters(p: UnlockCtx, season: Life): number[] {
  const done = new Set(p.feats ?? []);
  return SEASON_JOURNEY.chapters.map((c, i) => i).filter((i) => !done.has(chapterKey(i)) && SEASON_JOURNEY.chapters[i].tasks.every((t) => season[t.stat] >= t.goal));
}

/** A reward key ("cos:wings:judgement") as a readable name. */
export function rewardName(key: string) {
  const [, kind, id] = key.split(":");
  const c = COSMETICS[kind as CosKind]?.find((x) => x.id === id);
  return c ? `${c.name} ${({ armor: "armour", wings: "", weapon: "weapon", petSkin: "pet skin", dye: "dye" } as Record<string, string>)[kind] ?? ""}`.trim() : key;
}
/** What one run adds to the feat and journey counters. The client builds it in solo and phone co-op; the live server builds it from what it saw. */
export interface RunTally {
  kind: string; boss?: string; tier: number; completed: boolean; inTime: boolean;
  kills: number; elites: number; legendaries: number; mythics: number; ancestrals: number;
  deaths: number; party: number; wave: number;
}
export function bumpLife(L: Life, t: RunTally): Life {
  L.kills += t.kills; L.elites += t.elites; L.legendaries += t.legendaries; L.mythics += t.mythics; L.ancestrals += t.ancestrals;
  if (t.completed) {
    if (t.kind === "rift") { L.rifts++; if (t.inTime) L.tier = Math.max(L.tier, t.tier); if (t.inTime && t.tier >= 8 && !t.deaths) L.flawless++; if (t.party >= 6) L.party6++; }
    if (t.kind === "chase") { if (t.boss === "seraph") L.seraphs++; else L.kings++; }
    if (t.kind === "endless") L.wave = Math.max(L.wave, t.wave);
    if (t.kind === "bounty") L.bounties++;
  }
  return L;
}
/** Boss trophies from a run: King's Shards (craft a chosen set piece) and Seraph Hallows (make an item ancestral). */
export function trophiesForRun(t: RunTally): { shards: number; hallows: number } {
  const T = RIFT.trophies;
  if (!t.completed || t.kind !== "chase") return { shards: 0, hallows: 0 };
  return t.boss === "seraph" ? { shards: 0, hallows: T.seraphHallows } : { shards: T.kingShards + (t.inTime ? T.kingShardsInTime : 0), hallows: 0 };
}
/** Echo Cores from an Endless run: one per 5 waves from wave 10. */
export const coresForRun = (t: RunTally) => (t.kind === "endless" && t.wave >= RIFT.echo.fromWave ? Math.floor((t.wave - RIFT.echo.fromWave) / RIFT.echo.wavesPerCore) + 1 : 0);
/** Relic Dust from a run: finished bounties only. */
export const dustForRun = (t: RunTally) => (t.completed && t.kind === "bounty" ? RIFT.bounty.dust + Math.floor(t.tier / RIFT.bounty.dustPerTiers) : 0);

// ------------------------------------------------------------------ reliquary: wear extracted legendary powers
export type RelicSlot = "weapon" | "armor" | "jewelry";
export const RELIC_SLOTS: RelicSlot[] = ["weapon", "armor", "jewelry"];
export const relicSlotOf = (slot: SlotType): RelicSlot => (slot === "weapon" || slot === "offhand" ? "weapon" : slot === "amulet" || slot === "ring" ? "jewelry" : "armor");
/** Bounties finished before a reliquary slot opens. */
export const relicUnlock = (sl: RelicSlot) => (RIFT.reliquary.unlock as Record<RelicSlot, number>)[sl];

/** Achievements reached but not yet in the done list. */
export function newFeats(p: UnlockCtx): Achievement[] {
  const L = lifeStats(p), done = new Set(p.feats ?? []);
  return ACHIEVEMENTS.filter((a) => !done.has(a.id) && L[a.stat] >= a.goal);
}
export interface Earn { tier?: number; wave?: number; king?: number; seraph?: number; ach?: string }
export const earnText = (e: Earn) => e.ach ? (ACHIEVEMENTS.find((a) => a.id === e.ach)?.desc ?? "").replace(/\.$/, "") : e.tier ? `Clear tier ${e.tier}` : e.wave ? `Reach Endless wave ${e.wave}` : e.king ? "Slay the Ossuary King" : e.seraph ? "Slay the Pale Seraph" : "";
export function earned(p: UnlockCtx, e: Earn): boolean {
  const cs = Object.values(p.chars ?? {});
  if (e.tier && !cs.some((c) => c.highestTier > e.tier!)) return false;
  if (e.wave && !cs.some((c) => (c.bestWave ?? 0) >= e.wave!)) return false;
  if (e.king && !cs.some((c) => (c.kings ?? 0) >= e.king!)) return false;
  if (e.seraph && !cs.some((c) => (c.seraphs ?? 0) >= e.seraph!)) return false;
  // a feat counts once it's in the done list, or as soon as its counter is reached (the server has no done list to update)
  if (e.ach && !(p.feats ?? []).includes(e.ach)) { const a = ACHIEVEMENTS.find((x) => x.id === e.ach); if (!a || lifeStats(p)[a.stat] < a.goal) return false; }
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
// ------------------------------------------------------------------ premium currency (cosmetics only, never power)
export const SHOP = shopJson as { currency: string; symbol: string; prices: Record<string, number>; classArmorDiscount: number; packs: { id: string; amount: number }[];
  earn: { chapter: number[]; riftFromTier: number; riftBase: number; riftPerTier: number; seraph: number; endlessFromWave: number; endlessPerWave: number } };
/** Currency a run earns: only really hard content pays (timed tier 15+, the Seraph, Endless wave 30+). */
export function aetherForRun(t: RunTally): number {
  const E = SHOP.earn;
  if (!t.completed) return 0;
  if (t.kind === "rift" && t.inTime && t.tier >= E.riftFromTier) return E.riftBase + (t.tier - E.riftFromTier) * E.riftPerTier;
  if (t.kind === "chase" && t.boss === "seraph") return E.seraph;
  if (t.kind === "endless" && t.wave >= E.endlessFromWave) return (t.wave - E.endlessFromWave + 1) * E.endlessPerWave;
  return 0;
}
/** Currency for newly done feats and journey chapters (keys from the feats list). */
export function aetherForFeats(keys: string[]): number {
  let n = 0;
  for (const k of keys) {
    const a = ACHIEVEMENTS.find((x) => x.id === k); if (a?.aether) n += a.aether;
    const m = /^journey:[^:]+:(\d+)$/.exec(k); if (m) n += SHOP.earn.chapter[+m[1] - 1] ?? 0;
  }
  return n;
}

export function shopCatalogue(): { key: string; section: string; name: string; desc: string; price: number; cls?: string }[] {
  const out: { key: string; section: string; name: string; desc: string; price: number; cls?: string }[] = [];
  const sec: Record<string, string> = { armor: "Armour", wings: "Wings", weapon: "Weapons", petSkin: "Pet skins", dye: "Dyes" };
  for (const k of COS_KINDS) for (const c of COSMETICS[k]) if ((c as any).unlock === "premium") out.push({ key: `cos:${k}:${c.id}`, section: sec[k], name: String(c.name), desc: String(c.desc ?? ""), price: Math.round(SHOP.prices[k] * ((c as any).cls ? SHOP.classArmorDiscount : 1)), cls: (c as any).cls });
  for (const t of HIDEOUT.themes) if (t.premium) out.push({ key: `theme:${t.id}`, section: "Hideout themes", name: t.name, desc: t.desc, price: SHOP.prices.theme });
  for (const d of HIDEOUT.decor) if (d.premium) out.push({ key: `decor:${d.id}`, section: "Hideout decor", name: d.name, desc: "", price: SHOP.prices.decor });
  for (const [skill, styles] of Object.entries(VFX.perSkill)) for (const st of styles) out.push({ key: `fx:${skill}:${st}`, section: "Skill effects", name: `${VFX.styles[st].name} ${SKILL[skill]?.name ?? skill}`, desc: "", price: SHOP.prices.fx, cls: Object.keys(CLASSES).find((c) => CLASSES[c].skills.includes(skill)) });
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

/** Paragon: after max level, XP keeps going into paragon levels; each gives a point to spend on four capped stats. */
export type ParagonStat = "power" | "vitality" | "toughness" | "haste";
export const PARAGON_STATS = Object.keys(RIFT.paragon.stats) as ParagonStat[];
export const paragonXp = (n: number) => Math.round(RIFT.paragon.xpPer * Math.pow(RIFT.paragon.xpGrowth, n));
export const paragonSpent = (a?: Partial<Record<ParagonStat, number>>) => Object.values(a ?? {}).reduce((x, y) => x + (y ?? 0), 0);
