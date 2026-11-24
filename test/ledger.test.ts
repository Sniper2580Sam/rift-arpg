// Server item authority: forged items, edited items, inflated materials and forced rarities are refused.
import { newProfile } from "../src/client/profile";
import { applyHubOp } from "../src/shared/ops";
import { RunInfo, RunMember, applySave, mintFor, sanitizeOpts } from "../src/server/ledger";
import { mintItem, scrapValue } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";

let fails = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) fails++; };
const rng = makeRng(7);
const member = (): RunMember => ({ account: "a", pid: 0, level: 10, pity: { ancestral: false, primal: false }, pending: new Map(), forced: 0, usedAnc: false, usedPri: false, drops: 0, mythic: false });
const run: RunInfo = { kind: "rift", tier: 5, completed: false, inTime: false, time: 0 };
const base = (p: ReturnType<typeof newProfile>) => { const c = p.chars.ashknight; return { equipment: c.equipment, bag: c.bag, scrapped: [] as string[], materials: p.materials, level: c.level, xp: c.xp, sigils: c.sigils, uses: c.uses, highestTier: c.highestTier, pityAnc: c.pityAnc, pityPri: c.pityPri, bestTimes: c.bestTimes, riftsCleared: c.riftsCleared }; };

{ // minted item is accepted once
  const p = newProfile(), m = member();
  const it = mintFor(rng, m, sanitizeOpts(run, m, {}, rng, {})!);
  const rep = base(p); rep.bag = [it];
  check("minted item accepted", applySave(p, "ashknight", rep, m, run).length === 0 && p.chars.ashknight.bag.length === 1);
  const p2 = newProfile(); const rep2 = base(p2); rep2.bag = [it];
  check("same item can't be claimed twice", applySave(p2, "ashknight", rep2, m, run).length > 0 && p2.chars.ashknight.bag.length === 0);
}
{ // forged item
  const p = newProfile(), m = member();
  const fake = mintItem(makeRng(1), "fake", { rarity: "legendary", ilvl: 30 });
  const rep = base(p); rep.bag = [fake];
  check("forged item refused", applySave(p, "ashknight", rep, m, run).length > 0 && p.chars.ashknight.bag.length === 0);
}
{ // edited item
  const p = newProfile(), m = member();
  const it = mintFor(rng, m, sanitizeOpts(run, m, {}, rng, {})!);
  const edited = JSON.parse(JSON.stringify(it)); if (edited.affixes[0]) edited.affixes[0].value *= 10; else edited.ilvl = 99;
  const rep = base(p); rep.bag = [edited];
  check("edited item refused", applySave(p, "ashknight", rep, m, run).length > 0 && p.chars.ashknight.bag.length === 0);
}
{ // materials only from real scraps
  const p = newProfile(), m = member();
  const it = mintFor(rng, m, sanitizeOpts(run, m, {}, rng, {})!);
  const rep = base(p); rep.scrapped = [it.id, it.id, "nope"]; rep.materials = 99999;
  applySave(p, "ashknight", rep, m, run);
  check("materials capped at real scrap value", p.materials === scrapValue(it));
}
{ // forced rarity before completion is ignored, after completion limited to two
  const m = member();
  check("no forced legendary mid-run", sanitizeOpts(run, m, { rarity: "legendary" }, rng, {})!.rarity === undefined);
  const done = { ...run, completed: true, inTime: true };
  const r = [0, 1, 2].map(() => sanitizeOpts(done, m, { rarity: "legendary" }, rng, {})!.rarity);
  check("two forced legendaries per run at most", r[0] === "legendary" && r[1] === "legendary" && r[2] === undefined);
  const m2 = member();
  check("no mythic outside the chase", sanitizeOpts(done, m2, { rarity: "mythic" }, rng, {})!.rarity === "legendary");
  check("no ancestral without pity", !sanitizeOpts(done, member(), { rarity: "legendary", forceAncestral: true }, rng, {})!.forceAncestral);
  check("item level capped", sanitizeOpts(run, member(), { ilvl: 30 }, rng, {})!.ilvl! <= 10 + 6 + 1);
}
{ // tier unlock needs a server-recorded timed clear
  const p = newProfile(), m = member();
  const rep = base(p); rep.highestTier = 9;
  applySave(p, "ashknight", rep, m, { ...run, tier: 1 });
  check("tier unlock refused without a clear", p.chars.ashknight.highestTier === 1);
  applySave(p, "ashknight", { ...rep, highestTier: 2 }, m, { ...run, tier: 1, completed: true, inTime: true });
  check("tier unlock after a timed clear", p.chars.ashknight.highestTier === 2);
}
{ // cosmetics: catalogue ids only
  const p = newProfile();
  check("cosmetic set", applyHubOp(p, { t: "setting", k: "cos.wings", v: "ember" }) === true && p.cos.wings === "ember");
  check("unknown cosmetic refused", applyHubOp(p, { t: "setting", k: "cos.wings", v: "golden_dragon" }) === false && p.cos.wings === "ember");
  check("unknown cosmetic kind refused", applyHubOp(p, { t: "setting", k: "cos.hat", v: "default" }) === false);
}
if (fails) { console.log(`${fails} ledger checks failed`); process.exit(1); }
console.log("ledger: all checks passed");
