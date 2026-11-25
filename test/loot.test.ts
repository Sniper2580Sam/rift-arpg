// Batch 6 loot: skill-changing legendaries, the Concord Band, generic 2-piece sets, defence, trade-off boons, bag sort.
import { createSim, step, NO_INPUT, PlayerSetup, refreshAll, damagePlayer as damagePlayerForTest } from "../src/sim/sim";
import { mintItem, computeStats, Holder, applyInvCmd, capRarity } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";
import { CLASSES, LEGENDARY, SET, SlotType, EquipSlot } from "../src/sim/data";
const proc = (globalThis as any).process;
const assert = (c: boolean, m: string) => { if (!c) { console.error("FAIL", m); proc.exit(1); } };
function setup(pid: number, cls = "ashknight", level = 1, equipment: Holder["equipment"] = {}): PlayerSetup {
  return { pid, name: "P" + pid, cls, level, xp: 0, equipment, bag: [], materials: 0, sigils: 0, runes: {}, pet: "none", filter: "common" };
}

{
  const leg = (id: string) => { const l = LEGENDARY[id]; const it = mintItem(makeRng(1), id, { rarity: "legendary", slot: l.slot }); it.legendary = id; it.affixes = []; return it; };
  // Crown of Lances: Ember Lance fires 8 lances evenly all around
  const ps = setup(0, "ashknight", 30, { helm: leg("lance_crown") }); ps.loadout = ["ember_lance", ...CLASSES.ashknight.loadout.filter((x) => x !== "ember_lance")];
  const s = createSim({ seed: 5, players: [ps] });
  const sk = s.players[0].sk.ember_lance;
  assert(sk.p.count === 8 && sk.p.circle === 8, `lance crown: count ${sk.p.count}`);
  // Sunwheel: Searing Strike hits all around
  const swp = setup(0, "ashknight", 30, { gloves: leg("sunwheel") }); swp.loadout = ["searing_strike", ...CLASSES.ashknight.loadout.filter((x) => x !== "searing_strike")];
  const sw = createSim({ seed: 5, players: [swp] });
  assert(sw.players[0].sk.searing_strike.p.arcCos === -1, "sunwheel arc");
  // a skill legendary leans to its own class
  let own = 0; for (let i = 0; i < 400; i++) { const it = mintItem(makeRng(900 + i), "x" + i, { rarity: "legendary", cls: "stormcaller" }); const l = LEGENDARY[it.legendary!]; if (l.skill) own += CLASSES.stormcaller.skills.includes(l.skill) ? 1 : -1; }
  assert(own > 0, `skill legendaries lean to the class (${own})`);
  // the Concord Band never drops outside the King, and does drop from his pool
  let normal = 0, king = 0;
  for (let i = 0; i < 3000; i++) { if (mintItem(makeRng(i), "n" + i, { rarity: "legendary" }).legendary === "concord") normal++; if (mintItem(makeRng(i), "k" + i, { rarity: "legendary", chasePool: true }).legendary === "concord") king++; }
  assert(normal === 0 && king > 30 && king < 600, `concord drops: normal ${normal}, king ${king}/3000`);
  // Concord: 3 of a 4-piece bonus, 1 of a 2-piece set does nothing
  const r = makeRng(3), eq: Holder["equipment"] = {};
  const st0 = SET.reaver; const sl = Object.keys(st0.pieces).slice(0, 3) as SlotType[];
  for (const x of sl) { const it = mintItem(r, x, { rarity: "set", slot: x }); it.set = "reaver"; it.affixes = []; eq[x as EquipSlot] = it; }
  const without = computeStats(eq, { cls: "ashknight", level: 30 }).mods.length;
  eq.ring1 = leg("concord");
  const withC = computeStats(eq, { cls: "ashknight", level: 30 }).mods.length;
  assert(withC === without + 2, `concord (its own power plus) the 4-piece bonus (${without} -> ${withC})`);
  const one: Holder["equipment"] = { ring1: leg("concord"), boots: Object.assign(mintItem(r, "b", { rarity: "set", slot: "boots" }), { set: "wanderer", affixes: [] }) };
  assert(computeStats(one, { cls: "ashknight", level: 30 }).moveSpeed === 0, "concord needs 2 pieces");
  // generic 2-piece set
  const two: Holder["equipment"] = { boots: Object.assign(mintItem(r, "b", { rarity: "set", slot: "boots" }), { set: "wanderer", affixes: [] }), gloves: Object.assign(mintItem(r, "g", { rarity: "set", slot: "gloves" }), { set: "wanderer", affixes: [] }) };
  const ts = computeStats(two, { cls: "ashknight", level: 30 });
  assert(ts.moveSpeed === 15 && ts.atkSpeed === 10, `wanderer pair: ${ts.moveSpeed}/${ts.atkSpeed}`);
  // trade-off boon: more damage and more damage taken
  const g = computeStats({}, { cls: "ashknight", level: 30, boons: ["glass"] });
  assert(g.dmgPct === 60 && Math.abs(g.takenMult - 1.3) < 1e-9, "glass cannon");
  // barrier soaks a hit, then refills
  const bs = createSim({ seed: 9, players: [setup(0, "ashknight", 30, {})] });
  const bp = bs.players[0]; bp.boons.push("aegis"); refreshAll(bs); bp.invuln = 0;
  for (let i = 0; i < 30 * 3; i++) step(bs, { 0: NO_INPUT });
  const full = bp.barrier ?? 0;
  assert(full > bp.stats.maxHp * 0.24, `barrier fills (${full})`);
  const hp0 = bp.hp; bp.invuln = 0; damagePlayerForTest(bs, bp, full * 0.5);
  assert(bp.hp === hp0 && (bp.barrier ?? 0) < full, "barrier soaks the hit");
  // bag sort: best first
  const h = { bag: [mintItem(r, "c", { rarity: "common" }), leg("sunwheel"), mintItem(r, "m", { rarity: "magic" })], equipment: {}, materials: 0 } as unknown as Holder;
  applyInvCmd(h, { type: "sort" });
  assert(h.bag[0].rarity === "legendary" && h.bag[2].rarity === "common", "sort");
  console.log(`ok   batch 6 loot: circle lances, concord (${king}/3000 King legendaries), 2-piece sets, glass cannon, barrier ${Math.round(full)}, sort`);
}

// loot by level: no legendaries before 20, no sets before 30, forced rewards drop to the best allowed
{
  const count = (level: number) => { const n: Record<string, number> = {}; for (let i = 0; i < 4000; i++) { const it = mintItem(makeRng(50000 + i), "l" + i, { tier: 5, level }); n[it.rarity] = (n[it.rarity] ?? 0) + 1; } return n; };
  const l1 = count(1), l19 = count(19), l24 = count(24), l30 = count(30);
  assert(!l1.rare && !l1.legendary && !l1.set, `level 1: ${JSON.stringify(l1)}`);
  assert(!l19.legendary && !l19.set && (l19.rare ?? 0) > 0, `level 19: ${JSON.stringify(l19)}`);
  assert((l24.legendary ?? 0) > 0 && !l24.set, `level 24: ${JSON.stringify(l24)}`);
  assert((l30.set ?? 0) > 0 && (l30.legendary ?? 0) > (l24.legendary ?? 0), `level 30: ${JSON.stringify(l30)}`);
  assert(capRarity("set", 10) === "rare" && capRarity("set", 22) === "legendary" && capRarity("legendary", 2) === "magic" && capRarity("mythic", 30) === "mythic", "capRarity");
  assert(mintItem(makeRng(1), "f", { rarity: "legendary", level: 12 }).rarity === "rare", "forced legendary at 12 is a rare");
  console.log(`ok   loot by level: L1 ${JSON.stringify(l1)} · L19 ${JSON.stringify(l19)} · L24 ${JSON.stringify(l24)} · L30 ${JSON.stringify(l30)}`);
}
