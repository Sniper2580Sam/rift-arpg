// Server-side item authority: minting drops for a run, and validating what a player brings back.
// Pure functions (no I/O) so they can be unit tested.
import { CLASSES, RIFT } from "../sim/data";
import { Item, MintOpts, mintItem, scrapValue } from "../sim/items";
import { Rng, next } from "../sim/rng";
import type { CharSave, Profile } from "../client/profile";

export interface RunMember {
  account: string; pid: number; level: number;
  pity: { ancestral: boolean; primal: boolean };
  pending: Map<string, Item>; // minted for this player, not yet saved into their profile
  forced: number; usedAnc: boolean; usedPri: boolean; drops: number; mythic: boolean;
}
export interface RunInfo { kind: "rift" | "chase"; tier: number; completed: boolean; inTime: boolean; time: number }

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
    // forced rarities only come from guardian / king rewards: at most two per player per run, after completion
    if (!run.completed || m.forced >= 2) return out;
    m.forced++;
    if (o.rarity === "mythic") {
      if (run.kind !== "chase" || m.mythic || next(rng) >= RIFT.chase.mythicChance) out.rarity = "legendary";
      else { out.rarity = "mythic"; m.mythic = true; }
    } else if (o.rarity === "legendary" || o.rarity === "set") out.rarity = o.rarity;
    if (o.forceAncestral && m.pity.ancestral && !m.usedAnc) { out.forceAncestral = true; m.usedAnc = true; }
    if (o.forcePrimal && m.pity.primal && !m.usedPri) { out.forcePrimal = true; m.usedPri = true; }
  }
  return out;
}

let counter = 0;
export function mintFor(rng: Rng, m: RunMember, opts: MintOpts): Item {
  const id = `s${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(next(rng) * 1e6).toString(36)}`;
  const it = mintItem(rng, id, opts);
  m.pending.set(id, it); m.drops++;
  return it;
}

const same = (a: Item, b: Item) => JSON.stringify(a) === JSON.stringify(b);

export interface SaveReport {
  equipment: CharSave["equipment"]; bag: Item[]; scrapped: string[]; materials: number;
  level: number; xp: number; sigils: number; uses: Record<string, number>;
  highestTier: number; pityAnc: number; pityPri: number; bestTimes: Record<string, number>; riftsCleared: number;
  weeklyBest?: number;
}

/**
 * Accept a player's in-run results. Items must be ones they already owned or were minted for them this run,
 * unchanged. Materials can only grow by the scrap value of items that really left. Everything else is clamped.
 * Returns a list of problems (empty = clean); the save still applies with offending parts dropped.
 */
export function applySave(p: Profile, cls: string, rep: SaveReport, m: RunMember | null, run: RunInfo | null): string[] {
  const problems: string[] = [];
  const c = p.chars[cls];
  if (!c) return ["no such class"];
  const owned = new Map<string, Item>();
  for (const it of Object.values(c.equipment)) if (it) owned.set(it.id, it);
  for (const it of c.bag) owned.set(it.id, it);
  const known = (id: string) => owned.get(id) ?? m?.pending.get(id);
  // materials earned from scrapping
  let earned = 0;
  const gone = new Set<string>();
  for (const id of rep.scrapped ?? []) {
    const it = known(id);
    if (!it || gone.has(id)) continue;
    gone.add(id); earned += scrapValue(it);
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
  // progression: trusted within sane bounds (the sim is host-run; see DECISIONS.md)
  const L = RIFT.levels.max;
  const lvl = Math.max(c.level, Math.min(L, rep.level | 0, c.level + 6));
  if (lvl !== c.level || rep.xp !== c.xp) { c.level = lvl; c.xp = Math.max(0, rep.xp | 0); }
  c.sigils = Math.max(0, Math.min(rep.sigils | 0, c.sigils + 2));
  for (const [k, v] of Object.entries(rep.uses ?? {})) c.uses[k] = Math.max(c.uses[k] ?? 0, Math.min(v | 0, (c.uses[k] ?? 0) + 5000));
  if (run?.completed && run.inTime && run.kind === "rift" && rep.highestTier === run.tier + 1 && c.highestTier <= run.tier) c.highestTier = Math.min(RIFT.tiers.max, run.tier + 1);
  if (run?.completed) {
    c.riftsCleared = Math.min(rep.riftsCleared | 0, c.riftsCleared + 1);
    c.pityAnc = Math.max(0, Math.min(rep.pityAnc | 0, c.pityAnc + 1));
    c.pityPri = Math.max(0, Math.min(rep.pityPri | 0, c.pityPri + 1));
    const key = String(run.tier);
    if (run.inTime && rep.bestTimes?.[key] && Math.abs(rep.bestTimes[key] - run.time) < 1 && (!c.bestTimes[key] || run.time < c.bestTimes[key])) c.bestTimes[key] = run.time;
  }
  return problems;
}
