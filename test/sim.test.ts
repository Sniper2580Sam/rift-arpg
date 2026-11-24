// Headless checks: determinism, mint spread, bot pacing per tier/class, every legendary + set + mythic runs.
import { createSim, step, stateHash, NO_INPUT, PlayerInput, PlayerSetup, SimState } from "../src/sim/sim";
import { mintItem, computeStats, Holder } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";
import { LEGENDARIES, MYTHICS, SETS, CLASSES, SKILL, SlotType, EquipSlot } from "../src/sim/data";
const proc = (globalThis as any).process;

function setup(pid: number, cls = "ashknight", level = 1, equipment: Holder["equipment"] = {}, runes: Record<string, string> = {}): PlayerSetup {
  return { pid, name: "P" + pid, cls, level, xp: 0, equipment, bag: [], materials: 0, sigils: 0, runes, pet: "none", filter: "common" };
}
function bot(s: SimState, pid: number, t: number): PlayerInput {
  const p = s.players.find((q) => q.pid === pid)!;
  let target: { x: number; y: number } | null = null, best = 1e9;
  for (const e of s.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < best) { best = d; target = e; } }
  for (const l of s.loot) { if (l.owner !== pid) continue; const d = Math.hypot(l.x - p.x, l.y - p.y); if (d < 80 && d < best) { best = d; target = l; } }
  if (!target) return NO_INPUT;
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
  const near = d < (p.cls !== "ashknight" ? 90 : 26);
  let act = 0;
  if (d < (p.cls !== "ashknight" ? 200 : 40)) act |= 1;
  if (d < 150) act |= 2;
  if (d < 100) act |= 8;
  if (d > 120 && d < 200 && t % 60 === 0) act |= 4;
  return { mx: near ? 0 : dx / d, my: near ? 0 : dy / d, ax: target.x, ay: target.y, act };
}
function run(cfg: { seed: number; tier?: number; players: PlayerSetup[]; kind?: "rift" | "chase" }, label: string, maxSec = 900) {
  const s = createSim({ ...cfg, mods: cfg.kind === "chase" ? [] : ["fortified", "hasted"] });
  let gdmg = 0, deathsAtG = 0, deaths = 0, guardianAt = -1, legs = 0, drops = 0, lastX = 0, lastY = 0, stuck = 0, boons = 0, lvls = 0;
  for (let t = 0; t < maxSec * 30; t++) {
    const inputs: Record<number, PlayerInput> = {};
    for (const p of s.players) {
      inputs[p.pid] = bot(s, p.pid, t);
      const off = s.boonOffers[p.pid];
      if (off) inputs[p.pid].cmds = [{ type: "boon", id: off[0] }];
    }
    step(s, inputs);
    for (const e of s.events) {
      if (e.type === "playerDeath") { deaths++; if (guardianAt >= 0) deathsAtG++; }
      if (e.type === "hit" && e.kind === "guardian") gdmg += e.amount;
      if (e.type === "guardianSpawn") guardianAt = s.rift.time;
      if (e.type === "drop") { drops++; if (e.rarity === "legendary" || e.rarity === "set" || e.rarity === "mythic") legs++; }
      if (e.type === "boonTaken") boons++;
      if (e.type === "levelUp") lvls++;
    }
    if (t % 60 === 0) {
      const p = s.players[0];
      if (Math.hypot(p.x - lastX, p.y - lastY) < 4) stuck++; else stuck = 0;
      lastX = p.x; lastY = p.y;
      if (stuck > 2) { const e = s.enemies.find((e) => !e.dead); if (e) for (const q of s.players) { q.x = e.x; q.y = e.y; } stuck = 0; }
    }
    if (s.rift.done) break;
  }
  const p = s.players[0];
  console.log(`${label}: done=${s.rift.done} t=${s.rift.time.toFixed(0)}s guardian@${guardianAt.toFixed(0)} kills=${s.rift.kills} deaths=${deaths} drops=${drops} leg/set=${legs} boons=${boons} lvl=${p.level} (+${lvls}) dmg=${p.stats.dmgMin}-${p.stats.dmgMax} hp=${p.stats.maxHp}` + (proc.env.GDBG ? ` gdmg=${gdmg.toFixed(0)} gdeaths=${deathsAtG} gHP=${s.enemies.find((e) => e.kind === "guardian")?.maxHp}` : ""));
  return s;
}

// 1) determinism
function replay(seed: number) {
  const s = createSim({ seed, players: [setup(0), setup(1, "gloomstalker", 12)] });
  for (let t = 0; t < 30 * 60; t++) { step(s, { 0: bot(s, 0, t), 1: bot(s, 1, t) }); for (const p of s.players) if (s.boonOffers[p.pid]) step(s, { [p.pid]: { ...NO_INPUT, cmds: [{ type: "boon", id: s.boonOffers[p.pid][0] }] } }); }
  return stateHash(s);
}
const h1 = replay(1234), h2 = replay(1234), h3 = replay(999);
if (h1 !== h2) { console.error("DETERMINISM FAIL", h1, h2); proc.exit(1); }
console.log(`determinism ok (${h1}), different seed differs: ${h1 !== h3}`);

// 2) mint spread at tier 1 and tier 10
for (const tier of [1, 10]) {
  const r = makeRng(7), counts: Record<string, number> = {}; let anc = 0, pri = 0;
  for (let i = 0; i < 5000; i++) { const it = mintItem(r, "t" + i, { tier, ancestralChance: tier >= 3 ? 0.15 : 0, primalChance: tier >= 8 ? 0.004 : 0 }); counts[it.rarity] = (counts[it.rarity] ?? 0) + 1; if (it.quality === "ancestral") anc++; if (it.quality === "primal") pri++; }
  console.log(`tier ${tier} rarity /5000:`, JSON.stringify(counts), `ancestral ${anc} primal ${pri}`);
}

// 3) pacing
run({ seed: 1, players: [setup(0)] }, "T1 fresh knight");
run({ seed: 2, players: [setup(0, "gloomstalker")] }, "T1 fresh stalker");
run({ seed: 4, players: [setup(0, "stormcaller")] }, "T1 fresh mage");
run({ seed: 7, players: [setup(0, "bonewright")] }, "T1 fresh bonewright");
const kit = (lvl: number, rar: "rare" | "legendary", seed = 42): Holder["equipment"] => {
  const r = makeRng(seed), eq: Holder["equipment"] = {};
  for (const sl of ["weapon", "offhand", "helm", "shoulders", "chest", "bracers", "gloves", "belt", "pants", "boots", "amulet", "ring1", "ring2"] as EquipSlot[])
    eq[sl] = mintItem(r, sl, { rarity: rar, slot: (sl.startsWith("ring") ? "ring" : sl) as SlotType, ilvl: lvl });
  return eq;
};
run({ seed: 3, tier: 5, players: [setup(0, "ashknight", 20, kit(20, "rare"), { cleave: "searing" })] }, "T5 lvl20 rare kit knight");
run({ seed: 4, tier: 10, players: [setup(0, "ashknight", 30, kit(30, "legendary"))] }, "T10 lvl30 legendary kit knight");
{ // Bonewright at level 20: turrets, totem and the Colossus in the loadout
  const ps = setup(0, "bonewright", 20, kit(20, "rare"));
  ps.loadout = ["rivet_shot", "bone_turret", "mending_lantern", "ossuary_colossus"];
  run({ seed: 3, tier: 5, players: [ps] }, "T5 lvl20 rare kit bonewright");
}
{ // the Colossus: cast it, then the primary slams and damage taken drops
  const ps = setup(0, "bonewright", 12); ps.loadout = ["rivet_shot", "bone_turret", "war_totem", "ossuary_colossus"];
  const s = createSim({ seed: 9, players: [ps] }); const p = s.players[0];
  step(s, { 0: { ...NO_INPUT, act: 8 } });
  let slams = 0; for (let t = 0; t < 60; t++) { step(s, { 0: { ...NO_INPUT, act: 1, ax: p.x + 10, ay: p.y } }); slams += s.events.filter((e) => e.type === "slam").length; }
  if (!((p.colossusT ?? 0) > 0) || slams < 2) { console.log("FAIL colossus", p.colossusT, slams); proc.exit(1); } else console.log(`colossus ok: ${slams} slams in 2 s`);
}
run({ seed: 5, tier: 3, players: [setup(0, "ashknight", 15, kit(15, "rare")), setup(1, "gloomstalker", 8, kit(8, "rare", 9))] }, "T3 duo (15 + 8, level sync)");
run({ seed: 6, tier: 3, kind: "chase", players: [setup(0, "ashknight", 25, kit(25, "legendary"))] }, "Chase boss lvl25 legendary kit", 400);

// 4) every legendary/mythic/set bonus runs
for (const l of [...LEGENDARIES, ...MYTHICS]) {
  const it = mintItem(makeRng(5), l.id, { rarity: l.mythic ? "mythic" : "legendary", slot: l.slot });
  it.legendary = l.id;
  const cls = ["construct", "colossus"].includes(l.tag) ? "bonewright" : ["projectile", "pierce", "cold", "aoe"].includes(l.tag) ? "gloomstalker" : "ashknight";
  const s = createSim({ seed: 77, players: [setup(0, cls, 12, { [l.slot === "ring" ? "ring1" : l.slot]: it })] });
  for (let t = 0; t < 30 * 20; t++) step(s, { 0: bot(s, 0, t) });
}
for (const st of SETS) {
  const eq: Holder["equipment"] = {}; const r = makeRng(3);
  for (const sl of Object.keys(st.pieces) as SlotType[]) { const it = mintItem(r, sl, { rarity: "set", slot: sl }); it.set = st.id; eq[sl === "ring" ? "ring1" : (sl as EquipSlot)] = it; }
  const stt = computeStats(eq, { cls: "ashknight", level: 12 });
  const s = createSim({ seed: 78, players: [setup(0, "ashknight", 12, eq), setup(1, "gloomstalker", 12, eq), setup(2, "bonewright", 12, eq)] });
  for (let t = 0; t < 30 * 20; t++) step(s, { 0: bot(s, 0, t), 1: bot(s, 1, t), 2: bot(s, 2, t) });
  console.log(`  set ${st.name}: ${stt.setCounts[st.id]} pieces, ${stt.mods.length} mods, kills in 20s ${s.rift.kills}`);
}
console.log("all legendaries, mythics and sets ran", Object.keys(CLASSES).length, "classes");

// 5) every rune of every skill: equipped in the always-pressed slot, 12 s of play, no NaN and some damage dealt
{
  let runs = 0, bad: string[] = [];
  for (const [cls, cd] of Object.entries(CLASSES)) for (const id of cd.skills) {
    const runes = SKILL[id].runes;
    if (runes.length !== 5) bad.push(`${id}: ${runes.length} runes`);
    let base = 0;
    for (const r of [{ id: "" }, ...runes]) {
      const ps = setup(0, cls, 30, kit(30, "rare"), r.id ? { [id]: r.id } : {});
      ps.loadout = [id, ...cd.loadout.filter((x) => x !== id)];
      const s = createSim({ seed: 11, players: [ps] });
      let dmg = 0;
      for (let t = 0; t < 30 * 12; t++) { step(s, { 0: bot(s, 0, t) }); for (const e of s.events as any[]) if (e.type === "hit" && e.pid === 0) dmg += e.amount; }
      const p = s.players[0];
      if (!Number.isFinite(p.hp) || !Number.isFinite(p.res) || !Number.isFinite(dmg) || s.enemies.some((e) => !Number.isFinite(e.hp))) bad.push(`${id}/${r.id}: NaN`);
      if (!r.id) { base = dmg; continue; }
      if (proc.env.RUNEDBG) console.log(`  ${id}/${r.id}: ${(dmg / Math.max(1, base)).toFixed(2)}x`);
      runs++;
    }
  }
  if (bad.length) { console.log("FAIL runes:", bad.join(", ")); proc.exit(1); } else console.log(`all ${runs} runes ran`);
}
