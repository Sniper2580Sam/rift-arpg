// Server-side item authority: minting drops for a run, and validating what a player brings back.
// Pure functions (no I/O) so they can be unit tested.
import { coresForRun, trophiesForRun, dustForRun, aetherForFeats, aetherForRun, CLASSES, GEM, GEMS, gemCap, RIFT, bumpLife, chapterKey, lifeStats, newChapters, newFeats, tierJump } from "../sim/data";
import { Item, MintOpts, mintItem, scrapValue, shardValue } from "../sim/items";
import { Rng, next } from "../sim/rng";
import type { CharSave, Profile } from "../client/profile";

export interface RunMember {
  account: string; pid: number; level: number;
  pity: { ancestral: boolean; primal: boolean };
  pending: Map<string, Item>; // minted for this player, not yet saved into their profile
  forced: number; usedAnc: boolean; usedPri: boolean; drops: number; mythic: boolean;
  /** good items minted for this player this run (feat counters), and whether the run's counters were already added */
  finds?: { legendaries: number; mythics: number; ancestrals: number }; counted?: boolean;
}
export interface RunInfo { kind: "rift" | "chase" | "endless" | "bounty"; boss?: "king" | "seraph"; tier: number; completed: boolean; inTime: boolean; time: number }

const MAX_DROPS = 500;

/** Rebuild the mint options from what the server knows, keeping only the few hints the sim may give. */
export function sanitizeOpts(run: RunInfo, m: RunMember, o: MintOpts, rng: Rng, equipment: CharSave["equipment"]): MintOpts | null {
  if (m.drops >= MAX_DROPS) return null;
  const t = run.tier, T = RIFT.tiers;
  const out: MintOpts = {
    tier: t, equipment, cls: o.cls && CLASSES[o.cls] ? o.cls : undefined, // smart loot only; gives no power
    ilvl: Math.max(1, Math.min(RIFT.levels.max, o.ilvl ?? 1, m.level + 6 + Math.floor(t / 4))),
    ancestralChance: t >= T.ancestralFrom ? Math.min(T.ancestralCap, T.ancestralBase + T.ancestralPerTier * (t - T.ancestralFrom)) : 0,
    primalChance: t >= T.primalFrom ? T.primalChance : 0,
    legendaryWeightMult: Math.max(1, Math.min(6, o.legendaryWeightMult ?? 1)),
  };
  if (o.rarity) {
    // forced rarities only come from guardian / chase rewards: at most two per player per run (three for the Seraph), after completion
    if (!run.completed || m.forced >= (run.boss === "seraph" ? 3 : 2)) return out;
    m.forced++;
    if (o.rarity === "mythic") {
      if (run.kind !== "chase" || m.mythic || next(rng) >= (run.boss === "seraph" ? RIFT.seraph.mythicChance : RIFT.chase.mythicChance)) out.rarity = "legendary";
      else { out.rarity = "mythic"; m.mythic = true; }
    } else if (o.rarity === "legendary" || o.rarity === "set") out.rarity = o.rarity;
    if (o.forceAncestral && run.kind === "chase" && run.boss === "seraph") out.forceAncestral = true; // the Seraph's first two items are always ancestral
    else if (o.forceAncestral && m.pity.ancestral && !m.usedAnc) { out.forceAncestral = true; m.usedAnc = true; }
    if (o.forcePrimal && m.pity.primal && !m.usedPri) { out.forcePrimal = true; m.usedPri = true; }
  }
  return out;
}

let counter = 0;
export function mintFor(rng: Rng, m: RunMember, opts: MintOpts): Item {
  const id = `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(next(rng) * 1e6).toString(36)}`;
  const it = mintItem(rng, id, opts);
  m.pending.set(id, it); m.drops++;
  if (it.rarity === "legendary" || it.rarity === "set" || it.rarity === "mythic") {
    const f = (m.finds ??= { legendaries: 0, mythics: 0, ancestrals: 0 });
    f.legendaries++; if (it.rarity === "mythic") f.mythics++; if (it.quality === "ancestral") f.ancestrals++;
  }
  return it;
}

// the lock (favourite) flag is the player's own choice and may change mid-run
const same = (a: Item, b: Item) => JSON.stringify({ ...a, locked: undefined }) === JSON.stringify({ ...b, locked: undefined });

export interface SaveReport {
  equipment: CharSave["equipment"]; bag: Item[]; scrapped: string[]; materials: number; shards?: number;
  level: number; xp: number; sigils: number; feathers?: number; gems?: Record<string, number>; gemSlots?: string[]; uses: Record<string, number>; paragon?: number; pxp?: number;
  highestTier: number; pityAnc: number; pityPri: number; bestTimes: Record<string, number>; riftsCleared: number;
  weeklyBest?: number;
  /** the player's own count of this run (kills and elites are trusted within limits; finds come from the server's mint) */
  tally?: { kills: number; elites: number; deaths: number; wave: number };
}

/**
 * Accept a player's in-run results. Items must be ones they already owned or were minted for them this run,
 * unchanged. Materials can only grow by the scrap value of items that really left. Everything else is clamped.
 * Returns a list of problems (empty = clean); the save still applies with offending parts dropped.
 */
export function applySave(p: Profile, cls: string, rep: SaveReport, m: RunMember | null, run: RunInfo | null, party = 1): string[] {
  const problems: string[] = [];
  const c = p.chars[cls];
  if (!c) return ["no such class"];
  const owned = new Map<string, Item>();
  for (const it of Object.values(c.equipment)) if (it) owned.set(it.id, it);
  for (const it of c.bag) owned.set(it.id, it);
  const known = (id: string) => owned.get(id) ?? m?.pending.get(id);
  // materials earned from scrapping
  let earned = 0, earnedShards = 0;
  const gone = new Set<string>();
  for (const id of rep.scrapped ?? []) {
    const it = known(id);
    if (!it || gone.has(id)) continue;
    gone.add(id); earned += scrapValue(it); earnedShards += shardValue(it);
  }
  const seen = new Set<string>();
  const ok = (it: Item | undefined) => {
    if (!it) return false;
    const k = known(it.id);
    if (!k || gone.has(it.id) || seen.has(it.id) || !same(k, it)) { problems.push(`rejected item ${it?.id}`); return false; }
    seen.add(it.id); return true;
  };
  const eq: CharSave["equipment"] = {};
  for (const [slot, it] of Object.entries(rep.equipment ?? {})) if (ok(it)) (eq as any)[slot] = it;
  const bag = (rep.bag ?? []).filter(ok).slice(0, 30);
  c.equipment = eq; c.bag = bag;
  for (const id of [...seen, ...gone]) m?.pending.delete(id);
  const maxMats = p.materials + earned;
  if (rep.materials > maxMats) problems.push(`materials clamped ${rep.materials} -> ${maxMats}`);
  p.materials = Math.max(0, Math.min(rep.materials | 0, maxMats));
  const maxShards = (p.shards ?? 0) + earnedShards;
  p.shards = Math.max(0, Math.min((rep.shards ?? p.shards ?? 0) | 0, maxShards));
  // progression: trusted within sane bounds (the sim is host-run; see DECISIONS.md)
  const L = RIFT.levels.max;
  const lvl = Math.max(c.level, Math.min(L, rep.level | 0, c.level + 6));
  if (lvl !== c.level || rep.xp !== c.xp) { c.level = lvl; c.xp = Math.max(0, rep.xp | 0); }
  c.sigils = Math.max(0, Math.min(rep.sigils | 0, c.sigils + 2));
  // rift gems: levels only grow by what one clear can give, and at most one new gem per run
  if (rep.gems && run?.completed && run.kind === "rift") {
    const g = { ...(c.gems ?? {}) }; let added = 0;
    for (const [id, lv] of Object.entries(rep.gems)) {
      if (!GEM[id]) continue;
      if (!g[id]) { if (added++ || run.tier < GEMS.fromTier) continue; g[id] = 1; }
      g[id] = Math.max(g[id], Math.min(lv | 0, g[id] + 4, gemCap(run.tier)));
    }
    c.gems = g;
  }
  if (rep.gemSlots) c.gemSlots = rep.gemSlots.filter((id, i, a) => c.gems?.[id] && a.indexOf(id) === i).slice(0, GEMS.slots);
  if (rep.feathers !== undefined) c.feathers = Math.max(0, Math.min(rep.feathers | 0, (c.feathers ?? 0) + 2));
  if (c.level >= L && rep.paragon !== undefined) { c.paragon = Math.max(c.paragon ?? 0, Math.min(rep.paragon | 0, (c.paragon ?? 0) + 5)); c.pxp = Math.max(0, rep.pxp ?? 0); }
  for (const [k, v] of Object.entries(rep.uses ?? {})) c.uses[k] = Math.max(c.uses[k] ?? 0, Math.min(v | 0, (c.uses[k] ?? 0) + 5000));
  if (run?.completed && run.inTime && run.kind === "rift") {
    const up = Math.min(RIFT.tiers.max, run.tier + tierJump(run.time));
    if (rep.highestTier > c.highestTier && rep.highestTier <= up) c.highestTier = rep.highestTier;
  }
  if (run?.completed) {
    c.riftsCleared = Math.min(rep.riftsCleared | 0, c.riftsCleared + 1);
    c.pityAnc = Math.max(0, Math.min(rep.pityAnc | 0, c.pityAnc + 1));
    c.pityPri = Math.max(0, Math.min(rep.pityPri | 0, c.pityPri + 1));
    const key = String(run.tier);
    if (run.inTime && rep.bestTimes?.[key] && Math.abs(rep.bestTimes[key] - run.time) < 1 && (!c.bestTimes[key] || run.time < c.bestTimes[key])) c.bestTimes[key] = run.time;
  }
  if (m && run && !m.counted) { m.counted = true; countRun(p, c, rep, m, run, party); }
  return problems;
}

/** Feat and season-journey counters for one run, added once per player per run. */
function countRun(p: Profile, c: CharSave, rep: SaveReport, m: RunMember, run: RunInfo, party: number) {
  const t = rep.tally, f = m.finds ?? { legendaries: 0, mythics: 0, ancestrals: 0 };
  const secs = Math.max(run.time, 60);
  // a fast party clears a few enemies a second; anything above this is clamped
  const kills = Math.max(0, Math.min((t?.kills ?? 0) | 0, Math.ceil(secs * 25)));
  const elites = Math.max(0, Math.min((t?.elites ?? 0) | 0, Math.ceil(secs * 1.5), kills));
  const wave = run.kind === "endless" ? Math.max(0, Math.min((t?.wave ?? 0) | 0, Math.floor(secs / 4) + 1)) : 0; // a wave takes at least the 3 s breather plus clearing
  const tally = { kind: run.kind, boss: run.boss, tier: run.tier, completed: run.completed, inTime: run.inTime, kills, elites, ...f, deaths: t ? Math.max(0, t.deaths | 0) : 1, party, wave };
  // counters first (they read the heroes' records), then the hero's own records (boss kills, best wave)
  const season = lifeStats({ chars: p.chars, life: p.journey?.season === p.season.n ? p.journey.stats : {} });
  p.life = bumpLife(lifeStats(p), tally);
  p.journey = { season: p.season.n, stats: bumpLife(season, tally) };
  if (run.completed && run.kind === "chase") { if (run.boss === "seraph") c.seraphs = (c.seraphs ?? 0) + 1; else c.kings = (c.kings ?? 0) + 1; }
  if (wave > (c.bestWave ?? 0)) c.bestWave = wave;
  const fe = newFeats(p), ch = newChapters(p, p.journey.stats as any);
  const keys = [...fe.map((a) => a.id), ...ch.map(chapterKey)];
  if (keys.length) p.feats = [...(p.feats ?? []), ...keys];
  p.aether = (p.aether ?? 0) + aetherForRun(tally) + aetherForFeats(keys);
  p.relicDust = (p.relicDust ?? 0) + dustForRun(tally);
  p.echoCores = (p.echoCores ?? 0) + coresForRun(tally);
  const tro = trophiesForRun(tally); p.kingShards = (p.kingShards ?? 0) + tro.shards; p.hallows = (p.hallows ?? 0) + tro.hallows;
}
