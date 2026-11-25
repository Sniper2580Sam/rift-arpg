// Server item authority: forged items, edited items, inflated materials and forced rarities are refused.
import { char, newProfile } from "../src/client/profile";
import { applyHubOp } from "../src/shared/ops";
import { RunInfo, RunMember, applySave, mintFor, sanitizeOpts } from "../src/server/ledger";
import { computeStats, mintItem, resolveSkill, scrapValue } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";
import { talentPoints, trialTarget } from "../src/sim/data";

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
{ // cosmetics: free colours, earned styles, premium only after the (free) shop
  const p = newProfile();
  check("free dye set", applyHubOp(p, { t: "setting", k: "cos.dye", v: "crimson" }) === true && p.cos.dye === "crimson");
  check("premium refused before buying", applyHubOp(p, { t: "setting", k: "cos.wings", v: "ember" }) === false);
  check("can't buy without Aether", applyHubOp(p, { t: "buy", key: "cos:wings:ember" }) === false && !(p.owned ?? []).includes("cos:wings:ember"));
  check("test pack adds Aether", applyHubOp(p, { t: "buyAether", pack: "medium" }) === true && p.aether === 1100);
  check("shop buy spends Aether and records ownership", applyHubOp(p, { t: "buy", key: "cos:wings:ember" }) === true && p.owned!.includes("cos:wings:ember") && p.aether === 100);
  check("can't buy the same thing twice", applyHubOp(p, { t: "buy", key: "cos:wings:ember" }) === false && p.aether === 100);
  check("cosmetic set after buying", applyHubOp(p, { t: "setting", k: "cos.wings", v: "ember" }) === true && p.cos.wings === "ember");
  check("unknown shop key refused", applyHubOp(p, { t: "buy", key: "cos:wings:golden_dragon" }) === false);
  check("unknown cosmetic refused", applyHubOp(p, { t: "setting", k: "cos.wings", v: "golden_dragon" }) === false && p.cos.wings === "ember");
  check("unknown cosmetic kind refused", applyHubOp(p, { t: "setting", k: "cos.hat", v: "default" }) === false);
  check("earned armour locked at first", applyHubOp(p, { t: "setting", k: "cos.armor", v: "riftbreaker" }) === false);
  char(p).highestTier = 11;
  check("earned armour after tier 10", applyHubOp(p, { t: "setting", k: "cos.armor", v: "riftbreaker" }) === true);
  applyHubOp(p, { t: "buy", key: "cos:armor:nightveil" });
  check("class armour refused for another class", char(p).cls === "gloomstalker" || applyHubOp(p, { t: "setting", k: "cos.armor", v: "nightveil" }) === false);
  check("premium skill effect needs owning", applyHubOp(p, { t: "setting", k: "fx.cleave", v: "voidfire" }) === false);
}
{ // hideout: themes and decorations
  const p = newProfile();
  check("premium theme refused before buying", applyHubOp(p, { t: "hideout", theme: "gilded" }) === false);
  check("free theme", applyHubOp(p, { t: "hideout", theme: "camp" }) === true && p.hideout!.theme === "camp");
  check("place free decor", applyHubOp(p, { t: "hideout", place: { id: "barrel", x: 5, y: 5 } }) === true && p.hideout!.decor.length === 1);
  check("no two on one tile", applyHubOp(p, { t: "hideout", place: { id: "crate", x: 5, y: 5 } }) === false);
  check("premium decor needs owning", applyHubOp(p, { t: "hideout", place: { id: "statue", x: 6, y: 5 } }) === false);
  p.aether = 5000; applyHubOp(p, { t: "buy", key: "decor:statue" }); applyHubOp(p, { t: "buy", key: "theme:gilded" });
  check("premium decor after buying", applyHubOp(p, { t: "hideout", place: { id: "statue", x: 6, y: 5 } }) === true);
  check("premium theme after buying", applyHubOp(p, { t: "hideout", theme: "gilded" }) === true && p.hideout!.decor.length === 2);
  check("remove decor", applyHubOp(p, { t: "hideout", remove: 0 }) === true && p.hideout!.decor.length === 1 && p.hideout!.decor[0].id === "statue");
}
{ // hub "scrap common+magic" really empties them from the character's bag
  const p = newProfile(); const c = p.chars.ashknight; const r = makeRng(3);
  c.bag = [mintItem(r, "a", { rarity: "common" }), mintItem(r, "b", { rarity: "magic" }), mintItem(r, "c", { rarity: "rare" })];
  applyHubOp(p, { t: "inv", cmd: { type: "scrapBelow", rarity: "rare" } });
  check("hub scrap below removes items from the bag", c.bag.length === 1 && c.bag[0].rarity === "rare" && p.materials > 0);
}
{
  // slot upgrades: shards from scrapping legendaries, materials + shards buy +1..+5, +5 rolls a masterwork crit
  const p = newProfile(); const c = char(p); const r = makeRng(9);
  const leg = mintItem(r, "m1", { rarity: "legendary", slot: "weapon" });
  c.bag = [leg]; p.materials = 0; p.shards = 0;
  applyHubOp(p, { t: "inv", cmd: { type: "scrap", bagIndex: 0 } });
  check("scrapping a legendary gives a shard", p.shards === 1 && p.materials === 20);
  p.materials += 10;
  check("slot upgrade refused without enough", applyHubOp(p, { t: "slotUp", slot: "weapon" }) === true && c.slotPlus?.weapon === 1 && applyHubOp(p, { t: "slotUp", slot: "weapon" }) === false);
  p.materials = 10000; p.shards = 100;
  for (let k = 0; k < 6; k++) applyHubOp(p, { t: "slotUp", slot: "weapon" });
  check("slot caps at +5 with a masterwork crit", c.slotPlus?.weapon === 5 && !!c.slotCrit?.weapon);
  const before = c.slotCrit!.weapon;
  check("crit reroll changes it", applyHubOp(p, { t: "slotCrit", slot: "weapon" }) === true && c.slotCrit!.weapon !== before);
  const w = c.equipment.weapon!;
  const st0 = computeStats({ weapon: w }, { cls: c.cls, level: 1 }), st5 = computeStats({ weapon: w }, { cls: c.cls, level: 1, slotPlus: c.slotPlus });
  check("+5 slot scales weapon damage by 50%", st5.dmgMax === Math.round(st0.dmgMax * 1.5) || Math.abs(st5.dmgMax - st0.dmgMax * 1.5) <= 1)
}
{ // feat and journey counters: added once per run, kills clamped, finds counted from the server's own mint, boss kills recorded
  const p = newProfile(), m = member();
  const r: RunInfo = { kind: "rift", tier: 9, completed: true, inTime: true, time: 200 };
  const leg = mintFor(rng, m, { tier: 9, rarity: "legendary", forceAncestral: true });
  const rep: any = base(p); rep.bag = [leg]; rep.tally = { kills: 999999, elites: 40, deaths: 0, wave: 0 };
  applySave(p, "ashknight", rep, m, r, 6);
  const L = p.life!;
  check("kills clamped to a sane rate", L.kills === 200 * 25 && L.elites === 40);
  check("finds come from the mint", L.legendaries === 1 && L.ancestrals === 1 && L.mythics === 0);
  check("rift, tier, flawless and party counted", L.rifts === 1 && L.tier === 9 && L.flawless === 1 && L.party6 === 1);
  check("feats recorded on the server", (p.feats ?? []).includes("first_rift") && (p.feats ?? []).includes("flawless8") && (p.feats ?? []).includes("full_house"));
  check("journey counters this season", p.journey?.season === p.season.n && p.journey.stats.rifts === 1);
  const rep2: any = base(p); rep2.tally = { kills: 500, elites: 0, deaths: 0, wave: 0 };
  applySave(p, "ashknight", rep2, m, r, 6);
  check("a second save of the same run adds nothing", p.life!.kills === 200 * 25 && p.life!.rifts === 1);
  const m2 = member(), c: RunInfo = { kind: "chase", boss: "seraph", tier: 9, completed: true, inTime: true, time: 120 };
  applySave(p, "ashknight", base(p) as any, m2, c, 1);
  check("Seraph kill recorded on the hero and the account", p.chars.ashknight.seraphs === 1 && p.life!.seraphs === 1 && (p.feats ?? []).includes("seraph"));
  check("old clients (no tally) never count as flawless", (() => { const p3 = newProfile(); applySave(p3, "ashknight", base(p3) as any, member(), r, 1); return p3.life!.flawless === 0 && p3.life!.rifts === 1; })());
}

{ // gems: socket op, and the server clamps gem levels to one clear's worth
  const p = newProfile(), c = p.chars.ashknight;
  c.gems = { fury: 3, bane: 1, storm: 1, gale: 1 }; c.gemSlots = [];
  check("socket a gem", applyHubOp(p, { t: "gem", slot: 0, id: "fury" }) === true && c.gemSlots!.join() === "fury");
  applyHubOp(p, { t: "gem", slot: 1, id: "bane" }); applyHubOp(p, { t: "gem", slot: 2, id: "storm" });
  check("can't socket a gem you don't own", applyHubOp(p, { t: "gem", slot: 0, id: "blood" }) === false);
  check("swap into a full slot", applyHubOp(p, { t: "gem", slot: 1, id: "gale" }) === true && c.gemSlots!.join() === "fury,gale,storm");
  check("remove", applyHubOp(p, { t: "gem", slot: 0, id: null }) === true && c.gemSlots!.join() === "gale,storm");
  const r: RunInfo = { kind: "rift", tier: 6, completed: true, inTime: true, time: 200 };
  const rep: any = base(p); rep.gems = { fury: 50, bane: 1, storm: 1, gale: 1, blood: 1, bulwark: 1 }; rep.gemSlots = ["gale", "storm"];
  applySave(p, "ashknight", rep, member(), r, 1);
  check("gem levels clamped, one new gem per run", c.gems!.fury === 7 && Object.keys(c.gems!).length === 5);
}

{ // Aether: earned once from feats/chapters and from hard runs only
  const p = newProfile(), m = member();
  const r: RunInfo = { kind: "rift", tier: 16, completed: true, inTime: true, time: 300 };
  const rep: any = base(p); rep.tally = { kills: 100, elites: 0, deaths: 1, wave: 0 };
  applySave(p, "ashknight", rep, m, r, 1);
  // T16 timed clear = 12, plus feats tier10 (150) reached via the tier counter
  check("hard runs and feats pay Aether", p.aether === 12 + 150);
  const p2 = newProfile(); applySave(p2, "ashknight", base(p2) as any, member(), { kind: "rift", tier: 5, completed: true, inTime: true, time: 100 }, 1);
  check("easy runs pay nothing", (p2.aether ?? 0) === 0);
}

{ // reliquary: extract costs dust and the item, slots open with bounties, and bounties pay dust once
  const p = newProfile(), c = p.chars.ashknight;
  const leg = mintItem(makeRng(4), "lg", { rarity: "legendary", slot: "weapon" }); leg.legendary = "cinderbrand"; c.bag = [leg];
  check("extract needs dust", applyHubOp(p, { t: "extract", bag: 0 }) === false);
  p.relicDust = 2;
  check("extract consumes the item and dust", applyHubOp(p, { t: "extract", bag: 0 }) === true && c.bag.length === 0 && p.relicDust === 0 && p.relics!.includes("cinderbrand"));
  check("wear it in the weapon slot", applyHubOp(p, { t: "relic", slot: "weapon", id: "cinderbrand" }) === true && c.relicSlots?.weapon === "cinderbrand");
  check("wrong slot refused", applyHubOp(p, { t: "relic", slot: "jewelry", id: "cinderbrand" }) === false);
  const m = member(), r: RunInfo = { kind: "bounty", tier: 10, completed: true, inTime: true, time: 300 };
  applySave(p, "ashknight", base(p) as any, m, r, 1); applySave(p, "ashknight", base(p) as any, m, r, 1);
  check("bounty pays dust once and counts", p.relicDust === 5 && p.life!.bounties === 1);
}

{ // boss trophies: the King pays shards, the Seraph a Hallow; crafting gives the chosen set piece; hallowing makes it ancestral
  const p = newProfile(), c = p.chars.ashknight; c.level = 30;
  applySave(p, "ashknight", base(p) as any, member(), { kind: "chase", tier: 8, completed: true, inTime: true, time: 200 }, 1);
  applySave(p, "ashknight", base(p) as any, member(), { kind: "chase", boss: "seraph", tier: 8, completed: true, inTime: true, time: 200 }, 1);
  check("King shards and a Seraph Hallow", p.kingShards === 5 && p.hallows === 1);
  p.kingShards = 10;
  const p2 = JSON.parse(JSON.stringify(p));
  check("craft the chosen set piece", applyHubOp(p, { t: "craftSet", set: "embersworn", slot: "helm" }) === true && c.bag.at(-1)?.set === "embersworn" && c.bag.at(-1)?.slot === "helm" && p.kingShards === 0);
  applyHubOp(p2, { t: "craftSet", set: "embersworn", slot: "helm" });
  check("crafting is the same on client and server", JSON.stringify(p2.chars.ashknight.bag.at(-1)) === JSON.stringify(c.bag.at(-1)));
  check("craft needs shards", applyHubOp(p, { t: "craftSet", set: "embersworn", slot: "chest" }) === false);
  const before = c.bag.at(-1)!;
  check("hallow makes it ancestral", applyHubOp(p, { t: "hallow", bag: c.bag.length - 1 }) === true && c.bag.at(-1)!.quality === "ancestral" && c.bag.at(-1)!.affixes[0].value >= before.affixes[0].value && p.hallows === 0);
  check("can't hallow twice", applyHubOp(p, { t: "hallow", bag: c.bag.length - 1 }) === false);
}

{ // Echo Cores: Endless pays them, each echo costs one more, capped at 5, and they raise damage and life
  const p = newProfile(), c = p.chars.ashknight;
  const rep: any = base(p); rep.tally = { kills: 100, elites: 0, deaths: 0, wave: 24 };
  applySave(p, "ashknight", rep, member(), { kind: "endless", tier: 5, completed: true, inTime: false, time: 600 }, 1);
  check("wave 24 pays 3 cores", p.echoCores === 3);
  p.echoCores = 20;
  for (let i = 0; i < 6; i++) applyHubOp(p, { t: "echo", slot: "weapon" });
  check("five echoes cost 15 and stop at 5", c.equipment.weapon!.echo === 5 && p.echoCores === 5);
  const a = computeStats({}, { cls: "ashknight", level: 30 }), b = computeStats({ weapon: c.equipment.weapon }, { cls: "ashknight", level: 30 }), b0 = computeStats({ weapon: { ...c.equipment.weapon!, echo: 0 } }, { cls: "ashknight", level: 30 });
  check("echo adds damage and life", b.dmgPct === b0.dmgPct + 7.5 && b.maxHp > b0.maxHp && a.maxHp === b0.maxHp);
}

{ // Trials and talents: a passed trial raises trialBest by one; pick a subclass; nodes open as you spend; a respec costs the points until you beat your best Trial again
  const p = newProfile(), c = p.chars.ashknight;
  applySave(p, "ashknight", base(p) as any, member(), { kind: "trial", tier: 1, completed: true, inTime: true, time: 80 }, 1);
  check("trial 1 passed gives a point", c.trialBest === 1 && talentPoints(c) === 1);
  applySave(p, "ashknight", base(p) as any, member(), { kind: "trial", tier: 2, completed: true, inTime: false, time: 120 }, 1);
  check("a late trial gives nothing", c.trialBest === 1);
  check("no subclass: can't spend", applyHubOp(p, { t: "talent", id: "as_pyreblade_s1", d: 1 }) === false);
  check("pick a subclass", applyHubOp(p, { t: "talent", sub: "pyreblade" }) === true && c.subclass === "pyreblade");
  check("can spend a first-row point", applyHubOp(p, { t: "talent", id: "as_pyreblade_s1", d: 1 }) === true);
  check("no points left", applyHubOp(p, { t: "talent", id: "as_pyreblade_s1", d: 1 }) === false);
  check("no taking points back one by one", applyHubOp(p, { t: "talent", id: "as_pyreblade_s1", d: -1 }) === false);
  c.trialBest = 10;
  check("notable shut below 6 spent", applyHubOp(p, { t: "talent", id: "as_pyreblade_n1", d: 1 }) === false);
  for (let i = 0; i < 4; i++) applyHubOp(p, { t: "talent", id: "as_pyreblade_s1", d: 1 });
  applyHubOp(p, { t: "talent", id: "as_pyreblade_s2", d: 1 });
  check("notable opens at 6", applyHubOp(p, { t: "talent", id: "as_pyreblade_n1", d: 1 }) === true);
  check("other subclass's node refused", applyHubOp(p, { t: "talent", id: "as_bastion_s1", d: 1 }) === false);
  const s0 = computeStats({}, { cls: "ashknight", level: 30 }), s1 = computeStats({}, { cls: "ashknight", level: 30, talents: c.talents, subclass: c.subclass });
  check("talents add stats and the notable's mod", (s1.tagDmg.fire ?? 0) === (s0.tagDmg.fire ?? 0) + 30 && s1.mods.some((m) => m.set?.igniteMult === 0.6));
  check("switching subclass clears the tree and costs the points", applyHubOp(p, { t: "talent", sub: "bastion" }) === true && !Object.keys(c.talents ?? {}).length && talentPoints(c) === 0 && c.trialRe === 0);
  check("the portal offers your best Trial again", trialTarget(c) === 10);
  applySave(p, "ashknight", base(p) as any, member(), { kind: "trial", tier: 10, completed: true, inTime: true, time: 100 }, 1);
  check("beating it again brings all the points back", talentPoints(c) === 10 && c.trialRe === undefined && trialTarget(c) === 11);
}

{ // Gilded Vault: pays chisels; a chisel adds an affix or re-rolls two, the same on client and server, once per item
  const p = newProfile(), c = p.chars.ashknight;
  applySave(p, "ashknight", base(p) as any, member(), { kind: "vault", tier: 4, completed: true, inTime: true, time: 90 }, 1);
  check("vault pays 2 chisels", p.chisels === 2);
  const w = c.equipment.weapon!, n0 = w.affixes.length, p2 = JSON.parse(JSON.stringify(p));
  check("chisel adds an affix", applyHubOp(p, { t: "chisel", slot: "weapon", mode: "add" }) === true && w.affixes.length === n0 + 1 && p.chisels === 1);
  applyHubOp(p2, { t: "chisel", slot: "weapon", mode: "add" });
  check("chisel is deterministic", JSON.stringify(p2.chars.ashknight.equipment.weapon) === JSON.stringify(w));
  check("once per item", applyHubOp(p, { t: "chisel", slot: "weapon", mode: "reroll" }) === false && p.chisels === 1);
  const rep: any = base(p); rep.vaultKeys = 5;
  applySave(p, "ashknight", rep, member(), { kind: "rift", tier: 4, completed: true, inTime: true, time: 400 }, 1);
  check("keys clamp to +1 per save", c.vaultKeys === 1);
}

{ // Passive tree: points from Paragon, nodes must link to what you have, refunds keep the tree connected, keystones change skills
  const p = newProfile(), c = p.chars.ashknight;
  c.paragon = 6;
  check("can't jump to a keystone", applyHubOp(p, { t: "passive", id: "ashknight_0_6", d: 1 }) === false);
  for (const id of ["ashknight_0_1", "ashknight_0_2", "ashknight_0_3", "ashknight_0_4", "ashknight_0_5", "ashknight_0_6"]) applyHubOp(p, { t: "passive", id, d: 1 });
  check("a path to the keystone", (c.passives ?? []).length === 6);
  check("no points left", applyHubOp(p, { t: "passive", id: "ashknight_1_1", d: 1 }) === false);
  check("can't cut the path", applyHubOp(p, { t: "passive", id: "ashknight_0_3", d: -1 }) === false);
  check("can refund the tip", applyHubOp(p, { t: "passive", id: "ashknight_0_6", d: -1 }) === true);
  applyHubOp(p, { t: "passive", id: "ashknight_0_6", d: 1 });
  const st = computeStats({}, { cls: "ashknight", level: 30, passives: c.passives });
  check("Ring of Fire makes Cleave a circle", resolveSkill("cleave", undefined, st).p.arcCos === -1);
}

if (fails) { console.log(`${fails} ledger checks failed`); process.exit(1); }
console.log("ledger: all checks passed");

{ // two copies of the same set ring count as one piece
  const r = makeRng(7);
  let ring: any = null;
  for (let i = 0; i < 4000 && !ring; i++) { const it: any = mintItem(r, "x" + i, { slot: "ring", rarity: "set" } as any); if (it.set && it.slot === "ring") ring = it; }
  if (ring) {
    const st = computeStats({ ring1: ring, ring2: { ...ring, id: "copy" } } as any, { cls: "stormcaller", level: 30 });
    check("duplicate set ring counts once", st.setCounts[ring.set] === 1);
  } else check("found a set ring to test", false);
}
{ // Splinters on a bone turret adds shots per volley, not turrets; Legion still adds turrets
  const st0 = computeStats({}, { cls: "bonewright", level: 10, boons: ["splinters"] } as any);
  const t = resolveSkill("bone_turret", undefined, st0);
  check("projectile boon adds turret shots, not turrets", t.p.count === 1 && t.p.shots === 3);
  const st1 = computeStats({}, { cls: "bonewright", level: 10, boons: ["legion"] } as any);
  const t1 = resolveSkill("bone_turret", undefined, st1).p;
  check("minion boon lets more turrets stand, one per cast", t1.count === 1 && t1.maxCount === 4);
}
{ // paragon: points come from paragon levels, capped per stat, free respec, and they add stats
  const p = newProfile(); const c = char(p);
  check("paragon refused below max level", applyHubOp(p, { t: "paragon", stat: "power", d: 1 }) === false);
  c.level = 30; c.paragon = 3;
  check("paragon spend", applyHubOp(p, { t: "paragon", stat: "power", d: 1 }) === true && applyHubOp(p, { t: "paragon", stat: "power", d: 1 }) === true && applyHubOp(p, { t: "paragon", stat: "vitality", d: 1 }) === true);
  check("no points left", applyHubOp(p, { t: "paragon", stat: "haste", d: 1 }) === false);
  const base = computeStats({}, { cls: c.cls, level: 30 }), withP = computeStats({}, { cls: c.cls, level: 30, paragon: c.pAlloc });
  check("paragon adds damage and life", withP.dmgPct === base.dmgPct + 2 && withP.maxHp > base.maxHp);
  check("refund all", applyHubOp(p, { t: "paragon", reset: true }) === true && Object.keys(c.pAlloc ?? {}).length === 0);
}
