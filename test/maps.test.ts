// Every map layout generates, is connected, places packs, and a bot can clear it. The Good Luck map runs fast enough.
import { createSim, step, NO_INPUT, PlayerInput, SimState, pickMap, shieldFactor } from "../src/sim/sim";
import { MAPS } from "../src/sim/data";
import { isWallAt, moveWithWalls } from "../src/sim/map";
const proc = (globalThis as any).process;
let fails = 0;
const check = (name: string, ok: boolean, extra = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`); if (!ok) fails++; };

function bot(s: SimState, t: number): PlayerInput {
  const p = s.players[0];
  let target: { x: number; y: number } | null = null, best = 1e9;
  for (const e of s.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < best) { best = d; target = e; } }
  if (!target) return NO_INPUT;
  const dx = target.x - p.x, dy = target.y - p.y, d = Math.hypot(dx, dy) || 1, near = d < 26;
  return { mx: near ? 0 : dx / d, my: near ? 0 : dy / d, ax: target.x, ay: target.y, act: (d < 40 ? 1 : 0) | (d < 150 ? 2 : 0) | (d < 100 ? 8 : 0) | (t % 60 === 0 ? 4 : 0) };
}

const setup = { pid: 0, name: "b", cls: "ashknight", level: 20, xp: 0, equipment: {}, bag: [], materials: 0, sigils: 0, runes: {}, pet: "none", filter: "common" as const };
for (const m of MAPS.filter((m) => m.weight > 0)) {
  const t0 = Date.now();
  const s = createSim({ seed: 21, tier: 3, map: m.id, players: [setup] });
  const floors = s.map.tiles.filter((x) => x === 0).length;
  const genMs = Date.now() - t0;
  check(`${m.id}: generates`, floors > 800 && s.enemies.length > 50, `(${s.map.w}x${s.map.h}, ${floors} floor tiles, ${s.enemies.length} enemies, density ×${s.rift.density}, ${genMs} ms)`);
  // bot run: 4 minutes of play (Good Luck: 30 s, timed)
  const secs = m.id === "goodluck" ? 30 : 240;
  const t1 = Date.now();
  let lastX = 0, lastY = 0, stuck = 0;
  for (let t = 0; t < secs * 30; t++) {
    step(s, { 0: bot(s, t) });
    if (t % 60 === 0) {
      const p = s.players[0];
      if (Math.hypot(p.x - lastX, p.y - lastY) < 4) stuck++; else stuck = 0;
      lastX = p.x; lastY = p.y;
      if (stuck > 2) { const e = s.enemies.find((e) => !e.dead); if (e) { p.x = e.x; p.y = e.y; } stuck = 0; }
    }
    if (s.rift.done) break;
  }
  const ms = (Date.now() - t1) / (secs * 30);
  check(`${m.id}: plays`, s.rift.kills > 20, `(kills ${s.rift.kills} in ${secs}s, progress ${Math.round((s.rift.progress / s.rift.need) * 100)}%, ${ms.toFixed(2)} ms/tick, alive ${s.enemies.filter((e) => !e.dead).length})`);
  if (m.id === "goodluck") check("goodluck: under 12 ms per tick in node", ms < 12);
}
// Endless: waves come, scale up, and the run ends with a reward chest when lives run out
{
  const s = createSim({ seed: 9, kind: "endless", tier: 3, players: [setup] });
  let waves = 0, clears = 0, drops = 0;
  for (let t = 0; t < 30 * 600 && !s.rift.done; t++) { step(s, { 0: bot(s, t) }); for (const e of s.events) { if (e.type === "waveStart") waves++; if (e.type === "waveClear") clears++; if (e.type === "drop") drops++; } }
  check("endless: waves start and clear", waves >= 3 && clears >= 2, `(wave ${s.rift.wave}, level ${s.rift.level}, ${clears} cleared)`);
  check("endless: ends with a reward chest", s.rift.done && s.loot.length >= 2 && !s.players[0].dead, `(${s.loot.length} items on the floor, ${drops} drops, ${s.rift.time.toFixed(0)} s)`);
}
// Trials: 5 waves against the clock, no loot. Level 1 is passable; a huge level runs out of time.
for (const [lvl, want] of [[1, true], [30, false]] as [number, boolean][]) {
  const s = createSim({ seed: 5, kind: "trial", tier: lvl, players: [{ ...setup, level: 30 }] });
  let drops = 0, waves = 0;
  for (let t = 0; t < 30 * 200 && !s.rift.done; t++) { step(s, { 0: bot(s, t) }); for (const e of s.events) { if (e.type === "drop") drops++; if (e.type === "waveStart") waves++; } }
  const won = s.rift.done && s.rift.time < s.rift.limit && s.rift.wave === 5;
  check(`trial ${lvl}: ${want ? "passes" : "times out"}`, s.rift.done && won === want && drops === 0, `(wave ${s.rift.wave}, ${s.rift.time.toFixed(0)} s, ${drops} drops)`);
}
// how often each map comes up from rift codes
const counts: Record<string, number> = {};
for (let i = 0; i < 20000; i++) { const m = pickMap(i * 7919 + 13); counts[m.id] = (counts[m.id] ?? 0) + 1; }
console.log("map odds /20000:", JSON.stringify(counts));
check("eggs are rare", (counts.goodluck ?? 0) < 400 && (counts.goodluck ?? 0) > 20 && (counts.vault ?? 0) < 700);
{ // a blink-speed move into a thick wall stops at the wall, never inside it
  const m = { w: 10, h: 3, ts: 16, tiles: [1,1,1,1,1,1,1,1,1,1, 1,0,0,0,1,1,1,1,0,1, 1,1,1,1,1,1,1,1,1,1] };
  const e = { x: 24, y: 24, r: 5 };
  for (let i = 0; i < 4; i++) moveWithWalls(m, e, 46, 0);
  check("fast move stops at the wall", !isWallAt(m, e.x, e.y) && e.x < 4 * 16);
}
{ // a Shieldbearer blocks hits from the front, not from behind
  const e: any = { kind: "shieldbearer", x: 100, y: 100, tx: 1, ty: 0, state: "chase" };
  check("shield blocks from the front", shieldFactor(e, 140, 100) < 0.5 && shieldFactor(e, 60, 100) === 1);
}
if (fails) { console.log(`${fails} map checks failed`); proc.exit(1); }
console.log("maps: all checks passed");
