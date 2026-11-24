// Pure deterministic simulation for 1–6 players. No DOM, no Math.random, no wall-clock time.
// The host runs it authoritatively; clients run it for prediction; the backend can replay it to validate.
import { GEM, GEMS, gemCap, BOONS, CosChoice, BOON, CLASSES, validLoadout, ELITES, ENEMIES, EnemyDef, MODIFIER, MODIFIERS, Num, RARITY_ORDER, RIFT, Rarity, SKILL, levelPower, xpForLevel , GUARDIANS, ParagonStat, paragonXp, GuardianDef, guardianDef, MAP, MAPS, MapDef, ITEMS, HideoutLayout, hideoutTheme } from "./data";
import { Holder, InvCmd, Item, MintOpts, ResolvedSkill, Stats, applyInvCmd, equipTarget, computeStats, mintItem, resolveSkill, BAG_SIZE, scrapValue, shardValue } from "./items";
import { TileMap, flowField, genArena, genCave, genHideout, genLinear, genOpen, genRing, genRooms, moveWithWalls, unstick } from "./map";
import { Rng, chance, int, makeRng, next, range, weighted } from "./rng";
import { DIR_TABLE, len, norm, rotFine } from "./vec";

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

// ------------------------------------------------------------------ types
export interface PlayerInput { mx: number; my: number; ax: number; ay: number; act: number; cmds?: PlayerCmd[] }
export const NO_INPUT: PlayerInput = { mx: 0, my: 0, ax: 0, ay: 0, act: 0 };
export type PlayerCmd = InvCmd | { type: "boon"; id: string } | { type: "setLoadout"; setup: PlayerSetup };
export type HostCmd =
  | { type: "spawnLoot"; owner: number; item: Item; x: number; y: number }
  | { type: "join"; setup: PlayerSetup; pity?: { ancestral?: boolean; primal?: boolean } }
  | { type: "leave"; pid: number };

export interface PlayerSetup {
  pid: number; name: string; cls: string; level: number; xp: number;
  equipment: Holder["equipment"]; bag: Item[]; materials: number; sigils: number;
  /** Pale Feathers: open the Sanctum of the Pale Seraph */
  feathers?: number;
  shards?: number; slotPlus?: Holder["slotPlus"]; slotCrit?: Holder["slotCrit"];
  runes: Record<string, string>; pet: string; filter: Rarity;
  loadout?: string[];
  /** paragon levels, XP toward the next one, and points spent */
  paragon?: number; pxp?: number; pAlloc?: Partial<Record<ParagonStat, number>>;
  /** rift gems owned (id -> level) and the ones socketed (up to 3) */
  gems?: Record<string, number>; gemSlots?: string[];
  /** cosmetics: visual only, never read by the sim */
  cos?: CosChoice;
}

export interface Buff { armorPct: number; dmgPct: number; cdrPct: number; t: number }
export interface Player extends Holder {
  pid: number; name: string; cls: string; level: number; xp: number; sigils: number; feathers: number;
  runes: Record<string, string>; pet: string; filter: Rarity; cos: CosChoice;
  x: number; y: number; px: number; py: number; r: number; hp: number; fx: number; fy: number; moving: boolean; walk: number;
  skills: string[]; cds: Num; charges: Num; chargeT: Num; swingT: number; swingCount: number;
  dashT: number; dashDx: number; dashDy: number; dashHit: number[]; dashSkill: string; trailT: number;
  paragon: number; pxp: number; pAlloc: Partial<Record<ParagonStat, number>>;
  gems: Record<string, number>; gemSlots: string[];
  /** life-on-hit healed in the current second (capped, so many-hit skills can't out-heal everything) */
  leech: number;
  invuln: number; deaths?: number; chillT?: number; thornT?: number; dead: boolean; deadT: number; buff: Buff; boons: string[]; cheatT: number;
  stats: Stats; sk: Record<string, ResolvedSkill>; uses: Num; connected: boolean;
  /** class resource (Embers / Focus / Mana) and seconds since the last hit dealt or taken */
  res: number; combatT: number;
  /** Bonewright Colossus form: seconds left, and the skill that made it */
  colossusT?: number; colossusSkill?: string;
}

export type EnemyKind = "ghoul" | "archer" | "brute" | "guardian" | "king" | "pylon" | "hound" | "hexer" | "gorehorn" | "shieldbearer";
export interface Enemy {
  id: number; kind: EnemyKind;
  x: number; y: number; px: number; py: number; r: number;
  hp: number; maxHp: number; dmgMult: number; speedMult: number;
  /** last projectile volley that hit this enemy: further hits from the same volley are weaker */
  vol?: number;
  state: string; t: number; atkCd: number; aggro: boolean; target: number;
  kbx: number; kby: number; flash: number;
  burnDps: number; burnT: number; burnTick: number; burnPid: number;
  slowT: number; slowPct: number; vulnT: number; vulnPct: number; tauntT: number; tauntBy: number;
  tx: number; ty: number; dead: boolean; noProgress: boolean;
  pattern: number; enraged: boolean; age: number; chargeHit: boolean; phase: number;
  elite: boolean; affixes: string[]; shieldT: number; shieldCd: number; affT: number; aff2T: number; scale: number;
  /** guardians: which one (data/guardians.json), and a counter for multi-step attacks */
  variant?: string; combo?: number;
}
export interface Projectile {
  id: number; team: 0 | 1; kind: "lance" | "wave" | "arrow" | "bone" | "bolt";
  x: number; y: number; px: number; py: number; vx: number; vy: number; r: number;
  pid: number; skill: string; mult: number; dmg: number; tags: string[]; pierce: boolean; life: number; hit: number[];
  returning: boolean; kb: number; dead: boolean; trailT: number; cold: boolean; fire: boolean;
  /** projectiles fired together share a volley id */
  volley: number;
}
export interface Summon { id: number; pid: number; skill: string; x: number; y: number; px: number; py: number; r: number; life: number; atkT: number; fx: number; dead: boolean; ox: number; oy: number; size: number; kind: string;
  /** constructs (Bonewright): stationary; 1 turret, 2 mortar, 3 totem, 4 lantern, 5 battery turret */ build?: number; boostT?: number; boostPct?: number }
export interface Hazard { id: number; pid: number; skill: string; x: number; y: number; r: number; mult: number; life: number; max: number; tickT: number; tags: string[]; slowPct: number; slowT: number; dead: boolean; kind: string }
export interface Zone { id: number; x: number; y: number; r: number; delay: number; life: number; dmg: number; kind: "blast" | "pool" | "frost" | "mire"; tickT: number; dead: boolean }
export interface Loot { id: number; x: number; y: number; item: Item; age: number; owner: number }
interface Pending { t: number; pid: number; skill: string }

export type SimEvent =
  | { type: "hit"; x: number; y: number; amount: number; crit: boolean; kind: EnemyKind; burn?: boolean; pid: number }
  | { type: "immune"; x: number; y: number }
  | { type: "kill"; x: number; y: number; kind: EnemyKind; elite: boolean }
  | { type: "drop"; x: number; y: number; rarity: Rarity; name: string; owner: number; quality?: string }
  | { type: "dropRequest"; owner: number; x: number; y: number; opts: MintOpts }
  | { type: "pickup"; pid: number; rarity: Rarity; name: string; item: Item }
  | { type: "scrapped"; pid: number; name: string; mats: number; id: string }
  | { type: "bagFull"; pid: number }
  | { type: "swing"; pid: number; skill?: string; x: number; y: number; fx: number; fy: number; ring: boolean; range: number; hits: number; arcCos: number }
  | { type: "cast"; pid: number; skill: string; x: number; y: number; r?: number }
  | { type: "playerHurt"; pid: number; amount: number }
  | { type: "playerDeath"; pid: number } | { type: "respawn"; pid: number } | { type: "cheatDeath"; pid: number }
  | { type: "slam"; x: number; y: number; r: number; big: boolean }
  | { type: "explosion"; x: number; y: number; r: number; cold?: boolean; pid?: number; skill?: string }
  | { type: "paragonUp"; pid: number; level: number } | { type: "gem"; pid: number; id: string } | { type: "gemUp"; pid: number; id: string; level: number }
  | { type: "guardianSpawn"; x: number; y: number; kind: EnemyKind; variant?: string }
  | { type: "enrage" } | { type: "guardianStun" } | { type: "timeUp" } | { type: "phase"; n: number; text: string }
  | { type: "riftComplete"; inTime: boolean; time: number }
  | { type: "levelUp"; pid: number; level: number }
  | { type: "boonOffer"; pid: number } | { type: "boonTaken"; pid: number; id: string }
  | { type: "sigil"; pid: number } | { type: "feather"; pid: number } | { type: "teleport"; x: number; y: number } | { type: "chain"; x1: number; y1: number; x2: number; y2: number; pid?: number; skill?: string }
  | { type: "waveStart"; wave: number; count: number; boss: boolean } | { type: "waveClear"; wave: number; secs: number; jump: number; cleared: boolean } | { type: "endlessOver"; wave: number; time: number }
  | { type: "equipChanged"; pid: number } | { type: "ambush"; x: number; y: number; n: number };

export type RunKind = "rift" | "chase" | "endless" | "hideout";
/** chase runs: which boss waits at the end */
export type ChaseBoss = "king" | "seraph";
export interface RiftState {
  kind: RunKind; tier: number; mods: string[];
  /** chase runs: the boss (default the Ossuary King) */
  boss?: ChaseBoss;
  /** Endless mode: wave number, difficulty level (rises faster on quick clears), when the next wave comes (0 = a wave is up) and when the current one started */
  wave?: number; level?: number; waveAt?: number; waveStart?: number;
  /** hideout runs: the room being visited (rendered by everyone in it) */
  hideout?: HideoutLayout;
  /** which map (data/maps.json) and, for the Good Luck map, its density multiplier */
  map?: string; density?: number;
  time: number; limit: number; progress: number; need: number;
  guardianSpawned: boolean; guardianId: number; done: boolean; doneAt: number; kills: number; timeUpSent: boolean; boonIdx: number;
  /** rift time of the next ambush wave (enemies that spawn nearby and hunt the party) */
  nextWave?: number;
}
export interface SimConfig {
  seed: number; kind?: RunKind; tier?: number; mods?: string[]; players: PlayerSetup[];
  /** chase runs: which boss (default the Ossuary King) */
  boss?: ChaseBoss;
  /** hideout runs: the host's room (theme + decorations) */
  hideout?: HideoutLayout;
  /** force a map (tests); otherwise it's picked from the seed */
  map?: string;
  mint?: "local" | "external"; pity?: Record<number, { ancestral?: boolean; primal?: boolean }>;
}
export interface SimState {
  seed: number; tick: number; rng: Rng; map: TileMap; mint: "local" | "external";
  players: Player[]; enemies: Enemy[]; projectiles: Projectile[]; summons: Summon[]; hazards: Hazard[]; zones: Zone[]; loot: Loot[]; pending: Pending[];
  nextId: number; itemCounter: number; startX: number; startY: number;
  rift: RiftState; boonOffers: Record<number, string[]>; /** offers earned while another was still unopened */ boonPending: Record<number, number>; pity: NonNullable<SimConfig["pity"]>;
  events: SimEvent[];
  _flows: Int16Array[]; _flowTick: number;
}

// ------------------------------------------------------------------ setup
export function rollModifiers(seed: number, tier: number): string[] {
  const r = makeRng(seed ^ 0x9e3779b9);
  const n = tier >= 5 ? 3 : 2;
  const pool = MODIFIERS.map((m) => m.id);
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(next(r) * pool.length), 1)[0]);
  return out;
}
const modVal = (s: SimState, k: "packMult" | "enemySpeed" | "enemyHp" | "dropMult" | "eliteMult" | "xpMult") => {
  let v = 1; for (const m of s.rift.mods) v *= (MODIFIER[m] as any)[k] ?? 1;
  if (k === "dropMult" && s.rift.kind === "endless") v *= RIFT.endless.dropMult;
  // map-wide loot bonus (the Gilded Vault)
  if (k === "dropMult" && s.rift.map) v *= MAP[s.rift.map]?.dropMult ?? 1;
  return v;
};
/** The map for a rift code: a weighted pick from the seed, so the same code is always the same map. */
export function pickMap(seed: number): MapDef {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
  const total = MAPS.reduce((a, m) => a + m.weight, 0);
  let x = (h / 4294967296) * total;
  for (const m of MAPS) { x -= m.weight; if (x < 0) return m; }
  return MAPS[0];
}

export function createSim(cfg: SimConfig): SimState {
  const kind = cfg.kind ?? "rift";
  const tier = Math.max(1, cfg.tier ?? 1);
  const rng = makeRng(cfg.seed);
  const hth = kind === "hideout" ? hideoutTheme(cfg.hideout?.theme) : undefined;
  const md = kind === "chase" || kind === "hideout" ? undefined : kind === "endless" ? MAP.endless : MAP[cfg.map ?? ""] ?? pickMap(cfg.seed);
  const map = hth ? genHideout(rng, hth.w, hth.h, RIFT.tileSize, hth.shape)
    : !md ? genArena(rng, 44, 44, RIFT.tileSize)
    : md.layout === "arena" ? genArena(rng, md.w, md.h, RIFT.tileSize)
    : md.layout === "linear" ? genLinear(rng, md.w, md.h, RIFT.tileSize)
    : md.layout === "open" ? genOpen(rng, md.w, md.h, RIFT.tileSize)
    : md.layout === "ring" ? genRing(rng, md.w, md.h, RIFT.tileSize)
    : md.layout === "rooms" ? genRooms(rng, md.w, md.h, RIFT.tileSize)
    : genCave(rng, md.w, md.h, RIFT.tileSize);
  const density = md?.density ? md.density[0] + Math.floor(next(rng) * (md.density[1] - md.density[0] + 1)) : 1;
  const ts = map.ts;
  const floors: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === 0 && openness(map, i) >= 8) floors.push(i);
  let startX: number, startY: number;
  if (kind === "chase") { startX = (map.w / 2) * ts; startY = (map.h / 2 + 10) * ts; }
  else if (kind === "hideout") { startX = (map.w / 2) * ts; startY = Math.round(map.h * 0.62) * ts; }
  else if (kind === "endless") { startX = (map.w / 2) * ts; startY = (map.h / 2) * ts; }
  else { const st = floors[Math.floor(next(rng) * floors.length)]; startX = (st % map.w) * ts + ts / 2; startY = Math.floor(st / map.w) * ts + ts / 2; }
  const mods = kind !== "rift" ? [] : cfg.mods ?? rollModifiers(cfg.seed, tier);
  const s: SimState = {
    seed: cfg.seed, tick: 0, rng, map, mint: cfg.mint ?? "local",
    players: [], enemies: [], projectiles: [], summons: [], hazards: [], zones: [], loot: [], pending: [],
    nextId: 1, itemCounter: 0, startX, startY,
    rift: {
      kind, tier, mods, map: md?.id, density, time: 0, limit: kind === "chase" ? (cfg.boss === "seraph" ? RIFT.seraph.timeLimit : RIFT.chase.timeLimit) : kind === "endless" || kind === "hideout" ? 1e9 : RIFT.timeLimit, progress: 0, need: Math.round(RIFT.progressNeeded * tierDensity(tier) * Math.max(1, density / 5)),
      guardianSpawned: false, guardianId: 0, done: false, doneAt: 0, kills: 0, timeUpSent: false, boonIdx: 0, nextWave: RIFT.waves.first,
    },
    boonOffers: {}, boonPending: {}, pity: cfg.pity ?? {}, events: [], _flows: [], _flowTick: -999,
  };
  for (const ps of cfg.players) addPlayer(s, ps);
  const n = Math.max(1, s.players.length);
  if (kind === "hideout") { Object.assign(s.rift, { need: 1e9, nextWave: undefined, hideout: cfg.hideout }); return s; }
  if (kind === "endless") {
    Object.assign(s.rift, { wave: 0, level: 0, waveAt: RIFT.endless.firstDelay, waveStart: 0, need: 1e9, nextWave: undefined });
    return s;
  }
  if (kind === "chase") {
    const k = spawnEnemy(s, "king", (map.w / 2) * ts, (map.h / 2 - 4) * ts, n);
    k.aggro = true; k.state = "intro"; k.t = 2.5;
    if (cfg.boss === "seraph") { s.rift.boss = "seraph"; k.variant = "seraph"; k.hp = k.maxHp = Math.round(k.maxHp * RIFT.seraph.hpMult); }
    s.rift.guardianSpawned = true; s.rift.guardianId = k.id; s.rift.progress = s.rift.need;
    return s;
  }
  const packs: [number, number][] = [];
  let attempts = 0;
  const eliteChance = RIFT.eliteChance * modVal(s, "eliteMult") + RIFT.party.eliteChancePerExtra * (n - 1);
  // bigger or smaller maps get proportionally more or fewer packs (the cave has about 4,700 open tiles)
  const packTarget = Math.round(RIFT.packCount * Math.max(0.6, Math.min(1.4, floors.length / 4700)));
  const cap = md?.enemyCap ?? 99999;
  while (packs.length < packTarget && attempts++ < 4000 && s.enemies.length < cap) {
    const ti = floors[Math.floor(next(rng) * floors.length)];
    const x = (ti % map.w) * ts + ts / 2, y = Math.floor(ti / map.w) * ts + ts / 2;
    if (len(x - startX, y - startY) < 220) continue;
    if (packs.some(([px, py]) => len(px - x, py - y) < RIFT.packSpacing)) continue;
    packs.push([x, y]);
    const pack = weighted(rng, packsFor(s.rift.tier));
    const elitePack = chance(rng, eliteChance);
    let first = true;
    for (const [ek, lo, hi] of pack.members as [EnemyKind, number, number][]) {
      const cnt = Math.max(1, Math.round(int(rng, lo, hi) * modVal(s, "packMult") * tierDensity(s.rift.tier) * (md?.packMult ?? 1) * density));
      for (let i = 0; i < cnt; i++) {
        const d = DIR_TABLE[int(rng, 0, 31)];
        const rr = range(rng, 0, 22);
        let ex = x + d[0] * rr, ey = y + d[1] * rr;
        if (isWall(map, ex, ey)) { ex = x; ey = y; }
        const e = spawnEnemy(s, ek, ex, ey, n);
        if (elitePack && first) makeElite(s, e);
        first = false;
      }
    }
  }
  return s;
}

function openness(m: TileMap, i: number): number {
  const x = i % m.w, y = Math.floor(i / m.w); let c = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!(dx === 0 && dy === 0) && m.tiles[(y + dy) * m.w + x + dx] === 0) c++;
  return c;
}
export function isWall(m: TileMap, x: number, y: number) {
  const tx = Math.floor(x / m.ts), ty = Math.floor(y / m.ts);
  return tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.tiles[ty * m.w + tx] === 1;
}

export function addPlayer(s: SimState, ps: PlayerSetup): Player {
  const cls = ps.cls;
  const p: Player = {
    paragon: ps.paragon ?? 0, pxp: ps.pxp ?? 0, pAlloc: { ...(ps.pAlloc ?? {}) },
    gems: { ...(ps.gems ?? {}) }, gemSlots: (ps.gemSlots ?? []).filter((g) => ps.gems?.[g] && GEM[g]).slice(0, GEMS.slots),
    pid: ps.pid, name: ps.name, cls, level: ps.level, xp: ps.xp, sigils: ps.sigils, feathers: ps.feathers ?? 0, runes: { ...ps.runes }, pet: ps.pet, filter: ps.filter, cos: { ...ps.cos },
    equipment: clone(ps.equipment), bag: clone(ps.bag), materials: ps.materials, shards: ps.shards ?? 0, slotPlus: { ...(ps.slotPlus ?? {}) }, slotCrit: { ...(ps.slotCrit ?? {}) },
    x: s.startX + (s.players.length % 2) * 12 - 6, y: s.startY + Math.floor(s.players.length / 2) * 12, px: 0, py: 0, r: 5, hp: 1, fx: 1, fy: 0, moving: false, walk: 0,
    skills: [], cds: {}, charges: {}, chargeT: {}, swingT: 0, swingCount: 0,
    dashT: 0, dashDx: 0, dashDy: 0, dashHit: [], dashSkill: "", trailT: 0, leech: 0,
    invuln: 1.5, dead: false, deadT: 0, buff: { armorPct: 0, dmgPct: 0, cdrPct: 0, t: 0 }, boons: [], cheatT: 0,
    stats: undefined as unknown as Stats, sk: {}, uses: {}, connected: true,
    res: CLASSES[cls].resource.start, combatT: 99,
  };
  p.px = p.x; p.py = p.y;
  p.skills = validLoadout(cls, ps.loadout);
  s.players.push(p);
  refreshAll(s);
  p.hp = p.stats.maxHp;
  for (const id of p.skills) p.charges[id] = p.sk[id].p.charges ?? 1;
  return p;
}
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Recompute stats + resolved skills for every player (party level sync depends on the whole party). */
export function refreshAll(s: SimState) {
  let maxL = 1; for (const p of s.players) maxL = Math.max(maxL, p.level);
  for (const p of s.players) refreshPlayer(s, p, maxL - RIFT.levels.syncGap);
}
function refreshPlayer(s: SimState, p: Player, minEff: number) {
  const ratio = p.stats ? p.hp / p.stats.maxHp : 1;
  p.stats = computeStats(p.equipment, { cls: p.cls, level: p.level, effLevel: Math.max(p.level, minEff), paragon: p.pAlloc, gems: Object.fromEntries(p.gemSlots.map((g) => [g, p.gems[g] ?? 1])), boons: p.boons, riftMods: s.rift.mods, slotPlus: p.slotPlus, slotCrit: p.slotCrit });
  p.sk = {};
  for (const id of p.skills) p.sk[id] = resolveSkill(id, p.runes[id], p.stats);
  if (!p.dead) p.hp = Math.max(1, Math.min(p.stats.maxHp, p.stats.maxHp * ratio));
  for (const id of p.skills) if (p.charges[id] !== undefined) p.charges[id] = Math.min(p.charges[id], p.sk[id].p.charges ?? 1);
}

function spawnEnemy(s: SimState, kind: EnemyKind, x: number, y: number, party: number): Enemy {
  const d = ENEMIES[kind] ?? { hp: 300, radius: 7 } as EnemyDef;
  const t = s.rift.tier;
  const hpM = Math.pow(RIFT.tiers.hpGrowth, t - 1) * (t === 1 ? RIFT.tiers.tier1Hp ?? 1 : 1) * (1 + RIFT.party.hpPerExtra * (party - 1)) * modVal(s, "enemyHp");
  const dmgM = Math.pow(RIFT.tiers.dmgGrowth, t - 1) * (t === 1 ? RIFT.tiers.tier1Dmg ?? 1 : 1) * (1 + RIFT.party.dmgPerExtra * (party - 1));
  const hp = Math.round(d.hp * hpM);
  const e: Enemy = {
    id: s.nextId++, kind, x, y, px: x, py: y, r: d.radius, hp, maxHp: hp, dmgMult: dmgM, speedMult: modVal(s, "enemySpeed") * Math.min(RIFT.tiers.speedCap, 1 + RIFT.tiers.speedPerTier * (t - 1)),
    state: "chase", t: 0, atkCd: range(s.rng, 0.3, 1.0), aggro: false, target: -1, kbx: 0, kby: 0, flash: 0,
    burnDps: 0, burnT: 0, burnTick: 0, burnPid: 0, slowT: 0, slowPct: 0, vulnT: 0, vulnPct: 0, tauntT: 0, tauntBy: -1,
    tx: 0, ty: 0, dead: false, noProgress: false, pattern: 0, enraged: false, age: 0, chargeHit: false, phase: 1,
    elite: false, affixes: [], shieldT: 0, shieldCd: 4, affT: 2, aff2T: 1, scale: 1,
  };
  s.enemies.push(e);
  return e;
}

function makeElite(s: SimState, e: Enemy) {
  e.elite = true;
  e.hp = e.maxHp = Math.round(e.maxHp * ELITES.hpMult);
  e.dmgMult *= ELITES.dmgMult; e.scale = ELITES.scale; e.r = Math.round(e.r * ELITES.scale);
  const pool = Object.keys(ELITES.affixes);
  const n = Math.min(4, 1 + Math.floor((s.rift.tier - 1) / 3) + (chance(s.rng, 0.3) ? 1 : 0));
  while (e.affixes.length < n) { const a = pool.splice(Math.floor(next(s.rng) * pool.length), 1)[0]; e.affixes.push(a); }
  if (e.affixes.includes("fast")) e.speedMult *= 1.5;
}

// ------------------------------------------------------------------ step
export function step(s: SimState, inputs: Record<number, PlayerInput>, host?: HostCmd[]): void {
  s.events.length = 0;
  s.tick++;
  if (host) for (const c of host) applyHostCmd(s, c);
  for (const p of s.players) updatePlayer(s, p, inputs[p.pid] ?? NO_INPUT);
  updatePending(s);
  if (s._flowTick + 8 <= s.tick) {
    s._flows = s.players.map((p) => flowField(s.map, p.x, p.y, 40));
    s._flowTick = s.tick;
  }
  updateEnemies(s);
  updateSummons(s);
  updateProjectiles(s);
  updateHazards(s);
  updateZones(s);
  updateLoot(s);
  updateRift(s);
  if (s.tick % 30 === 0) s.enemies = s.enemies.filter((e) => !e.dead);
  s.projectiles = s.projectiles.filter((p) => !p.dead);
  s.summons = s.summons.filter((p) => !p.dead);
  s.hazards = s.hazards.filter((p) => !p.dead);
  s.zones = s.zones.filter((z) => !z.dead);
}

function applyHostCmd(s: SimState, c: HostCmd) {
  if (c.type === "spawnLoot") {
    [c.x, c.y] = onFloor(s.map, c.x, c.y);
    s.loot.push({ id: s.nextId++, x: c.x, y: c.y, item: c.item, age: 0, owner: c.owner });
    s.events.push({ type: "drop", x: c.x, y: c.y, rarity: c.item.rarity, name: c.item.name, owner: c.owner, quality: c.item.quality });
  } else if (c.type === "join") {
    if (!s.players.some((p) => p.pid === c.setup.pid)) { addPlayer(s, c.setup); if (c.pity) s.pity[c.setup.pid] = c.pity; }
  } else if (c.type === "leave") {
    const p = s.players.find((q) => q.pid === c.pid);
    if (p) { s.players.splice(s.players.indexOf(p), 1); s.summons.forEach((m) => { if (m.pid === c.pid) m.dead = true; }); s.loot = s.loot.filter((l) => l.owner !== c.pid); refreshAll(s); }
  }
}

function offerBoon(s: SimState, p: Player) {
  // only offer boons that touch one of your equipped skills (no "+2 minions" for a build with no minions)
  const fits = (b: (typeof BOONS)[number]) => !b.mod || b.mod.tag === "any" || !b.mod.tag || p.skills.some((id) => p.sk[id]?.tags.includes(b.mod!.tag!));
  const pool = BOONS.filter((b) => !p.boons.includes(b.id) && fits(b)).map((b) => b.id);
  const offer: string[] = [];
  while (offer.length < 3 && pool.length) offer.push(pool.splice(Math.floor(next(s.rng) * pool.length), 1)[0]);
  if (!offer.length) return;
  s.boonOffers[p.pid] = offer;
  s.events.push({ type: "boonOffer", pid: p.pid });
}

export function playerById(s: SimState, pid: number) { return s.players.find((p) => p.pid === pid); }

export function applyPlayerCmd(s: SimState, p: Player, c: PlayerCmd): boolean {
  if (c.type === "boon") {
    const offer = s.boonOffers[p.pid];
    if (!offer || !offer.includes(c.id)) return false;
    p.boons.push(c.id); delete s.boonOffers[p.pid];
    refreshAll(s);
    s.events.push({ type: "boonTaken", pid: p.pid, id: c.id });
    if ((s.boonPending?.[p.pid] ?? 0) > 0) { s.boonPending[p.pid]--; offerBoon(s, p); }
    return true;
  }
  if (c.type === "setLoadout") {
    p.equipment = clone(c.setup.equipment); p.runes = { ...c.setup.runes }; p.filter = c.setup.filter; p.pet = c.setup.pet; p.cos = { ...c.setup.cos };
    p.skills = validLoadout(p.cls, c.setup.loadout); for (const id of p.skills) if (p.charges[id] === undefined) p.charges[id] = 1;
    refreshAll(s); s.events.push({ type: "equipChanged", pid: p.pid });
    return true;
  }
  if (!applyInvCmd(p, c)) return false;
  refreshAll(s);
  s.events.push({ type: "equipChanged", pid: p.pid });
  return true;
}

// ------------------------------------------------------------------ players
const cdMult = (p: Player) => (1 - Math.min(50, p.stats.cdr) / 100) * (1 - (p.buff.t > 0 ? p.buff.cdrPct : 0) / 100);
const atkMult = (p: Player) => 1 / (1 + p.stats.atkSpeed / 100);
export function skillReady(p: Player, id: string): boolean {
  const sk = p.sk[id];
  if (!sk || SKILL[id].unlock > p.level) return false;
  if (skillCost(p, id) > p.res) return false;
  if (sk.p.interval) return p.swingT <= 0;
  return (p.charges[id] ?? 0) > 0;
}

function updatePlayer(s: SimState, p: Player, inp: PlayerInput) {
  p.px = p.x; p.py = p.y;
  if (inp.cmds) for (const c of inp.cmds) applyPlayerCmd(s, p, c);
  // cooldowns / charges
  const cm = cdMult(p);
  for (const id of p.skills) {
    const sk = p.sk[id];
    if (sk.p.interval || !sk.p.cooldown) continue;
    const max = sk.p.charges ?? 1;
    if ((p.charges[id] ?? 0) < max) {
      p.chargeT[id] = (p.chargeT[id] ?? sk.p.cooldown * cm) - DT;
      if (p.chargeT[id] <= 0) { p.charges[id] = (p.charges[id] ?? 0) + 1; p.chargeT[id] = sk.p.cooldown * cm; }
    } else p.chargeT[id] = sk.p.cooldown * cm;
  }
  if (p.buff.t > 0) p.buff.t -= DT;
  if (p.cheatT > 0) p.cheatT -= DT;
  if ((p.colossusT ?? 0) > 0) { p.colossusT! -= DT; if (p.colossusT! <= 0 || p.dead) { p.colossusT = 0; s.events.push({ type: "cast", pid: p.pid, skill: "colossus_end", x: p.x, y: p.y }); } }
  if (p.dead) {
    p.deadT -= DT;
    if (p.deadT <= 0) {
      const ally = s.players.find((q) => q !== p && !q.dead);
      p.dead = false; p.hp = p.stats.maxHp; p.x = ally ? ally.x : s.startX; p.y = ally ? ally.y : s.startY; p.px = p.x; p.py = p.y; p.invuln = 2;
      s.events.push({ type: "respawn", pid: p.pid });
    }
    return;
  }
  if (p.stats.regen > 0) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.regen * DT);
  if (s.tick % 30 === 0) p.leech = 0;
  updateResource(p);
  p.invuln = Math.max(0, p.invuln - DT);
  p.swingT -= DT;
  const [afx, afy] = norm(inp.ax - p.x, inp.ay - p.y);
  if (afx !== 0 || afy !== 0) { p.fx = afx; p.fy = afy; }
  if (p.dashT > 0) { updateDash(s, p); unstick(s.map, p); return; }
  unstick(s.map, p);

  let mx = inp.mx, my = inp.my;
  const ml = len(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  p.moving = ml > 0.05;
  if (p.chillT) p.chillT = Math.max(0, p.chillT - DT);
  if (p.thornT) p.thornT = Math.max(0, p.thornT - DT);
  if (p.moving) {
    const sp = p.stats.speed * (1 + p.stats.moveSpeed / 100) * ((p.chillT ?? 0) > 0 ? 0.55 : 1) * DT;
    const ox = p.x, oy = p.y;
    moveWithWalls(s.map, p, mx * sp, my * sp);
    p.walk += len(p.x - ox, p.y - oy);
  }
  // casting: one skill per tick, utilities and ultimate first
  for (const slot of [3, 2, 1, 0]) {
    if (!(inp.act & (1 << slot))) continue;
    const id = p.skills[slot];
    if (!id || !skillReady(p, id)) continue;
    cast(s, p, id, inp, mx, my);
    break;
  }
}

export function resMax(p: Player) { return CLASSES[p.cls].resource.max + (p.stats?.resMax ?? 0); }
export function skillCost(p: Player, id: string) { const c = p.sk[id]?.p.cost ?? 0; return c ? c * (1 - Math.min(50, p.stats.costRed) / 100) : 0; }
function gainRes(p: Player, v: number) { p.res = Math.min(resMax(p), p.res + v); }
function updateResource(p: Player) {
  const R = CLASSES[p.cls].resource;
  p.combatT += DT;
  if (R.regen || p.stats.resRegen) gainRes(p, (R.regen + p.stats.resRegen) * DT);
  if (R.decay && p.combatT > R.decayAfter) p.res = Math.max(0, p.res - R.decay * DT);
}
function useCharge(p: Player, id: string) {
  const sk = p.sk[id];
  if (sk.p.interval) { p.swingT = sk.p.interval * atkMult(p); return; }
  p.charges[id] = (p.charges[id] ?? 1) - 1;
}

function cast(s: SimState, p: Player, id: string, inp: PlayerInput, mx: number, my: number) {
  const sk = p.sk[id];
  useCharge(p, id);
  if (sk.p.cost) p.res -= skillCost(p, id);
  if (sk.p.gen) gainRes(p, sk.p.gen);
  p.uses[id] = (p.uses[id] ?? 0) + 1;
  if ((p.colossusT ?? 0) > 0 && id === p.skills[0] && p.colossusSkill && p.sk[p.colossusSkill]) { colossusSlam(s, p, p.sk[p.colossusSkill]); return; }
  switch (sk.kind) {
    case "build": castBuild(s, p, sk, inp); break;
    case "melee": castMelee(s, p, sk); break;
    case "projectile": castProjectile(s, p, sk); break;
    case "dash": {
      let dx = p.moving ? mx : p.fx, dy = p.moving ? my : p.fy;
      [dx, dy] = norm(dx, dy);
      if (dx === 0 && dy === 0) dx = 1;
      p.dashT = sk.p.duration; p.dashDx = dx; p.dashDy = dy; p.dashHit = []; p.trailT = 0; p.dashSkill = id;
      p.invuln = Math.max(p.invuln, p.dashT + 0.1);
      if (sk.p.healPct) heal(p, p.stats.maxHp * sk.p.healPct);
      if (sk.p.resetSecondary) { const sec = p.skills[1]; if (sec && p.sk[sec]) p.charges[sec] = p.sk[sec].p.charges ?? 1; }
      s.events.push({ type: "cast", pid: p.pid, skill: id, x: p.x, y: p.y });
      break;
    }
    case "shout": castShout(s, p, sk); break;
    case "nova": {
      novaPulse(s, p, sk);
      for (let i = 1; i < (sk.p.pulses ?? 1); i++) s.pending.push({ t: 0.45 * i, pid: p.pid, skill: id });
      break;
    }
    case "summon": castSummon(s, p, sk); break;
    case "trap": {
      let tx = inp.ax, ty = inp.ay;
      const d = len(tx - p.x, ty - p.y);
      if (d > sk.p.castRange) { tx = p.x + ((tx - p.x) / d) * sk.p.castRange; ty = p.y + ((ty - p.y) / d) * sk.p.castRange; }
      if (isWall(s.map, tx, ty)) { tx = p.x; ty = p.y; }
      s.hazards.push({ id: s.nextId++, pid: p.pid, skill: id, x: tx, y: ty, r: sk.p.radius, mult: sk.p.dps, life: sk.p.duration, max: sk.p.duration, tickT: 0, tags: sk.tags, slowPct: sk.p.slowPct ?? 0, slowT: sk.p.slowT ?? 0.6, dead: false, kind: sk.tags.includes("fire") ? "fire" : sk.tags.includes("construct") && !sk.tags.includes("cold") ? "bone" : "frost" });
      s.events.push({ type: "cast", pid: p.pid, skill: id, x: tx, y: ty, r: sk.p.radius });
      break;
    }
  }
}

function heal(p: Player, amt: number) { if (!p.dead) p.hp = Math.min(p.stats.maxHp, p.hp + amt); }

function castMelee(s: SimState, p: Player, sk: ResolvedSkill) {
  p.swingCount++;
  const ringEvery = sk.p.ringEvery ?? 0;
  const ring = ringEvery > 0 && p.swingCount % ringEvery === 0;
  const mult = sk.p.damage * (ring ? sk.p.ringMult : 1);
  const rng = sk.p.range + (ring ? 6 : 0);
  let hits = 0;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = len(dx, dy);
    if (d > rng + e.r) continue;
    const ok = ring || d < e.r + p.r + 2 || (dx * p.fx + dy * p.fy) / (d || 1) >= sk.p.arcCos;
    if (!ok) continue;
    const [kx, ky] = norm(dx, dy);
    const pull = sk.p.pullOnHit ? -1 : 1;
    hitEnemy(s, e, mult, p, sk, { kb: sk.p.knockback * pull * (sk.p.pullOnHit ? 0.6 : 1), kx, ky, direct: true });
    hits++;
  }
  if (sk.p.healPerHit && hits) heal(p, p.stats.maxHp * sk.p.healPerHit * hits);
  if (sk.p.repair && hits) for (const m of s.summons) if (m.build && m.pid === p.pid && !m.dead && len(m.x - p.x, m.y - p.y) < 160) m.life += sk.p.repair * Math.min(3, hits);
  if (sk.p.genPerHit && hits) gainRes(p, Math.min(sk.p.genMax ?? 999, sk.p.genPerHit * hits));
  s.events.push({ type: "swing", pid: p.pid, skill: sk.id, x: p.x, y: p.y, fx: p.fx, fy: p.fy, ring, range: rng, hits, arcCos: sk.p.arcCos });
  if (sk.p.wave) {
    const sp = 210;
    s.projectiles.push(mkProj(s, 0, "wave", p.x + p.fx * 6, p.y + p.fy * 6, p.fx * sp, p.fy * sp, 9, p.pid, sk.id, sk.p.wave, 0, [...sk.tags, "fire"], true, 120 / sp, 30));
  }
}

function castProjectile(s: SimState, p: Player, sk: ResolvedSkill) {
  const n = Math.max(1, Math.round(sk.p.count ?? 1));
  const step = (sk.p.spreadSteps ?? 1) * 8; // in 1/256 turns
  const kind = sk.id === "ember_lance" ? "lance" : "bolt";
  const vol = s.nextId;
  for (let i = 0; i < n; i++) {
    const k = (i - (n - 1) / 2) * step;
    const [dx, dy] = rotFine(p.fx, p.fy, k);
    const pr = mkProj(s, 0, kind, p.x + dx * 6, p.y + dy * 6, dx * sk.p.speed, dy * sk.p.speed, sk.p.radius, p.pid, sk.id, sk.p.damage, 0, sk.tags, (sk.p.pierce ?? 0) > 0, sk.p.range / sk.p.speed, sk.p.knockback);
    pr.volley = vol;
    s.projectiles.push(pr);
  }
  s.events.push({ type: "cast", pid: p.pid, skill: sk.id, x: p.x, y: p.y });
}

function castShout(s: SimState, p: Player, sk: ResolvedSkill) {
  const P = sk.p;
  if (P.resGain) gainRes(p, P.resGain);
  if (P.colossus) {
    p.colossusT = P.duration; p.colossusSkill = sk.id; p.swingT = 0;
    if (P.arrival) explosion(s, p.x, p.y, (P.slamRadius ?? 46) * 1.3, 0, P.arrival, p, sk);
    if (P.partyHeal) for (const q of s.players) if (q !== p && !q.dead && len(q.x - p.x, q.y - p.y) < 140) { heal(q, q.stats.maxHp * P.partyHeal); q.buff = { ...q.buff, armorPct: Math.max(q.buff.t > 0 ? q.buff.armorPct : 0, 60), t: Math.max(q.buff.t, 6) }; }
  }
  if (P.boostBuilds) for (const m of s.summons) {
    if (!m.build || m.pid !== p.pid || m.dead) continue;
    m.life += P.boostBuilds; m.boostT = P.duration; m.boostPct = P.boostPct ?? 50;
    if (P.buildBlast) explosion(s, m.x, m.y, 40, 0, P.buildBlast, p, sk);
  }
  for (const q of s.players) {
    if (q.dead || len(q.x - p.x, q.y - p.y) > P.radius * 1.5) continue;
    if (P.selfOnly && q !== p) continue;
    q.buff = {
      armorPct: Math.max(q.buff.t > 0 ? q.buff.armorPct : 0, P.armorPct ?? 0),
      dmgPct: Math.max(q.buff.t > 0 ? q.buff.dmgPct : 0, P.dmgPct ?? 0),
      cdrPct: Math.max(q.buff.t > 0 ? q.buff.cdrPct : 0, P.cdrPct ?? 0),
      t: Math.max(q.buff.t, P.duration),
    };
    if (P.healPct) heal(q, q.stats.maxHp * P.healPct);
  }
  for (const e of s.enemies) {
    if (e.dead || len(e.x - p.x, e.y - p.y) > P.radius + e.r) continue;
    e.aggro = true;
    if (P.taunt) { e.tauntT = P.taunt; e.tauntBy = p.pid; }
    if (P.vulnPct) { e.vulnT = Math.max(6, P.duration ?? 0); e.vulnPct = Math.max(e.vulnPct, P.vulnPct); }
    if (P.slowAll) { e.slowT = Math.max(e.slowT, 4); e.slowPct = Math.min(90, Math.max(e.slowPct, P.slowAll)); }
    if (P.shoutDamage) { const [kx, ky] = norm(e.x - p.x, e.y - p.y); hitEnemy(s, e, P.shoutDamage, p, sk, { kb: 60, kx, ky, direct: true }); }
  }
  s.events.push({ type: "cast", pid: p.pid, skill: sk.id, x: p.x, y: p.y, r: P.radius });
}

function novaPulse(s: SimState, p: Player, sk: ResolvedSkill) {
  const P = sk.p;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const d = len(e.x - p.x, e.y - p.y);
    if (d > P.radius + e.r) continue;
    const [kx, ky] = norm(e.x - p.x, e.y - p.y);
    if (P.pull && e.kind !== "guardian" && e.kind !== "king") { const pull = Math.max(0, d - 14); moveWithWalls(s.map, e, -kx * pull * 0.8, -ky * pull * 0.8); }
    hitEnemy(s, e, P.damage, p, sk, { kb: P.knockback ?? 0, kx, ky, direct: true });
  }
  s.events.push({ type: "cast", pid: p.pid, skill: sk.id, x: p.x, y: p.y, r: P.radius });
}

function castSummon(s: SimState, p: Player, sk: ResolvedSkill) {
  const n = Math.max(1, Math.round(sk.p.count));
  // re-casting replaces your old minions
  for (const m of s.summons) if (m.pid === p.pid && m.skill === sk.id) { m.dead = true; if (sk.p.burst) explosion(s, m.x, m.y, 38, 0, sk.p.burst, p, sk); }
  for (let i = 0; i < n; i++) {
    const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
    const size = sk.p.size ?? 1;
    const m: Summon = { id: s.nextId++, pid: p.pid, skill: sk.id, x: p.x + d[0] * 10, y: p.y + d[1] * 10, px: 0, py: 0, r: 3 * size, life: sk.p.duration, atkT: 0, fx: 1, dead: false, ox: d[0] * 18, oy: d[1] * 18, size, kind: sk.id === "raven_swarm" ? "raven" : "imp" };
    if (isWall(s.map, m.x, m.y)) { m.x = p.x; m.y = p.y; }
    m.px = m.x; m.py = m.y;
    s.summons.push(m);
  }
  s.events.push({ type: "cast", pid: p.pid, skill: sk.id, x: p.x, y: p.y });
}

// ------------------------------------------------------------------ Bonewright constructs
const BUILD_KIND = ["", "turret", "mortar", "totem", "lantern", "turret"];
function castBuild(s: SimState, p: Player, sk: ResolvedSkill, inp: PlayerInput) {
  const P = sk.p, n = Math.max(1, Math.round(P.count ?? 1));
  let tx = p.x, ty = p.y;
  if ((P.castRange ?? 0) > 0) {
    tx = inp.ax; ty = inp.ay;
    const d = len(tx - p.x, ty - p.y);
    if (d > P.castRange) { tx = p.x + ((tx - p.x) / d) * P.castRange; ty = p.y + ((ty - p.y) / d) * P.castRange; }
    if (isWall(s.map, tx, ty)) { tx = p.x; ty = p.y; }
  }
  // the battery rings you; other constructs cluster at the aim point
  const ring = P.build === 5 ? 34 : n > 1 ? 14 : 0;
  for (let i = 0; i < n; i++) {
    const dir = DIR_TABLE[Math.floor((i * 32) / n) % 32];
    let x = tx + dir[0] * ring, y = ty + dir[1] * ring;
    if (isWall(s.map, x, y)) { x = tx; y = ty; }
    const m: Summon = { id: s.nextId++, pid: p.pid, skill: sk.id, x, y, px: x, py: y, r: 5, life: P.duration, atkT: 0.2 + i * 0.05, fx: 1, dead: false, ox: 0, oy: 0, size: 1, kind: BUILD_KIND[P.build] ?? "turret", build: P.build };
    s.summons.push(m);
  }
  // keep at most maxCount (+ extra from count) of this skill: the oldest fall apart
  const cap = Math.max(1, Math.round((P.maxCount ?? 1) + n - 1));
  const mine = s.summons.filter((m) => !m.dead && m.pid === p.pid && m.skill === sk.id);
  for (let i = 0; i < mine.length - cap; i++) mine[i].dead = true;
  s.events.push({ type: "cast", pid: p.pid, skill: sk.id, x: tx, y: ty, r: P.radius });
}

function updateBuild(s: SimState, m: Summon, p: Player, sk: ResolvedSkill) {
  const P = sk.p;
  const boost = (m.boostT ?? 0) > 0 ? 1 + (m.boostPct ?? 50) / 100 : 1;
  if ((m.boostT ?? 0) > 0) m.boostT! -= DT;
  m.atkT -= DT * boost;
  const rad = P.radius ?? 80;
  // auras: buffs, healing and enemy debuffs around the construct
  if (P.dmgPct || P.armorPct || P.cdrPct) for (const q of s.players) {
    if (q.dead || len(q.x - m.x, q.y - m.y) > rad) continue;
    q.buff = {
      armorPct: Math.max(q.buff.t > 0 ? q.buff.armorPct : 0, P.armorPct ?? 0),
      dmgPct: Math.max(q.buff.t > 0 ? q.buff.dmgPct : 0, P.dmgPct ?? 0),
      cdrPct: Math.max(q.buff.t > 0 ? q.buff.cdrPct : 0, P.cdrPct ?? 0),
      t: Math.max(q.buff.t, 0.3),
    };
  }
  if (P.healPerSec || P.resPerSec) for (const q of s.players) {
    if (q.dead || len(q.x - m.x, q.y - m.y) > rad) continue;
    if (P.healPerSec) heal(q, q.stats.maxHp * P.healPerSec * DT);
    if (P.resPerSec) gainRes(q, P.resPerSec * DT);
  }
  if (P.vulnAura || P.tauntAura) for (const e of s.enemies) {
    if (e.dead || len(e.x - m.x, e.y - m.y) > rad + e.r) continue;
    if (P.vulnAura) { e.vulnT = Math.max(e.vulnT, 0.5); e.vulnPct = Math.max(e.vulnPct, P.vulnAura); }
    if (P.tauntAura && e.kind !== "guardian" && e.kind !== "king") { e.tauntT = Math.max(e.tauntT, 0.5); e.tauntBy = p.pid; e.aggro = true; }
  }
  if (m.build !== 1 && m.build !== 2 && m.build !== 5) return;
  if (m.atkT > 0) return;
  // shooters: nearest enemy in range
  let target: Enemy | null = null, best = P.range ?? 170;
  for (const e of s.enemies) {
    if (e.dead || e.kind === "pylon") continue;
    const d = len(e.x - m.x, e.y - m.y);
    if (d < best) { best = d; target = e; }
  }
  if (!target) { m.atkT = 0.1; return; }
  m.atkT = P.attackInterval;
  m.fx = target.x >= m.x ? 1 : -1;
  const shots = Math.max(1, Math.round(P.shots ?? 1));
  if (m.build === 2) {
    for (let i = 0; i < shots; i++) {
      const d = DIR_TABLE[int(s.rng, 0, 31)], j = i === 0 ? 0 : range(s.rng, 10, 26);
      shell(s, target.x + d[0] * j, target.y + d[1] * j, P.radius ?? 30, P.damage, p, sk);
    }
    s.events.push({ type: "cast", pid: p.pid, skill: "mortar_fire", x: m.x, y: m.y });
    return;
  }
  const [dx, dy] = norm(target.x - m.x, target.y - m.y);
  const sp = P.speed ?? 280, vol = s.nextId;
  for (let i = 0; i < shots; i++) {
    const [vx, vy] = rotFine(dx, dy, (i - (shots - 1) / 2) * 10);
    const pr = mkProj(s, 0, "bolt", m.x + vx * 5, m.y - 4 + vy * 5, vx * sp, vy * sp, 3, p.pid, sk.id, P.damage, 0, sk.tags, (P.pierce ?? 0) > 0, ((P.range ?? 170) + 30) / sp, 15);
    pr.volley = vol; s.projectiles.push(pr);
  }
}

/** A mortar shell landing: like an explosion, but carries the skill's on-hit effects (burn, slow). */
function shell(s: SimState, x: number, y: number, r: number, mult: number, p: Player, sk: ResolvedSkill) {
  s.events.push({ type: "explosion", x, y, r, cold: sk.tags.includes("cold") && !sk.tags.includes("fire"), pid: p.pid, skill: sk.id });
  for (const e of s.enemies) {
    if (e.dead || len(e.x - x, e.y - y) > r + e.r) continue;
    const [kx, ky] = norm(e.x - x, e.y - y);
    hitEnemy(s, e, mult, p, sk, { kb: 40, kx, ky, direct: true });
  }
}

function colossusSlam(s: SimState, p: Player, sk: ResolvedSkill) {
  const P = sk.p;
  p.swingT = (P.slamInterval ?? 0.55) * atkMult(p);
  const r = P.slamRadius ?? 46;
  // centred a little in front of you, so you can aim it
  const cx = p.x + p.fx * r * 0.35, cy = p.y + p.fy * r * 0.35;
  let hits = 0;
  for (const e of s.enemies) {
    if (e.dead || len(e.x - cx, e.y - cy) > r + e.r) continue;
    const [kx, ky] = norm(e.x - cx, e.y - cy);
    hitEnemy(s, e, P.slamDamage, p, sk, { kb: P.knockback ?? 70, kx, ky, direct: true });
    hits++;
  }
  gainRes(p, 6);
  s.events.push({ type: "slam", x: cx, y: cy, r, big: hits > 2 });
}

function updateDash(s: SimState, p: Player) {
  const sk = p.sk[p.dashSkill];
  const speed = sk.p.distance / sk.p.duration;
  const blocked = moveWithWalls(s.map, p, p.dashDx * speed * DT, p.dashDy * speed * DT);
  p.dashT -= DT;
  if (blocked) p.dashT = 0;
  for (const e of s.enemies) {
    if (e.dead || p.dashHit.includes(e.id)) continue;
    if (len(e.x - p.x, e.y - p.y) < e.r + p.r + 8) {
      p.dashHit.push(e.id);
      hitEnemy(s, e, sk.p.damage, p, sk, { kb: sk.p.knockback, kx: p.dashDx, ky: p.dashDy, direct: true });
      if (sk.p.cdrOnHit) for (const id of p.skills) if (id !== sk.id && p.chargeT[id] !== undefined) p.chargeT[id] -= sk.p.cdrOnHit;
    }
  }
  if (sk.p.trail) {
    p.trailT -= DT;
    if (p.trailT <= 0) {
      p.trailT = 0.05;
      s.hazards.push({ id: s.nextId++, pid: p.pid, skill: sk.id, x: p.x, y: p.y, r: 10, mult: sk.p.trail, life: 3, max: 3, tickT: 0, tags: sk.tags, slowPct: sk.p.slowPct ?? 0, slowT: sk.p.slowT ?? 0, dead: false, kind: sk.tags.includes("cold") && !sk.tags.includes("fire") ? "frost" : "fire" });
    }
  }
  if (p.dashT <= 0 && sk.p.endBlast) explosion(s, p.x, p.y, 44, 0, sk.p.endBlast, p, sk);
}

function updatePending(s: SimState) {
  for (let i = s.pending.length - 1; i >= 0; i--) {
    const q = s.pending[i];
    q.t -= DT;
    if (q.t > 0) continue;
    s.pending.splice(i, 1);
    const p = playerById(s, q.pid);
    if (p && !p.dead && p.sk[q.skill]) novaPulse(s, p, p.sk[q.skill]);
  }
}

function mkProj(s: SimState, team: 0 | 1, kind: Projectile["kind"], x: number, y: number, vx: number, vy: number, r: number,
  pid: number, skill: string, mult: number, dmg: number, tags: string[], pierce: boolean, life: number, kb: number): Projectile {
  return { id: s.nextId++, team, kind, x, y, px: x, py: y, vx, vy, r, pid, skill, mult, dmg, tags, pierce, life, hit: [], returning: false, kb, dead: false, trailT: 0, cold: tags.includes("cold"), fire: tags.includes("fire"), volley: 0 };
}

// ------------------------------------------------------------------ damage
interface HitOpts { kb?: number; kx?: number; ky?: number; direct?: boolean; noCrit?: boolean; extra?: number; chained?: boolean }

/** Lightning jumps: each jump goes to the nearest enemy not yet hit, within chainRange of the last one. */
function chainFrom(s: SimState, from: Enemy, mult: number, p: Player, sk: ResolvedSkill, P: Num) {
  const hit = new Set<number>([from.id]);
  let cur = from, m = mult;
  for (let i = 0; i < Math.round(P.chain); i++) {
    let best: Enemy | null = null, bd = P.chainRange ?? 80;
    for (const e of s.enemies) { if (e.dead || hit.has(e.id)) continue; const d = len(e.x - cur.x, e.y - cur.y); if (d < bd) { bd = d; best = e; } }
    if (!best) break;
    hit.add(best.id); m *= P.chainMult ?? 0.7;
    s.events.push({ type: "chain", x1: cur.x, y1: cur.y, x2: best.x, y2: best.y, pid: p.pid, skill: sk.id });
    hitEnemy(s, best, m, p, sk, { kb: 0, kx: 0, ky: 0, direct: true, chained: true });
    cur = best;
  }
}
function hitEnemy(s: SimState, e: Enemy, mult: number, p: Player | undefined, sk: ResolvedSkill | undefined, o: HitOpts) {
  if (e.dead || ((e.kind === "guardian" || e.kind === "king") && e.state === "intro")) return;
  if (e.shieldT > 0 || (e.kind === "king" && e.state === "tomb")) { if (s.tick % 6 === 0) s.events.push({ type: "immune", x: e.x, y: e.y - e.r }); return; }
  if (!p) return;
  const st = p.stats;
  const tags = sk ? sk.tags : ["explosion"];
  const P = sk ? sk.p : ({} as Num);
  let dmg = range(s.rng, st.dmgMin, st.dmgMax) * mult * (P.power ?? 1) * (o.extra ?? 1);
  let pct = st.dmgPct + (p.buff.t > 0 ? p.buff.dmgPct : 0);
  for (const t of tags) pct += st.tagDmg[t] ?? 0;
  dmg *= (1 + pct / 100) * st.dmgMult;
  if (e.vulnT > 0) dmg *= 1 + e.vulnPct / 100;
  if (e.slowT > 0 && P.slowVuln) dmg *= 1 + P.slowVuln;
  if (e.elite || e.kind === "guardian" || e.kind === "king") dmg *= 1 + st.eliteDmg / 100;
  if (e.kind === "shieldbearer") {
    // where the hit came from: against the knock direction if there is one, else from the attacker
    const sx = o.kx || o.ky ? e.x - (o.kx ?? 0) * 20 : p.x, sy = o.kx || o.ky ? e.y - (o.ky ?? 0) * 20 : p.y;
    const f = shieldFactor(e, sx, sy);
    if (f < 1) { dmg *= f; if (s.tick % 4 === 0) s.events.push({ type: "immune", x: e.x + e.tx * 8, y: e.y + e.ty * 8 - 4 }); }
  }
  const crit = !o.noCrit && chance(s.rng, st.critChance / 100);
  if (crit) dmg *= 1 + st.critDmg / 100;
  const amount = Math.max(1, Math.round(dmg));
  // Thorns elites hurt whoever hits them (at most twice a second)
  if (e.elite && e.affixes.includes("thorns") && (p.thornT ?? 0) <= 0) { p.thornT = 0.5; damagePlayer(s, p, (ENEMIES[e.kind]?.damage ?? 10) * e.dmgMult * 0.35); }
  if (o.kb && e.kind !== "guardian" && e.kind !== "king" && e.kind !== "pylon") {
    const res = e.kind === "brute" ? 0.35 : e.elite ? 0.5 : 1;
    e.kbx += (o.kx ?? 0) * o.kb * res; e.kby += (o.ky ?? 0) * o.kb * res;
  }
  if (o.direct) {
    if (P.igniteMult) { const dps = (amount * P.igniteMult) / 3; e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps); e.burnT = 3; e.burnPid = p.pid; }
    if (P.slowPct) { e.slowT = Math.max(e.slowT, P.slowT ?? 1); e.slowPct = Math.min(90, Math.max(e.slowT > 0 ? e.slowPct : 0, P.slowPct)); }
    if (P.vulnOnHit) { e.vulnT = 3; e.vulnPct = Math.max(e.vulnPct, P.vulnOnHit); }
    if (P.tauntOnHit) { e.tauntT = P.tauntOnHit; e.tauntBy = p.pid; e.aggro = true; }
    if (P.chain && !o.chained && sk) chainFrom(s, e, mult, p, sk, P);
    // Stormlink gem: a chance to arc lightning
    if (st.flags.gemChain && !o.chained && sk && chance(s.rng, st.flags.gemChain)) chainFrom(s, e, st.flags.gemChainMult / 0.85, p, sk, { chain: 3, chainRange: 90, chainMult: 0.85 });
    if (st.lifeOnHit > 0) { const cap = p.stats.maxHp * RIFT.lifeOnHitCap, amt = Math.min(st.lifeOnHit, cap - p.leech); if (amt > 0) { p.leech += amt; heal(p, amt); } }
  }
  applyDamage(s, e, amount, crit, p.pid, P, false);
}

function applyDamage(s: SimState, e: Enemy, dmg: number, crit: boolean, pid: number, P: Num, burn: boolean) {
  e.hp -= dmg;
  e.flash = 3;
  const hitter = playerById(s, pid); if (hitter) hitter.combatT = 0;
  e.aggro = true;
  s.events.push({ type: "hit", x: e.x, y: e.y - e.r, amount: dmg, crit, kind: e.kind, burn, pid });
  if (e.hp <= 0) killEnemy(s, e, pid, P);
}

function explosion(s: SimState, x: number, y: number, r: number, flat: number, mult: number, p: Player | undefined, sk: ResolvedSkill | undefined) {
  s.events.push({ type: "explosion", x, y, r, cold: sk?.tags.includes("cold") && !sk.tags.includes("fire"), pid: p?.pid, skill: sk?.id });
  for (const e of s.enemies) {
    if (e.dead || len(e.x - x, e.y - y) > r + e.r) continue;
    if (flat > 0) { if (e.shieldT <= 0) applyDamage(s, e, Math.max(1, Math.round(flat)), false, p?.pid ?? 0, {}, false); }
    else { const [kx, ky] = norm(e.x - x, e.y - y); hitEnemy(s, e, mult, p, sk, { kb: 60, kx, ky }); }
  }
}

function killEnemy(s: SimState, e: Enemy, pid: number, P: Num) {
  if (e.dead) return;
  e.dead = true;
  s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite });
  const killer = playerById(s, pid);
  if (killer && killer.stats.flags.refundOnKill && P.cost) gainRes(killer, P.cost * killer.stats.flags.refundOnKill);
  if (killer && killer.stats.flags.healOnKill && !killer.dead) heal(killer, killer.stats.maxHp * killer.stats.flags.healOnKill);
  const def = ENEMIES[e.kind];
  if (e.kind === "pylon") return;
  grantXp(s, (def?.xp ?? 0) * (e.elite ? ELITES.xpMult : 1));
  if (e.kind === "guardian" || e.kind === "king") { completeRift(s, e); return; }
  s.rift.kills++;
  if (!e.noProgress) s.rift.progress = Math.min(s.rift.need, s.rift.progress + def.progress * (e.elite ? 4 : 1));
  if (!e.noProgress) {
    // per-player loot: everyone rolls their own drops
    for (const p of s.players) {
      const rolls = e.elite ? ELITES.drops : 1;
      for (let i = 0; i < rolls; i++) if (chance(s.rng, def.dropChance * modVal(s, "dropMult") * (e.elite ? 1.5 : 1))) dropFor(s, p, e.x, e.y, e.elite ? { legendaryWeightMult: 2 } : {});
    }
  }
  if (P.explodeOnKill) { const p = playerById(s, pid); explosion(s, e.x, e.y, 40, e.maxHp * P.explodeOnKill, 0, p, undefined); }
  if (s.rift.mods.includes("volatile")) s.zones.push({ id: s.nextId++, x: e.x, y: e.y, r: 22, delay: 0.8, life: 0, dmg: ENEMIES[e.kind].damage * 1.2 * e.dmgMult, kind: "blast", tickT: 0, dead: false });
  if (e.affixes.includes("molten")) s.zones.push({ id: s.nextId++, x: e.x, y: e.y, r: 40, delay: 1.0, life: 0, dmg: ENEMIES[e.kind].damage * 2 * e.dmgMult, kind: "blast", tickT: 0, dead: false });
}

function grantXp(s: SimState, base: number) {
  const t = s.rift.tier;
  let maxL = 1; for (const p of s.players) maxL = Math.max(maxL, p.level);
  for (const p of s.players) {
    if (p.level >= RIFT.levels.max) {
      // past max level, XP fills paragon levels instead
      p.pxp += Math.round(base * (1 + RIFT.tiers.xpGrowth * (t - 1)) * modVal(s, "xpMult"));
      while (p.pxp >= paragonXp(p.paragon)) { p.pxp -= paragonXp(p.paragon); p.paragon++; s.events.push({ type: "paragonUp", pid: p.pid, level: p.paragon }); }
      continue;
    }
    const catchup = p.level < maxL ? 1 + RIFT.levels.catchupXp : 1;
    p.xp += Math.round(base * (1 + RIFT.tiers.xpGrowth * (t - 1)) * modVal(s, "xpMult") * catchup);
    let leveled = false;
    while (p.level < RIFT.levels.max && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level); p.level++; leveled = true;
      s.events.push({ type: "levelUp", pid: p.pid, level: p.level });
    }
    if (leveled) { refreshAll(s); p.hp = p.stats.maxHp; for (const id of p.skills) if (p.charges[id] === undefined || SKILL[id].unlock === p.level) p.charges[id] = p.sk[id].p.charges ?? 1; }
  }
}

function lootOpts(s: SimState, p: Player, extra: MintOpts): MintOpts {
  const t = s.rift.tier, T = RIFT.tiers;
  return {
    tier: t, ilvl: Math.min(RIFT.levels.max, p.level + Math.floor(t / 4)), equipment: p.equipment, cls: p.cls,
    legendaryWeightMult: (s.rift.map && MAP[s.rift.map]?.legendaryWeightMult) || 1,
    ancestralChance: t >= T.ancestralFrom ? Math.min(T.ancestralCap, T.ancestralBase + T.ancestralPerTier * (t - T.ancestralFrom)) : 0,
    primalChance: t >= T.primalFrom ? T.primalChance : 0,
    ...extra,
  };
}

/** Nearest open floor point to (x, y), so loot never lands inside a wall. */
function onFloor(m: TileMap, x: number, y: number): [number, number] {
  if (!isWall(m, x, y)) return [x, y];
  const tx = Math.floor(x / m.ts), ty = Math.floor(y / m.ts);
  for (let r = 1; r < 12; r++) {
    let best: [number, number] | null = null, bd = 1e9;
    for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) {
      if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
      const cx = tx + ox, cy = ty + oy;
      if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h || m.tiles[cy * m.w + cx] !== 0) continue;
      const px = (cx + 0.5) * m.ts, py = (cy + 0.5) * m.ts, d = len(px - x, py - y);
      if (d < bd) { bd = d; best = [px, py]; }
    }
    if (best) return best;
  }
  return [x, y];
}

function dropFor(s: SimState, p: Player, x: number, y: number, extra: MintOpts) {
  [x, y] = onFloor(s.map, x, y);
  const opts = lootOpts(s, p, extra);
  if (s.mint === "external") { s.events.push({ type: "dropRequest", owner: p.pid, x, y, opts: { ...opts, equipment: undefined } }); return; }
  const id = `${(s.seed >>> 0).toString(36)}-${s.itemCounter++}`;
  const item = mintItem(s.rng, id, opts);
  s.loot.push({ id: s.nextId++, x, y, item, age: 0, owner: p.pid });
  s.events.push({ type: "drop", x, y, rarity: item.rarity, name: item.name, owner: p.pid, quality: item.quality });
}

function damagePlayer(s: SimState, p: Player, raw: number) {
  if (p.dead || p.invuln > 0) return;
  const st = p.stats;
  const armor = st.armor * (1 + (p.buff.t > 0 ? p.buff.armorPct : 0) / 100);
  let dmg = raw * (1 - armor / (armor + 150 * levelPower(Math.max(1, s.rift.tier * 1.5)))) * st.takenMult;
  if (p.buff.t > 0 && st.flags.buffDR) dmg *= 1 - st.flags.buffDR;
  if (st.flags.lowLifeDR && p.hp < st.maxHp / 2) dmg *= 1 - Math.min(0.6, st.flags.lowLifeDR);
  if ((p.colossusT ?? 0) > 0 && p.colossusSkill) dmg *= 1 - Math.min(90, p.sk[p.colossusSkill]?.p.takenPct ?? 0) / 100;
  dmg = Math.max(1, Math.round(dmg));
  p.hp -= dmg;
  p.combatT = 0; if (CLASSES[p.cls].resource.onHurt || st.flags.resOnHurt) gainRes(p, CLASSES[p.cls].resource.onHurt + (st.flags.resOnHurt ?? 0));
  s.events.push({ type: "playerHurt", pid: p.pid, amount: dmg });
  if (p.hp <= 0) {
    if (st.flags.cheatDeath && p.cheatT <= 0) {
      p.hp = st.maxHp; p.invuln = 3; p.cheatT = st.flags.cheatDeath;
      s.events.push({ type: "cheatDeath", pid: p.pid });
      return;
    }
    // each death in this rift waits longer before respawning: 4 s, 8 s, 12 s… up to 20 s
    p.deaths = (p.deaths ?? 0) + 1;
    const D = RIFT.deathPenalty;
    p.hp = 0; p.dead = true; p.deadT = Math.min(D.max, D.base + D.perDeath * (p.deaths - 1)); p.dashT = 0;
    s.events.push({ type: "playerDeath", pid: p.pid });
    // Endless: the run ends when the whole party is down at once
    // Endless: the party shares a pool of lives (3, +1 per extra player); the run ends when it runs out
    if (s.rift.kind === "endless" && !s.rift.done && endlessLivesLeft(s) <= 0) endEndless(s);
  }
}

// ------------------------------------------------------------------ enemies
function pickTarget(s: SimState, e: Enemy): Player | undefined {
  if (e.tauntT > 0) { const t = playerById(s, e.tauntBy); if (t && !t.dead) return t; }
  let best: Player | undefined, bd = 1e9;
  for (const p of s.players) { if (p.dead) continue; const d = len(p.x - e.x, p.y - e.y); if (d < bd) { bd = d; best = p; } }
  return best;
}

function updateEnemies(s: SimState) {
  const active: Enemy[] = [];
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.px = e.x; e.py = e.y;
    const tgt = pickTarget(s, e);
    if (!tgt) { if (e.state === "windup") e.state = "chase"; continue; }
    e.target = tgt.pid;
    const dx = tgt.x - e.x, dy = tgt.y - e.y, dist = len(dx, dy);
    if (!e.aggro && dist > 300) continue;
    active.push(e);
    if (!e.aggro && dist < 160) e.aggro = true;
    if (e.flash > 0) e.flash--;
    if (e.slowT > 0) e.slowT -= DT;
    if (e.vulnT > 0) e.vulnT -= DT;
    if (e.tauntT > 0) e.tauntT -= DT;
    if (e.burnT > 0) {
      e.burnT -= DT; e.burnTick -= DT;
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        if (e.shieldT <= 0) applyDamage(s, e, Math.max(1, Math.round(e.burnDps * 0.5)), false, e.burnPid, {}, true);
        if (e.dead) continue;
      }
    }
    if (e.kbx !== 0 || e.kby !== 0) {
      moveWithWalls(s.map, e, e.kbx * DT, e.kby * DT);
      e.kbx *= 0.78; e.kby *= 0.78;
      if (Math.abs(e.kbx) + Math.abs(e.kby) < 2) { e.kbx = 0; e.kby = 0; }
    }
    if (!e.aggro) continue;
    e.atkCd -= DT; e.t -= DT; e.age += DT;
    const def = ENEMIES[e.kind];
    if (e.elite) eliteAffixes(s, e, tgt, dist);
    const spd = (def?.speed ?? 0) * e.speedMult * (e.slowT > 0 ? 1 - e.slowPct / 100 : 1);
    switch (e.kind) {
      case "ghoul": case "hound": aiMelee(s, e, def, tgt, dist, dx, dy, spd); break;
      case "brute": aiBrute(s, e, def, tgt, dist, dx, dy, spd); break;
      case "archer": aiArcher(s, e, def, tgt, dist, dx, dy, spd); break;
      case "guardian": aiGuardian(s, e, def, tgt, dist, dx, dy, spd); break;
      case "hexer": aiHexer(s, e, def, tgt, dist, dx, dy, spd); break;
      case "gorehorn": aiGorehorn(s, e, def, tgt, dist, dx, dy, spd); break;
      case "shieldbearer": aiShield(s, e, def, tgt, dist, dx, dy, spd); break;
      case "king": if (e.variant === "seraph") aiSeraph(s, e, def, tgt, dist, dx, dy, spd); else aiKing(s, e, def, tgt, dist, dx, dy, spd); break;
      case "pylon": break;
    }
  }
  // separation: with many active enemies (Good Luck hordes) only pairs in nearby grid cells are checked
  const CELL = 24, gw = Math.ceil((s.map.w * s.map.ts) / CELL) + 3, useGrid = active.length >= 120;
  const grid = new Map<number, number[]>();
  if (useGrid) for (let i = 0; i < active.length; i++) { const a = active[i]; const k = (Math.floor(a.y / CELL) + 1) * gw + Math.floor(a.x / CELL) + 1; let b = grid.get(k); if (!b) grid.set(k, (b = [])); b.push(i); }
  const all = useGrid ? [] : active.map((_, j) => j);
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (a.dead) continue;
    let js = all;
    if (useGrid) {
      js = [];
      const cx = Math.floor(a.x / CELL) + 1, cy = Math.floor(a.y / CELL) + 1;
      for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) { const b = grid.get((cy + oy) * gw + cx + ox); if (b) for (const j of b) js.push(j); }
      js.sort((x, y) => x - y);
    }
    for (const j of js) {
      if (j <= i) continue;
      const b = active[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy), min = a.r + b.r;
      if (d < min && d > 0.001) {
        const push = (min - d) * 0.5, nx = dx / d, ny = dy / d;
        const heavyA = a.kind === "guardian" || a.kind === "king" || a.kind === "pylon", heavyB = b.kind === "guardian" || b.kind === "king" || b.kind === "pylon";
        const wa = heavyA ? 0 : heavyB ? 2 : 1;
        moveWithWalls(s.map, a, -nx * push * wa, -ny * push * wa);
        moveWithWalls(s.map, b, nx * push * (2 - wa), ny * push * (2 - wa));
      }
    }
    if (a.kind === "guardian" || a.kind === "king" || a.kind === "pylon") continue;
    for (const p of s.players) {
      if (p.dead) continue;
      const dx = a.x - p.x, dy = a.y - p.y, d = len(dx, dy), min = a.r + p.r;
      if (d < min && d > 0.001) moveWithWalls(s.map, a, (dx / d) * (min - d), (dy / d) * (min - d));
    }
  }
}

function eliteAffixes(s: SimState, e: Enemy, p: Player, dist: number) {
  const dmg = (ENEMIES[e.kind]?.damage ?? 10) * e.dmgMult;
  if (e.affixes.includes("shielded")) {
    if (e.shieldT > 0) e.shieldT -= DT;
    else { e.shieldCd -= DT; if (e.shieldCd <= 0) { e.shieldT = 2; e.shieldCd = 7; } }
  }
  e.affT -= DT; e.aff2T -= DT;
  if (e.affixes.includes("teleporting") && e.affT <= 0 && dist > 60) {
    e.affT = 5;
    const d = DIR_TABLE[s.tick % 32];
    const x = p.x + d[0] * 24, y = p.y + d[1] * 24;
    if (!isWall(s.map, x, y)) { s.events.push({ type: "teleport", x: e.x, y: e.y }); e.x = e.px = x; e.y = e.py = y; s.events.push({ type: "teleport", x, y }); }
  }
  if (e.affixes.includes("mortar") && e.aff2T <= 0 && dist < 220) {
    e.aff2T = 3.5;
    s.zones.push({ id: s.nextId++, x: p.x, y: p.y, r: 24, delay: 1.3, life: 0, dmg: dmg * 1.4, kind: "blast", tickT: 0, dead: false });
  }
  if (e.affixes.includes("molten") && s.tick % 15 === 0 && (e.x !== e.px || e.y !== e.py)) {
    s.zones.push({ id: s.nextId++, x: e.x, y: e.y, r: 10, delay: 0, life: 3, dmg: dmg * 0.6, kind: "pool", tickT: 0, dead: false });
  }
  if (e.affixes.includes("frozen") && s.tick % 120 === (e.id % 120) && dist < 200) {
    for (let i = 0; i < 3; i++) { const d = DIR_TABLE[(s.tick + i * 11) % 32]; s.zones.push({ id: s.nextId++, x: p.x + d[0] * 18 * i, y: p.y + d[1] * 18 * i, r: 20, delay: 1.4, life: 0, dmg: dmg * 0.8, kind: "frost", tickT: 0, dead: false }); }
  }
  if (e.affixes.includes("vortex") && e.affT <= 0 && dist > 40 && dist < 160 && !e.affixes.includes("teleporting")) {
    e.affT = 6;
    const [nx, ny] = norm(e.x - p.x, e.y - p.y);
    moveWithWalls(s.map, p, nx * (dist - 20) * 0.8, ny * (dist - 20) * 0.8);
    s.events.push({ type: "teleport", x: p.x, y: p.y });
  }
}

function chase(s: SimState, e: Enemy, p: Player, speed: number, dx: number, dy: number, dist: number) {
  let mx = dx, my = dy;
  const f = s._flows[s.players.indexOf(p)], m = s.map;
  if (f && dist > 36) {
    const tx = Math.floor(e.x / m.ts), ty = Math.floor(e.y / m.ts);
    const here = f[ty * m.w + tx];
    if (here > 0) {
      let best = here, bx = 0, by = 0;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const v = f[(ty + oy) * m.w + tx + ox];
        if (v >= 0 && v < best) { best = v; bx = ox; by = oy; }
      }
      if (best < here) { mx = (tx + bx + 0.5) * m.ts - e.x; my = (ty + by + 0.5) * m.ts - e.y; }
    }
  }
  const [nx, ny] = norm(mx, my);
  moveWithWalls(s.map, e, nx * speed * DT, ny * speed * DT);
}

function aiMelee(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (e.state === "windup") {
    if (e.t <= 0) {
      if (dist <= e.r + p.r + def.attackRange + 4) damagePlayer(s, p, def.damage * e.dmgMult);
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; return; }
  if (dist > e.r + p.r + 2) chase(s, e, p, spd, dx, dy, dist);
}

function aiBrute(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (e.state === "windup") {
    if (e.t <= 0) {
      const r = def.slamRadius! * e.scale;
      for (const q of s.players) if (!q.dead && len(q.x - e.tx, q.y - e.ty) <= r + q.r) damagePlayer(s, q, def.damage * e.dmgMult);
      s.events.push({ type: "slam", x: e.tx, y: e.ty, r, big: false });
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) {
    const [nx, ny] = norm(dx, dy);
    e.state = "windup"; e.t = def.windup; e.tx = e.x + nx * 14; e.ty = e.y + ny * 14;
    return;
  }
  if (dist > e.r + p.r + 2) chase(s, e, p, spd, dx, dy, dist);
}

function aiArcher(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (e.state === "windup") {
    if (e.t <= 0) {
      const [nx, ny] = norm(p.x - e.x, p.y - e.y);
      s.projectiles.push(mkProj(s, 1, "arrow", e.x, e.y, nx * def.projectileSpeed!, ny * def.projectileSpeed!, 3, -1, "", 0, def.damage * e.dmgMult, [], false, 2.2, 0));
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist < def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; return; }
  if (dist > def.attackRange * 0.8) chase(s, e, p, spd, dx, dy, dist);
  else if (dist < 70) { const [nx, ny] = norm(dx, dy); moveWithWalls(s.map, e, -nx * spd * DT, -ny * spd * DT); }
}

/** Bone Hexer: hangs back and curses the ground under you (a delayed blast you can step out of). */
function aiHexer(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (e.state === "windup") {
    if (e.t <= 0) {
      s.zones.push({ id: s.nextId++, x: e.tx, y: e.ty, r: def.blastRadius!, delay: def.blastDelay!, life: 0, dmg: def.damage * e.dmgMult, kind: "blast", tickT: 0, dead: false });
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist < def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; e.tx = p.x; e.ty = p.y; return; }
  if (dist > def.attackRange * 0.75) chase(s, e, p, spd, dx, dy, dist);
  else if (dist < 90) { const [nx, ny] = norm(dx, dy); moveWithWalls(s.map, e, -nx * spd * DT, -ny * spd * DT); }
}

/** Gorehorn: lowers its head, then charges in a straight line. Hitting a wall stuns it. */
function aiGorehorn(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (e.state === "windup") {
    if (e.t <= 0) { e.state = "charging"; e.t = def.chargeTime!; e.chargeHit = false; }
    return;
  }
  if (e.state === "charging") {
    const blocked = moveWithWalls(s.map, e, e.tx * def.chargeSpeed! * DT, e.ty * def.chargeSpeed! * DT);
    for (const q of s.players) if (!e.chargeHit && !q.dead && len(q.x - e.x, q.y - e.y) < e.r + q.r + 2) { e.chargeHit = true; damagePlayer(s, q, def.damage * e.dmgMult); }
    if (blocked) { e.state = "stun"; e.t = 1.2; s.events.push({ type: "slam", x: e.x, y: e.y, r: 14, big: false }); }
    else if (e.t <= 0) { e.state = "chase"; e.atkCd = def.attackCooldown; }
    return;
  }
  if (e.state === "stun") { if (e.t <= 0) { e.state = "chase"; e.atkCd = def.attackCooldown * 0.5; } return; }
  if (dist < def.attackRange && dist > 30 && e.atkCd <= 0) { const [nx, ny] = norm(dx, dy); e.state = "windup"; e.t = def.windup; e.tx = nx; e.ty = ny; return; }
  if (dist > e.r + p.r + 2) chase(s, e, p, spd, dx, dy, dist);
}

/** Shieldbearer: a tower shield faces its target and blocks most damage from the front. Flank it. */
function aiShield(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  // turn slowly toward the target, so a quick player can get round the side
  const [nx, ny] = norm(dx, dy), turn = 2.2 * DT;
  if (e.tx === 0 && e.ty === 0) { e.tx = nx; e.ty = ny; }
  const [fx, fy] = norm(e.tx + (nx - e.tx) * turn, e.ty + (ny - e.ty) * turn); e.tx = fx; e.ty = fy;
  if (e.state === "windup") {
    if (e.t <= 0) {
      for (const q of s.players) if (!q.dead && len(q.x - e.x, q.y - e.y) <= e.r + q.r + def.attackRange) damagePlayer(s, q, def.damage * e.dmgMult);
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; return; }
  if (dist > e.r + p.r + 2) chase(s, e, p, spd, dx, dy, dist);
}
/** How much of a hit from (x, y) a Shieldbearer's shield lets through. */
export function shieldFactor(e: Enemy, x: number, y: number): number {
  if (e.kind !== "shieldbearer" || e.state === "stun") return 1;
  const [nx, ny] = norm(x - e.x, y - e.y);
  return nx * e.tx + ny * e.ty > 0.35 ? 1 - (ENEMIES.shieldbearer.shieldBlock ?? 0.75) : 1;
}

function bossCommon(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number, pattern: string[], adds: EnemyKind[]): void {
  const en = e.enraged;
  const dmg = def.damage * e.dmgMult * (en ? 2 : 1);
  const sp = spd * (en ? 1.4 : 1);
  switch (e.state) {
    case "intro": if (e.t <= 0) { e.state = "idle"; e.t = 1.0; } return;
    case "stun": if (e.t <= 0) { e.state = "idle"; e.t = 0.6; } return;
    case "slam":
      if (e.t <= 0) {
        for (const q of s.players) if (!q.dead && len(q.x - e.tx, q.y - e.ty) <= def.slamRadius! + q.r) damagePlayer(s, q, dmg * 1.5);
        s.events.push({ type: "slam", x: e.tx, y: e.ty, r: def.slamRadius!, big: true });
        e.state = "idle"; e.t = Math.max(e.t, 0.5); e.atkCd = def.attackCooldown;
      }
      return;
    case "nova":
      if (e.t <= 0) {
        const step = en ? 1 : 2;
        const off = e.pattern % 2;
        for (let i = off; i < 32; i += step) {
          const [cx, cy] = DIR_TABLE[i];
          s.projectiles.push(mkProj(s, 1, "bone", e.x, e.y, cx * def.novaSpeed!, cy * def.novaSpeed!, 4, -1, "", 0, dmg, [], false, 3.5, 0));
        }
        s.events.push({ type: "slam", x: e.x, y: e.y, r: 20, big: true });
        e.state = "idle"; e.t = en ? 0.6 : 1.2;
      }
      return;
    case "chargeWind":
      if (e.t <= 0) { e.state = "charging"; e.t = 0.75; e.chargeHit = false; }
      return;
    case "charging": {
      const blocked = moveWithWalls(s.map, e, e.tx * def.chargeSpeed! * DT, e.ty * def.chargeSpeed! * DT);
      for (const q of s.players) if (!e.chargeHit && !q.dead && len(q.x - e.x, q.y - e.y) < e.r + q.r + 2) { e.chargeHit = true; damagePlayer(s, q, dmg * 1.6); }
      if (blocked) { e.combo = 0; e.state = "stun"; e.t = 1.6; s.events.push({ type: "guardianStun" }); s.events.push({ type: "slam", x: e.x, y: e.y, r: 24, big: true }); }
      else if (e.t <= 0) {
        // the Reaver chains up to three charges, re-aiming each time
        if ((e.combo ?? 0) > 1) { e.combo! -= 1; const [nx, ny] = norm(p.x - e.x, p.y - e.y); e.tx = nx; e.ty = ny; e.state = "chargeWind"; e.t = en ? 0.3 : 0.45; }
        else { e.combo = 0; e.state = "idle"; e.t = en ? 0.5 : 1.0; }
      }
      return;
    }
    case "raise":
      if (e.t <= 0) {
        let n = 0;
        for (const o of s.enemies) if (!o.dead && o.noProgress) n++;
        for (let i = 0; i < 4 && n < 8; i++, n++) {
          const d = DIR_TABLE[i * 8 + 4];
          const x = e.x + d[0] * 30, y = e.y + d[1] * 30;
          if (isWall(s.map, x, y)) continue;
          const g = spawnEnemy(s, adds[i % adds.length], x, y, s.players.length);
          g.aggro = true; g.noProgress = true;
        }
        e.state = "idle"; e.t = 1.0;
      }
      return;
    case "mire":
      if (e.t <= 0) {
        // the Matron spits slowing pools at everyone, plus a few around her
        for (const q of s.players) if (!q.dead) s.zones.push({ id: s.nextId++, x: q.x, y: q.y, r: 22, delay: 0.9, life: 5, dmg: dmg * 0.5, kind: "mire", tickT: 0.9, dead: false });
        for (let i = 0; i < 3; i++) { const d = DIR_TABLE[(e.pattern * 5 + i * 11) % 32], x = e.x + d[0] * 60, y = e.y + d[1] * 60; if (!isWall(s.map, x, y)) s.zones.push({ id: s.nextId++, x, y, r: 26, delay: 0.9, life: 6, dmg: dmg * 0.5, kind: "mire", tickT: 0.9, dead: false }); }
        e.state = "idle"; e.t = en ? 0.7 : 1.1;
      }
      return;
    case "spiral":
      if (e.t <= 0) {
        // the Scribe: three rotating rings of bone shards with gaps to slip through
        const k = e.combo ?? 0;
        for (let i = k * 3; i < 32 + k * 3; i += 3) {
          const [cx, cy] = DIR_TABLE[i % 32];
          s.projectiles.push(mkProj(s, 1, "bone", e.x, e.y, cx * def.novaSpeed! * 0.85, cy * def.novaSpeed! * 0.85, 4, -1, "", 0, dmg * 0.8, [], false, 3.5, 0));
        }
        s.events.push({ type: "slam", x: e.x, y: e.y, r: 16, big: false });
        e.combo = k + 1;
        if (e.combo < 3) e.t = en ? 0.25 : 0.4; else { e.combo = 0; e.state = "idle"; e.t = en ? 0.6 : 1.0; }
      }
      return;
    case "blink":
      if (e.t <= 0) {
        // the Scribe vanishes and reappears at range, then answers with a ring of shards
        let bx = e.x, by = e.y;
        for (let i = 0; i < 16; i++) {
          const d = DIR_TABLE[(e.pattern * 7 + i * 5) % 32], x = p.x + d[0] * 120, y = p.y + d[1] * 120;
          if (!isWall(s.map, x, y) && !isWall(s.map, x + 12, y) && !isWall(s.map, x - 12, y) && !isWall(s.map, x, y + 12) && !isWall(s.map, x, y - 12)) { bx = x; by = y; break; }
        }
        s.events.push({ type: "teleport", x: e.x, y: e.y });
        e.x = e.px = bx; e.y = e.py = by;
        s.events.push({ type: "teleport", x: bx, y: by });
        e.state = "nova"; e.t = en ? 0.5 : 0.8;
      }
      return;
    case "fire":
      if (e.t <= 0) {
        // fire grid: rows of delayed blasts the party must step out of
        for (let i = 0; i < 9; i++) {
          const d = DIR_TABLE[(i * 7 + e.pattern * 3) % 32];
          const rr = 30 + ((i * 37) % 110);
          const x = e.x + d[0] * rr, y = e.y + d[1] * rr;
          if (!isWall(s.map, x, y)) s.zones.push({ id: s.nextId++, x, y, r: 26, delay: 1.4, life: 0, dmg: dmg * 1.5, kind: "blast", tickT: 0, dead: false });
        }
        for (const q of s.players) if (!q.dead) s.zones.push({ id: s.nextId++, x: q.x, y: q.y, r: 26, delay: 1.4, life: 0, dmg: dmg * 1.5, kind: "blast", tickT: 0, dead: false });
        e.state = "idle"; e.t = 1.0;
      }
      return;
    default: {
      if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) {
        const [nx, ny] = norm(dx, dy);
        e.state = "slam"; e.t = def.windup; e.tx = e.x + nx * 18; e.ty = e.y + ny * 18;
        return;
      }
      if (e.t <= 0) {
        const nxt = pattern[e.pattern % pattern.length];
        e.pattern++;
        if (nxt === "nova") { e.state = "nova"; e.t = en ? 0.7 : 1.0; }
        else if (nxt === "raise") { e.state = "raise"; e.t = 0.8; }
        else if (nxt === "fire") { e.state = "fire"; e.t = 0.6; }
        else if (nxt === "mire") { e.state = "mire"; e.t = 0.7; }
        else if (nxt === "spiral") { e.state = "spiral"; e.t = 0.7; e.combo = 0; }
        else if (nxt === "blink") { e.state = "blink"; e.t = 0.5; }
        else if (nxt === "rush") { const [nx, ny] = norm(dx, dy); e.combo = 3; e.state = "chargeWind"; e.t = en ? 0.55 : 0.85; e.tx = nx; e.ty = ny; }
        else { const [nx, ny] = norm(dx, dy); e.state = "chargeWind"; e.t = en ? 0.55 : 0.85; e.tx = nx; e.ty = ny; }
        return;
      }
      if (dist > e.r + p.r + 4) chase(s, e, p, sp, dx, dy, dist);
    }
  }
}

/** Which guardian guards this rift: weighted by data, only those unlocked at this tier. */
function pickGuardian(s: SimState): GuardianDef {
  const ok = GUARDIANS.filter((g) => g.minTier <= s.rift.tier);
  return weighted(s.rng, ok.length ? ok : [GUARDIANS[0]]);
}
function aiGuardian(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (!e.enraged && e.age >= def.enrageAfter!) { e.enraged = true; s.events.push({ type: "enrage" }); }
  const gd = guardianDef(e.variant);
  // the Scribe backs away when you get close (but not while winding up an attack)
  if (gd.kite && e.state === "idle" && dist < gd.kite && e.t > 0.2) {
    const [nx, ny] = norm(dx, dy);
    moveWithWalls(s.map, e, -nx * spd * 0.9 * DT, -ny * spd * 0.9 * DT);
  }
  bossCommon(s, e, def, p, dist, dx, dy, spd, gd.pattern, gd.adds as EnemyKind[]);
}

/** Chase boss: three phases that each test a role (dodge hazards, hold adds, burn a damage check). */
function aiKing(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (!e.enraged && e.age >= def.enrageAfter!) { e.enraged = true; s.events.push({ type: "enrage" }); }
  const frac = e.hp / e.maxHp;
  if (e.phase === 1 && frac < 0.66) { e.phase = 2; e.pattern = 0; s.events.push({ type: "phase", n: 2, text: "The King calls his court" }); }
  if (e.phase === 2 && frac < 0.33) {
    e.phase = 3; e.state = "tomb"; e.t = 14;
    s.events.push({ type: "phase", n: 3, text: "Break the bone pylons before the King mends!" });
    for (let i = 0; i < 3; i++) {
      const d = DIR_TABLE[i * 11 + 2];
      const py = spawnEnemy(s, "pylon", e.x + d[0] * 90, e.y + d[1] * 90, s.players.length);
      py.hp = py.maxHp = Math.round(e.maxHp * 0.04); py.r = 7; py.aggro = true; py.noProgress = true;
    }
    return;
  }
  if (e.state === "tomb") {
    const alive = s.enemies.filter((o) => o.kind === "pylon" && !o.dead).length;
    if (alive === 0) { e.state = "stun"; e.t = 4; s.events.push({ type: "phase", n: 4, text: "The King is exposed!" }); return; }
    if (e.t <= 0) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.2);
      for (const o of s.enemies) if (o.kind === "pylon") o.dead = true;
      e.state = "idle"; e.t = 1; e.phase = 2; s.events.push({ type: "phase", n: 2, text: "Too slow. The King mends." });
    }
    return;
  }
  const pat = e.phase === 1 ? ["fire", "nova", "charge", "fire", "nova"] : ["raise", "fire", "nova", "charge", "raise", "nova"];
  bossCommon(s, e, def, p, dist, dx, dy, spd, pat, ["brute", "archer", "ghoul", "archer"]);
}

/** Second chase boss: a ranged duellist. Dodge shard rings, hold the choir, then survive her Judgement to ground her. */
function aiSeraph(s: SimState, e: Enemy, def: EnemyDef, p: Player, dist: number, dx: number, dy: number, spd: number) {
  if (!e.enraged && e.age >= def.enrageAfter!) { e.enraged = true; s.events.push({ type: "enrage" }); }
  const frac = e.hp / e.maxHp, S = RIFT.seraph;
  if (e.phase === 1 && frac < 0.66) { e.phase = 2; e.pattern = 0; s.events.push({ type: "phase", n: 2, text: "The Seraph calls her choir" }); }
  if (e.phase === 2 && frac < 0.33) {
    // Judgement: she rises out of reach and rains fire; outlast it and she falls, stunned
    e.phase = 3; e.state = "tomb"; e.t = S.judgement;
    for (const o of s.enemies) if (o.noProgress && !o.dead) { o.dead = true; s.events.push({ type: "kill", x: o.x, y: o.y, kind: o.kind, elite: o.elite }); }
    s.events.push({ type: "phase", n: 3, text: "JUDGEMENT. Keep moving!" });
    return;
  }
  if (e.state === "tomb") {
    const dmg = def.damage * e.dmgMult;
    if (s.tick % 27 === 0) {
      for (const q of s.players) if (!q.dead) s.zones.push({ id: s.nextId++, x: q.x, y: q.y, r: 24, delay: 1.0, life: 0, dmg: dmg * 1.3, kind: "blast", tickT: 0, dead: false });
    }
    if (s.tick % 45 === 0) {
      const off = Math.floor(s.tick / 45) % 4;
      for (let i = off; i < 32; i += 4) { const [cx, cy] = DIR_TABLE[i]; s.projectiles.push(mkProj(s, 1, "bone", e.x, e.y, cx * def.novaSpeed! * 0.7, cy * def.novaSpeed! * 0.7, 4, -1, "", 0, dmg * 0.7, [], false, 3.5, 0)); }
    }
    if (e.t <= 0) { e.state = "stun"; e.t = S.fallStun; s.events.push({ type: "phase", n: 4, text: "The Seraph falls! Strike now!" }); s.events.push({ type: "slam", x: e.x, y: e.y, r: 40, big: true }); }
    return;
  }
  // she keeps her distance between attacks
  if (e.state === "idle" && dist < S.kite && e.t > 0.2) {
    const [nx, ny] = norm(dx, dy);
    moveWithWalls(s.map, e, -nx * spd * DT, -ny * spd * DT);
  }
  const pat = e.phase === 1 ? ["spiral", "blink", "fire", "spiral", "nova"] : e.phase === 2 ? ["raise", "spiral", "blink", "fire", "nova", "spiral"] : ["spiral", "blink", "fire", "nova", "blink"];
  bossCommon(s, e, def, p, dist, dx, dy, spd, pat, ["shieldbearer", "hexer", "archer", "hexer"]);
}

// ------------------------------------------------------------------ summons, projectiles, hazards, zones, loot
function updateSummons(s: SimState) {
  for (const m of s.summons) {
    m.px = m.x; m.py = m.y;
    const p = playerById(s, m.pid);
    if (!p) { m.dead = true; continue; }
    const sk = p.sk[m.skill];
    m.life -= DT;
    if (m.life <= 0) {
      m.dead = true;
      if (sk.p.burst) explosion(s, m.x, m.y, 38, 0, sk.p.burst, p, sk);
      continue;
    }
    if (m.build) { updateBuild(s, m, p, sk); continue; }
    let target: Enemy | null = null, best = 150;
    for (const e of s.enemies) {
      if (e.dead || (!e.aggro && len(e.x - p.x, e.y - p.y) > 200)) continue;
      const d = len(e.x - m.x, e.y - m.y);
      if (d < best) { best = d; target = e; }
    }
    m.atkT -= DT;
    if (target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      m.fx = dx >= 0 ? 1 : -1;
      if (best > target.r + 6) { const [nx, ny] = norm(dx, dy); moveWithWalls(s.map, m, nx * sk.p.speed * DT, ny * sk.p.speed * DT); }
      else if (sk.p.contactExplode) { m.dead = true; explosion(s, m.x, m.y, 30, 0, sk.p.contactExplode, p, sk); }
      else if (m.atkT <= 0) {
        m.atkT = sk.p.attackInterval;
        const [kx, ky] = norm(dx, dy);
        hitEnemy(s, target, sk.p.damage, p, sk, { kb: 20, kx, ky, direct: true });
        if (sk.p.healPerHit) heal(p, p.stats.maxHp * sk.p.healPerHit);
      }
    } else {
      const tx = p.x + m.ox, ty = p.y + m.oy, dx = tx - m.x, dy = ty - m.y, d = len(dx, dy);
      if (d > 4) { const [nx, ny] = norm(dx, dy); const sp = Math.min(d, sk.p.speed * DT * (d > 60 ? 1.6 : 1)); moveWithWalls(s.map, m, nx * sp, ny * sp); m.fx = dx >= 0 ? 1 : -1; }
    }
  }
}

function updateProjectiles(s: SimState) {
  for (const pr of s.projectiles) {
    if (pr.dead) continue;
    pr.px = pr.x; pr.py = pr.y;
    const owner = pr.team === 0 ? playerById(s, pr.pid) : undefined;
    if (pr.team === 0 && !owner) { pr.dead = true; continue; }
    const sk = owner?.sk[pr.skill];
    if (pr.returning && owner) {
      const [nx, ny] = norm(owner.x - pr.x, owner.y - pr.y);
      const sp = len(pr.vx, pr.vy);
      pr.vx = nx * sp; pr.vy = ny * sp;
      if (len(owner.x - pr.x, owner.y - pr.y) < owner.r + 6) { pr.dead = true; continue; }
    }
    pr.x += pr.vx * DT; pr.y += pr.vy * DT;
    pr.life -= DT;
    const wall = isWall(s.map, pr.x, pr.y);
    if (pr.team === 0 && owner && sk) {
      if (sk.p.trail && pr.kind !== "wave") {
        pr.trailT -= DT;
        if (pr.trailT <= 0) { pr.trailT = 0.06; s.hazards.push({ id: s.nextId++, pid: owner.pid, skill: sk.id, x: pr.x, y: pr.y, r: 9, mult: sk.p.trail, life: 2.5, max: 2.5, tickT: 0, tags: sk.tags, slowPct: sk.p.slowPct ?? 0, slowT: sk.p.slowT ?? 0, dead: false, kind: pr.cold && !pr.fire ? "frost" : "fire" }); }
      }
      for (const e of s.enemies) {
        if (e.dead || pr.hit.includes(e.id)) continue;
        if (len(e.x - pr.x, e.y - pr.y) < e.r + pr.r) {
          pr.hit.push(e.id);
          const [kx, ky] = norm(pr.vx, pr.vy);
          let grow = sk.p.pierceGrow ? 1 + sk.p.pierceGrow * (pr.hit.length - 1) : 1;
          // extra projectiles widen the spread; stacking them all into one enemy only adds a little
          if (pr.volley) { if (e.vol === pr.volley) grow *= RIFT.volleyRepeat; else e.vol = pr.volley; }
          hitEnemy(s, e, pr.mult, owner, sk, { kb: pr.kb, kx, ky, direct: true, extra: grow });
          if (!pr.pierce) { pr.dead = true; break; }
        }
      }
      if (pr.dead) continue;
      if ((wall && !pr.returning) || pr.life <= 0) {
        if (!pr.returning && sk.p.returns && pr.pierce) {
          pr.returning = true; pr.hit = []; pr.life = 3;
          if (wall) { pr.x = pr.px; pr.y = pr.py; }
        } else pr.dead = true;
      }
    } else if (pr.team === 1) {
      if (wall || pr.life <= 0) { pr.dead = true; continue; }
      for (const p of s.players) if (!p.dead && p.invuln <= 0 && len(p.x - pr.x, p.y - pr.y) < p.r + pr.r) { damagePlayer(s, p, pr.dmg); pr.dead = true; break; }
    }
  }
}

function updateHazards(s: SimState) {
  for (const h of s.hazards) {
    h.life -= DT; h.tickT -= DT;
    if (h.life <= 0) { h.dead = true; continue; }
    if (h.tickT > 0) continue;
    h.tickT = 0.5;
    const p = playerById(s, h.pid);
    const sk = p?.sk[h.skill];
    if (!p || !sk) { h.dead = true; continue; }
    for (const e of s.enemies) {
      if (e.dead || len(e.x - h.x, e.y - h.y) > h.r + e.r) continue;
      hitEnemy(s, e, h.mult * 0.5, p, sk, { noCrit: true });
      if (h.slowPct) { e.slowT = Math.max(e.slowT, h.slowT || 0.6); e.slowPct = Math.min(90, Math.max(e.slowPct, h.slowPct)); }
      if (sk.p.vulnOnHit && !e.dead) { e.vulnT = Math.max(e.vulnT, 1); e.vulnPct = Math.max(e.vulnPct, sk.p.vulnOnHit); }
    }
  }
}

function updateZones(s: SimState) {
  for (const z of s.zones) {
    if (z.kind === "blast" || z.kind === "frost") {
      z.delay -= DT;
      if (z.delay > 0) continue;
      z.dead = true;
      for (const p of s.players) if (!p.dead && len(p.x - z.x, p.y - z.y) < z.r + p.r) { damagePlayer(s, p, z.dmg); if (z.kind === "frost") p.chillT = 2; }
      s.events.push({ type: "slam", x: z.x, y: z.y, r: z.r, big: false });
    } else {
      z.life -= DT; z.tickT -= DT;
      if (z.life <= 0) { z.dead = true; continue; }
      if (z.tickT <= 0) { z.tickT = 0.5; for (const p of s.players) if (!p.dead && len(p.x - z.x, p.y - z.y) < z.r + p.r) { damagePlayer(s, p, z.dmg * 0.5); if (z.kind === "mire") p.chillT = Math.max(p.chillT ?? 0, 0.8); } }
    }
  }
}

export function pickupRadius(p: Player) { return p.pet && p.pet !== "none" ? (p.level >= 15 ? 70 : 42) : 14; }
export function hiddenByFilter(p: Player, it: Item) {
  if (RARITY_ORDER.indexOf(it.rarity) >= RARITY_ORDER.indexOf(p.filter)) return false;
  return true;
}

function updateLoot(s: SimState) {
  for (let i = s.loot.length - 1; i >= 0; i--) {
    const l = s.loot[i];
    l.age += DT;
    if (l.age < 0.4) continue;
    const p = playerById(s, l.owner);
    if (!p) { s.loot.splice(i, 1); continue; }
    if (p.dead || len(l.x - p.x, l.y - p.y) > pickupRadius(p)) continue;
    if (hiddenByFilter(p, l.item)) {
      // auto-scrap: anything the loot filter hides turns into materials on pickup
      const v = scrapValue(l.item);
      p.materials += v; p.shards = (p.shards ?? 0) + shardValue(l.item); s.loot.splice(i, 1);
      s.events.push({ type: "scrapped", pid: p.pid, name: l.item.name, mats: v, id: l.item.id });
      continue;
    }
    // an empty gear slot takes the item straight away
    const slot = equipTarget(p, l.item);
    if (!p.equipment[slot] && ITEMS_EQUIP_SLOTS.includes(slot)) {
      p.equipment[slot] = l.item;
      s.loot.splice(i, 1);
      refreshAll(s);
      s.events.push({ type: "pickup", pid: p.pid, rarity: l.item.rarity, name: l.item.name, item: l.item });
      s.events.push({ type: "equipChanged", pid: p.pid });
      continue;
    }
    if (p.bag.length >= BAG_SIZE) { if (s.tick % 45 === 0) s.events.push({ type: "bagFull", pid: p.pid }); continue; }
    p.bag.push(l.item);
    s.loot.splice(i, 1);
    s.events.push({ type: "pickup", pid: p.pid, rarity: l.item.rarity, name: l.item.name, item: l.item });
  }
}

// ------------------------------------------------------------------ rift
/** Ambush: a pack spawns just off-screen around a random living player and hunts the party. */
/** Fresh characters on tiers 1–2 meet thinner packs (and need less progress); full density from tier 3. */
const ITEMS_EQUIP_SLOTS: string[] = (ITEMS as any).equipSlots;
/** Packs that can appear on this tier (Bone Hounds join from tier 4). */
const packsFor = (tier: number) => RIFT.packs.filter((p) => ((p as { minTier?: number }).minTier ?? 1) <= tier);
function tierDensity(tier: number) { const d = (RIFT as any).densityByTier as number[] | undefined; return d?.[tier - 1] ?? 1; }

function ambush(s: SimState) {
  const r = s.rift, W = RIFT.waves;
  r.nextWave = r.time + range(s.rng, W.every[0], W.every[1]);
  const alive = s.players.filter((p) => !p.dead);
  if (!alive.length) return;
  const p = alive[Math.floor(next(s.rng) * alive.length)];
  let x = 0, y = 0, ok = false;
  for (let i = 0; i < 40 && !ok; i++) {
    const a = next(s.rng) * Math.PI * 2, d = range(s.rng, W.distance[0], W.distance[1]);
    x = p.x + Math.cos(a) * d; y = p.y + Math.sin(a) * d;
    ok = !isWall(s.map, x, y);
  }
  if (!ok) return;
  const n = s.players.length;
  let count = Math.round((W.base + W.perMinute * (r.time / 60)) * (1 + 0.5 * (n - 1)) * modVal(s, "packMult") * tierDensity(r.tier) * (r.density ?? 1));
  const cap = (r.map && MAP[r.map]?.enemyCap) || 0;
  if (cap) { let alive = 0; for (const e of s.enemies) if (!e.dead) alive++; count = Math.max(0, Math.min(count, cap - alive)); }
  const pack = weighted(s.rng, packsFor(s.rift.tier));
  const kinds = (pack.members as [EnemyKind, number, number][]).map((m) => m[0]);
  for (let i = 0; i < count; i++) {
    const k = i === 0 && kinds.includes("brute") && r.time > 120 ? "brute" : kinds[i % kinds.length] === "brute" ? "ghoul" : kinds[i % kinds.length];
    const d = DIR_TABLE[int(s.rng, 0, 31)], rr = range(s.rng, 0, 26);
    let ex = x + d[0] * rr, ey = y + d[1] * rr;
    if (isWall(s.map, ex, ey)) { ex = x; ey = y; }
    const e = spawnEnemy(s, k, ex, ey, n);
    e.aggro = true;
  }
  s.events.push({ type: "ambush", x, y, n: count });
}

function updateRift(s: SimState) {
  const r = s.rift;
  if (r.done) return;
  r.time += DT;
  if (!r.timeUpSent && r.time >= r.limit) { r.timeUpSent = true; s.events.push({ type: "timeUp" }); }
  if (r.kind === "hideout") return;
  if (r.kind === "endless") { updateEndless(s); return; }
  if (r.kind === "rift" && !r.guardianSpawned && r.nextWave !== undefined && r.time >= r.nextWave) ambush(s);
  // boons: pick 1 of 3 at progress thresholds (lost at the end of the run)
  const at = RIFT.boonsAt;
  if (r.kind === "rift" && r.boonIdx < at.length && (r.progress / r.need) * 100 >= at[r.boonIdx]) {
    r.boonIdx++;
    if (!s.boonPending) s.boonPending = {};
    // the player opens it when they're ready, so a new one waits behind an unopened one
    for (const p of s.players) {
      if (s.boonOffers[p.pid]) { s.boonPending[p.pid] = (s.boonPending[p.pid] ?? 0) + 1; s.events.push({ type: "boonOffer", pid: p.pid }); }
      else offerBoon(s, p);
    }
  }
  if (!r.guardianSpawned && r.progress >= r.need) {
    r.guardianSpawned = true;
    const p = s.players.find((q) => !q.dead) ?? s.players[0];
    let gx = p.x, gy = p.y;
    for (let rad = 90; rad >= 30; rad -= 15) {
      let found = false;
      for (let k = 0; k < 32; k += 4) {
        const d = DIR_TABLE[k];
        const x = p.x + d[0] * rad, y = p.y + d[1] * rad;
        if (!isWall(s.map, x, y) && !isWall(s.map, x + 16, y) && !isWall(s.map, x - 16, y) && !isWall(s.map, x, y + 16) && !isWall(s.map, x, y - 16)) { gx = x; gy = y; found = true; break; }
      }
      if (found) break;
    }
    const g = spawnEnemy(s, "guardian", gx, gy, s.players.length);
    const gd = pickGuardian(s);
    g.variant = gd.id; g.hp = g.maxHp = Math.round(g.maxHp * gd.hp); g.dmgMult *= gd.dmg; g.speedMult *= gd.speed; g.scale = gd.scale; g.r = Math.round(g.r * gd.scale);
    g.aggro = true; g.state = "intro"; g.t = 1.6; g.atkCd = 2;
    r.guardianId = g.id;
    for (const e of s.enemies) if (e !== g && !e.dead && len(e.x - gx, e.y - gy) < 120) { e.dead = true; s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite }); }
    s.events.push({ type: "guardianSpawn", x: gx, y: gy, kind: "guardian", variant: gd.id });
  }
}

// ------------------------------------------------------------------ endless
export function endlessLivesLeft(s: SimState) {
  const E = RIFT.endless, used = s.players.reduce((a, q) => a + (q.deaths ?? 0), 0);
  return E.lives + E.livesPerExtra * (s.players.length - 1) - used;
}
function updateEndless(s: SimState) {
  const r = s.rift, E = RIFT.endless;
  if (r.waveAt! > 0) { if (r.time >= r.waveAt!) spawnWave(s); return; }
  const alive = s.enemies.some((e) => !e.dead);
  const secs = r.time - r.waveStart!;
  if (alive && secs < E.maxWaveSecs) return;
  // wave cleared (or dragged on too long): quick clears push the difficulty up faster
  let jump = 1;
  if (!alive) for (const [t, n] of E.fastClear as [number, number][]) if (secs < t) { jump = n; break; }
  r.level! += jump;
  s.events.push({ type: "waveClear", wave: r.wave!, secs, jump, cleared: !alive });
  if (r.wave! % E.boonEvery === 0) for (const p of s.players) { if (s.boonOffers[p.pid]) s.boonPending[p.pid] = (s.boonPending[p.pid] ?? 0) + 1; else offerBoon(s, p); }
  r.waveAt = r.time + (alive ? 0.5 : E.breather);
}

function spawnWave(s: SimState) {
  const r = s.rift, E = RIFT.endless, n = Math.max(1, s.players.length), L = r.level!;
  r.wave! += 1; r.waveAt = 0; r.waveStart = r.time;
  const count = Math.min(E.maxCount, Math.round((E.baseCount + E.countPerLevel * L) * (1 + E.partyCount * (n - 1))));
  const tierEff = r.tier + Math.floor(L / E.tierPerLevels);
  const hpM = Math.pow(E.hpPerLevel, L), dmgM = Math.pow(E.dmgPerLevel, L);
  const p = s.players.find((q) => !q.dead) ?? s.players[0];
  const m = s.map, cx = (m.w / 2) * m.ts, cy = (m.h / 2) * m.ts;
  // 3–4 groups come in from the arena's edge, away from the player
  const groups = 3 + (r.wave! % 2);
  let made = 0, g = 0;
  const boss = r.wave! % E.bossEvery === 0;
  while (made < count && g < 40) {
    const a = (Math.PI * 2 * g) / groups + r.wave! * 0.7;
    const rad = Math.min(m.w, m.h) * m.ts * 0.38;
    let gx = cx + Math.cos(a) * rad, gy = cy + Math.sin(a) * rad;
    if (len(gx - p.x, gy - p.y) < 90) { gx = cx * 2 - gx; gy = cy * 2 - gy; }
    const pack = weighted(s.rng, packsFor(tierEff));
    for (const [ek, lo, hi] of pack.members as [EnemyKind, number, number][]) {
      const cnt = int(s.rng, lo, hi);
      for (let i = 0; i < cnt && made < count; i++) {
        const d = DIR_TABLE[int(s.rng, 0, 31)], rr = range(s.rng, 0, 24);
        let ex = gx + d[0] * rr, ey = gy + d[1] * rr;
        if (isWall(m, ex, ey)) { ex = gx; ey = gy; }
        if (isWall(m, ex, ey)) { ex = cx; ey = cy; }
        const e = spawnEnemy(s, ek, ex, ey, n);
        e.hp = e.maxHp = Math.round(e.maxHp * hpM); e.dmgMult *= dmgM; e.aggro = true;
        if (chance(s.rng, RIFT.eliteChance * 0.25)) makeElite(s, e);
        made++;
      }
    }
    g++;
  }
  if (boss) {
    // every 5th wave: an elite brute leads the charge
    const e = spawnEnemy(s, "brute", cx + Math.cos(r.wave!) * 120, cy + Math.sin(r.wave!) * 120, n);
    if (isWall(m, e.x, e.y)) { e.x = e.px = cx; e.y = e.py = cy - 60; }
    e.hp = e.maxHp = Math.round(e.maxHp * hpM); e.dmgMult *= dmgM; e.aggro = true; makeElite(s, e);
  }
  s.events.push({ type: "waveStart", wave: r.wave!, count: made + (boss ? 1 : 0), boss });
}

/** Endless run over: everyone stands back up and the reward chest opens, sized by the wave reached. */
function endEndless(s: SimState) {
  const r = s.rift, R = RIFT.endless.rewards, w = r.wave ?? 0;
  r.done = true; r.doneAt = r.time;
  for (const e of s.enemies) if (!e.dead) { e.dead = true; s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite }); }
  for (const p of s.players) {
    p.dead = false; p.deadT = 0; p.hp = p.stats.maxHp; p.invuln = 999;
    const pity = s.pity[p.pid] ?? {};
    const n = Math.min(R.max, R.base + Math.floor(w / R.perWaves));
    const legs = Math.min(n, Math.floor(w / R.legendaryPerWaves));
    for (let i = 0; i < n; i++) {
      const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
      const extra: MintOpts = i < legs ? { rarity: chance(s.rng, 0.3) ? "set" : "legendary", forceAncestral: i === 0 && !!pity.ancestral, forcePrimal: i === 0 && !!pity.primal } : { legendaryWeightMult: 2 + w / 5 };
      dropFor(s, p, p.x + d[0] * 20, p.y + d[1] * 20, extra);
    }
    if (w >= R.sigilFromWave && chance(s.rng, RIFT.tiers.sigilChance * 2)) { p.sigils++; s.events.push({ type: "sigil", pid: p.pid }); }
  }
  s.events.push({ type: "endlessOver", wave: w, time: r.time });
  s.events.push({ type: "riftComplete", inTime: false, time: r.time });
}

function completeRift(s: SimState, g: Enemy) {
  const r = s.rift;
  r.done = true; r.doneAt = r.time;
  const left = Math.max(0, r.limit - r.time);
  const inTime = left > 0;
  const gr = RIFT.guardianRewards;
  for (const p of s.players) {
    const pity = s.pity[p.pid] ?? {};
    if (r.kind === "chase" && r.boss === "seraph") {
      // the Seraph: more items, the first two always ancestral, and a better mythic chance
      const S = RIFT.seraph, n = S.items + (inTime ? 2 : 0);
      let anc = 0;
      for (let i = 0; i < n; i++) {
        const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
        const mythic = i === 0 && chance(s.rng, S.mythicChance);
        const a = !mythic && anc < S.ancestral; if (a) anc++; // a mythic is a bonus: the two ancestral items still come
        dropFor(s, p, g.x + d[0] * 26, g.y + d[1] * 26, mythic ? { rarity: "mythic" } : a ? { rarity: chance(s.rng, 0.5) ? "legendary" : "set", forceAncestral: true } : { legendaryWeightMult: 8 });
      }
      continue;
    }
    if (r.kind === "chase") {
      const n = RIFT.chase.items + (inTime ? 2 : 0);
      for (let i = 0; i < n; i++) {
        const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
        const mythic = i === 0 && chance(s.rng, RIFT.chase.mythicChance);
        dropFor(s, p, g.x + d[0] * 26, g.y + d[1] * 26, mythic ? { rarity: "mythic" } : i < 2 ? { rarity: chance(s.rng, 0.5) ? "legendary" : "set" } : { legendaryWeightMult: 6 });
      }
      // every King kill leaves a Pale Feather: the way to the Seraph
      p.feathers++; s.events.push({ type: "feather", pid: p.pid });
      continue;
    }
    const n = gr.baseItems + (inTime ? gr.inTimeItems + Math.floor(left / 60) * gr.itemsPerMinuteLeft : 0);
    for (let i = 0; i < n; i++) {
      const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
      let x = g.x + d[0] * 22, y = g.y + d[1] * 22;
      if (isWall(s.map, x, y)) { x = g.x; y = g.y; }
      const first = i === 0 && inTime && gr.inTimeLegendary;
      const extra: MintOpts = first ? { rarity: chance(s.rng, 0.3) ? "set" : "legendary", forceAncestral: !!pity.ancestral, forcePrimal: !!pity.primal } : { legendaryWeightMult: 4 };
      dropFor(s, p, x, y, extra);
    }
    if (r.tier >= RIFT.tiers.sigilFrom && chance(s.rng, RIFT.tiers.sigilChance)) { p.sigils++; s.events.push({ type: "sigil", pid: p.pid }); }
    if (r.tier >= RIFT.seraph.featherFrom && chance(s.rng, RIFT.seraph.featherChance)) { p.feathers++; s.events.push({ type: "feather", pid: p.pid }); }
    if (r.kind === "rift") gemRewards(s, p, inTime);
  }
  for (const e of s.enemies) if (!e.dead) { e.dead = true; s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind, elite: e.elite }); }
  s.events.push({ type: "riftComplete", inTime, time: r.time });
}

/** Rift gems: guardians from tier 5 may give a gem you don't have (the first one is certain); timed clears level the socketed ones. */
function gemRewards(s: SimState, p: Player, inTime: boolean) {
  const t = s.rift.tier;
  if (t < GEMS.fromTier) return;
  const missing = GEMS.gems.filter((g) => !p.gems[g.id]);
  if (missing.length && (!Object.keys(p.gems).length || chance(s.rng, GEMS.dropChance))) {
    const g = missing[Math.floor(next(s.rng) * missing.length)];
    p.gems[g.id] = 1;
    if (p.gemSlots.length < GEMS.slots) p.gemSlots.push(g.id);
    s.events.push({ type: "gem", pid: p.pid, id: g.id });
  }
  if (!inTime) return;
  const ups = 1 + Math.floor((t - GEMS.fromTier) / 5), cap = gemCap(t);
  for (const id of p.gemSlots) {
    const was = p.gems[id] ?? 1, now = Math.max(was, Math.min(cap, was + ups));
    if (now > was) { p.gems[id] = now; s.events.push({ type: "gemUp", pid: p.pid, id, level: now }); }
  }
  refreshAll(s);
}

/** Stable hash of the gameplay state (determinism test; later netcode desync checks). */
export function stateHash(s: SimState): string {
  const { events, _flows, _flowTick, ...rest } = s;
  const str = JSON.stringify(rest, (k, v) => (k === "stats" || k === "sk" ? undefined : v));
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export { BOON };
