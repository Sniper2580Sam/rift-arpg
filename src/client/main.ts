// Client: fixed-step loop around the pure sim, code-drawn pixel renderer, game feel, HUD.
import { ENEMIES, RIFT, SKILL } from "../sim/data";
import { Holder, InvCmd, applyInvCmd, mintItem } from "../sim/items";
import { makeRng } from "../sim/rng";
import { DT, Enemy, PlayerInput, SimEvent, SimState, applyPlayerCmd, createSim, maxDashCharges, step } from "../sim/sim";
import { sfx, toggleMute, unlockAudio } from "./audio";
import { Input } from "./input";
import { RARITY_COLOR, Sprite, buildSprites, renderMap } from "./sprites";
import { UI, fmtTime } from "./ui";

declare const OFFLINE_TEST: boolean;

// ------------------------------------------------------------------ save (OFFLINE_TEST only; live saves go to the backend)
const SAVE_KEY = "rift-arpg-save";
const SAVE_VERSION = 1;
interface Profile extends Holder { version: number; riftsCleared: number; bestTime: number }

function newProfile(): Profile {
  const starter = mintItem(makeRng(20261124), "starter-0", { rarity: "common", slot: "weapon" });
  return { version: SAVE_VERSION, equipment: { weapon: starter }, bag: [], materials: 0, riftsCleared: 0, bestTime: 0 };
}
function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && p.version === SAVE_VERSION) return p;
    }
  } catch { /* private mode etc. */ }
  return newProfile();
}
function saveProfile(p: Profile) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

// ------------------------------------------------------------------ setup
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const wb = document.createElement("canvas"); // low-res world buffer
const wctx = wb.getContext("2d")!;
const bank = buildSprites();
const input = new Input(canvas);
const ui = new UI(bank);
let profile = loadProfile();

let dpr = 1, cssW = 0, cssH = 0, pix = 3;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cssW = innerWidth; cssH = innerHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  pix = Math.max(2, Math.floor((Math.min(cssW, cssH) * dpr) / 200));
  wb.width = Math.ceil(canvas.width / pix); wb.height = Math.ceil(canvas.height / pix);
  input.layout(cssW, cssH);
  vignette = null;
}
addEventListener("resize", resize);
resize();

// ------------------------------------------------------------------ run state
type Mode = "hub" | "rift" | "blocked";
let mode: Mode = "hub";
let sim: SimState | null = null;
let mapCanvas: HTMLCanvasElement | null = null;
let miniCanvas: HTMLCanvasElement | null = null;
let pendingCmds: InvCmd[] = []; // reserved for co-op: inventory commands sent with the next input
let paused = false;
let acc = 0, hitstop = 0, shake = 0, flash = 0, flashColor = "#fff", hurtFlash = 0;
let camX = 0, camY = 0;
let banner: { text: string; sub: string; color: string; t: number } | null = null;
let found: Record<string, number> = {}, foundLegs: string[] = [];
let completeInfo: { inTime: boolean; time: number } | null = null;
let leaveArmed = 0;

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number }
interface Num { x: number; y: number; text: string; color: string; size: number; t: number; vx: number }
interface Ring { x: number; y: number; r: number; t: number; max: number; color: string }
interface Arc { x: number; y: number; fx: number; fy: number; r: number; ring: boolean; t: number }
interface Ghost { x: number; y: number; t: number; flip: boolean }
const particles: Particle[] = [], nums: Num[] = [], rings: Ring[] = [], arcs: Arc[] = [], ghosts: Ghost[] = [];

function startRift(seed: number | null) {
  unlockAudio();
  const sd = seed ?? ((Math.random() * 0xffffffff) >>> 0);
  sim = createSim(sd, profile);
  mapCanvas = renderMap(sim.map.tiles, sim.map.w, sim.map.h, sim.map.ts, sd);
  miniCanvas = document.createElement("canvas");
  miniCanvas.width = sim.map.w; miniCanvas.height = sim.map.h;
  const m = miniCanvas.getContext("2d")!;
  for (let i = 0; i < sim.map.tiles.length; i++) if (sim.map.tiles[i] === 0) { m.fillStyle = "#6a5a7e"; m.fillRect(i % sim.map.w, Math.floor(i / sim.map.w), 1, 1); }
  camX = sim.player.x - wb.width / 2; camY = sim.player.y - wb.height / 2;
  particles.length = nums.length = rings.length = arcs.length = ghosts.length = 0;
  found = {}; foundLegs = []; completeInfo = null; acc = 0; hitstop = 0; paused = false; pendingCmds = [];
  mode = "rift";
  ui.hide();
  riftButtons();
  showBanner(RIFT.name, `Rift code ${sd.toString(36).toUpperCase()} · fill the bar, slay the guardian`, "#c9b8ff", 3);
}

function riftButtons() {
  const root = document.getElementById("ui")!;
  root.className = "hudbtns";
  root.innerHTML = `<button id="b-inv">Bag</button><button id="b-mute">Sound</button><button id="b-leave">Leave</button>`;
  document.getElementById("b-inv")!.onclick = () => openRiftInventory();
  document.getElementById("b-mute")!.onclick = (e) => { (e.target as HTMLElement).textContent = toggleMute() ? "Muted" : "Sound"; };
  document.getElementById("b-leave")!.onclick = (e) => {
    const el = e.target as HTMLElement;
    if (completeInfo || performance.now() - leaveArmed < 2500) endRift();
    else { leaveArmed = performance.now(); el.textContent = "Leave? tap again"; setTimeout(() => (el.textContent = "Leave"), 2500); }
  };
}

function syncProfileFromSim() {
  if (!sim) return;
  profile.equipment = JSON.parse(JSON.stringify(sim.player.equipment));
  profile.bag = JSON.parse(JSON.stringify(sim.player.bag));
  profile.materials = sim.player.materials;
  saveProfile(profile);
}

function openRiftInventory() {
  if (!sim) return;
  paused = true; // solo only: co-op can't pause the shared sim (see notes)
  input.enabled = false;
  const s = sim;
  ui.showInventory(s.player, (c) => {
    // solo + paused: apply now. In co-op this goes out as an input command for the host's next tick.
    if (applyPlayerCmd(s, c)) syncProfileFromSim();
  }, () => { paused = false; input.enabled = true; riftButtons(); }, "Inventory · rift paused");
}

function endRift() {
  if (!sim) return;
  syncProfileFromSim();
  const s = sim;
  if (completeInfo) {
    profile.riftsCleared++;
    if (completeInfo.inTime && (!profile.bestTime || completeInfo.time < profile.bestTime)) profile.bestTime = completeInfo.time;
    saveProfile(profile);
    ui.showResults({ ...completeInfo, kills: s.rift.kills, found, legendaries: foundLegs }, goHub);
  } else goHub();
  sim = null; mode = "hub";
}

function goHub() {
  mode = "hub";
  ui.showHub({ materials: profile.materials, riftsCleared: profile.riftsCleared, bestTime: profile.bestTime, bagCount: profile.bag.length, offline: OFFLINE_TEST },
    (seed) => startRift(seed),
    () => ui.showInventory(profile, (c) => { applyInvCmd(profile, c); saveProfile(profile); }, goHub),
    () => { profile = newProfile(); saveProfile(profile); goHub(); });
}

input.onKey = (k) => {
  unlockAudio();
  if (mode !== "rift") return;
  if (k === "i" || k === "tab" || k === "b") { if (ui.invOpen) { ui.hide(); paused = false; input.enabled = true; riftButtons(); } else openRiftInventory(); }
  if (k === "m") toggleMute();
  if (k === "escape" && ui.invOpen) { ui.hide(); paused = false; input.enabled = true; riftButtons(); }
  if (k === "enter" && completeInfo) endRift();
};
canvas.addEventListener("pointerdown", () => unlockAudio());

// ------------------------------------------------------------------ events -> feel
function showBanner(text: string, sub: string, color: string, t = 2.2) { banner = { text, sub, color, t }; }
function burst(x: number, y: number, n: number, color: string | string[], speed = 60, size = 1, life = 0.4, grav = 0) {
  for (let i = 0; i < n && particles.length < 400; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    const c = Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.6), max: life, color: c, size, grav });
  }
}
const BLOOD: Record<string, string[]> = {
  ghoul: ["#6f8f5a", "#4a6640", "#9bc27a"], archer: ["#f2ead3", "#c9bf9f"], brute: ["#9a7aa8", "#6b4f7a", "#4a3456"], guardian: ["#f2ead3", "#ffd23f", "#2b1f3a"],
};

function handleEvent(e: SimEvent) {
  switch (e.type) {
    case "hit": {
      if (nums.length < 80) nums.push({ x: e.x + (Math.random() * 6 - 3), y: e.y, text: String(e.amount), color: e.burn ? "#ff9a3c" : e.crit ? "#ffe14a" : "#ffffff", size: e.crit ? 1.5 : e.burn ? 0.8 : 1, t: 0, vx: (Math.random() - 0.5) * 20 });
      burst(e.x, e.y + 4, e.crit ? 6 : 3, BLOOD[e.kind], 70, 1, 0.35, 120);
      if (!e.burn) sfx.hit(e.crit);
      if (e.crit) { hitstop = Math.max(hitstop, 0.03); shake = Math.max(shake, 1.5); }
      break;
    }
    case "kill":
      burst(e.x, e.y, e.kind === "brute" ? 26 : e.kind === "guardian" ? 80 : 12, BLOOD[e.kind], e.kind === "guardian" ? 160 : 90, e.kind === "ghoul" ? 1 : 2, 0.6, 150);
      if (e.kind === "brute") { hitstop = Math.max(hitstop, 0.08); shake = Math.max(shake, 5); sfx.bigKill(); }
      else if (e.kind === "guardian") { hitstop = 0.4; shake = 12; flash = 0.5; flashColor = "#fff"; sfx.bigKill(); }
      else sfx.kill();
      break;
    case "swing":
      arcs.push({ x: e.x, y: e.y, fx: e.fx, fy: e.fy, r: e.range, ring: e.ring, t: 0 });
      sfx.swing();
      if (e.hits > 0) shake = Math.max(shake, e.ring ? 3 : 1);
      if (e.hits > 0) hitstop = Math.max(hitstop, e.ring ? 0.05 : 0.018);
      break;
    case "cast":
      if (e.skill === "ember_lance") sfx.lance();
      if (e.skill === "ash_dash") sfx.dash();
      if (e.skill === "cinderlings") { sfx.summon(); burst(e.x, e.y, 20, ["#ff8a1f", "#ffd23f"], 80, 1, 0.5); }
      break;
    case "playerHurt":
      shake = Math.max(shake, 3); hurtFlash = 0.35; sfx.hurt();
      if (sim && nums.length < 80) nums.push({ x: sim.player.x, y: sim.player.y - 14, text: "-" + e.amount, color: "#ff4a4a", size: 1, t: 0, vx: 0 });
      break;
    case "playerDeath": sfx.death(); showBanner("You fell", "Respawning at the rift entrance…", "#ff4a4a", 2.5); break;
    case "slam": rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.35, color: e.big ? "#ffd23f" : "#c9a0ff" }); shake = Math.max(shake, e.big ? 6 : 4); sfx.slam(); burst(e.x, e.y, 14, ["#5c4a6e", "#8a7f66"], 90, 1, 0.5); break;
    case "explosion": rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.3, color: "#ff8a1f" }); burst(e.x, e.y, 18, ["#ff8a1f", "#ffd23f", "#ff5a1f"], 110, 1, 0.45); shake = Math.max(shake, 2.5); sfx.explosion(); break;
    case "drop":
      sfx.drop(e.rarity);
      if (e.rarity === "legendary") { shake = Math.max(shake, 5); flash = 0.35; flashColor = RARITY_COLOR.legendary; showBanner("LEGENDARY!", e.name, RARITY_COLOR.legendary, 2.4); burst(e.x, e.y, 40, ["#ff8a1f", "#ffd23f", "#fff"], 140, 2, 0.9); }
      else if (e.rarity === "rare") burst(e.x, e.y, 14, ["#ffd84a", "#fff"], 80, 1, 0.6);
      break;
    case "pickup":
      sfx.pickup(); found[e.rarity] = (found[e.rarity] ?? 0) + 1;
      if (e.rarity === "legendary") foundLegs.push(e.name);
      if (e.rarity === "legendary" || e.rarity === "rare") ui.toast(`Picked up ${e.name} (I to equip)`, RARITY_COLOR[e.rarity]);
      syncProfileFromSim();
      break;
    case "bagFull": ui.toast("Bag full! Open the bag (I) and scrap something.", "#ff6a6a"); break;
    case "guardianSpawn": showBanner("THE HOLLOW WARDEN", "rises from the bone pit", "#ffd23f", 3); shake = 8; sfx.guardian(); burst(e.x, e.y, 60, ["#2b1f3a", "#ffd23f", "#f2ead3"], 140, 2, 0.9); break;
    case "enrage": showBanner("ENRAGED", "The Warden grows faster and deadlier", "#ff4a4a", 2); sfx.guardian(); break;
    case "guardianStun": showBanner("STUNNED", "", "#9be0ff", 1); break;
    case "timeUp": showBanner("TIME'S UP", "Finish the rift for reduced rewards", "#ff7a3c", 2.5); break;
    case "riftComplete":
      completeInfo = { inTime: e.inTime, time: e.time };
      sfx.complete();
      showBanner(e.inTime ? "RIFT CLEARED" : "GUARDIAN SLAIN", `${fmtTime(e.time)} · grab your loot, then Leave (or Enter)`, "#7dff9a", 4);
      document.getElementById("b-leave") && (document.getElementById("b-leave")!.textContent = "Finish");
      syncProfileFromSim();
      break;
    case "equipChanged": syncProfileFromSim(); break;
  }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === "rift" && sim) {
    if (hitstop > 0) hitstop -= dt; // solo-only: freezes the sim; co-op needs a render-only version
    else if (!paused) acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 5) {
      const inp: PlayerInput = input.read(sim, toWorld);
      if (pendingCmds.length) { inp.cmds = pendingCmds; pendingCmds = []; }
      const ps = sim.player;
      step(sim, inp);
      for (const e of sim.events) handleEvent(e);
      if (ps.dashT > 0) ghosts.push({ x: ps.x, y: ps.y, t: 0, flip: ps.fx < 0 });
      acc -= DT; steps++;
      if (hitstop > 0) { acc = 0; break; }
    }
    if (steps === 5) acc = 0;
    updateFx(dt);
    render(Math.min(1, acc / DT), dt);
  } else {
    ctx.fillStyle = "#0b0710"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawHubBackdrop(now / 1000);
  }
  requestAnimationFrame(frame);
}

function toWorld(x: number, y: number): [number, number] { return [camX + (x * dpr) / pix, camY + (y * dpr) / pix]; }

function updateFx(dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt; if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy = p.vy * 0.9 + p.grav * dt;
  }
  for (let i = nums.length - 1; i >= 0; i--) { const n = nums[i]; n.t += dt; n.x += n.vx * dt; if (n.t > 0.8) nums.splice(i, 1); }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].max) rings.splice(i, 1); }
  for (let i = arcs.length - 1; i >= 0; i--) { arcs[i].t += dt; if (arcs[i].t > 0.13) arcs.splice(i, 1); }
  for (let i = ghosts.length - 1; i >= 0; i--) { ghosts[i].t += dt; if (ghosts[i].t > 0.25) ghosts.splice(i, 1); }
  shake = Math.max(0, shake - dt * 25);
  flash = Math.max(0, flash - dt);
  hurtFlash = Math.max(0, hurtFlash - dt);
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
}

// ------------------------------------------------------------------ render
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
let vignette: HTMLCanvasElement | null = null;

function render(alpha: number, dt: number) {
  const s = sim!;
  const p = s.player;
  const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
  const W = wb.width, H = wb.height;
  const tx = px - W / 2, ty = py - H / 2;
  const k = Math.min(1, dt * 12);
  camX += (tx - camX) * k; camY += (ty - camY) * k;
  const sx = Math.round(camX + (Math.random() - 0.5) * shake * 2), sy = Math.round(camY + (Math.random() - 0.5) * shake * 2);
  const g = wctx;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0e0a14"; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(-sx, -sy);
  g.drawImage(mapCanvas!, 0, 0);

  const t = performance.now() / 1000;
  // hazards
  for (const h of s.hazards) {
    const a = Math.min(1, h.life / 0.6);
    g.globalAlpha = 0.5 * a; g.fillStyle = (Math.floor(t * 12 + h.id) % 2) ? "#ff5a1f" : "#ff8a1f";
    g.beginPath(); g.ellipse(h.x, h.y, h.r * 0.8, h.r * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    if (Math.random() < 0.08) particles.push({ x: h.x + (Math.random() - 0.5) * 10, y: h.y, vx: 0, vy: -20, life: 0.4, max: 0.4, color: "#ffd23f", size: 1, grav: 0 });
  }
  // telegraphs
  for (const e of s.enemies) {
    if (e.dead) continue;
    const def = ENEMIES[e.kind];
    if (e.kind === "brute" && e.state === "windup") telegraphCircle(g, e.tx, e.ty, def.slamRadius!, 1 - e.t / def.windup);
    if (e.kind === "guardian") {
      if (e.state === "slam") telegraphCircle(g, e.tx, e.ty, def.slamRadius!, 1 - e.t / def.windup);
      if (e.state === "nova") { g.strokeStyle = "#ffd23f"; g.globalAlpha = 0.4 + 0.4 * Math.sin(t * 30); g.beginPath(); g.arc(e.x, e.y, e.r + 6 + (1 - e.t) * 10, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
      if (e.state === "chargeWind") {
        g.save(); g.translate(e.x, e.y); g.rotate(Math.atan2(e.ty, e.tx));
        g.fillStyle = "rgba(255,40,40,0.25)"; g.fillRect(0, -e.r, 190, e.r * 2);
        g.fillStyle = "rgba(255,80,80,0.6)"; g.fillRect(0, -1, 190 * (1 - e.t / 0.85), 2);
        g.restore();
      }
    }
    if (e.kind === "archer" && e.state === "windup") {
      g.strokeStyle = "rgba(255,60,60,0.5)"; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(p.x, p.y); g.stroke();
    }
  }
  // loot
  for (const l of s.loot) {
    const col = RARITY_COLOR[l.item.rarity];
    const bob = Math.sin(t * 4 + l.id) * 1.5;
    const hgt = l.item.rarity === "legendary" ? 90 : l.item.rarity === "rare" ? 40 : l.item.rarity === "magic" ? 22 : 0;
    if (hgt) {
      const wdt = l.item.rarity === "legendary" ? 6 + Math.sin(t * 8) : 3;
      const gr = g.createLinearGradient(0, l.y - hgt, 0, l.y);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, col);
      g.globalAlpha = 0.65; g.fillStyle = gr; g.fillRect(Math.round(l.x - wdt / 2), l.y - hgt, wdt, hgt); g.globalAlpha = 1;
    }
    const ic = bank.icon(l.item.slot, l.item.rarity);
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(l.x - 4, l.y + 3, 8, 2);
    g.drawImage(ic.img, Math.round(l.x - ic.w / 2), Math.round(l.y - ic.h + 2 + bob));
  }
  // dash ghosts
  for (const gh of ghosts) { g.globalAlpha = 0.4 * (1 - gh.t / 0.25); drawSprite(g, bank.hero[1], gh.x, gh.y, gh.flip, true); }
  g.globalAlpha = 1;
  // entities, y-sorted
  type D = { y: number; f: () => void };
  const list: D[] = [];
  for (const e of s.enemies) {
    if (e.dead) continue;
    if (e.x < sx - 40 || e.x > sx + W + 40 || e.y < sy - 40 || e.y > sy + H + 60) continue;
    const ex = lerp(e.px, e.x, alpha), ey = lerp(e.py, e.y, alpha);
    list.push({ y: ey, f: () => drawEnemy(g, e, ex, ey, t) });
  }
  for (const m of s.summons) {
    const mx = lerp(m.px, m.x, alpha), my = lerp(m.py, m.y, alpha);
    list.push({ y: my, f: () => { shadow(g, mx, my, 3); g.globalAlpha = m.life < 1.5 && Math.floor(t * 10) % 2 ? 0.5 : 1; drawSprite(g, bank.imp[Math.floor(t * 8 + m.id) % 2], mx, my, m.fx < 0, false); g.globalAlpha = 1; } });
  }
  if (!p.dead) list.push({ y: py, f: () => drawHero(g, s, px, py, t) });
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();
  // projectiles
  for (const pr of s.projectiles) {
    const x = lerp(pr.px, pr.x, alpha), y = lerp(pr.py, pr.y, alpha);
    const [nx, ny] = norm2(pr.vx, pr.vy);
    if (pr.kind === "lance") {
      g.strokeStyle = pr.returning ? "#7fd8ff" : "#ff5a1f"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x - nx * 12, y - ny * 12); g.lineTo(x + nx * 3, y + ny * 3); g.stroke();
      g.strokeStyle = "#ffe9a0"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - nx * 9, y - ny * 9); g.lineTo(x + nx * 4, y + ny * 4); g.stroke();
      if (Math.random() < 0.6) particles.push({ x, y, vx: -nx * 20 + (Math.random() - 0.5) * 20, vy: -ny * 20 + (Math.random() - 0.5) * 20, life: 0.3, max: 0.3, color: "#ff8a1f", size: 1, grav: 0 });
    } else if (pr.kind === "wave") {
      g.strokeStyle = "#ff8a1f"; g.lineWidth = 3; g.globalAlpha = Math.min(1, pr.life * 3);
      const a = Math.atan2(ny, nx);
      g.beginPath(); g.arc(x - nx * 6, y - ny * 6, 10, a - 1, a + 1); g.stroke();
      g.strokeStyle = "#ffd23f"; g.lineWidth = 1; g.beginPath(); g.arc(x - nx * 6, y - ny * 6, 10, a - 0.8, a + 0.8); g.stroke();
      g.globalAlpha = 1;
    } else if (pr.kind === "arrow") {
      g.strokeStyle = "#f2ead3"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - nx * 6, y - ny * 6); g.lineTo(x, y); g.stroke();
      g.fillStyle = "#ff3b3b"; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    } else {
      g.fillStyle = "#140c1c"; g.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
      g.fillStyle = (Math.floor(t * 10) % 2) ? "#f2ead3" : "#ffd23f"; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    }
  }
  g.lineWidth = 1;
  // swing arcs
  for (const a of arcs) {
    const k2 = a.t / 0.13;
    g.globalAlpha = 1 - k2;
    g.strokeStyle = a.ring ? "#ffd23f" : "#ffffff"; g.lineWidth = 3;
    const ang = Math.atan2(a.fy, a.fx);
    g.beginPath();
    if (a.ring) g.arc(a.x, a.y, a.r * (0.6 + 0.4 * k2), 0, Math.PI * 2);
    else g.arc(a.x, a.y, a.r * (0.7 + 0.3 * k2), ang - 1.15 + k2 * 0.3, ang + 1.15 + k2 * 0.3);
    g.stroke();
    g.globalAlpha = 1; g.lineWidth = 1;
  }
  for (const r of rings) {
    const k2 = r.t / r.max;
    g.globalAlpha = 1 - k2; g.strokeStyle = r.color; g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y, r.r * (0.4 + 0.6 * k2), 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1; g.lineWidth = 1;
  }
  for (const pa of particles) {
    g.globalAlpha = Math.min(1, pa.life / pa.max * 1.5);
    g.fillStyle = pa.color; g.fillRect(Math.round(pa.x), Math.round(pa.y), pa.size, pa.size);
  }
  g.globalAlpha = 1;
  g.restore();

  // darkness vignette around the hero
  if (!vignette || vignette.width !== W) {
    vignette = document.createElement("canvas"); vignette.width = W; vignette.height = H;
    const v = vignette.getContext("2d")!;
    const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    gr.addColorStop(0, "rgba(5,2,10,0)"); gr.addColorStop(1, "rgba(5,2,10,0.75)");
    v.fillStyle = gr; v.fillRect(0, 0, W, H);
  }
  g.drawImage(vignette, 0, 0);

  // blit
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wb, 0, 0, W * pix, H * pix);
  drawHud(s, sx, sy, t);
}

function norm2(x: number, y: number): [number, number] { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function shadow(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.ellipse(Math.round(x), Math.round(y) + 1, r + 1, r * 0.5, 0, 0, Math.PI * 2); g.fill();
}
function drawSprite(g: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, flip: boolean, white: boolean) {
  const img = white ? sp.flash : sp.img;
  const dx = Math.round(x - sp.w / 2), dy = Math.round(y - sp.h + 2);
  if (flip) { g.save(); g.translate(dx + sp.w, dy); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore(); }
  else g.drawImage(img, dx, dy);
}
function telegraphCircle(g: CanvasRenderingContext2D, x: number, y: number, r: number, k: number) {
  g.fillStyle = "rgba(255,40,40,0.18)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,60,60,0.35)"; g.beginPath(); g.arc(x, y, r * Math.max(0, Math.min(1, k)), 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,90,90,0.8)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}

function drawEnemy(g: CanvasRenderingContext2D, e: Enemy, x: number, y: number, t: number) {
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
  const frames = e.kind === "ghoul" ? bank.ghoul : e.kind === "archer" ? bank.archer : e.kind === "brute" ? bank.brute : bank.guardian;
  const fr = frames[moving ? Math.floor(t * 8 + e.id) % frames.length : 0];
  const flip = sim!.player.x < e.x;
  shadow(g, x, y, e.r);
  let yy = y;
  if (e.state === "windup" || e.state === "slam" || e.state === "nova" || e.state === "chargeWind") yy -= Math.floor(t * 20) % 2; // tremble
  if (e.kind === "guardian") yy += Math.sin(t * 2) * 1.5 - 2;
  if (e.kind === "guardian" && e.state === "intro") g.globalAlpha = 1 - Math.max(0, e.t / 1.6) * 0.7;
  if (e.kind === "guardian" && e.state === "stun") { g.fillStyle = "#9be0ff"; for (let i = 0; i < 3; i++) g.fillRect(Math.round(x + Math.cos(t * 6 + i * 2) * 10), Math.round(yy - fr.h - 2 + Math.sin(t * 6 + i * 2) * 2), 2, 2); }
  drawSprite(g, fr, x, yy, flip, e.flash > 0);
  if (e.kind === "guardian" && e.enraged) { g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 12); drawSprite(g, fr, x, yy, flip, true); }
  g.globalAlpha = 1;
  if (e.burnT > 0 && Math.random() < 0.3) particles.push({ x: x + (Math.random() - 0.5) * e.r * 2, y: yy - Math.random() * fr.h, vx: 0, vy: -25, life: 0.35, max: 0.35, color: Math.random() < 0.5 ? "#ff8a1f" : "#ffd23f", size: 1, grav: 0 });
  if (e.hp < e.maxHp && e.kind !== "guardian") {
    const w = e.r * 2 + 2;
    g.fillStyle = "#140c1c"; g.fillRect(Math.round(x - w / 2) - 1, Math.round(yy - fr.h - 3), w + 2, 3);
    g.fillStyle = "#d93a3a"; g.fillRect(Math.round(x - w / 2), Math.round(yy - fr.h - 2), Math.max(1, Math.round(w * e.hp / e.maxHp)), 1);
  }
}

function drawHero(g: CanvasRenderingContext2D, s: SimState, x: number, y: number, t: number) {
  const p = s.player;
  const fr = p.moving ? 1 + (Math.floor(p.walk / 7) % 2) : 0;
  shadow(g, x, y, 5);
  const blink = p.invuln > 0 && p.dashT <= 0 && Math.floor(t * 15) % 2 === 0;
  if (blink) g.globalAlpha = 0.5;
  const flip = p.fx < 0;
  // sword, swung behind/in front depending on facing
  const swingK = Math.max(0, p.swingTimer / SKILL.cleave.interval!);
  const ang = Math.atan2(p.fy, p.fx) + (swingK > 0.5 ? (swingK - 0.5) * 3 : -0.6);
  const hx = x + (flip ? -3 : 3), hy = y - 6;
  const drawSword = () => {
    g.strokeStyle = "#cfd6e6"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.cos(ang) * 11, hy + Math.sin(ang) * 11); g.stroke();
    g.fillStyle = "#ff8a1f"; g.fillRect(Math.round(hx + Math.cos(ang) * 11) - 1, Math.round(hy + Math.sin(ang) * 11) - 1, 2, 2);
    g.lineWidth = 1;
  };
  if (p.fy < 0) drawSword();
  drawSprite(g, bank.hero[fr], x, y, flip, false);
  if (p.fy >= 0) drawSword();
  if (hurtFlash > 0.2) { g.globalAlpha = 0.6; drawSprite(g, bank.hero[fr], x, y, flip, true); }
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------ HUD (drawn at screen resolution)
function drawHud(s: SimState, sx: number, sy: number, t: number) {
  const c = ctx;
  const S = dpr;
  c.save();
  c.scale(S, S);
  const W = cssW, H = cssH;
  const font = (px: number) => `${px}px "Pixelify Sans", ui-monospace, monospace`;
  // damage numbers
  c.textAlign = "center"; c.textBaseline = "middle";
  for (const n of nums) {
    const k = n.t / 0.8;
    const scale = n.t < 0.08 ? 1 + (1 - n.t / 0.08) * 0.8 : 1;
    const px = ((n.x - sx) * pix) / S, py = ((n.y - sy - n.t * 22) * pix) / S;
    c.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    c.font = font(Math.round(13 * n.size * scale));
    c.lineWidth = 3; c.strokeStyle = "#140c1c"; c.strokeText(n.text, px, py);
    c.fillStyle = n.color; c.fillText(n.text, px, py);
  }
  c.globalAlpha = 1;
  // loot labels
  c.font = font(11);
  for (const l of s.loot) {
    if (l.item.rarity === "common") continue;
    const px = ((l.x - sx) * pix) / S, py = ((l.y - sy - 14) * pix) / S;
    if (px < -50 || px > W + 50 || py < -20 || py > H + 20) continue;
    c.lineWidth = 3; c.strokeStyle = "#000"; c.strokeText(l.item.name, px, py);
    c.fillStyle = RARITY_COLOR[l.item.rarity]; c.fillText(l.item.name, px, py);
  }
  // top-left: life
  const p = s.player;
  c.textAlign = "left";
  const lw = Math.min(180, W * 0.38);
  panel(c, 10, 10, lw + 12, 28);
  c.fillStyle = "#3a1018"; c.fillRect(16, 16, lw, 16);
  c.fillStyle = p.hp / p.stats.maxHp < 0.3 && Math.floor(t * 4) % 2 ? "#ff6a6a" : "#d93a3a";
  c.fillRect(16, 16, lw * Math.max(0, p.hp / p.stats.maxHp), 16);
  c.fillStyle = "#fff"; c.font = font(12); c.fillText(`${Math.ceil(p.hp)} / ${p.stats.maxHp}`, 22, 25);
  // top-centre: timer + progress / guardian bar
  const r = s.rift;
  const bw = Math.min(300, W - 2 * lw - 60 > 160 ? W - 2 * lw - 60 : W * 0.5);
  const bx = W / 2 - bw / 2;
  const topY = W < 600 ? 46 : 10;
  panel(c, bx - 6, topY, bw + 12, 40);
  const left = r.limit - (r.done ? r.doneAt : r.time);
  c.textAlign = "center"; c.font = font(14);
  c.fillStyle = left < 0 ? "#ff7a3c" : left < 60 ? (Math.floor(t * 2) % 2 ? "#ffd23f" : "#fff") : "#fff";
  c.fillText(left >= 0 ? fmtTime(left) : "+" + fmtTime(-left), W / 2, topY + 12);
  const g = s.enemies.find((e) => e.id === r.guardianId && !e.dead);
  c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 22, bw, 12);
  if (r.guardianSpawned && g) {
    c.fillStyle = g.enraged ? "#ff3b3b" : "#ffd23f"; c.fillRect(bx, topY + 22, bw * g.hp / g.maxHp, 12);
    c.fillStyle = "#140c1c"; c.font = font(10); c.fillText(g.enraged ? "THE HOLLOW WARDEN — ENRAGED" : "THE HOLLOW WARDEN", W / 2, topY + 28);
  } else {
    c.fillStyle = r.done ? "#7dff9a" : "#8a5cff"; c.fillRect(bx, topY + 22, bw * r.progress / r.need, 12);
    c.fillStyle = "#fff"; c.font = font(10); c.fillText(r.done ? "RIFT CLEARED" : `${Math.floor((r.progress / r.need) * 100)}%`, W / 2, topY + 28);
  }
  // minimap (top-right, under the buttons)
  if (miniCanvas) {
    const ms = Math.min(96, W * 0.22), mx = W - ms - 10, my = W < 600 ? topY + 50 : 48;
    c.globalAlpha = 0.85; panel(c, mx - 3, my - 3, ms + 6, ms + 6);
    c.imageSmoothingEnabled = false; c.drawImage(miniCanvas, mx, my, ms, ms);
    const k = ms / (s.map.w * s.map.ts);
    c.fillStyle = "#d93a3a";
    for (const e of s.enemies) if (!e.dead && e.kind !== "guardian") c.fillRect(mx + e.x * k - 1, my + e.y * k - 1, 2, 2);
    if (g) { c.fillStyle = "#ffd23f"; c.fillRect(mx + g.x * k - 3, my + g.y * k - 3, 6, 6); }
    for (const l of s.loot) if (l.item.rarity === "legendary" || l.item.rarity === "rare") { c.fillStyle = RARITY_COLOR[l.item.rarity]; c.fillRect(mx + l.x * k - 2, my + l.y * k - 2, 4, 4); }
    c.fillStyle = "#fff"; c.fillRect(mx + p.x * k - 2, my + p.y * k - 2, 4, 4);
    c.globalAlpha = 1;
  }
  // skills
  const skills = [
    { id: "cleave", key: "LMB", label: "Cleave", cd: Math.max(0, p.swingTimer) / SKILL.cleave.interval!, held: "primary" as const, color: "#cfd6e6" },
    { id: "ember_lance", key: "RMB", label: "Lance", cd: (p.cds.ember_lance ?? 0) / SKILL.ember_lance.cooldown, held: "secondary" as const, color: "#ff8a1f" },
    { id: "ash_dash", key: "SPC", label: "Dash", cd: p.dashCharges > 0 ? 0 : p.dashRecharge / SKILL.ash_dash.cooldown, held: "dash" as const, color: "#9be0ff", charges: maxDashCharges(p) > 1 ? p.dashCharges : undefined },
    { id: "cinderlings", key: "Q", label: "Imps", cd: (p.cds.cinderlings ?? 0) / SKILL.cinderlings.cooldown, held: "ult" as const, color: "#ffd23f" },
  ];
  if (input.touchMode) {
    for (const b of input.buttons) {
      const sk = skills.find((q) => q.held === b.id)!;
      c.globalAlpha = input.isHeld(b.id) ? 0.85 : 0.55;
      c.fillStyle = "#1b1424"; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = sk.color; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
      if (sk.cd > 0) { c.fillStyle = "rgba(0,0,0,0.6)"; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, sk.cd)); c.fill(); }
      c.globalAlpha = 1; c.fillStyle = "#fff"; c.textAlign = "center"; c.font = font(Math.round(b.r * 0.42)); c.fillText(sk.label + (sk.charges !== undefined ? ` ${sk.charges}` : ""), b.x, b.y);
    }
    if (input.stick) {
      const st = input.stick;
      c.globalAlpha = 0.35; c.fillStyle = "#fff"; c.beginPath(); c.arc(st.ox, st.oy, 50, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.7; const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), m = Math.min(d, 50) / (d || 1);
      c.beginPath(); c.arc(st.ox + dx * m, st.oy + dy * m, 22, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    } else {
      c.globalAlpha = 0.25; c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(90, H - 100, 50, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
    }
  } else {
    const size = 46, gap = 8, total = skills.length * size + (skills.length - 1) * gap;
    let x0 = W / 2 - total / 2;
    const y0 = H - size - 14;
    for (const sk of skills) {
      panel(c, x0 - 2, y0 - 2, size + 4, size + 4);
      c.fillStyle = "#241b30"; c.fillRect(x0, y0, size, size);
      c.strokeStyle = sk.color; c.lineWidth = 2; c.strokeRect(x0 + 1, y0 + 1, size - 2, size - 2);
      c.fillStyle = "#fff"; c.textAlign = "center"; c.font = font(12); c.fillText(sk.label, x0 + size / 2, y0 + size / 2 + 2);
      c.font = font(9); c.fillStyle = "#b8a8d0"; c.fillText(sk.key, x0 + size / 2, y0 + 9);
      if (sk.charges !== undefined) { c.fillStyle = "#9be0ff"; c.fillText("×" + sk.charges, x0 + size - 9, y0 + size - 7); }
      if (sk.cd > 0) { c.fillStyle = "rgba(0,0,0,0.65)"; c.fillRect(x0, y0 + size * (1 - Math.min(1, sk.cd)), size, size * Math.min(1, sk.cd)); }
      x0 += size + gap;
    }
  }
  // banner
  if (banner) {
    const a = Math.min(1, banner.t * 2);
    c.globalAlpha = a; c.textAlign = "center";
    const by = H * 0.3;
    c.font = font(Math.min(40, W / 12)); c.lineWidth = 6; c.strokeStyle = "#000";
    c.strokeText(banner.text, W / 2, by); c.fillStyle = banner.color; c.fillText(banner.text, W / 2, by);
    if (banner.sub) { c.font = font(Math.min(16, W / 28)); c.lineWidth = 4; c.strokeText(banner.sub, W / 2, by + 32); c.fillStyle = "#fff"; c.fillText(banner.sub, W / 2, by + 32); }
    c.globalAlpha = 1;
  }
  if (p.dead) { c.fillStyle = "rgba(60,0,0,0.35)"; c.fillRect(0, 0, W, H); }
  if (hurtFlash > 0) {
    const gr = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    gr.addColorStop(0, "rgba(255,0,0,0)"); gr.addColorStop(1, `rgba(255,0,0,${hurtFlash})`);
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
  }
  if (flash > 0) { c.globalAlpha = Math.min(0.6, flash); c.fillStyle = flashColor; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  if (paused) { c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(0, 0, W, H); }
  c.restore();
}

function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.fillStyle = "rgba(20,12,28,0.85)"; c.fillRect(x, y, w, h);
  c.strokeStyle = "#4a3b5a"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

// animated backdrop behind hub screens
function drawHubBackdrop(t: number) {
  const W = wb.width, H = wb.height, g = wctx;
  g.fillStyle = "#0e0a14"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = (i * 97 + t * (8 + (i % 5) * 3)) % (W + 20) - 10;
    const y = H - ((i * 53 + t * (10 + (i % 7) * 4)) % (H + 20));
    g.fillStyle = i % 3 ? "#ff8a1f" : "#ffd23f"; g.globalAlpha = 0.3 + (i % 4) * 0.15;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.globalAlpha = 1;
  const hero = bank.hero[Math.floor(t * 3) % 2 ? 1 : 2];
  drawSprite(g, hero, W / 2, H - 20, false, false);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wb, 0, 0, W * pix, H * pix);
}

// ------------------------------------------------------------------ boot
if (!OFFLINE_TEST) {
  mode = "blocked";
  document.getElementById("ui")!.className = "screen";
  document.getElementById("ui")!.innerHTML = `<div class="panel hub"><h1>RIFT ARPG</h1><p>Live build: sign-in is required and the backend isn't built yet (Milestone 4). Use an OFFLINE_TEST build to play the solo slice.</p></div>`;
} else goHub();
requestAnimationFrame(frame);
(window as any).__rift = { get sim() { return sim; }, startRift, get profile() { return profile; } };
