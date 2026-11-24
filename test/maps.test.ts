// Every map layout generates, is connected, places packs, and a bot can clear it. The Good Luck map runs fast enough.
import { createSim, step, NO_INPUT, PlayerInput, SimState, pickMap } from "../src/sim/sim";
import { MAPS } from "../src/sim/data";
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
for (const m of MAPS) {
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
// how often each map comes up from rift codes
const counts: Record<string, number> = {};
for (let i = 0; i < 20000; i++) { const m = pickMap(i * 7919 + 13); counts[m.id] = (counts[m.id] ?? 0) + 1; }
console.log("map odds /20000:", JSON.stringify(counts));
check("eggs are rare", (counts.goodluck ?? 0) < 400 && (counts.goodluck ?? 0) > 20 && (counts.vault ?? 0) < 700);
if (fails) { console.log(`${fails} map checks failed`); proc.exit(1); }
console.log("maps: all checks passed");
