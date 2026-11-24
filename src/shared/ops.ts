// Hub operations on a profile. The offline build runs them locally; the live build runs them on the
// client (instant feedback) AND on the server, whose copy is the one that counts.
import { CLASSES, COSMETICS, COS_KINDS, CosKind, EquipSlot, LOADOUT_SIZE, SKILL, validLoadout } from "../sim/data";
import { Affix, BAG_SIZE, InvCmd, Item, applyInvCmd, canMerge, mergeCost, mergeFodder, rerollCost } from "../sim/items";
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
  | { t: "merge"; target: { bag?: number; slot?: EquipSlot; stash?: number } }
  | { t: "newSeason" }
  | { t: "reset" };

const SETTINGS = new Set(["mute", "shake", "autoTier"]);
const FILTERS = new Set(["common", "magic", "rare", "legendary"]);

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
      if (!r || (c.uses[op.skill] ?? 0) < r.uses) return false;
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
    case "merge": {
      const stash = p.stash ?? [];
      const it = op.target.bag !== undefined ? c.bag[op.target.bag] : op.target.stash !== undefined ? stash[op.target.stash] : op.target.slot ? c.equipment[op.target.slot] : undefined;
      if (!it || !canMerge(it)) return false;
      const cost = mergeCost(it);
      const fod = mergeFodder(it, c.bag, stash);
      if (fod.length < 2 || p.materials < cost) return false;
      p.materials -= cost;
      // remove highest index first so earlier indices stay valid
      for (const f of [...fod].sort((a, b) => b.i - a.i)) (f.where === "bag" ? c.bag : stash).splice(f.i, 1);
      it.plus = (it.plus ?? 0) + 1;
      return true;
    }
    case "setting":
      if (op.k === "filter") { if (!FILTERS.has(op.v)) return false; p.filter = op.v; return true; }
      if (op.k === "pet") { if (!p.unlockedPets.includes(op.v)) return false; p.pet = op.v; return true; }
      if (op.k.startsWith("cos.")) {
        // cosmetics: every one is free in this build (no store yet), so any catalogue id is valid
        const kind = op.k.slice(4) as CosKind;
        if (!COS_KINDS.includes(kind) || !COSMETICS[kind].some((x) => x.id === op.v)) return false;
        p.cos = { ...(p.cos ?? {}), [kind]: op.v }; return true;
      }
      if (SETTINGS.has(op.k)) { (p.settings as any)[op.k] = !!op.v; return true; }
      return false;
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
