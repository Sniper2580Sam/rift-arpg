// Hub operations on a profile. The offline build runs them locally; the live build runs them on the
// client (instant feedback) AND on the server, whose copy is the one that counts.
import { makeRng } from "../sim/rng";
import { passiveCanAdd, passiveCanRemove, runeLevel, talentCanAdd, talentPoints, talentRespec, subclassOf, SET, setComplete, SlotType, LEGENDARY, RELIC_SLOTS, RelicSlot, lifeStats, relicSlotOf, relicUnlock, SHOP, GEMS, ITEMS, RIFT, paragonSpent, CLASSES, COSMETICS, COS_KINDS, CosKind, EquipSlot, HIDEOUT, LOADOUT_SIZE, SKILL, cosAccess, ownsKey, shopCatalogue, validLoadout, VFX } from "../sim/data";
import { chiselItem, echoCost, hallowItem, mintItem, Affix, BAG_SIZE, InvCmd, Item, applyInvCmd, rerollCost, rollSlotCrit, slotCost, SLOT_MAX } from "../sim/items";
import { BUILD_SLOTS, CharSave, Profile, STASH_SIZE, char, holderOf, newProfile, startNewSeason } from "../client/profile";

export type HubOp =
  | { t: "inv"; cmd: InvCmd }
  | { t: "setClass"; cls: string }
  | { t: "setRune"; skill: string; rune: string }
  | { t: "setSkill"; slot: number; skill: string }
  | { t: "reroll"; target: { bag?: number; slot?: EquipSlot }; idx: number; choice: Affix | null }
  | { t: "setting"; k: string; v: any }
  | { t: "stash"; bagIndex: number }
  | { t: "unstash"; stashIndex: number }
  | { t: "lockStash"; stashIndex: number }
  | { t: "buildSave"; idx: number; name?: string }
  | { t: "buildLoad"; idx: number }
  | { t: "buildDelete"; idx: number }
  | { t: "slotUp"; slot: EquipSlot }
  | { t: "slotCrit"; slot: EquipSlot }
  | { t: "buy"; key: string }
  | { t: "paragon"; stat?: string; d?: number; reset?: boolean }
  | { t: "talent"; id?: string; d?: number; reset?: boolean; sub?: string }
  | { t: "tier"; v: number }
  | { t: "passive"; id?: string; d?: number; reset?: boolean }
  | { t: "gem"; slot: number; id: string | null }
  | { t: "buyAether"; pack: string }
  | { t: "extract"; bag: number }
  | { t: "craftSet"; set: string; slot: string }
  | { t: "hallow"; bag?: number; slot?: string }
  | { t: "echo"; bag?: number; slot?: string }
  | { t: "chisel"; bag?: number; slot?: string; mode: "add" | "reroll" }
  | { t: "relic"; slot: string; id: string | null }
  | { t: "hideout"; theme?: string; place?: { id: string; x: number; y: number }; remove?: number }
  | { t: "newSeason" }
  | { t: "reset" };

const ITEMS_EQUIP = ITEMS.equipSlots;
const SETTINGS = new Set(["mute", "shake", "autoTier", "hpbar", "setLooks"]);
const FILTERS = new Set(["common", "magic", "rare", "legendary", "ancestral", "primal"]);

/** Applies one hub op. Returns false if it was invalid (nothing changed). */
export function applyHubOp(p: Profile, op: HubOp): boolean | Profile {
  const c = char(p);
  switch (op.t) {
    case "inv": return applyInvCmd(holderOf(p), op.cmd);
    case "setClass": if (!CLASSES[op.cls]) return false; p.active = op.cls; return true;
    case "setRune": {
      const sk = SKILL[op.skill];
      if (!sk || !CLASSES[c.cls].skills.includes(op.skill)) return false;
      if (!op.rune) { delete c.runes[op.skill]; return true; }
      const r = sk.runes.find((x) => x.id === op.rune);
      if (!r || c.level < runeLevel(op.skill, r.id)) return false;
      c.runes[op.skill] = op.rune; return true;
    }
    case "setSkill": {
      const d = SKILL[op.skill];
      if (!d || !CLASSES[c.cls].skills.includes(op.skill) || d.unlock > c.level || op.slot < 0 || op.slot >= LOADOUT_SIZE) return false;
      const cur = validLoadout(c.cls, c.loadout);
      const j = cur.indexOf(op.skill);
      if (j >= 0) { cur[j] = cur[op.slot]; cur[op.slot] = op.skill; }
      else {
        const k = d.type === "ultimate" ? cur.findIndex((x, i) => i !== op.slot && SKILL[x].type === "ultimate") : -1;
        if (k >= 0) cur[k] = cur[op.slot];
        cur[op.slot] = op.skill;
      }
      c.loadout = validLoadout(c.cls, cur);
      return true;
    }
    case "reroll": {
      const it = op.target.bag !== undefined ? c.bag[op.target.bag] : op.target.slot ? c.equipment[op.target.slot] : undefined;
      if (!it || op.idx < 0 || op.idx >= it.affixes.length) return false;
      if (it.rerollIdx !== undefined && it.rerollIdx !== op.idx) return false;
      const cost = rerollCost(it);
      if (p.materials < cost) return false;
      p.materials -= cost;
      it.rerollIdx = op.idx; it.rerolls = (it.rerolls ?? 0) + 1;
      if (op.choice) it.affixes[op.idx] = op.choice;
      return true;
    }
    case "slotUp": {
      if (!(ITEMS_EQUIP as string[]).includes(op.slot)) return false;
      c.slotPlus ??= {};
      const cur = c.slotPlus[op.slot] ?? 0, cost = slotCost(cur);
      if (!cost || p.materials < cost.materials || (p.shards ?? 0) < cost.shards) return false;
      p.materials -= cost.materials; p.shards = (p.shards ?? 0) - cost.shards;
      c.slotPlus[op.slot] = cur + 1;
      // reaching the cap rolls the slot's masterwork crit
      if (cur + 1 >= SLOT_MAX && !c.slotCrit?.[op.slot]) {
        c.slotCrit ??= {}; c.slotCritRolls ??= {};
        const n = c.slotCritRolls[op.slot] ?? 0;
        c.slotCrit[op.slot] = rollSlotCrit(op.slot, n); c.slotCritRolls[op.slot] = n + 1;
      }
      return true;
    }
    case "slotCrit": {
      const cost = ITEMS.slotUpgrade.critReroll;
      if ((c.slotPlus?.[op.slot] ?? 0) < SLOT_MAX || !c.slotCrit?.[op.slot]) return false;
      if (p.materials < cost.materials || (p.shards ?? 0) < cost.shards) return false;
      p.materials -= cost.materials; p.shards = (p.shards ?? 0) - cost.shards;
      c.slotCritRolls ??= {};
      const n = c.slotCritRolls[op.slot] ?? 0;
      c.slotCrit[op.slot] = rollSlotCrit(op.slot, n, c.slotCrit[op.slot]); c.slotCritRolls[op.slot] = n + 1;
      return true;
    }
    case "setting":
      if (op.k === "filter") { if (!FILTERS.has(op.v)) return false; p.filter = op.v; return true; }
      if (op.k === "pet") { if (!p.unlockedPets.includes(op.v)) return false; p.pet = op.v; return true; }
      if (op.k.startsWith("fx.")) {
        // premium skill effects: free in this build; "default" clears it
        const skill = op.k.slice(3);
        if (op.v !== "default" && (!(VFX.perSkill[skill] ?? []).includes(op.v) || !ownsKey(p, `fx:${skill}:${op.v}`))) return false;
        const fx = { ...(p.cos?.fx ?? {}) };
        if (op.v === "default") delete fx[skill]; else fx[skill] = op.v;
        p.cos = { ...(p.cos ?? {}), fx }; return true;
      }
      if (op.k.startsWith("cos.")) {
        // cosmetics: free ones, earned ones, and premium ones you own (the shop is free in the test build)
        const kind = op.k.slice(4) as CosKind;
        // a set look: a free dye earned by finding every piece of that set (the collection)
        if (kind === "dye" && typeof op.v === "string" && op.v.startsWith("set:")) { if (!setComplete(p.codex, op.v.slice(4))) return false; p.cos = { ...(p.cos ?? {}), dye: op.v }; return true; }
        if (!COS_KINDS.includes(kind) || !COSMETICS[kind].some((x) => x.id === op.v)) return false;
        if (!cosAccess(p, kind, op.v, c.cls).ok) return false;
        p.cos = { ...(p.cos ?? {}), [kind]: op.v }; return true;
      }
      if (SETTINGS.has(op.k)) { (p.settings as any)[op.k] = !!op.v; return true; }
      return false;
    case "passive": {
      // the passive tree: one point per Paragon level; take nodes linked to what you have; free to respec
      if (op.reset) { c.passives = []; return true; }
      const taken = [...(c.passives ?? [])], id = String(op.id ?? "");
      if (op.d === 1 && passiveCanAdd(c.cls, taken, id, c.paragon ?? 0)) { c.passives = [...taken, id]; return true; }
      if (op.d === -1 && passiveCanRemove(c.cls, taken, id)) { c.passives = taken.filter((x) => x !== id); return true; }
      return false;
    }
    case "tier": {
      // one difficulty for every activity (Trials keep their own ladder)
      const v = Math.max(1, Math.min(c.highestTier, op.v | 0));
      if (c.tier === v) return false;
      c.tier = v; return true;
    }
    case "talent": {
      // talents: pick a subclass, then spend points (one per Trial level beaten) in its tree.
      // Points can't be taken back one by one: a respec (or a new subclass) clears the tree, and the points
      // return when you beat your best Trial again.
      if (op.reset) { talentRespec(c); return true; }
      if (op.sub !== undefined) {
        if (!subclassOf(c.cls, op.sub)) return false;
        if (op.sub !== c.subclass) { talentRespec(c); c.subclass = op.sub; }
        return true;
      }
      const a = { ...(c.talents ?? {}) }, id = String(op.id ?? "");
      if (op.d === 1 && talentCanAdd(c.cls, c.subclass, a, id, talentPoints(c))) { a[id] = (a[id] ?? 0) + 1; c.talents = a; return true; }
      return false;
    }
    case "paragon": {
      // spend or refund paragon points; free to respec
      if (op.reset) { c.pAlloc = {}; return true; }
      const ps = (RIFT.paragon.stats as Record<string, { cap: number }>)[op.stat ?? ""];
      if (!ps || (op.d !== 1 && op.d !== -1)) return false;
      const a = { ...(c.pAlloc ?? {}) }, cur = a[op.stat!] ?? 0;
      if (op.d === 1 && (cur >= ps.cap || paragonSpent(a) >= (c.paragon ?? 0))) return false;
      if (op.d === -1 && cur <= 0) return false;
      a[op.stat!] = cur + op.d; c.pAlloc = a; return true;
    }
    case "gem": {
      // socket a gem you own into one of the 3 slots (or empty the slot); a gem can only sit in one slot
      if (!Number.isInteger(op.slot) || op.slot < 0 || op.slot >= GEMS.slots) return false;
      const sl = [...(c.gemSlots ?? [])].filter((g) => c.gems?.[g]);
      if (op.id !== null && !c.gems?.[op.id]) return false;
      if (op.id === null) { if (op.slot >= sl.length) return false; sl.splice(op.slot, 1); c.gemSlots = sl; return true; }
      const out: (string | null)[] = [...sl];
      const was = out.indexOf(op.id); if (was >= 0) out[was] = null;
      if (op.slot < out.length) out[op.slot] = op.id; else out.push(op.id);
      c.gemSlots = out.filter((g): g is string => !!g).slice(0, GEMS.slots); return true;
    }
    case "buy": {
      // spend Aether on a cosmetic (premium currency buys looks only, never power)
      const item = typeof op.key === "string" ? shopCatalogue().find((x) => x.key === op.key) : undefined;
      if (!item) return false;
      p.owned ??= [];
      if (p.owned.includes(item.key)) return false;
      if ((p.aether ?? 0) < item.price) return false;
      p.aether = (p.aether ?? 0) - item.price;
      p.owned.push(item.key);
      return true;
    }
    case "craftSet": {
      // King's Shards: craft the set piece you choose, at your level. Seeded from the hero's craft count, so the result is the same on the server.
      const S = SET[op.set], sl = op.slot as SlotType;
      if (!S || !S.pieces[sl] || (p.kingShards ?? 0) < RIFT.trophies.craftCost || c.bag.length >= BAG_SIZE || c.level < RIFT.lootLevels.setFrom) return false;
      p.kingShards = (p.kingShards ?? 0) - RIFT.trophies.craftCost;
      const n = (c.crafted ?? 0) + 1; c.crafted = n;
      let h = 2166136261; for (const ch of `${c.cls}:${op.set}:${sl}:${n}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
      c.bag.push(mintItem(makeRng(h >>> 0), `craft-${c.cls}-${n}-${(h >>> 0).toString(36)}`, { rarity: "set", set: op.set, slot: sl, ilvl: c.level, cls: c.cls }));
      return true;
    }
    case "chisel": {
      // Gilded Chisels (Gilded Vault): add an affix or re-roll the two weakest, once per item
      const it = op.bag !== undefined ? c.bag[op.bag] : op.slot ? c.equipment[op.slot as EquipSlot] : undefined;
      if (!it || (p.chisels ?? 0) < 1 || (op.mode !== "add" && op.mode !== "reroll")) return false;
      if (!chiselItem(it, op.mode)) return false;
      p.chisels = (p.chisels ?? 0) - 1; return true;
    }
    case "echo": {
      // Echo Cores: +1 echo on an item (up to 5), each costing one more core than the last
      const it = op.bag !== undefined ? c.bag[op.bag] : op.slot ? c.equipment[op.slot as EquipSlot] : undefined;
      if (!it || (it.echo ?? 0) >= RIFT.echo.maxPerItem || (p.echoCores ?? 0) < echoCost(it)) return false;
      p.echoCores = (p.echoCores ?? 0) - echoCost(it);
      it.echo = (it.echo ?? 0) + 1; return true;
    }
    case "hallow": {
      // Seraph Hallow: make a legendary or set item ancestral
      const it = op.bag !== undefined ? c.bag[op.bag] : op.slot ? c.equipment[op.slot as EquipSlot] : undefined;
      if (!it || it.quality || !(it.rarity === "legendary" || it.rarity === "set") || (p.hallows ?? 0) < RIFT.trophies.hallowCost) return false;
      p.hallows = (p.hallows ?? 0) - RIFT.trophies.hallowCost;
      const nu = hallowItem(it);
      if (op.bag !== undefined) c.bag[op.bag] = nu; else c.equipment[op.slot as EquipSlot] = nu;
      return true;
    }
    case "extract": {
      // destroy a legendary in the bag to keep its power in the reliquary (account-wide), for Relic Dust
      const it = c.bag[op.bag];
      if (!it?.legendary || !LEGENDARY[it.legendary] || LEGENDARY[it.legendary].mythic || LEGENDARY[it.legendary].chase || it.locked) return false;
      if ((p.relics ?? []).includes(it.legendary) || (p.relicDust ?? 0) < RIFT.reliquary.extractCost) return false;
      p.relicDust = (p.relicDust ?? 0) - RIFT.reliquary.extractCost;
      p.relics = [...(p.relics ?? []), it.legendary];
      c.bag.splice(op.bag, 1); return true;
    }
    case "relic": {
      // wear an extracted power in its slot (weapon / armour / jewellery); slots open with bounties done
      const sl = op.slot as RelicSlot;
      if (!RELIC_SLOTS.includes(sl)) return false;
      if (op.id === null) { const r = { ...(c.relicSlots ?? {}) }; delete r[sl]; c.relicSlots = r; return true; }
      const L = LEGENDARY[op.id];
      if (!L || !(p.relics ?? []).includes(op.id) || relicSlotOf(L.slot) !== sl || lifeStats(p).bounties < relicUnlock(sl)) return false;
      c.relicSlots = { ...(c.relicSlots ?? {}), [sl]: op.id }; return true;
    }
    case "buyAether": {
      // test build stub: packs are free. The live server refuses this until a payment provider is wired in.
      const pack = SHOP.packs.find((x) => x.id === op.pack);
      if (!pack) return false;
      p.aether = (p.aether ?? 0) + pack.amount; return true;
    }
    case "hideout": {
      const h = p.hideout ?? { theme: HIDEOUT.themes[0].id, decor: [] };
      if (op.theme !== undefined) {
        const th = HIDEOUT.themes.find((t) => t.id === op.theme);
        if (!th || (th.premium && !ownsKey(p, `theme:${th.id}`))) return false;
        // decorations outside the new room's size are dropped
        p.hideout = { theme: th.id, decor: h.decor.filter((d) => d.x < th.w - 1 && d.y < th.h - 1) }; return true;
      }
      if (op.place) {
        const d = HIDEOUT.decor.find((x) => x.id === op.place!.id);
        const x = op.place.x | 0, y = op.place.y | 0;
        if (!d || (d.premium && !ownsKey(p, `decor:${d.id}`)) || h.decor.length >= HIDEOUT.maxDecor || x < 1 || y < 1 || x > 62 || y > 62) return false;
        if (h.decor.some((o) => o.x === x && o.y === y)) return false;
        p.hideout = { theme: h.theme, decor: [...h.decor, { id: d.id, x, y }] }; return true;
      }
      if (op.remove !== undefined) {
        if (!h.decor[op.remove]) return false;
        p.hideout = { theme: h.theme, decor: h.decor.filter((_, i) => i !== op.remove) }; return true;
      }
      return false;
    }
    case "stash": {
      const it = c.bag[op.bagIndex];
      p.stash ??= [];
      if (!it || p.stash.length >= STASH_SIZE) return false;
      c.bag.splice(op.bagIndex, 1); p.stash.push(it); return true;
    }
    case "unstash": {
      const it = p.stash?.[op.stashIndex];
      if (!it || c.bag.length >= BAG_SIZE) return false;
      p.stash.splice(op.stashIndex, 1); c.bag.push(it); return true;
    }
    case "lockStash": {
      const it = p.stash?.[op.stashIndex]; if (!it) return false;
      if (it.locked) delete it.locked; else it.locked = true; return true;
    }
    case "buildSave": {
      if (op.idx < 0 || op.idx >= BUILD_SLOTS) return false;
      c.builds ??= [];
      const equipment: Partial<Record<EquipSlot, string>> = {};
      for (const [slot, it] of Object.entries(c.equipment)) if (it) equipment[slot as EquipSlot] = it.id;
      const name = String(op.name ?? c.builds[op.idx]?.name ?? `Build ${op.idx + 1}`).slice(0, 20);
      c.builds[op.idx] = { name, equipment, loadout: validLoadout(c.cls, c.loadout), runes: { ...c.runes } };
      return true;
    }
    case "buildDelete": { if (!c.builds?.[op.idx]) return false; c.builds[op.idx] = null; return true; }
    case "buildLoad": {
      const b = c.builds?.[op.idx]; if (!b) return false;
      p.stash ??= [];
      // every item this character can reach: worn, in the bag, or in storage
      const where = new Map<string, { it: Item; from: "eq" | "bag" | "stash" }>();
      for (const it of Object.values(c.equipment)) if (it) where.set(it.id, { it, from: "eq" });
      for (const it of c.bag) where.set(it.id, { it, from: "bag" });
      for (const it of p.stash) where.set(it.id, { it, from: "stash" });
      const next: CharSave["equipment"] = {};
      for (const [slot, id] of Object.entries(b.equipment)) { const w = id ? where.get(id) : undefined; if (w) next[slot as EquipSlot] = w.it; }
      const wanted = new Set(Object.values(next).map((it) => it!.id));
      const bag = c.bag.filter((it) => !wanted.has(it.id));
      const stash = p.stash.filter((it) => !wanted.has(it.id));
      for (const it of Object.values(c.equipment)) if (it && !wanted.has(it.id)) { if (bag.length < BAG_SIZE) bag.push(it); else if (stash.length < STASH_SIZE) stash.push(it); else return false; }
      c.equipment = next; c.bag.splice(0, c.bag.length, ...bag); p.stash.splice(0, p.stash.length, ...stash);
      c.loadout = validLoadout(c.cls, b.loadout);
      c.runes = {};
      for (const [sk, r] of Object.entries(b.runes)) { const d = SKILL[sk]?.runes.find((x) => x.id === r); if (d && (c.uses[sk] ?? 0) >= d.uses) c.runes[sk] = r; }
      return true;
    }
    case "newSeason": return startNewSeason(p);
    case "reset": return newProfile();
  }
  return false;
}
