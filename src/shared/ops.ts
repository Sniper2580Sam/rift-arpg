// Hub operations on a profile. The offline build runs them locally; the live build runs them on the
// client (instant feedback) AND on the server, whose copy is the one that counts.
import { CLASSES, EquipSlot, LOADOUT_SIZE, SKILL, validLoadout } from "../sim/data";
import { Affix, InvCmd, applyInvCmd, rerollCost } from "../sim/items";
import { Profile, char, holderOf, newProfile, startNewSeason } from "../client/profile";

export type HubOp =
  | { t: "inv"; cmd: InvCmd }
  | { t: "setClass"; cls: string }
  | { t: "setRune"; skill: string; rune: string }
  | { t: "setSkill"; slot: number; skill: string }
  | { t: "reroll"; target: { bag?: number; slot?: EquipSlot }; idx: number; choice: Affix | null }
  | { t: "setting"; k: string; v: any }
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
    case "setting":
      if (op.k === "filter") { if (!FILTERS.has(op.v)) return false; p.filter = op.v; return true; }
      if (op.k === "pet") { if (!p.unlockedPets.includes(op.v)) return false; p.pet = op.v; return true; }
      if (SETTINGS.has(op.k)) { (p.settings as any)[op.k] = !!op.v; return true; }
      return false;
    case "newSeason": return startNewSeason(p);
    case "reset": return newProfile();
  }
  return false;
}
