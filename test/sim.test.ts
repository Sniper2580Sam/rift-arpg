// Headless checks: determinism, mint spread, bot pacing per tier/class, every legendary + set + mythic runs.
import { createSim, step, stateHash, NO_INPUT, PlayerInput, PlayerSetup, SimState } from "../src/sim/sim";
import { mintItem, computeStats, Holder } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";
import { SEASON_JOURNEY, chapterKey, newChapters, cosAccess, newFeats, lifeStats, ACHIEVEMENTS, COSMETICS, GUARDIANS, LEGENDARIES, MYTHICS, SETS, CLASSES, SKILL, SlotType, EquipSlot } from "../src/sim/data";
const proc = (globalThis as any).process;

function setup(pid: number, cls = "ashknight", level = 1, equipment: Holder["equipment"] = {}, runes: Record<string, string> = {}): PlayerSetup {
  return { pid, name: "P" + pid, cls, level, xp: 0, equipment, bag: [], materials: 0, sigils: 0, runes, pet: "none", filter: "common" };
}
function bot(s: SimState, pid: number, t: number): PlayerInput {
  const p = s.players.find((q) => q.pid === pid)!;
  let target: { x: number; y: number } | null = null, best = 1e9;
  for (const e of s.enemies) { if (e.dead || (e.kind === "king" && e.state === "tomb" && s.enemies.some((o) => o.kind === "pylon" && !o.dead))) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < best) { best = d; target = e; } }
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
function run(cfg: { seed: number; tier?: number; players: PlayerSetup[]; kind?: "rift" | "chase"; boss?: "king" | "seraph" }, label: string, maxSec = 900) {
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
{ // a full room of 6 stays deterministic
  const six = () => { const cls = ["ashknight", "gloomstalker", "stormcaller", "bonewright", "ashknight", "stormcaller"];
    const s = createSim({ seed: 77, players: cls.map((c, i) => setup(i, c, 10)) });
    for (let t = 0; t < 30 * 40; t++) { const inp: any = {}; for (const p of s.players) inp[p.pid] = bot(s, p.pid, t); step(s, inp); }
    return [stateHash(s), s.players.length] as const; };
  const a = six(), b = six();
  if (a[0] !== b[0] || a[1] !== 6) { console.error("6-PLAYER FAIL", a, b); proc.exit(1); }
  console.log("6-player room ok");
}

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
// every guardian: spawns, uses its own attacks, and can be beaten by a geared hero
for (const gd of GUARDIANS) {
  for (const cls of ["ashknight", "gloomstalker"]) {
    const s = createSim({ seed: 11, tier: 10, players: [setup(0, cls, 30, kit(30, "legendary"))], mods: [] });
    s.rift.progress = s.rift.need;
    let g: any = null, deaths = 0; const states = new Set<string>();
    for (let t = 0; t < 30 * 300 && !s.rift.done; t++) {
      step(s, { 0: bot(s, 0, t) });
      if (s.boonOffers[0]) step(s, { 0: { ...NO_INPUT, cmds: [{ type: "boon", id: s.boonOffers[0][0] }] } });
      if (!g) { g = s.enemies.find((e) => e.kind === "guardian"); if (g) g.variant = gd.id; }
      if (g) states.add(g.state);
      for (const e of s.events) if (e.type === "playerDeath") deaths++;
    }
    const own = gd.pattern.filter((x) => !["nova", "raise", "fire", "charge"].includes(x)).map((x) => x === "rush" ? "charging" : x);
    const used = own.every((x) => states.has(x));
    console.log(`guardian ${gd.id} vs ${cls}: killed=${s.rift.done} in ${s.rift.time.toFixed(0)}s deaths=${deaths} own attacks used=${used}`);
    if (!s.rift.done || !used) { console.error("GUARDIAN FAIL", gd.id, cls, [...states]); proc.exit(1); }
  }
}
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
{ // the King leaves a Pale Feather
  const s = run({ seed: 6, tier: 3, kind: "chase", players: [setup(0, "ashknight", 30, kit(30, "legendary"))] }, "King (feather check)", 600);
  if (!s.rift.done || s.players[0].feathers !== 1) { console.error("FAIL king feather", s.players[0].feathers); proc.exit(1); }
}
// the Pale Seraph: beatable by both a melee and a ranged hero, goes through Judgement, and drops two ancestral items
for (const cls of ["ashknight", "gloomstalker"]) {
  const s = createSim({ seed: 12, tier: 6, kind: "chase", boss: "seraph", players: [setup(0, cls, 30, kit(30, "legendary"))], mods: [] });
  const states = new Set<string>(); let deaths = 0, anc = 0;
  for (let t = 0; t < 30 * 360 && !s.rift.done; t++) {
    step(s, { 0: bot(s, 0, t) });
    if (s.boonOffers[0]) step(s, { 0: { ...NO_INPUT, cmds: [{ type: "boon", id: s.boonOffers[0][0] }] } });
    const b = s.enemies.find((e) => e.kind === "king"); if (b) states.add(b.state);
    for (const e of s.events) if (e.type === "playerDeath") deaths++;
  }
  for (const it of [...s.loot.map((l) => l.item), ...s.players[0].bag]) if (it.quality) anc++;
  console.log(`seraph vs ${cls}: killed=${s.rift.done} in ${s.rift.time.toFixed(0)}s deaths=${deaths} states=${[...states].join(",")} ancestral=${anc}`);
  if (!s.rift.done || !states.has("tomb") || !states.has("spiral") || !states.has("blink") || anc < 2) { console.error("SERAPH FAIL", cls); proc.exit(1); }
}

{ // feats: legacy hero progress counts, rewards unlock through the feat, and every reward exists
  const ctx: any = { chars: { a: { highestTier: 11, kings: 1, level: 30, paragon: 3 } }, life: { kills: 1200 } };
  const ids = newFeats(ctx).map((a) => a.id);
  const ok = ids.includes("tier10") && ids.includes("king") && ids.includes("kills_1k") && !ids.includes("tier20") && cosAccess(ctx, "armor", "kingslayer").ok && !cosAccess(ctx, "wings", "judgement").ok && lifeStats(ctx).tier === 10;
  const missing = ACHIEVEMENTS.filter((a) => a.reward && !(COSMETICS as any)[a.reward.split(":")[1]]?.some((c: any) => c.id === a.reward!.split(":")[2] && c.earn?.ach === a.id));
  if (!ok || missing.length) { console.error("FAIL feats", ids, missing.map((a) => a.id)); proc.exit(1); } else console.log(`feats ok: ${ids.join(",")}`);
}

{ // season journey: chapters complete on this season's counters, and every chapter reward exists and unlocks
  const ctx: any = { chars: { a: { highestTier: 5, level: 12 } } };
  const season = lifeStats({ chars: ctx.chars, life: { rifts: 3, kills: 400, legendaries: 10, elites: 30 } });
  const ch = newChapters(ctx, season);
  const before = cosAccess(ctx, "dye", "bonefire").ok;
  ctx.feats = ch.map(chapterKey);
  const rewardsOk = SEASON_JOURNEY.chapters.every((c, i) => !c.reward || (COSMETICS as any)[c.reward.split(":")[1]]?.some((x: any) => x.id === c.reward!.split(":")[2] && x.earn?.ach === chapterKey(i)));
  if (ch.join() !== "0,1" || before || !cosAccess(ctx, "dye", "bonefire").ok || cosAccess(ctx, "armor", "bonefire").ok || !rewardsOk) { console.error("FAIL journey", ch, before, rewardsOk); proc.exit(1); } else console.log("journey ok: chapters 1-2 done, Bonefire dye unlocked");
}

{ // rift gems: the first guardian kill from tier 5 gives a gem, timed clears level socketed gems, and gems change stats
  const ps = setup(0, "ashknight", 30, kit(30, "legendary"));
  const s = createSim({ seed: 11, tier: 10, players: [ps], mods: [] });
  s.rift.progress = s.rift.need;
  for (let t = 0; t < 30 * 300 && !s.rift.done; t++) { step(s, { 0: bot(s, 0, t) }); if (s.boonOffers[0]) step(s, { 0: { ...NO_INPUT, cmds: [{ type: "boon", id: s.boonOffers[0][0] }] } }); }
  const p = s.players[0], g = Object.keys(p.gems);
  const base = computeStats({}, { cls: "ashknight", level: 30 }), withG = computeStats({}, { cls: "ashknight", level: 30, gems: { fury: 11, bane: 1 } });
  const ok = s.rift.done && g.length === 1 && p.gemSlots[0] === g[0] && p.gems[g[0]] === 3 && withG.dmgPct === base.dmgPct + 7.5 && withG.eliteDmg === base.eliteDmg + 10;
  if (!ok) { console.error("FAIL gems", p.gems, p.gemSlots, withG.dmgPct - base.dmgPct); proc.exit(1); } else console.log(`gems ok: got ${g[0]}, levelled to ${p.gems[g[0]]} by a timed T10 clear`);
}

{ // bounties: four tasks get done (the bot is walked to the shrine), then the cache drops
  for (const cls of ["ashknight", "gloomstalker"]) {
    const s = createSim({ seed: 21, tier: 6, kind: "bounty", players: [setup(0, cls, 30, kit(30, "legendary"))] });
    const tasks = s.rift.bounty!;
    let deaths = 0, lx = 0, ly = 0;
    for (let t = 0; t < 30 * 600 && !s.rift.done; t++) {
      const shrine = tasks.find((q) => q.kind === "shrine")!, p = s.players[0];
      const others = tasks.filter((q) => q.kind !== "shrine" && q.kind !== "cull").every((q) => q.done);
      let inp = bot(s, 0, t);
      // go hold the shrine once the elite and totems are down (the bot fights whatever comes)
      if (others && !shrine.done && Math.hypot(p.x - shrine.x, p.y - shrine.y) > 30) { const d = Math.hypot(shrine.x - p.x, shrine.y - p.y); inp = { ...inp, mx: (shrine.x - p.x) / d, my: (shrine.y - p.y) / d }; if (t % 150 === 0) { p.x = shrine.x; p.y = shrine.y; } }
      step(s, { 0: inp });
      if (s.boonOffers[0]) step(s, { 0: { ...NO_INPUT, cmds: [{ type: "boon", id: s.boonOffers[0][0] }] } });
      for (const e of s.events) if (e.type === "playerDeath") deaths++;
      // the test bot has no pathfinding: when it stops making progress, put it next to the nearest enemy
      if (t % 60 === 0) { if (Math.hypot(p.x - lx, p.y - ly) < 4) { const e = s.enemies.filter((q) => !q.dead).sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y))[0]; if (e && !(others && !shrine.done)) { p.x = e.x; p.y = e.y + 10; } } lx = p.x; ly = p.y; }
    }
    console.log(`bounty vs ${cls}: done=${s.rift.done} in ${s.rift.time.toFixed(0)}s deaths=${deaths} tasks=${tasks.map((q) => `${q.kind}:${Math.floor(q.have)}/${q.need}`).join(",")} drops=${s.loot.length + s.players[0].bag.length}`);
    if (!s.rift.done) { console.error("FAIL bounty", cls); proc.exit(1); }
  }
  // a relic power adds the legendary's mod; the same power from an item doesn't stack
  const L = LEGENDARIES.find((l) => !l.mythic)!;
  const a = computeStats({}, { cls: "ashknight", level: 30 }), b = computeStats({}, { cls: "ashknight", level: 30, relics: [L.id] });
  const it = mintItem(makeRng(3), "x", { rarity: "legendary", slot: L.slot }); it.legendary = L.id;
  const c2 = computeStats({ [L.slot === "ring" ? "ring1" : L.slot]: it } as any, { cls: "ashknight", level: 30, relics: [L.id] });
  if (b.mods.length !== a.mods.length + 1 || c2.mods.filter((m) => (m as any).id === L.id).length !== 1) { console.error("FAIL relic mods"); proc.exit(1); } else console.log("relics ok");
}

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

{ // Abyssal tiers: life keeps climbing to 30 (gentler past 20), 4 modifiers from 16, better ancestral odds
  const { tierHpMult, lootChances, RIFT } = require("../src/sim/data");
  const { rollModifiers } = require("../src/sim/sim");
  const T = RIFT.tiers;
  let ok = T.max === 30;
  for (let t = 2; t <= 30; t++) if (!(tierHpMult(t) > tierHpMult(t - 1))) ok = false;
  ok = ok && tierHpMult(21) / tierHpMult(20) < tierHpMult(20) / tierHpMult(19);
  ok = ok && rollModifiers(7, 16).length === 4 && rollModifiers(7, 15).length === 3;
  ok = ok && lootChances(30).anc > lootChances(15).anc && lootChances(25).pri > lootChances(10).pri;
  if (!ok) { console.log("FAIL abyssal tiers"); proc.exit(1); } else console.log(`abyssal tiers ok (T20 life ×${Math.round(tierHpMult(20))}, T30 ×${Math.round(tierHpMult(30))})`);
}
