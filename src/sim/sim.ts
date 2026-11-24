// Pure deterministic simulation. No DOM, no Math.random, no wall-clock time.
// The same module will run on the co-op host, on clients (prediction) and on the backend (validation).
import { ENEMIES, EnemyDef, RIFT, Rarity, SKILL, Tag } from "./data";
import { Holder, InvCmd, Item, Stats, applyInvCmd, computeStats, mintItem, BAG_SIZE, MintOpts } from "./items";
import { TileMap, flowField, genCave, moveWithWalls } from "./map";
import { Rng, chance, int, makeRng, next, range, weighted } from "./rng";
import { DIR_TABLE, len, norm, rotSteps } from "./vec";

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;
const PLAYER_SPEED = 80;

export interface PlayerInput {
  mx: number; my: number;  // move vector, length <= 1
  ax: number; ay: number;  // aim point in world space
  primary: boolean; secondary: boolean; dash: boolean; ult: boolean;
  cmds?: InvCmd[];
}
export const NO_INPUT: PlayerInput = { mx: 0, my: 0, ax: 0, ay: 0, primary: false, secondary: false, dash: false, ult: false };

export interface Player extends Holder {
  x: number; y: number; px: number; py: number; r: number;
  hp: number; fx: number; fy: number;
  swingTimer: number; swingCount: number;
  cds: Record<string, number>;
  dashCharges: number; dashRecharge: number;
  dashT: number; dashDx: number; dashDy: number; dashHit: number[]; trailT: number;
  invuln: number; deadT: number; dead: boolean;
  moving: boolean; walk: number;
  stats: Stats;
}

export type EnemyKind = "ghoul" | "archer" | "brute" | "guardian";
export interface Enemy {
  id: number; kind: EnemyKind;
  x: number; y: number; px: number; py: number; r: number;
  hp: number; maxHp: number;
  state: string; t: number; atkCd: number; aggro: boolean;
  kbx: number; kby: number; flash: number;
  burnDps: number; burnT: number; burnTick: number;
  tx: number; ty: number; // attack target point / direction (telegraphs)
  dead: boolean; noProgress: boolean;
  pattern: number; enraged: boolean; age: number; chargeHit: boolean;
}

export interface Projectile {
  id: number; team: 0 | 1; kind: "lance" | "wave" | "arrow" | "bone";
  x: number; y: number; px: number; py: number; vx: number; vy: number; r: number;
  mult: number; dmg: number; tags: Tag[]; pierce: boolean; life: number; hit: number[]; returning: boolean; kb: number;
  dead: boolean;
}
export interface Summon { id: number; x: number; y: number; px: number; py: number; r: number; life: number; atkT: number; fx: number; dead: boolean; ox: number; oy: number }
export interface Hazard { id: number; x: number; y: number; r: number; mult: number; life: number; tickT: number; tags: Tag[]; dead: boolean }
export interface Loot { id: number; x: number; y: number; item: Item; age: number }

export type SimEvent =
  | { type: "hit"; x: number; y: number; amount: number; crit: boolean; kind: EnemyKind; burn?: boolean }
  | { type: "kill"; x: number; y: number; kind: EnemyKind }
  | { type: "drop"; x: number; y: number; rarity: Rarity; name: string }
  | { type: "pickup"; rarity: Rarity; name: string }
  | { type: "bagFull" }
  | { type: "swing"; x: number; y: number; fx: number; fy: number; ring: boolean; range: number; hits: number }
  | { type: "cast"; skill: string; x: number; y: number }
  | { type: "playerHurt"; amount: number }
  | { type: "playerDeath" } | { type: "respawn" }
  | { type: "slam"; x: number; y: number; r: number; big: boolean }
  | { type: "explosion"; x: number; y: number; r: number }
  | { type: "guardianSpawn"; x: number; y: number }
  | { type: "enrage" } | { type: "guardianStun" } | { type: "timeUp" }
  | { type: "riftComplete"; inTime: boolean; time: number }
  | { type: "equipChanged" };

export interface RiftState {
  time: number; limit: number; progress: number; need: number;
  guardianSpawned: boolean; guardianId: number; done: boolean; doneAt: number; kills: number; timeUpSent: boolean;
}

export interface SimState {
  seed: number; tick: number; rng: Rng; map: TileMap;
  player: Player; enemies: Enemy[]; projectiles: Projectile[]; summons: Summon[]; hazards: Hazard[]; loot: Loot[];
  nextId: number; itemCounter: number; startX: number; startY: number;
  rift: RiftState;
  events: SimEvent[];
  // derived caches (not part of a snapshot)
  _flow: Int16Array | null; _flowTick: number;
}

// ---------------------------------------------------------------- setup

export function createSim(seed: number, holder: Holder): SimState {
  const rng = makeRng(seed);
  const map = genCave(rng, RIFT.mapWidth, RIFT.mapHeight, RIFT.tileSize);
  const floors: number[] = [];
  for (let i = 0; i < map.tiles.length; i++) if (map.tiles[i] === 0 && openness(map, i) >= 8) floors.push(i);
  const startTile = floors[Math.floor(next(rng) * floors.length)];
  const ts = map.ts;
  const startX = (startTile % map.w) * ts + ts / 2, startY = Math.floor(startTile / map.w) * ts + ts / 2;
  const equipment = JSON.parse(JSON.stringify(holder.equipment));
  const stats = computeStats({ equipment });
  const player: Player = {
    x: startX, y: startY, px: startX, py: startY, r: 5, hp: stats.maxHp, fx: 1, fy: 0,
    swingTimer: 0, swingCount: 0, cds: {}, dashCharges: 1, dashRecharge: 0, dashT: 0, dashDx: 0, dashDy: 0, dashHit: [], trailT: 0,
    invuln: 1, deadT: 0, dead: false, moving: false, walk: 0, stats,
    equipment, bag: JSON.parse(JSON.stringify(holder.bag)), materials: holder.materials,
  };
  player.dashCharges = maxDashCharges(player);
  const s: SimState = {
    seed, tick: 0, rng, map, player, enemies: [], projectiles: [], summons: [], hazards: [], loot: [],
    nextId: 1, itemCounter: 0, startX, startY,
    rift: { time: 0, limit: RIFT.timeLimit, progress: 0, need: RIFT.progressNeeded, guardianSpawned: false, guardianId: 0, done: false, doneAt: 0, kills: 0, timeUpSent: false },
    events: [], _flow: null, _flowTick: -999,
  };
  // packs
  const packs: [number, number][] = [];
  let attempts = 0;
  while (packs.length < RIFT.packCount && attempts++ < 4000) {
    const ti = floors[Math.floor(next(rng) * floors.length)];
    const x = (ti % map.w) * ts + ts / 2, y = Math.floor(ti / map.w) * ts + ts / 2;
    if (len(x - startX, y - startY) < 220) continue;
    if (packs.some(([px, py]) => len(px - x, py - y) < 110)) continue;
    packs.push([x, y]);
    const pack = weighted(rng, RIFT.packs);
    for (const [kind, lo, hi] of pack.members as [EnemyKind, number, number][]) {
      const n = int(rng, lo, hi);
      for (let i = 0; i < n; i++) {
        const d = DIR_TABLE[int(rng, 0, 31)];
        const rr = range(rng, 0, 22);
        let ex = x + d[0] * rr, ey = y + d[1] * rr;
        if (isWall(map, ex, ey)) { ex = x; ey = y; }
        spawnEnemy(s, kind, ex, ey);
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
function isWall(m: TileMap, x: number, y: number) {
  const tx = Math.floor(x / m.ts), ty = Math.floor(y / m.ts);
  return tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.tiles[ty * m.w + tx] === 1;
}

function spawnEnemy(s: SimState, kind: EnemyKind, x: number, y: number): Enemy {
  const d = ENEMIES[kind];
  const e: Enemy = {
    id: s.nextId++, kind, x, y, px: x, py: y, r: d.radius, hp: d.hp, maxHp: d.hp,
    state: "chase", t: 0, atkCd: range(s.rng, 0.3, 1.0), aggro: false, kbx: 0, kby: 0, flash: 0,
    burnDps: 0, burnT: 0, burnTick: 0, tx: 0, ty: 0, dead: false, noProgress: false,
    pattern: 0, enraged: false, age: 0, chargeHit: false,
  };
  s.enemies.push(e);
  return e;
}

export function maxDashCharges(p: Player) { return p.stats.powers.dash_charges ? p.stats.powers.dash_charges.charges : 1; }
const cdMult = (p: Player) => 1 - Math.min(40, p.stats.cdr) / 100;

// ---------------------------------------------------------------- step

export function step(s: SimState, input: PlayerInput): void {
  s.events.length = 0;
  s.tick++;
  updatePlayer(s, input);
  if (s._flowTick + 8 <= s.tick) { s._flow = flowField(s.map, s.player.x, s.player.y, 40); s._flowTick = s.tick; }
  updateEnemies(s);
  updateSummons(s);
  updateProjectiles(s);
  updateHazards(s);
  updateLoot(s);
  updateRift(s);
  if (s.tick % 30 === 0) {
    s.enemies = s.enemies.filter((e) => !e.dead);
  }
  s.projectiles = s.projectiles.filter((p) => !p.dead);
  s.summons = s.summons.filter((p) => !p.dead);
  s.hazards = s.hazards.filter((p) => !p.dead);
}

// ---------------------------------------------------------------- player

/** Inventory command for the player. Arrives as part of the tick input (co-op: sent by the client like any other input). */
export function applyPlayerCmd(s: SimState, c: InvCmd): boolean {
  const p = s.player;
  if (!applyInvCmd(p, c)) return false;
  const ratio = p.hp / p.stats.maxHp;
  p.stats = computeStats(p);
  p.hp = p.dead ? 0 : Math.max(1, Math.round(p.stats.maxHp * ratio));
  p.dashCharges = Math.min(p.dashCharges, maxDashCharges(p));
  s.events.push({ type: "equipChanged" });
  return true;
}

function updatePlayer(s: SimState, inp: PlayerInput) {
  const p = s.player;
  p.px = p.x; p.py = p.y;
  if (inp.cmds) for (const c of inp.cmds) applyPlayerCmd(s, c);
  for (const k in p.cds) p.cds[k] = Math.max(0, p.cds[k] - DT);
  const maxC = maxDashCharges(p);
  if (p.dashCharges < maxC) {
    p.dashRecharge -= DT;
    if (p.dashRecharge <= 0) { p.dashCharges++; p.dashRecharge = p.dashCharges < maxC ? SKILL.ash_dash.cooldown * cdMult(p) : 0; }
  }
  if (p.dead) {
    p.deadT -= DT;
    if (p.deadT <= 0) {
      p.dead = false; p.hp = p.stats.maxHp; p.x = p.px = s.startX; p.y = p.py = s.startY; p.invuln = 2;
      s.events.push({ type: "respawn" });
    }
    return;
  }
  p.invuln = Math.max(0, p.invuln - DT);
  p.swingTimer -= DT;
  const [afx, afy] = norm(inp.ax - p.x, inp.ay - p.y);
  if (afx !== 0 || afy !== 0) { p.fx = afx; p.fy = afy; }

  if (p.dashT > 0) { updateDash(s, p); return; }

  let mx = inp.mx, my = inp.my;
  const ml = len(mx, my);
  if (ml > 1) { mx /= ml; my /= ml; }
  p.moving = ml > 0.05;
  if (p.moving) {
    const sp = PLAYER_SPEED * (1 + p.stats.moveSpeed / 100) * DT;
    const ox = p.x, oy = p.y;
    moveWithWalls(s.map, p, mx * sp, my * sp);
    p.walk += len(p.x - ox, p.y - oy);
  }

  if (inp.dash && p.dashCharges > 0) {
    let dx = p.moving ? mx : p.fx, dy = p.moving ? my : p.fy;
    [dx, dy] = norm(dx, dy);
    if (dx === 0 && dy === 0) dx = 1;
    if (p.dashCharges === maxC) p.dashRecharge = SKILL.ash_dash.cooldown * cdMult(p);
    p.dashCharges--;
    p.dashT = SKILL.ash_dash.duration!; p.dashDx = dx; p.dashDy = dy; p.dashHit = []; p.trailT = 0;
    p.invuln = Math.max(p.invuln, p.dashT + 0.1);
    s.events.push({ type: "cast", skill: "ash_dash", x: p.x, y: p.y });
  } else if (inp.ult && !(p.cds.cinderlings > 0)) {
    castCinderlings(s, p);
  } else if (inp.secondary && !(p.cds.ember_lance > 0)) {
    castLance(s, p);
  } else if (inp.primary && p.swingTimer <= 0) {
    castCleave(s, p);
  }
}

function updateDash(s: SimState, p: Player) {
  const sk = SKILL.ash_dash;
  const speed = sk.distance! / sk.duration!;
  const blocked = moveWithWalls(s.map, p, p.dashDx * speed * DT, p.dashDy * speed * DT);
  p.dashT -= DT;
  if (blocked) p.dashT = 0;
  for (const e of s.enemies) {
    if (e.dead || p.dashHit.includes(e.id)) continue;
    if (len(e.x - p.x, e.y - p.y) < e.r + p.r + 8) {
      p.dashHit.push(e.id);
      hitEnemy(s, e, sk.damage, sk.tags, { kb: sk.knockback!, kx: p.dashDx, ky: p.dashDy, direct: true });
    }
  }
  const trail = p.stats.powers.dash_trail;
  if (trail) {
    p.trailT -= DT;
    if (p.trailT <= 0) {
      p.trailT = 0.05;
      s.hazards.push({ id: s.nextId++, x: p.x, y: p.y, r: 10, mult: trail.dps, life: trail.duration, tickT: 0, tags: ["dash", "fire"], dead: false });
    }
  }
}

function castCleave(s: SimState, p: Player) {
  const sk = SKILL.cleave;
  p.swingTimer = sk.interval!;
  p.swingCount++;
  const ringP = p.stats.powers.melee_ring;
  const ring = !!ringP && p.swingCount % ringP.every === 0;
  const mult = sk.damage * (ring ? ringP!.mult : 1);
  const rng = sk.range! + (ring ? 6 : 0);
  let hits = 0;
  for (const e of s.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y, d = len(dx, dy);
    if (d > rng + e.r) continue;
    const ok = ring || d < e.r + p.r + 2 || (dx * p.fx + dy * p.fy) / (d || 1) >= sk.arcCos!;
    if (!ok) continue;
    const [kx, ky] = norm(dx, dy);
    hitEnemy(s, e, mult, sk.tags, { kb: sk.knockback!, kx, ky, direct: true });
    hits++;
  }
  s.events.push({ type: "swing", x: p.x, y: p.y, fx: p.fx, fy: p.fy, ring, range: rng, hits });
  const wave = p.stats.powers.cleave_wave;
  if (wave) {
    s.projectiles.push(mkProj(s, 0, "wave", p.x + p.fx * 6, p.y + p.fy * 6, p.fx * wave.speed, p.fy * wave.speed, 9,
      wave.damage, 0, ["melee", "fire"], true, wave.range / wave.speed, 30));
  }
}

function castLance(s: SimState, p: Player) {
  const sk = SKILL.ember_lance;
  p.cds.ember_lance = sk.cooldown * cdMult(p);
  const split = p.stats.powers.pierce_split;
  const n = split ? split.count : 1;
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    const [dx, dy] = rotSteps(p.fx, p.fy, k);
    s.projectiles.push(mkProj(s, 0, "lance", p.x + dx * 6, p.y + dy * 6, dx * sk.speed!, dy * sk.speed!, sk.radius!,
      sk.damage, 0, sk.tags, true, sk.range! / sk.speed!, sk.knockback!));
  }
  s.events.push({ type: "cast", skill: "ember_lance", x: p.x, y: p.y });
}

function castCinderlings(s: SimState, p: Player) {
  const sk = SKILL.cinderlings;
  p.cds.cinderlings = sk.cooldown * cdMult(p);
  const extra = p.stats.powers.summon_extra ? p.stats.powers.summon_extra.extra : 0;
  const n = sk.count! + extra;
  for (let i = 0; i < n; i++) {
    const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
    const sm: Summon = { id: s.nextId++, x: p.x + d[0] * 10, y: p.y + d[1] * 10, px: 0, py: 0, r: 3, life: sk.duration!, atkT: 0, fx: 1, dead: false, ox: d[0] * 18, oy: d[1] * 18 };
    if (isWall(s.map, sm.x, sm.y)) { sm.x = p.x; sm.y = p.y; }
    sm.px = sm.x; sm.py = sm.y;
    s.summons.push(sm);
  }
  s.events.push({ type: "cast", skill: "cinderlings", x: p.x, y: p.y });
}

function mkProj(s: SimState, team: 0 | 1, kind: Projectile["kind"], x: number, y: number, vx: number, vy: number, r: number,
  mult: number, dmg: number, tags: Tag[], pierce: boolean, life: number, kb: number): Projectile {
  return { id: s.nextId++, team, kind, x, y, px: x, py: y, vx, vy, r, mult, dmg, tags, pierce, life, hit: [], returning: false, kb, dead: false };
}

// ---------------------------------------------------------------- damage

function rollDamage(s: SimState, mult: number, tags: readonly Tag[], canCrit: boolean) {
  const st = s.player.stats;
  let dmg = range(s.rng, st.dmgMin, st.dmgMax) * mult;
  let pct = st.dmgPct;
  for (const t of tags) pct += st.tagDmg[t] ?? 0;
  dmg *= 1 + pct / 100;
  const crit = canCrit && chance(s.rng, st.critChance / 100);
  if (crit) dmg *= 1 + st.critDmg / 100;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}

interface HitOpts { kb?: number; kx?: number; ky?: number; direct?: boolean; noCrit?: boolean }

function hitEnemy(s: SimState, e: Enemy, mult: number, tags: readonly Tag[], o: HitOpts) {
  if (e.dead || (e.kind === "guardian" && e.state === "intro")) return;
  const { dmg, crit } = rollDamage(s, mult, tags, !o.noCrit);
  const p = s.player;
  if (o.kb && e.kind !== "guardian") {
    const res = e.kind === "brute" ? 0.35 : 1;
    e.kbx += (o.kx ?? 0) * o.kb * res; e.kby += (o.ky ?? 0) * o.kb * res;
  }
  if (o.direct) {
    const ign = p.stats.powers.fire_ignite;
    if (ign && tags.includes("fire")) {
      const dps = (dmg * ign.mult) / ign.duration;
      e.burnDps = Math.max(e.burnT > 0 ? e.burnDps : 0, dps);
      e.burnT = ign.duration;
    }
    if (p.stats.lifeOnHit > 0 && !p.dead) p.hp = Math.min(p.stats.maxHp, p.hp + p.stats.lifeOnHit);
  }
  applyDamage(s, e, dmg, crit, tags, false);
}

function applyDamage(s: SimState, e: Enemy, dmg: number, crit: boolean, tags: readonly Tag[], burn: boolean) {
  e.hp -= dmg;
  e.flash = 3;
  e.aggro = true;
  s.events.push({ type: "hit", x: e.x, y: e.y - e.r, amount: dmg, crit, kind: e.kind, burn });
  if (e.hp <= 0) killEnemy(s, e, tags);
}

function explosion(s: SimState, x: number, y: number, r: number, flat: number, mult: number, tags: Tag[]) {
  s.events.push({ type: "explosion", x, y, r });
  for (const e of s.enemies) {
    if (e.dead || len(e.x - x, e.y - y) > r + e.r) continue;
    if (flat > 0) applyDamage(s, e, Math.max(1, Math.round(flat)), false, tags, false);
    else hitEnemy(s, e, mult, tags, { kb: 60, ...dirFrom(x, y, e), noCrit: false });
  }
}
function dirFrom(x: number, y: number, e: Enemy) { const [kx, ky] = norm(e.x - x, e.y - y); return { kx, ky }; }

function killEnemy(s: SimState, e: Enemy, tags: readonly Tag[]) {
  if (e.dead) return;
  e.dead = true;
  s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind });
  const def = ENEMIES[e.kind];
  if (e.kind === "guardian") { completeRift(s, e); return; }
  s.rift.kills++;
  if (!e.noProgress) s.rift.progress = Math.min(s.rift.need, s.rift.progress + def.progress);
  if (!e.noProgress && chance(s.rng, def.dropChance)) dropItem(s, e.x, e.y, {});
  const ex = s.player.stats.powers.fire_explode;
  if (ex && tags.includes("fire")) explosion(s, e.x, e.y, ex.radius, e.maxHp * ex.pct, 0, ["explosion"]);
}

function dropItem(s: SimState, x: number, y: number, opts: MintOpts) {
  const id = `${(s.seed >>> 0).toString(36)}-${s.itemCounter++}`;
  const item = mintItem(s.rng, id, opts);
  s.loot.push({ id: s.nextId++, x, y, item, age: 0 });
  s.events.push({ type: "drop", x, y, rarity: item.rarity, name: item.name });
}

function damagePlayer(s: SimState, raw: number) {
  const p = s.player;
  if (p.dead || p.invuln > 0) return;
  const dmg = Math.max(1, Math.round(raw * (1 - p.stats.armor / (p.stats.armor + 150))));
  p.hp -= dmg;
  s.events.push({ type: "playerHurt", amount: dmg });
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deadT = 3; p.dashT = 0;
    s.events.push({ type: "playerDeath" });
  }
}

// ---------------------------------------------------------------- enemies

function updateEnemies(s: SimState) {
  const p = s.player;
  const active: Enemy[] = [];
  for (const e of s.enemies) {
    if (e.dead) continue;
    e.px = e.x; e.py = e.y;
    const dx = p.x - e.x, dy = p.y - e.y, dist = len(dx, dy);
    if (!e.aggro && dist > 300) continue;
    active.push(e);
    if (!e.aggro && dist < 160) e.aggro = true;
    if (e.flash > 0) e.flash--;
    if (e.burnT > 0) {
      e.burnT -= DT; e.burnTick -= DT;
      if (e.burnTick <= 0) {
        e.burnTick = 0.5;
        applyDamage(s, e, Math.max(1, Math.round(e.burnDps * 0.5)), false, ["fire"], true);
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
    if (p.dead) { if (e.state === "windup") e.state = "chase"; continue; }
    const def = ENEMIES[e.kind];
    switch (e.kind) {
      case "ghoul": aiMelee(s, e, def, dist, dx, dy); break;
      case "brute": aiBrute(s, e, def, dist, dx, dy); break;
      case "archer": aiArcher(s, e, def, dist, dx, dy); break;
      case "guardian": aiGuardian(s, e, def, dist, dx, dy); break;
    }
  }
  // separation (enemies don't stack; they also get nudged off the player)
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    if (a.dead) continue;
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      if (b.dead) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy), min = a.r + b.r;
      if (d < min && d > 0.001) {
        const push = (min - d) * 0.5, nx = dx / d, ny = dy / d;
        const wa = a.kind === "guardian" ? 0 : b.kind === "guardian" ? 2 : 1;
        moveWithWalls(s.map, a, -nx * push * wa, -ny * push * wa);
        moveWithWalls(s.map, b, nx * push * (2 - wa), ny * push * (2 - wa));
      }
    }
    if (!p.dead && a.kind !== "guardian") {
      const dx = a.x - p.x, dy = a.y - p.y, d = len(dx, dy), min = a.r + p.r;
      if (d < min && d > 0.001) moveWithWalls(s.map, a, (dx / d) * (min - d), (dy / d) * (min - d));
    }
  }
}

function chase(s: SimState, e: Enemy, speed: number, dx: number, dy: number, dist: number) {
  let mx = dx, my = dy;
  const f = s._flow, m = s.map;
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

function aiMelee(s: SimState, e: Enemy, def: EnemyDef, dist: number, dx: number, dy: number) {
  const p = s.player;
  if (e.state === "windup") {
    if (e.t <= 0) {
      if (dist <= e.r + p.r + def.attackRange + 4) damagePlayer(s, def.damage);
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; return; }
  if (dist > e.r + p.r + 2) chase(s, e, def.speed, dx, dy, dist);
}

function aiBrute(s: SimState, e: Enemy, def: EnemyDef, dist: number, dx: number, dy: number) {
  const p = s.player;
  if (e.state === "windup") {
    if (e.t <= 0) {
      if (len(p.x - e.tx, p.y - e.ty) <= def.slamRadius! + p.r) damagePlayer(s, def.damage);
      s.events.push({ type: "slam", x: e.tx, y: e.ty, r: def.slamRadius!, big: false });
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) {
    const [nx, ny] = norm(dx, dy);
    e.state = "windup"; e.t = def.windup; e.tx = e.x + nx * 14; e.ty = e.y + ny * 14;
    return;
  }
  if (dist > e.r + p.r + 2) chase(s, e, def.speed, dx, dy, dist);
}

function aiArcher(s: SimState, e: Enemy, def: EnemyDef, dist: number, dx: number, dy: number) {
  if (e.state === "windup") {
    if (e.t <= 0) {
      const [nx, ny] = norm(s.player.x - e.x, s.player.y - e.y);
      s.projectiles.push(mkProj(s, 1, "arrow", e.x, e.y, nx * def.projectileSpeed!, ny * def.projectileSpeed!, 3, 0, def.damage, [], false, 2.2, 0));
      e.state = "chase"; e.atkCd = def.attackCooldown;
    }
    return;
  }
  if (dist < def.attackRange && e.atkCd <= 0) { e.state = "windup"; e.t = def.windup; return; }
  if (dist > def.attackRange * 0.8) chase(s, e, def.speed, dx, dy, dist);
  else if (dist < 70) { const [nx, ny] = norm(dx, dy); moveWithWalls(s.map, e, -nx * def.speed * DT, -ny * def.speed * DT); }
}

const GUARDIAN_PATTERN = ["nova", "charge", "nova", "raise", "charge"];

function aiGuardian(s: SimState, e: Enemy, def: EnemyDef, dist: number, dx: number, dy: number) {
  const p = s.player;
  if (!e.enraged && e.age >= def.enrageAfter!) { e.enraged = true; s.events.push({ type: "enrage" }); }
  const en = e.enraged;
  const dmg = def.damage * (en ? 2 : 1);
  const spd = def.speed * (en ? 1.4 : 1);
  switch (e.state) {
    case "intro": if (e.t <= 0) { e.state = "idle"; e.t = 1.0; } return;
    case "stun": if (e.t <= 0) { e.state = "idle"; e.t = 0.6; } return;
    case "slam":
      if (e.t <= 0) {
        if (len(p.x - e.tx, p.y - e.ty) <= def.slamRadius! + p.r) damagePlayer(s, dmg * 1.5);
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
          s.projectiles.push(mkProj(s, 1, "bone", e.x, e.y, cx * def.novaSpeed!, cy * def.novaSpeed!, 4, 0, dmg, [], false, 3.5, 0));
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
      if (!e.chargeHit && len(p.x - e.x, p.y - e.y) < e.r + p.r + 2) { e.chargeHit = true; damagePlayer(s, dmg * 1.6); }
      if (blocked) { e.state = "stun"; e.t = 1.6; s.events.push({ type: "guardianStun" }); s.events.push({ type: "slam", x: e.x, y: e.y, r: 24, big: true }); }
      else if (e.t <= 0) { e.state = "idle"; e.t = en ? 0.5 : 1.0; }
      return;
    }
    case "raise":
      if (e.t <= 0) {
        let adds = 0;
        for (const o of s.enemies) if (!o.dead && o.noProgress) adds++;
        for (let i = 0; i < 4 && adds < 8; i++, adds++) {
          const d = DIR_TABLE[i * 8 + 4];
          const x = e.x + d[0] * 26, y = e.y + d[1] * 26;
          if (isWall(s.map, x, y)) continue;
          const g = spawnEnemy(s, "ghoul", x, y);
          g.aggro = true; g.noProgress = true;
        }
        e.state = "idle"; e.t = 1.0;
      }
      return;
    default: { // idle
      if (dist <= e.r + p.r + def.attackRange && e.atkCd <= 0) {
        const [nx, ny] = norm(dx, dy);
        e.state = "slam"; e.t = def.windup; e.tx = e.x + nx * 18; e.ty = e.y + ny * 18;
        return;
      }
      if (e.t <= 0) {
        const next = GUARDIAN_PATTERN[e.pattern % GUARDIAN_PATTERN.length];
        e.pattern++;
        if (next === "nova") { e.state = "nova"; e.t = en ? 0.7 : 1.0; }
        else if (next === "raise") { e.state = "raise"; e.t = 0.8; }
        else { const [nx, ny] = norm(dx, dy); e.state = "chargeWind"; e.t = en ? 0.55 : 0.85; e.tx = nx; e.ty = ny; }
        return;
      }
      if (dist > e.r + p.r + 4) chase(s, e, spd, dx, dy, dist);
    }
  }
}

// ---------------------------------------------------------------- summons, projectiles, hazards, loot

function updateSummons(s: SimState) {
  const p = s.player, sk = SKILL.cinderlings;
  for (const m of s.summons) {
    m.px = m.x; m.py = m.y;
    m.life -= DT;
    if (m.life <= 0) {
      m.dead = true;
      const burst = p.stats.powers.summon_burst;
      if (burst) explosion(s, m.x, m.y, burst.radius, 0, burst.damage, ["summon", "fire"]);
      continue;
    }
    let target: Enemy | null = null, best = 140;
    for (const e of s.enemies) {
      if (e.dead || !e.aggro && len(e.x - p.x, e.y - p.y) > 200) continue;
      const d = len(e.x - m.x, e.y - m.y);
      if (d < best) { best = d; target = e; }
    }
    m.atkT -= DT;
    if (target) {
      const dx = target.x - m.x, dy = target.y - m.y;
      m.fx = dx >= 0 ? 1 : -1;
      if (best > target.r + 6) { const [nx, ny] = norm(dx, dy); moveWithWalls(s.map, m, nx * sk.speed! * DT, ny * sk.speed! * DT); }
      else if (m.atkT <= 0) {
        m.atkT = sk.attackInterval!;
        const [kx, ky] = norm(dx, dy);
        hitEnemy(s, target, sk.damage, sk.tags, { kb: 20, kx, ky, direct: true });
      }
    } else {
      const tx = p.x + m.ox, ty = p.y + m.oy, dx = tx - m.x, dy = ty - m.y, d = len(dx, dy);
      if (d > 4) { const [nx, ny] = norm(dx, dy); const sp = Math.min(d, sk.speed! * DT * (d > 60 ? 1.6 : 1)); moveWithWalls(s.map, m, nx * sp, ny * sp); m.fx = dx >= 0 ? 1 : -1; }
    }
  }
}

function updateProjectiles(s: SimState) {
  const p = s.player;
  for (const pr of s.projectiles) {
    if (pr.dead) continue;
    pr.px = pr.x; pr.py = pr.y;
    if (pr.returning) {
      const [nx, ny] = norm(p.x - pr.x, p.y - pr.y);
      const sp = len(pr.vx, pr.vy);
      pr.vx = nx * sp; pr.vy = ny * sp;
      if (len(p.x - pr.x, p.y - pr.y) < p.r + 6) { pr.dead = true; continue; }
    }
    pr.x += pr.vx * DT; pr.y += pr.vy * DT;
    pr.life -= DT;
    const wall = isWall(s.map, pr.x, pr.y);
    if (pr.team === 0) {
      for (const e of s.enemies) {
        if (e.dead || pr.hit.includes(e.id)) continue;
        if (len(e.x - pr.x, e.y - pr.y) < e.r + pr.r) {
          pr.hit.push(e.id);
          const [kx, ky] = norm(pr.vx, pr.vy);
          hitEnemy(s, e, pr.mult, pr.tags, { kb: pr.kb, kx, ky, direct: true });
          if (!pr.pierce) { pr.dead = true; break; }
        }
      }
      if (pr.dead) continue;
      if ((wall && !pr.returning) || pr.life <= 0) {
        if (!pr.returning && p.stats.powers.pierce_return && pr.tags.includes("pierce")) {
          pr.returning = true; pr.hit = []; pr.life = 3;
          if (wall) { pr.x = pr.px; pr.y = pr.py; }
        } else pr.dead = true;
      }
    } else {
      if (wall || pr.life <= 0) { pr.dead = true; continue; }
      if (!p.dead && p.invuln <= 0 && len(p.x - pr.x, p.y - pr.y) < p.r + pr.r) { damagePlayer(s, pr.dmg); pr.dead = true; }
    }
  }
}

function updateHazards(s: SimState) {
  for (const h of s.hazards) {
    h.life -= DT; h.tickT -= DT;
    if (h.life <= 0) { h.dead = true; continue; }
    if (h.tickT <= 0) {
      h.tickT = 0.5;
      for (const e of s.enemies) if (!e.dead && len(e.x - h.x, e.y - h.y) < h.r + e.r) hitEnemy(s, e, h.mult * 0.5, h.tags, { noCrit: true });
    }
  }
}

function updateLoot(s: SimState) {
  const p = s.player;
  for (let i = s.loot.length - 1; i >= 0; i--) {
    const l = s.loot[i];
    l.age += DT;
    if (p.dead || l.age < 0.4 || len(l.x - p.x, l.y - p.y) > 14) continue;
    if (p.bag.length >= BAG_SIZE) { if (s.tick % 45 === 0) s.events.push({ type: "bagFull" }); continue; }
    p.bag.push(l.item);
    s.loot.splice(i, 1);
    s.events.push({ type: "pickup", rarity: l.item.rarity, name: l.item.name });
  }
}

// ---------------------------------------------------------------- rift

function updateRift(s: SimState) {
  const r = s.rift;
  if (r.done) return;
  r.time += DT;
  if (!r.timeUpSent && r.time >= r.limit) { r.timeUpSent = true; s.events.push({ type: "timeUp" }); }
  if (!r.guardianSpawned && r.progress >= r.need) {
    r.guardianSpawned = true;
    const p = s.player;
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
    const g = spawnEnemy(s, "guardian", gx, gy);
    g.aggro = true; g.state = "intro"; g.t = 1.6; g.atkCd = 2;
    r.guardianId = g.id;
    // clear the trash so the fight is readable
    for (const e of s.enemies) if (e !== g && !e.dead && len(e.x - gx, e.y - gy) < 120) { e.dead = true; s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind }); }
    s.events.push({ type: "guardianSpawn", x: gx, y: gy });
  }
}

function completeRift(s: SimState, g: Enemy) {
  const r = s.rift;
  r.done = true; r.doneAt = r.time;
  const left = Math.max(0, r.limit - r.time);
  const inTime = left > 0;
  const gr = RIFT.guardianRewards;
  const n = gr.baseItems + (inTime ? gr.inTimeItems + Math.floor(left / 60) * gr.itemsPerMinuteLeft : 0);
  for (let i = 0; i < n; i++) {
    const d = DIR_TABLE[Math.floor((i * 32) / n) % 32];
    let x = g.x + d[0] * 22, y = g.y + d[1] * 22;
    if (isWall(s.map, x, y)) { x = g.x; y = g.y; }
    dropItem(s, x, y, i === 0 && inTime && gr.inTimeLegendary ? { rarity: "legendary" } : { legendaryWeightMult: 4 });
  }
  for (const e of s.enemies) if (!e.dead) { e.dead = true; s.events.push({ type: "kill", x: e.x, y: e.y, kind: e.kind }); }
  s.events.push({ type: "riftComplete", inTime, time: r.time });
}

/** Stable hash of the gameplay state (used by the determinism test and later by netcode desync checks). */
export function stateHash(s: SimState): string {
  const { events, _flow, _flowTick, ...rest } = s;
  const str = JSON.stringify(rest);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

