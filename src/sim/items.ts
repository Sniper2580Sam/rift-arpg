import { AFFIX, AFFIXES, ITEMS, LEGENDARIES, LEGENDARY, Rarity, Slot, Tag } from "./data";
import { Rng, int, next, pick, weighted } from "./rng";

export interface Affix { id: string; value: number }
export interface Item {
  id: string;
  slot: Slot;
  rarity: Rarity;
  name: string;
  dmgMin?: number; dmgMax?: number; // weapons
  armor?: number;                   // everything else
  affixes: Affix[];
  legendary?: string;               // id into legendaries.json
}

export interface Holder { equipment: Partial<Record<Slot, Item>>; bag: Item[]; materials: number }
export const BAG_SIZE = 24;

export interface MintOpts { slot?: Slot; rarity?: Rarity; legendaryWeightMult?: number }

/**
 * Pure item mint. In the live game this runs on the backend only (it creates and saves every item);
 * in OFFLINE_TEST builds the local sim calls it directly.
 */
export function mintItem(r: Rng, id: string, opts: MintOpts = {}): Item {
  let rarity = opts.rarity;
  if (!rarity) {
    const table = Object.entries(ITEMS.rarities).map(([k, v]) => ({
      k: k as Rarity,
      weight: k === "legendary" ? v.weight * (opts.legendaryWeightMult ?? 1) : v.weight,
    }));
    rarity = weighted(r, table).k;
  }
  let slot = opts.slot ?? pick(r, ITEMS.slots);
  let legendary: string | undefined;
  if (rarity === "legendary") {
    const pool = opts.slot ? LEGENDARIES.filter((l) => l.slot === opts.slot) : LEGENDARIES;
    const leg = pick(r, pool);
    legendary = leg.id;
    slot = leg.slot;
  }
  const base = (ITEMS.bases as Record<string, any>)[slot];
  const item: Item = { id, slot, rarity, name: "", affixes: [] };
  const boost = rarity === "legendary" ? 1.25 : rarity === "rare" ? 1.1 : 1;
  if (slot === "weapon") {
    item.dmgMin = Math.round(int(r, base.dmgMin[0], base.dmgMin[1]) * boost);
    item.dmgMax = item.dmgMin + Math.round(int(r, base.dmgSpread[0], base.dmgSpread[1]) * boost);
  } else {
    item.armor = Math.round(int(r, base.armor[0], base.armor[1]) * boost);
  }
  const count = (ITEMS.rarities as Record<string, { affixes: number }>)[rarity].affixes;
  const pool = AFFIXES.filter((a) => a.slots.includes(slot));
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(next(r) * pool.length);
    const a = pool.splice(idx, 1)[0];
    item.affixes.push({ id: a.id, value: int(r, a.min, a.max) });
  }
  const baseName = pick(r, base.names as string[]);
  if (legendary) item.name = LEGENDARY[legendary].name;
  else if (rarity === "rare") item.name = `${pick(r, ITEMS.rareWords1)} ${pick(r, ITEMS.rareWords2)}`;
  else if (rarity === "magic") item.name = `${pick(r, ITEMS.magicPrefixes)} ${baseName}`;
  else item.name = baseName;
  if (rarity === "rare") item.name += ` ${baseName}`;
  return item;
}

export function affixText(a: Affix): string {
  return AFFIX[a.id].text.replace("{v}", String(a.value));
}

export interface Stats {
  dmgMin: number; dmgMax: number;
  dmgPct: number; critChance: number; critDmg: number;
  maxHp: number; armor: number; moveSpeed: number; cdr: number; lifeOnHit: number;
  tagDmg: Partial<Record<Tag, number>>;
  powers: Record<string, Record<string, number>>;
}

export function computeStats(h: Pick<Holder, "equipment">): Stats {
  const s: Stats = {
    dmgMin: 5, dmgMax: 8, dmgPct: 0, critChance: 5, critDmg: 50,
    maxHp: 200, armor: 0, moveSpeed: 0, cdr: 0, lifeOnHit: 0, tagDmg: {}, powers: {},
  };
  for (const slot of ITEMS.slots) {
    const it = h.equipment[slot];
    if (!it) continue;
    if (it.dmgMin !== undefined) { s.dmgMin = it.dmgMin; s.dmgMax = it.dmgMax!; }
    if (it.armor) s.armor += it.armor;
    for (const a of it.affixes) {
      switch (a.id) {
        case "dmg_pct": s.dmgPct += a.value; break;
        case "crit_chance": s.critChance += a.value; break;
        case "crit_dmg": s.critDmg += a.value; break;
        case "life": s.maxHp += a.value; break;
        case "armor": s.armor += a.value; break;
        case "move_speed": s.moveSpeed += a.value; break;
        case "cdr": s.cdr += a.value; break;
        case "life_on_hit": s.lifeOnHit += a.value; break;
        default:
          if (a.id.startsWith("tag_")) {
            const t = a.id.slice(4) as Tag;
            s.tagDmg[t] = (s.tagDmg[t] ?? 0) + a.value;
          }
      }
    }
    if (it.legendary) {
      const l = LEGENDARY[it.legendary];
      s.powers[l.power] = l.params;
    }
  }
  return s;
}

export type InvCmd =
  | { type: "equip"; bagIndex: number }
  | { type: "unequip"; slot: Slot }
  | { type: "scrap"; bagIndex: number };

/** Shared by the hub (local profile) and the sim (as a player command). Returns true if anything changed. */
export function applyInvCmd(h: Holder, cmd: InvCmd): boolean {
  if (cmd.type === "equip") {
    const it = h.bag[cmd.bagIndex];
    if (!it) return false;
    const old = h.equipment[it.slot];
    h.equipment[it.slot] = it;
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
  if (cmd.type === "scrap") {
    const it = h.bag[cmd.bagIndex];
    if (!it) return false;
    h.bag.splice(cmd.bagIndex, 1);
    h.materials += (ITEMS.scrapValue as Record<string, number>)[it.rarity] ?? 1;
    return true;
  }
  return false;
}

