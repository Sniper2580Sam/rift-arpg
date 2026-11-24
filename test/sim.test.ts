// Headless checks: determinism + a scripted bot that plays the rift to measure pacing/balance.
import { createSim, step, stateHash, NO_INPUT, PlayerInput, SimState } from "../src/sim/sim";
import { mintItem, Holder, computeStats } from "../src/sim/items";
import { makeRng } from "../src/sim/rng";
import { LEGENDARIES } from "../src/sim/data";

function bot(s: SimState, t: number): PlayerInput {
  const p = s.player;
  let target: { x: number; y: number } | null = null, best = 1e9;
  for (const e of s.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < best) { best = d; target = e; } }
  for (const l of s.loot) { const d = Math.hypot(l.x - p.x, l.y - p.y); if (d < 80 && d < best) { best = d; target = l; } }
  if (!target) return NO_INPUT;
  // follow the flow field direction toward the target (cheap: straight line + wall slide)
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1;
  const near = d < 26;
  // circle a bit around walls using tick-based wobble so the bot doesn't stall forever
  const wob = Math.floor(t / 90) % 2 ? 0.6 : -0.6;
  const mx = near ? 0 : dx / d + (p.x === p.px && p.y === p.py ? -dy / d * wob * 3 : 0);
  const my = near ? 0 : dy / d + (p.x === p.px && p.y === p.py ? dx / d * wob * 3 : 0);
  return { mx, my, ax: target.x, ay: target.y, primary: d < 40, secondary: d < 150, dash: d > 120 && d < 200 && t % 60 === 0, ult: d < 100 };
}

// a bot can't navigate caves well, so for pacing we let it "path" by teleporting along when stuck too long
function run(seed: number, holder: Holder, label: string, maxSec = 900) {
  const s = createSim(seed, holder);
  let stuck = 0, deaths = 0, guardianAt = -1, legs = 0, drops = 0, lastX = 0, lastY = 0;
  for (let t = 0; t < maxSec * 30; t++) {
    step(s, bot(s, t));
    for (const e of s.events) {
      if (e.type === "playerDeath") deaths++;
      if (e.type === "guardianSpawn") guardianAt = s.rift.time;
      if (e.type === "drop") { drops++; if (e.rarity === "legendary") legs++; }
    }
    if (t % 60 === 0) {
      if (Math.hypot(s.player.x - lastX, s.player.y - lastY) < 4) stuck++; else stuck = 0;
      lastX = s.player.x; lastY = s.player.y;
      if (stuck > 2) { // nudge the bot to the nearest live enemy (simulates a human pathing)
        const e = s.enemies.find((e) => !e.dead);
        if (e) { s.player.x = e.x; s.player.y = e.y; }
        stuck = 0;
      }
    }
    if (s.rift.done) break;
  }
  const st = s.player.stats;
  console.log(`${label}: done=${s.rift.done} time=${s.rift.time.toFixed(0)}s guardianAt=${guardianAt.toFixed(0)}s kills=${s.rift.kills} deaths=${deaths} drops=${drops} legendaries=${legs} dmg=${st.dmgMin}-${st.dmgMax} hp=${st.maxHp}`);
  return s;
}

// 1) determinism
const empty: Holder = { equipment: {}, bag: [], materials: 0 };
function replay(seed: number) {
  const s = createSim(seed, empty);
  for (let t = 0; t < 30 * 60; t++) step(s, bot(s, t));
  return stateHash(s);
}
const h1 = replay(1234), h2 = replay(1234), h3 = replay(999);
if (h1 !== h2) { console.error("DETERMINISM FAIL", h1, h2); (globalThis as any).process.exit(1); }
console.log(`determinism ok (${h1}), different seed differs: ${h1 !== h3}`);

// 2) mint sanity
const r = makeRng(7);
const counts: Record<string, number> = {};
for (let i = 0; i < 5000; i++) { const it = mintItem(r, "t" + i); counts[it.rarity] = (counts[it.rarity] ?? 0) + 1; }
console.log("rarity spread /5000:", counts);
const r2 = makeRng(8);
for (const l of LEGENDARIES) {
  const it = mintItem(r2, "x", { rarity: "legendary", slot: l.slot });
  if (it.slot !== l.slot) throw new Error("legendary slot mismatch");
}

// 3) pacing with no gear, and with a decent rare kit
for (const seed of [1, 2, 3]) run(seed, empty, `fresh seed ${seed}`);
const kit: Holder = { equipment: {}, bag: [], materials: 0 };
const kr = makeRng(42);
for (const slot of ["weapon", "helm", "chest", "gloves", "boots"] as const) kit.equipment[slot] = mintItem(kr, slot, { rarity: "rare", slot });
const ks = computeStats(kit);
console.log(`rare kit: dmg ${ks.dmgMin}-${ks.dmgMax} +${ks.dmgPct}% hp ${ks.maxHp} armor ${ks.armor}`);
for (const seed of [1, 2]) run(seed, kit, `rare kit seed ${seed}`);

// 4) every legendary power runs without errors and changes the outcome of a fixed replay
{
  const base = (() => { const s = createSim(77, empty); for (let t = 0; t < 30 * 40; t++) step(s, bot(s, t)); return s.rift.kills; })();
  const lr = makeRng(5);
  for (const l of LEGENDARIES) {
    const h: Holder = { equipment: { [l.slot]: mintItem(lr, l.id, { rarity: "legendary", slot: l.slot }) }, bag: [], materials: 0 };
    h.equipment[l.slot]!.legendary = l.id; h.equipment[l.slot]!.name = l.name;
    const s = createSim(77, h);
    let extra = 0;
    for (let t = 0; t < 30 * 40; t++) { step(s, bot(s, t)); for (const e of s.events) if (e.type === "explosion") extra++; }
    console.log(`  ${l.name.padEnd(22)} (${l.power}): kills in 40s ${s.rift.kills} vs ${base} baseline, explosions ${extra}, hazards live ${s.hazards.length}`);
  }
}
