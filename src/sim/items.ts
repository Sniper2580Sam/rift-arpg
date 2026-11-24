import {
  gemVals, AFFIX, AFFIXES, BOON, CLASSES, EquipSlot, ITEMS, LEGENDARIES, LEGENDARY, MODIFIER, ModDef, MYTHICS, Num, RARITY_ORDER, RIFT,
  Rarity, SET, SETS, SKILL, SlotType, classAffinity, levelPower, slotTypeOf,
} from "./data";
import { Rng, int, next, pick } from "./rng";

export interface Affix { id: string; value: number; min: number; max: number }
export interface Item {
  id: string; slot: SlotType; rarity: Rarity; name: string; ilvl: number;
  dmgMin?: number; dmgMax?: number; armor?: number;
  affixes: Affix[];
  legendary?: string; set?: string; quality?: "ancestral" | "primal";
  rerollIdx?: number; rerolls?: number;
  /** favourited by the player: scrapping skips it */
  locked?: boolean;
}
export interface Holder {
  equipment: Partial<Record<EquipSlot, Item>>; bag: Item[]; materials: number;
  /** Rift Shards: from scrapping legendary/set/mythic items; with materials they upgrade gear slots */
  shards?: number;
  /** slot upgrades (+1..+5): whatever is worn in that slot gets +10% per level */
  slotPlus?: Partial<Record<EquipSlot, number>>;
  /** masterwork crit per slot (rolled at max level): this affix on whatever is worn there gets +50% */
  slotCrit?: Partial<Record<EquipSlot, string>>;
}
export const BAG_SIZE = 30;

const ilvlMult = (ilvl: number) => 1 + ITEMS.ilvlScale * (ilvl - 1);

// ------------------------------------------------------------------ minting (backend-owned in live builds)
export interface MintOpts {
  slot?: SlotType; rarity?: Rarity; ilvl?: number; tier?: number;
  legendaryWeightMult?: number; ancestralChance?: number; primalChance?: number;
  forceAncestral?: boolean; forcePrimal?: boolean;
  equipment?: Holder["equipment"]; // smart loot
  /** smart loot: the class the drop is for (legendaries, sets, affixes and base names lean towards it) */
  cls?: string;
}

function rollRarity(r: Rng, o: MintOpts): Rarity {
  const tier = o.tier ?? 1;
  const grow = 1 + RIFT.tiers.legendaryGrowth * (tier - 1);
  const table = Object.entries(ITEMS.rarities).map(([k, v]) => ({
    k: k as Rarity,
    w: k === "legendary" || k === "set" ? v.weight * grow * (o.legendaryWeightMult ?? 1) : k === "common" ? v.weight / Math.max(1, tier * 0.5) : v.weight,
  }));
  let total = 0; for (const t of table) total += t.w;
  let x = next(r) * total;
  for (const t of table) { x -= t.w; if (x < 0) return t.k; }
  return "common";
}

function weightedPick<T>(r: Rng, arr: T[], w: (t: T) => number): T {
  let total = 0; for (const a of arr) total += w(a);
  let x = next(r) * total;
  for (const a of arr) { x -= w(a); if (x < 0) return a; }
  return arr[arr.length - 1];
}

export function mintItem(r: Rng, id: string, o: MintOpts = {}): Item {
  const rarity = o.rarity ?? rollRarity(r, o);
  const eq = o.equipment ?? {};
  let slot: SlotType = o.slot ?? pick(r, ITEMS.slots);
  let legendary: string | undefined, set: string | undefined, setName = "";
  if (rarity === "legendary" || rarity === "mythic") {
    let pool = rarity === "mythic" ? MYTHICS : LEGENDARIES;
    if (o.slot) pool = pool.filter((l) => l.slot === o.slot);
    // smart loot: favour slots that don't have a legendary yet
    const leg = weightedPick(r, pool, (l) => (hasLegInSlot(eq, l.slot) ? 1 : 2.5) * (o.cls ? classAffinity(o.cls, l.tag) : 1));
    legendary = leg.id; slot = leg.slot;
  } else if (rarity === "set") {
    const counts: Record<string, number> = {};
    for (const it of Object.values(eq)) if (it?.set) counts[it.set] = (counts[it.set] ?? 0) + 1;
    const opts: { set: string; slot: SlotType }[] = [];
    for (const s of SETS) for (const sl of Object.keys(s.pieces) as SlotType[]) if (!o.slot || o.slot === sl) opts.push({ set: s.id, slot: sl });
    // smart loot: strongly favour missing pieces of the set you're building
    const choice = weightedPick(r, opts, (c) => (1 + (counts[c.set] ?? 0) * 3 * (pieceOwned(eq, c.set, c.slot) ? 0.2 : 1)) * (o.cls ? classAffinity(o.cls, SET[c.set].tag) : 1));
    set = choice.set; slot = choice.slot; setName = SET[set].pieces[slot]!;
  }
  const ilvl = Math.max(1, Math.min(RIFT.levels.max, o.ilvl ?? 1));
  let quality: Item["quality"];
  if (rarity === "legendary" || rarity === "set" || rarity === "mythic") {
    if (o.forcePrimal || (o.primalChance && next(r) < o.primalChance)) quality = "primal";
    else if (o.forceAncestral || (o.ancestralChance && next(r) < o.ancestralChance)) quality = "ancestral";
  }
  const qm = quality ? ITEMS.ancestralMult : 1;
  const base = (ITEMS.bases as Record<string, any>)[slot];
  const item: Item = { id, slot, rarity, name: "", ilvl, affixes: [] };
  const boost = (rarity === "legendary" || rarity === "set" || rarity === "mythic" ? 1.25 : rarity === "rare" ? 1.1 : 1) * qm * ilvlMult(ilvl);
  const roll = (lo: number, hi: number) => (quality === "primal" ? hi : int(r, lo, hi));
  if (slot === "weapon") {
    item.dmgMin = Math.round(roll(base.dmgMin[0], base.dmgMin[1]) * boost);
    item.dmgMax = item.dmgMin + Math.round(roll(base.dmgSpread[0], base.dmgSpread[1]) * boost);
  } else if (base.armor) {
    item.armor = Math.round(roll(base.armor[0], base.armor[1]) * boost);
  }
  let count = (ITEMS.rarities as Record<string, { affixes: number }>)[rarity].affixes;
  if (ITEMS.jewelry.includes(slot)) count++;
  const pool = AFFIXES.filter((a) => a.slots.includes(slot));
  // "+% fire damage" style affixes lean towards tags the class's skills use
  const affW = (a: { id: string }) => (o.cls && a.id.startsWith("tag_") ? Math.max(0.15, classAffinity(o.cls, a.id.slice(4))) : 1);
  for (let i = 0; i < count && pool.length; i++) {
    const a = o.cls ? weightedPick(r, pool, affW) : pool[Math.floor(next(r) * pool.length)];
    pool.splice(pool.indexOf(a), 1);
    item.affixes.push(rollAffix(r, a.id, ilvl, qm, quality === "primal"));
  }
  const classNames = o.cls ? ((ITEMS as any).classBases?.[o.cls]?.[slot] as string[] | undefined) : undefined;
  const baseName = pick(r, classNames ?? (base.names as string[]));
  if (legendary) item.name = LEGENDARY[legendary].name;
  else if (set) item.name = setName;
  else if (rarity === "rare") item.name = `${pick(r, ITEMS.rareWords1)} ${pick(r, ITEMS.rareWords2)} ${baseName}`;
  else if (rarity === "magic") item.name = `${pick(r, ITEMS.magicPrefixes)} ${baseName}`;
  else item.name = baseName;
  if (legendary) item.legendary = legendary;
  if (set) item.set = set;
  if (quality) item.quality = quality;
  return item;
}

// ------------------------------------------------------------------ slot upgrades and Rift Shards
const SU = ITEMS.slotUpgrade;
export const SLOT_MAX = SU.maxPlus;
export const slotMult = (plus: number) => 1 + SU.perPlus * plus;
/** Cost of the next level for a slot at `plus`, or null at the cap. */
export const slotCost = (plus: number) => (plus >= SU.maxPlus ? null : { materials: SU.materials[plus], shards: SU.shards[plus] });
export function shardValue(it: Item): number {
  const V = ITEMS.shardValue as Record<string, number>;
  const base = V[it.rarity] ?? 0;
  return base * (it.quality === "primal" ? V.primalMult : it.quality === "ancestral" ? V.ancestralMult : 1);
}
const scaleVal = (v: number, m: number) => (Number.isInteger(v) ? Math.round(v * m) : Math.round(v * m * 10) / 10);
/** The item as it counts in a slot upgraded to `plus` (with an optional masterwork crit affix): values scaled. */
export function scaledItem(it: Item, plus = 0, crit?: string): Item {
  const m = slotMult(plus);
  if (m === 1 && !(crit && it.affixes.some((a) => a.id === crit))) return it;
  const cm = m * (1 + SU.critBonus);
  return {
    ...it,
    dmgMin: it.dmgMin !== undefined ? scaleVal(it.dmgMin, m) : undefined, dmgMax: it.dmgMax !== undefined ? scaleVal(it.dmgMax, m) : undefined,
    armor: it.armor ? scaleVal(it.armor, m) : it.armor,
    affixes: it.affixes.map((a) => ({ ...a, value: scaleVal(a.value, a.id === crit ? cm : m) })),
  };
}
/** Affix types that can roll in a slot (ring1/ring2 share the ring list). */
export const slotAffixes = (slot: EquipSlot) => AFFIXES.filter((a) => a.slots.includes((slot.startsWith("ring") ? "ring" : slot) as SlotType)).map((a) => a.id);
/** Masterwork crit roll: deterministic from the slot and how many times it was rolled, so client and server agree. */
export function rollSlotCrit(slot: EquipSlot, n: number, current?: string): string {
  const pool = slotAffixes(slot).filter((id) => id !== current);
  let h = 2166136261; const key = `${slot}:${n}`;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return pool[(h >>> 0) % pool.length];
}

function rollAffix(r: Rng, id: string, ilvl: number, qm: number, max: boolean): Affix {
  const a = AFFIX[id];
  const sc = (a.flat ? ilvlMult(ilvl) : 1) * qm;
  const min = Math.max(1, Math.round(a.min * sc)), mx = Math.max(min, Math.round(a.max * sc));
  return { id, value: max ? mx : int(r, min, mx), min, max: mx };
}

function hasLegInSlot(eq: Holder["equipment"], slot: SlotType) {
  for (const [k, it] of Object.entries(eq)) if (it && slotTypeOf(k as EquipSlot) === slot && it.legendary) return true;
  return false;
}
function pieceOwned(eq: Holder["equipment"], set: string, slot: SlotType) {
  for (const it of Object.values(eq)) if (it?.set === set && it.slot === slot) return true;
  return false;
}

export function affixText(a: Affix): string { return AFFIX[a.id].text.replace("{v}", String(a.value)); }
export function affixQuality(a: Affix): number { return a.max === a.min ? 1 : (a.value - a.min) / (a.max - a.min); }

/** Legendary power text with values filled in (ancestral/primal powers are 50% stronger). */
export function powerText(it: Item): string {
  const l = LEGENDARY[it.legendary!];
  const m = it.quality ? 1.5 : 1;
  return l.text.replace(/\{(\w+)\}/g, (_, k) => {
    const v = l.set?.[k] ?? l.add?.[k] ?? l.mul?.[k] ?? 0;
    const sv = l.scales?.includes(k) ? v * m : v;
    if (l.pct?.includes(k)) return Math.round(sv * 100) + "%";
    return String(Math.round(sv * 100) / 100);
  });
}

/** Rerolls one affix. Once an affix has been rerolled, only that one can be rerolled again (D3 enchanting). */
export function rerollCost(it: Item): number {
  const c = ITEMS.reroll;
  return Math.min(c.maxCost, Math.round(c.baseCost * Math.pow(c.costGrowth, it.rerolls ?? 0) * (it.rarity === "legendary" || it.rarity === "set" || it.rarity === "mythic" ? 2 : 1)));
}
export function rerollOptions(r: Rng, it: Item, idx: number, n = 3): Affix[] {
  const taken = new Set(it.affixes.map((a, i) => (i === idx ? "" : a.id)));
  const pool = AFFIXES.filter((a) => a.slots.includes(it.slot) && !taken.has(a.id));
  const out: Affix[] = [];
  const qm = it.quality ? ITEMS.ancestralMult : 1;
  for (let i = 0; i < n && pool.length; i++) {
    const a = pool.splice(Math.floor(next(r) * pool.length), 1)[0];
    out.push(rollAffix(r, a.id, it.ilvl, qm, it.quality === "primal"));
  }
  return out;
}

// ------------------------------------------------------------------ stats
export interface Stats {
  dmgMin: number; dmgMax: number; dmgPct: number; critChance: number; critDmg: number; atkSpeed: number;
  maxHp: number; armor: number; regen: number; moveSpeed: number; cdr: number; lifeOnHit: number; eliteDmg: number;
  resRegen: number; costRed: number; resMax: number; areaPct: number;
  tagDmg: Num; mods: ModDef[]; flags: Num; setCounts: Record<string, number>;
  speed: number; dmgMult: number; takenMult: number;
}

export interface StatCtx { cls: string; level: number; paragon?: Partial<Record<string, number>>; /** equipped rift gems and their levels */ gems?: Record<string, number>; effLevel?: number; boons?: string[]; riftMods?: string[]; slotPlus?: Holder["slotPlus"]; slotCrit?: Holder["slotCrit"] }

export function computeStats(eq: Holder["equipment"], c: StatCtx): Stats {
  const cd = CLASSES[c.cls];
  const lp = levelPower(c.level);
  const s: Stats = {
    dmgMin: Math.round(cd.fists[0] * lp), dmgMax: Math.round(cd.fists[1] * lp), dmgPct: 0, critChance: 5, critDmg: 50, atkSpeed: 0,
    maxHp: cd.baseHp + cd.hpPerLevel * (c.level - 1), armor: 0, regen: 0, moveSpeed: 0, cdr: 0, lifeOnHit: 0, eliteDmg: 0, resRegen: 0, costRed: 0, resMax: 0, areaPct: 0,
    tagDmg: {}, mods: [], flags: {}, setCounts: {}, speed: cd.speed, dmgMult: 1, takenMult: 1,
  };
  const setSeen = new Set<string>();
  for (const [slot, raw] of Object.entries(eq)) {
    if (!raw) continue;
    const it = scaledItem(raw, c.slotPlus?.[slot as EquipSlot] ?? 0, c.slotCrit?.[slot as EquipSlot]);
    if (it.dmgMin !== undefined) { s.dmgMin = it.dmgMin; s.dmgMax = it.dmgMax!; }
    if (it.armor) s.armor += it.armor;
    for (const a of it.affixes) {
      switch (a.id) {
        case "dmg_pct": s.dmgPct += a.value; break;
        case "crit_chance": s.critChance += a.value; break;
        case "crit_dmg": s.critDmg += a.value; break;
        case "atk_speed": s.atkSpeed += a.value; break;
        case "life": s.maxHp += a.value; break;
        case "armor": s.armor += a.value; break;
        case "regen": s.regen += a.value; break;
        case "move_speed": s.moveSpeed += a.value; break;
        case "cdr": s.cdr += a.value; break;
        case "life_on_hit": s.lifeOnHit += a.value; break;
        case "elite_dmg": s.eliteDmg += a.value; break;
        case "res_regen": s.resRegen += a.value; break;
        case "cost_red": s.costRed += a.value; break;
        case "res_max": s.resMax += a.value; break;
        case "area_pct": s.areaPct += a.value; break;
        default: if (a.id.startsWith("tag_")) { const t = a.id.slice(4); s.tagDmg[t] = (s.tagDmg[t] ?? 0) + a.value; }
      }
    }
    if (it.legendary) s.mods.push(scaledMod(LEGENDARY[it.legendary], it.quality ? 1.5 : 1));
    // a set counts each piece once: two copies of the same set ring are one piece
    if (it.set && !setSeen.has(it.set + ":" + it.slot)) { setSeen.add(it.set + ":" + it.slot); s.setCounts[it.set] = (s.setCounts[it.set] ?? 0) + 1; }
  }
  for (const [id, n] of Object.entries(s.setCounts)) {
    for (const [need, b] of Object.entries(SET[id].bonuses)) if (n >= +need) s.mods.push(b);
  }
  for (const b of c.boons ?? []) {
    const d = BOON[b];
    if (d.mod) s.mods.push(d.mod);
    const st = d.stats ?? {};
    s.dmgPct += st.dmgPct ?? 0; s.moveSpeed += st.moveSpeed ?? 0; s.atkSpeed += st.atkSpeed ?? 0; s.cdr += st.cdr ?? 0;
    s.critChance += st.critChance ?? 0;
    if (st.hpPct) s.maxHp = Math.round(s.maxHp * (1 + st.hpPct / 100));
    if (st.armorPct) s.armor = Math.round(s.armor * (1 + st.armorPct / 100) + 20);
    if (st.regenPct) s.regen += Math.round((s.maxHp * st.regenPct) / 100);
  }
  for (const m of s.mods) if (m.player) for (const [k, v] of Object.entries(m.set ?? {})) s.flags[k] = Math.max(s.flags[k] ?? 0, v);
  for (const id of c.riftMods ?? []) {
    const m = MODIFIER[id];
    if (m.playerDmg) s.dmgMult *= m.playerDmg;
    if (m.playerTaken) s.takenMult *= m.playerTaken;
  }
  // level sync: lower-level party members are scaled up toward the party, never above the strongest player
  if (c.effLevel && c.effLevel > c.level) {
    const k = levelPower(c.effLevel) / lp;
    s.dmgMult *= k; s.maxHp = Math.round(s.maxHp * k);
  }
  // paragon points (after max level)
  const pa = c.paragon ?? {}, PS = RIFT.paragon.stats as Record<string, { per: number; cap: number }>;
  const pv = (k: string) => Math.min(PS[k].cap, pa[k] ?? 0) * PS[k].per;
  if (pv("power")) s.dmgPct += pv("power");
  if (pv("vitality")) s.maxHp = Math.round(s.maxHp * (1 + pv("vitality") / 100));
  if (pv("toughness")) s.takenMult *= 1 - pv("toughness") / 100;
  if (pv("haste")) { s.cdr += pv("haste"); s.moveSpeed += pv("haste"); }
  // rift gems
  for (const [id, lvl] of Object.entries(c.gems ?? {})) {
    const [a, b] = gemVals(id, lvl);
    if (id === "bane") s.eliteDmg += a;
    if (id === "fury") s.dmgPct += a;
    if (id === "storm") { s.flags.gemChain = a / 100; s.flags.gemChainMult = b / 100; }
    if (id === "bulwark") s.flags.lowLifeDR = a / 100;
    if (id === "gale") { s.moveSpeed += a; s.cdr += b; }
    if (id === "blood") s.flags.healOnKill = a / 100;
  }
  s.critChance = Math.min(75, s.critChance);
  return s;
}

function scaledMod(l: ModDef & { scales?: string[] }, m: number): ModDef {
  if (m === 1 || !l.scales) return l;
  const sc = (o?: Num) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, l.scales!.includes(k) ? (Number.isInteger(v) && v > 1 ? Math.round(v * m) : v * m) : v]));
  return { ...l, set: sc(l.set), add: sc(l.add) };
}

// ------------------------------------------------------------------ skills: base -> rune -> item/set/boon mods
export interface ResolvedSkill { id: string; kind: string; p: Num; tags: string[] }
const OVERRIDE = new Set(["pierce", "spreadSteps", "arcCos", "size"]);

export function resolveSkill(id: string, rune: string | undefined, st: Stats): ResolvedSkill {
  const d = SKILL[id];
  const p: Num = { power: 1, ...d.p };
  let tags = [...d.tags];
  const r = rune ? d.runes.find((x) => x.id === rune) : undefined;
  if (r) {
    for (const [k, v] of Object.entries(r.add ?? {})) p[k] = (p[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.mul ?? {})) p[k] = (p[k] ?? 0) * v;
    for (const [k, v] of Object.entries(r.set ?? {})) p[k] = v;
    tags = tags.filter((t) => !(r.removeTags ?? []).includes(t)).concat(r.addTags ?? []);
  }
  const matches = (m: ModDef) => !m.player && (m.tag === "any" || m.skill === id || (!!m.tag && tags.includes(m.tag)));
  for (const m of st.mods) if (matches(m) && m.addTags) for (const t of m.addTags) if (!tags.includes(t)) tags.push(t);
  for (const m of st.mods) {
    if (!matches(m)) continue;
    // constructs: "+N projectiles" means more shots per volley, and "+N minions" means N more can stand at once
    // (each cast still builds one, so the oldest isn't knocked down early)
    // a build that drops its whole group at once (the Bone Battery ring) grows the group instead
    const build = tags.includes("construct") && p.maxCount !== undefined, ring = build && (d.p.count ?? 1) > 1;
    const ck = !build ? "count" : m.tag === "projectile" ? "shots" : ring ? "count" : "maxCount";
    for (const [k, v] of Object.entries(m.add ?? {})) { const kk = k === "count" ? ck : k; p[kk] = (p[kk] ?? 0) + v; }
    for (const [k, v] of Object.entries(m.mul ?? {})) p[k] = (p[k] ?? (k === "power" ? 1 : 0)) * v;
    for (const [k, v] of Object.entries(m.set ?? {})) p[k] = OVERRIDE.has(k) ? v : Math.max(p[k] ?? 0, v);
  }
  // area of effect gear scales area skills (radius only, so single-target skills stay single-target)
  if (st.areaPct && tags.includes("aoe") && p.radius) p.radius *= 1 + Math.min(100, st.areaPct) / 100;
  return { id, kind: d.kind, p, tags };
}

// ------------------------------------------------------------------ inventory
export type InvCmd =
  | { type: "equip"; bagIndex: number; to?: EquipSlot }
  | { type: "unequip"; slot: EquipSlot }
  | { type: "scrap"; bagIndex: number }
  | { type: "scrapBelow"; rarity: Rarity }
  | { type: "lock"; bagIndex?: number; slot?: EquipSlot };

export function equipTarget(h: Holder, it: Item, to?: EquipSlot): EquipSlot {
  if (it.slot !== "ring") return it.slot as EquipSlot;
  if (to === "ring1" || to === "ring2") return to;
  if (!h.equipment.ring1) return "ring1";
  if (!h.equipment.ring2) return "ring2";
  return "ring1";
}

export function applyInvCmd(h: Holder, cmd: InvCmd): boolean {
  if (cmd.type === "equip") {
    const it = h.bag[cmd.bagIndex];
    if (!it) return false;
    const slot = equipTarget(h, it, cmd.to);
    const old = h.equipment[slot];
    h.equipment[slot] = it;
    if (old) h.bag[cmd.bagIndex] = old; else h.bag.splice(cmd.bagIndex, 1);
    return true;
  }
  if (cmd.type === "unequip") {
    const it = h.equipment[cmd.slot];
    if (!it || h.bag.length >= BAG_SIZE) return false;
    delete h.equipment[cmd.slot];
    h.bag.push(it);
    return true;
  }
  if (cmd.type === "lock") {
    const it = cmd.bagIndex !== undefined ? h.bag[cmd.bagIndex] : cmd.slot ? h.equipment[cmd.slot] : undefined;
    if (!it) return false;
    if (it.locked) delete it.locked; else it.locked = true;
    return true;
  }
  if (cmd.type === "scrap") {
    const it = h.bag[cmd.bagIndex];
    if (!it || it.locked) return false;
    h.bag.splice(cmd.bagIndex, 1);
    h.materials += scrapValue(it); h.shards = (h.shards ?? 0) + shardValue(it);
    return true;
  }
  if (cmd.type === "scrapBelow") {
    const lim = RARITY_ORDER.indexOf(cmd.rarity);
    const keep: Item[] = [];
    for (const it of h.bag) { if (!it.locked && RARITY_ORDER.indexOf(it.rarity) < lim) { h.materials += scrapValue(it); h.shards = (h.shards ?? 0) + shardValue(it); } else keep.push(it); }
    const changed = keep.length !== h.bag.length;
    h.bag.splice(0, h.bag.length, ...keep); // in place: the hub passes a holder view whose bag is the character's own array
    return changed;
  }
  return false;
}

export function scrapValue(it: Item) {
  return ((ITEMS.scrapValue as Num)[it.rarity] ?? 1) * (it.quality === "primal" ? 5 : it.quality === "ancestral" ? 2 : 1);
}
