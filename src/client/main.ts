// Client: fixed-step loop around the pure sim, code-drawn pixel renderer, game feel, HUD, hub flow.
import { CLASSES, ENEMIES, MODIFIER, RIFT, Rarity, SKILL, xpForLevel } from "../sim/data";
import { drawHeroCos, drawPetCos, Emit } from "./cosdraw";
import { InvCmd, applyInvCmd, rerollCost } from "../sim/items";
import { DT, Enemy, HostCmd, NO_INPUT, Player, PlayerCmd, PlayerInput, SimConfig, SimEvent, SimState, applyPlayerCmd, createSim, skillReady, stateHash, step, rollModifiers } from "../sim/sim";
import { sfx, setMuted, unlockAudio } from "./audio";
import { Input, KEY_LABELS } from "./input";
import { Profile, char, isoWeek, loadProfile, saveProfile, setLocalSaves, setOnSaved, setupFor, syncFromSim, weeklySeed } from "./profile";
import { queue as cloudQueue, startCloud } from "./cloud";
import { HubOp, applyHubOp } from "../shared/ops";
import { RARITY_COLOR, Sprite, buildSprites, renderMap } from "./sprites";
import { UI, fmtTime, modsLine } from "./ui";
import { Online, onlineAvailable, signIn, signOut } from "./net";
import { Direct } from "./direct";

declare const OFFLINE_TEST: boolean;
let ME = 0;
/** Live build: the game server connection. Test builds: direct co-op by room code (no server). */
let online: Online | Direct | null = null;

// ------------------------------------------------------------------ setup
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const wb = document.createElement("canvas");
const wctx = wb.getContext("2d")!;
const bank = buildSprites();
const input = new Input(canvas);
const ui = new UI(bank);
let profile: Profile = loadProfile();
setMuted(profile.settings.mute);

let dpr = 1, cssW = 0, cssH = 0, pix = 3;
function readInsets() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px);left:env(safe-area-inset-left,0px);pointer-events:none;visibility:hidden";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  input.insets = { top: parseFloat(cs.top) || 0, right: parseFloat(cs.right) || 0, bottom: parseFloat(cs.bottom) || 0, left: parseFloat(cs.left) || 0 };
  probe.remove();
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cssW = innerWidth; cssH = innerHeight;
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
  pix = Math.max(2, Math.floor((Math.min(cssW, cssH) * dpr) / (matchMedia("(pointer: coarse)").matches ? 165 : 210)));
  wb.width = Math.ceil(canvas.width / pix); wb.height = Math.ceil(canvas.height / pix);
  readInsets();
  input.layout(cssW, cssH);
  vignette = null;
}
addEventListener("resize", resize);
addEventListener("orientationchange", () => setTimeout(resize, 200));

// ------------------------------------------------------------------ run state
type Mode = "hub" | "rift" | "blocked";
let mode: Mode = "hub";
let sim: SimState | null = null;
let mapCanvas: HTMLCanvasElement | null = null, miniCanvas: HTMLCanvasElement | null = null;
let paused = false;
let acc = 0, hitstop = 0, shake = 0, flash = 0, flashColor = "#fff", hurtFlash = 0;
let camX = 0, camY = 0;
let banner: { text: string; sub: string; color: string; t: number } | null = null;
let found: Record<string, number> = {}, foundLegs: { name: string; rarity: Rarity; quality?: string }[] = [];
let gotAncestral = false, gotPrimal = false, gotSigil = 0, startLevel = 1;
let completeInfo: { inTime: boolean; time: number } | null = null;
let run: { kind: "rift" | "chase"; tier: number; weekly: boolean; seed: number } | null = null;
let leaveArmed = 0;
let screen: "hub" | "results" | "rift" = "hub";
let runIds = new Set<string>(), scrappedIds: string[] = [];

// co-op: the host runs the sim and streams each tick's inputs; guests replay them (deterministic lockstep).
interface Coop {
  role: "host" | "guest"; cfg: SimConfig;
  remote: Map<number, { inp: PlayerInput; cmds: PlayerCmd[] }>; hostCmds: HostCmd[]; localCmds: PlayerCmd[];
  live: Set<number>; joining: Set<number>;
  queue: any[]; resyncing: boolean; inputAcc: number;
}
let coop: Coop | null = null;
const newCoop = (role: Coop["role"], cfg: SimConfig): Coop => ({ role, cfg, remote: new Map(), hostCmds: [], localCmds: [], live: new Set(), joining: new Set(), queue: [], resyncing: false, inputAcc: 0 });
/** Solo (or a live host with nobody connected) may pause and hit-stop; a shared sim never stops. */
const canFreeze = () => !coop || (coop.role === "host" && coop.live.size === 0 && coop.joining.size === 0);
const pets = new Map<number, { x: number; y: number; flip: boolean }>();

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; grav: number }
interface Num { x: number; y: number; text: string; color: string; size: number; t: number; vx: number }
interface Ring { x: number; y: number; r: number; t: number; max: number; color: string; fill?: boolean }
interface Arc { x: number; y: number; fx: number; fy: number; r: number; ring: boolean; t: number; arcCos: number }
interface Ghost { x: number; y: number; t: number; flip: boolean; cls: string }
const bolts: { x1: number; y1: number; x2: number; y2: number; t: number }[] = [];
const particles: Particle[] = [], nums: Num[] = [], rings: Ring[] = [], arcs: Arc[] = [], ghosts: Ghost[] = [];
const me = () => sim!.players.find((p) => p.pid === ME)!;

type RunOpts = { tier: number; seed: number | null; kind: "rift" | "chase"; weekly?: boolean };
type RunInfo = { kind: "rift" | "chase"; tier: number; weekly: boolean; seed: number };
function startRun(o: RunOpts) {
  unlockAudio();
  if (online && !online.direct) return startLiveRun(o);
  if (online?.direct && online.lobby) { if (online.lobby.host) startDirectRun(o); return; }
  const c = char(profile);
  let seed = o.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  if (o.weekly) seed = weeklySeed(isoWeek());
  if (o.kind === "chase") { if (c.sigils <= 0) return; c.sigils--; saveProfile(profile); }
  const T = RIFT.tiers;
  const cfg: SimConfig = {
    seed, kind: o.kind, tier: o.tier, players: [setupFor(profile, ME)],
    mods: o.kind === "chase" ? [] : rollModifiers(seed, o.tier),
    pity: { [ME]: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity } },
  };
  beginRun(cfg, { kind: o.kind, tier: o.tier, weekly: !!o.weekly, seed });
}

function beginRun(cfg: SimConfig, info: RunInfo, existing?: SimState) {
  const c = char(profile);
  sim = existing ?? createSim(cfg);
  run = info;
  const seed = info.seed;
  mapCanvas = renderMap(sim.map.tiles, sim.map.w, sim.map.h, sim.map.ts, seed);
  miniCanvas = document.createElement("canvas");
  miniCanvas.width = sim.map.w; miniCanvas.height = sim.map.h;
  const m = miniCanvas.getContext("2d")!;
  for (let i = 0; i < sim.map.tiles.length; i++) if (sim.map.tiles[i] === 0) { m.fillStyle = "#6a5a7e"; m.fillRect(i % sim.map.w, Math.floor(i / sim.map.w), 1, 1); }
  const p = me();
  camX = p.x - wb.width / 2; camY = p.y - wb.height / 2;
  particles.length = nums.length = rings.length = arcs.length = ghosts.length = 0; pets.clear();
  found = {}; foundLegs = []; completeInfo = null; acc = 0; hitstop = 0; paused = false; gotAncestral = gotPrimal = false; gotSigil = 0; startLevel = c.level;
  runIds = new Set([...Object.values(p.equipment).map((it) => it!.id), ...p.bag.map((it) => it.id)]); scrappedIds = [];
  mode = "rift"; screen = "rift";
  ui.hide();
  riftButtons();
  const party = sim.players.length > 1 ? ` · party of ${sim.players.length}` : "";
  if (info.kind === "chase") showBanner(RIFT.chase.name, "Three phases. Dodge the fire, break the pylons.", "#ff3b6b", 3.5);
  else showBanner(info.weekly ? "WEEKLY RIFT" : RIFT.name, `Tier ${info.tier} · code ${seed.toString(36).toUpperCase()} · ${modsLine(sim.rift.mods)}${party}`, "#c9b8ff", 3.5);
}

function riftButtons() {
  const root = document.getElementById("ui")!;
  root.className = "hudbtns";
  root.innerHTML = `${sim?.boonOffers[ME] ? `<button id="b-boon" class="boon-ready">★ Boon${sim.boonPending?.[ME] ? ` ×${sim.boonPending[ME] + 1}` : ""}</button>` : ""}<button id="b-inv">Bag</button><button id="b-leave">Leave</button>`;
  const bb = document.getElementById("b-boon"); if (bb) bb.onclick = () => openBoons();
  document.getElementById("b-inv")!.onclick = () => openRiftInventory();
  document.getElementById("b-leave")!.onclick = (e) => {
    const el = e.target as HTMLElement;
    if (completeInfo || performance.now() - leaveArmed < 2500) endRun();
    else { leaveArmed = performance.now(); el.textContent = "Leave? tap again"; setTimeout(() => { if (!completeInfo) el.textContent = "Leave"; }, 2500); }
  };
  if (completeInfo) document.getElementById("b-leave")!.textContent = "Finish";
}

function openBoons() {
  if (!sim?.boonOffers[ME]) return riftButtons();
  pause();
  ui.showBoons(sim.boonOffers[ME], (id) => { playerCmd({ type: "boon", id }); sfx.complete(); resume(); }, () => resume());
}
function resume() { paused = false; input.enabled = true; riftButtons(); }
function pause() { if (canFreeze()) paused = true; input.enabled = false; }
/** Inventory and boon picks: applied directly when nobody else shares the sim, otherwise sent as a tick input. */
function playerCmd(c: PlayerCmd) {
  if (!sim) return;
  if (canFreeze()) { if (applyPlayerCmd(sim, me(), c)) syncFromSim(profile, sim, ME); return; }
  if (coop!.role === "host") coop!.localCmds.push(c); else online!.sendR(0, { t: "cmd", c });
}
function openRiftInventory() {
  if (!sim) return;
  pause();
  const p = me();
  ui.showRiftInventory(p, p.materials, (c: InvCmd) => playerCmd(c), resume);
}

function endRun() {
  if (!sim || !run) return;
  const s = sim, p = me(), c = char(profile), T = RIFT.tiers;
  syncFromSim(profile, s, ME);
  for (const [k, v] of Object.entries(p.uses)) c.uses[k] = (c.uses[k] ?? 0) + v;
  const lines: string[] = [];
  if (c.level > startLevel) lines.push(`Level ${startLevel} → ${c.level}`);
  const newRunes = CLASSES[c.cls].skills.flatMap((id) => SKILL[id].runes.filter((r) => r.uses > (c.uses[id] ?? 0) - (p.uses[id] ?? 0) && r.uses <= (c.uses[id] ?? 0)).map((r) => `${SKILL[id].name}: ${r.name}`));
  if (newRunes.length) lines.push(`New runes: ${newRunes.join(", ")}`);
  if (gotSigil) lines.push(`Bone Sigil found (${c.sigils} owned). The Ossuary King awaits.`);
  if (completeInfo) {
    c.riftsCleared++;
    if (run.kind === "rift") {
      if (completeInfo.inTime && run.tier >= c.highestTier && c.highestTier < T.max) { c.highestTier = run.tier + 1; lines.push(`Tier ${c.highestTier} unlocked!`); }
      const key = String(run.tier);
      if (completeInfo.inTime && (!c.bestTimes[key] || completeInfo.time < c.bestTimes[key])) c.bestTimes[key] = completeInfo.time;
      if (run.tier >= T.ancestralFrom) c.pityAnc = gotAncestral ? 0 : c.pityAnc + 1;
      if (run.tier >= T.primalFrom) c.pityPri = gotPrimal ? 0 : c.pityPri + 1;
      if (run.weekly) {
        const wk = isoWeek();
        if (profile.weekly.week !== wk) profile.weekly = { week: wk, best: 0 };
        if (completeInfo.inTime && (!profile.weekly.best || completeInfo.time < profile.weekly.best)) { profile.weekly.best = completeInfo.time; lines.push("New weekly best!"); }
      }
    }
    saveProfile(profile);
    const title = run.kind === "chase" ? "The Ossuary King falls" : completeInfo.inTime ? "Rift cleared in time!" : "Guardian slain";
    const sub = completeInfo.inTime ? "Bonus loot for time remaining." : "The timer ran out, so the rewards were smaller.";
    finishOnline();
    screen = "results";
    ui.showResults({ title, sub, time: completeInfo.time, kills: s.rift.kills, found, legendaries: foundLegs, lines }, goHub);
  } else { saveProfile(profile); finishOnline(); goHub(); }
  sim = null; run = null; mode = "hub";
}

/** Live build: hand in this run's results to the server, and tell the party the run is over. */
function finishOnline() {
  if (!online || !run) return;
  if (online.direct) {
    // direct co-op: everyone already saved their own progress locally in endRun
    if (coop?.role === "host") { for (const pid of coop.live) online.sendR(pid, { t: "end" }); online.setRunning(false); }
    else if (coop?.role === "guest" && !hostEnded && online.lobby) online.leave();
    hostEnded = false; coop = null;
    return;
  }
  const c = char(profile);
  const have = new Set([...Object.values(c.equipment).map((it) => it!.id), ...c.bag.map((it) => it.id)]);
  const scrapped = [...new Set([...scrappedIds, ...[...runIds].filter((id) => !have.has(id))])];
  if (coop?.role === "host") {
    online.send({ t: "complete", inTime: completeInfo?.inTime, time: completeInfo?.time });
    for (const pid of coop.live) online.sendR(pid, { t: "end" });
  }
  online.send({ t: "save", report: { equipment: c.equipment, bag: c.bag, scrapped, materials: profile.materials, level: c.level, xp: c.xp, sigils: c.sigils, uses: c.uses, highestTier: c.highestTier, pityAnc: c.pityAnc, pityPri: c.pityPri, bestTimes: c.bestTimes, riftsCleared: c.riftsCleared }, week: isoWeek(), weeklyBest: run.weekly });
  if (coop?.role === "host") online.send({ t: "runEnd" });
  else if (coop?.role === "guest" && !hostEnded && online.lobby) online.leave(); // a guest who leaves on their own leaves the party
  hostEnded = false;
  coop = null;
}

function hubOp(op: HubOp) {
  const r = applyHubOp(profile, op);
  if (r && typeof r === "object") profile = r;
  if (op.t === "setting" && op.k === "mute") setMuted(profile.settings.mute);
  saveProfile(profile);
  if (online && !online.direct) online.op(op);
  else if (online?.direct) online.pushSetup();
}
function goHub() {
  mode = "hub"; screen = "hub";
  const apply = (window as any).__applyPendingRemote; if (apply) { (window as any).__applyPendingRemote = null; setTimeout(apply, 0); }
  ui.showHub(profile, {
    enter: startRun,
    invCmd: (cmd) => hubOp({ t: "inv", cmd }),
    setClass: (cls) => hubOp({ t: "setClass", cls }),
    setRune: (skill, rune) => hubOp({ t: "setRune", skill, rune }),
    setSkill: (slot, skill) => hubOp({ t: "setSkill", slot, skill }),
    reroll: (target, idx, choice) => hubOp({ t: "reroll", target, idx, choice }),
    setting: (k, v) => hubOp({ t: "setting", k, v }),
    op: hubOp,
    newSeason: () => { hubOp({ t: "newSeason" }); goHub(); },
    reset: () => { hubOp({ t: "reset" }); goHub(); },
    rerollOptions: online && !online.direct ? (target, idx) => (online as Online).rerollOptions(target, idx) : undefined,
    coop: !online ? undefined : online.direct
      ? { name: online.name, lobby: online.lobby, direct: true, connecting: online.connecting, host: () => (online as Direct).host(), join: (code) => (online as Direct).join(code), leave: () => online!.leave(), setName: (n: string) => { (online as Direct).setName(n); goHub(); } }
      : { name: online.name, lobby: online.lobby, host: () => online!.host(), join: (code) => online!.join(code), leave: () => online!.leave(), signOut: () => { signOut(); location.reload(); } },
  });
}

input.onKey = (k) => {
  unlockAudio();
  if (mode !== "rift") return;
  if (k === "i" || k === "tab" || k === "b") { if (ui.invOpen) { ui.hide(); resume(); } else openRiftInventory(); }
  if (k === "m") { profile.settings.mute = !profile.settings.mute; setMuted(profile.settings.mute); saveProfile(profile); }
  if (k === "escape" && ui.invOpen) { ui.hide(); resume(); }
  if (k === "enter" && completeInfo) endRun();
};
addEventListener("pointerdown", () => unlockAudio());
addEventListener("touchend", () => unlockAudio());
document.addEventListener("visibilitychange", () => { if (document.hidden && sim) { syncFromSim(profile, sim, ME); if (!ui.invOpen && !completeInfo) openRiftInventory(); } });

// ------------------------------------------------------------------ events -> feel
function showBanner(text: string, sub: string, color: string, t = 2.2) { banner = { text, sub, color, t }; }
function addShake(v: number) { if (profile.settings.shake) shake = Math.max(shake, v); }
function burst(x: number, y: number, n: number, color: string | string[], speed = 60, size = 1, life = 0.4, grav = 0) {
  for (let i = 0; i < n && particles.length < 350; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    const c = Array.isArray(color) ? color[(Math.random() * color.length) | 0] : color;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.6 + Math.random() * 0.6), max: life, color: c, size, grav });
  }
}
const BLOOD: Record<string, string[]> = {
  ghoul: ["#6f8f5a", "#4a6640", "#9bc27a"], archer: ["#f2ead3", "#c9bf9f"], brute: ["#9a7aa8", "#6b4f7a", "#4a3456"], guardian: ["#f2ead3", "#ffd23f", "#2b1f3a"],
  king: ["#f2ead3", "#ff3b6b", "#2b1f3a"], pylon: ["#f2ead3", "#ffd23f"],
};
const SKILL_COLOR = (tags: string[]) => (tags.includes("cold") && !tags.includes("fire") ? "#9be0ff" : tags.includes("fire") ? "#ff8a1f" : "#e8e0ff");

function handleEvent(e: SimEvent) {
  const mine = (pid: number) => pid === ME;
  switch (e.type) {
    case "hit": {
      if (nums.length < 70 && (mine(e.pid) || e.crit)) nums.push({ x: e.x + (Math.random() * 6 - 3), y: e.y, text: String(e.amount), color: e.burn ? "#ff9a3c" : e.crit ? "#ffe14a" : "#ffffff", size: e.crit ? 1.5 : e.burn ? 0.8 : 1, t: 0, vx: (Math.random() - 0.5) * 20 });
      burst(e.x, e.y + 4, e.crit ? 5 : 2, BLOOD[e.kind] ?? BLOOD.ghoul, 70, 1, 0.35, 120);
      if (!e.burn) sfx.hit(e.crit);
      if (e.crit && mine(e.pid)) { hitstop = Math.max(hitstop, 0.025); addShake(1.5); }
      break;
    }
    case "immune": if (nums.length < 70) nums.push({ x: e.x, y: e.y, text: "IMMUNE", color: "#9be0ff", size: 0.8, t: 0, vx: 0 }); break;
    case "kill":
      burst(e.x, e.y, e.kind === "brute" || e.elite ? 26 : e.kind === "guardian" || e.kind === "king" ? 80 : 12, BLOOD[e.kind] ?? BLOOD.ghoul, e.kind === "guardian" || e.kind === "king" ? 160 : 90, e.kind === "ghoul" ? 1 : 2, 0.6, 150);
      if (e.kind === "guardian" || e.kind === "king") { hitstop = 0.4; addShake(12); flash = 0.5; flashColor = "#fff"; sfx.bigKill(); }
      else if (e.kind === "brute" || e.elite) { hitstop = Math.max(hitstop, 0.07); addShake(5); sfx.bigKill(); }
      else sfx.kill();
      break;
    case "swing":
      arcs.push({ x: e.x, y: e.y, fx: e.fx, fy: e.fy, r: e.range, ring: e.ring, t: 0, arcCos: e.arcCos });
      sfx.swing();
      if (e.hits > 0 && mine(e.pid)) { addShake(e.ring ? 3 : 1); hitstop = Math.max(hitstop, e.ring ? 0.05 : 0.018); }
      break;
    case "cast": {
      const sk = SKILL[e.skill];
      if (!sk) break;
      if (sk.kind === "projectile") sfx.lance();
      if (sk.kind === "dash") sfx.dash();
      if (sk.kind === "summon") { sfx.summon(); burst(e.x, e.y, 20, ["#ff8a1f", "#ffd23f"], 80, 1, 0.5); }
      if (sk.kind === "shout") { sfx.shout(); rings.push({ x: e.x, y: e.y, r: e.r ?? 100, t: 0, max: 0.5, color: e.skill === "rally_banner" ? "#7dff9a" : "#ffd23f" }); addShake(2); }
      if (sk.kind === "nova") { sfx.explosion(); const p = sim?.players.find((q) => q.pid === e.pid); const col = p ? SKILL_COLOR(p.sk[e.skill].tags) : "#ff8a1f"; rings.push({ x: e.x, y: e.y, r: e.r ?? 56, t: 0, max: 0.3, color: col, fill: true }); burst(e.x, e.y, 24, [col, "#fff"], 160, 1, 0.4); addShake(2.5); }
      if (sk.kind === "trap") { sfx.ui(); rings.push({ x: e.x, y: e.y, r: e.r ?? 30, t: 0, max: 0.25, color: "#9be0ff" }); }
      break;
    }
    case "playerHurt":
      if (!mine(e.pid)) break;
      addShake(3); hurtFlash = 0.35; sfx.hurt();
      if (sim && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 14, text: "-" + e.amount, color: "#ff4a4a", size: 1, t: 0, vx: 0 }); }
      break;
    case "playerDeath": if (mine(e.pid)) { sfx.death(); showBanner("You fell", "Respawning…", "#ff4a4a", 3); } break;
    case "cheatDeath": if (mine(e.pid)) { showBanner("THE LAST EMBER", "Death refused", "#ff3b6b", 2); flash = 0.4; flashColor = "#ff3b6b"; } break;
    case "slam": rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.35, color: e.big ? "#ffd23f" : "#ff6a6a" }); addShake(e.big ? 6 : 3); sfx.slam(); burst(e.x, e.y, 12, ["#5c4a6e", "#8a7f66"], 90, 1, 0.5); break;
    case "explosion": rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.3, color: e.cold ? "#9be0ff" : "#ff8a1f" }); burst(e.x, e.y, 16, e.cold ? ["#9be0ff", "#fff"] : ["#ff8a1f", "#ffd23f", "#ff5a1f"], 110, 1, 0.45); addShake(2.5); sfx.explosion(); break;
    case "teleport": burst(e.x, e.y, 14, ["#c9a0ff", "#fff"], 70, 1, 0.4); break;
    case "chain": if (bolts.length < 40) bolts.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, t: 0 }); break;
    case "drop":
      if (!mine(e.owner)) break;
      sfx.drop(e.rarity);
      if (e.quality) { gotAncestral ||= e.quality === "ancestral" || e.quality === "primal"; gotPrimal ||= e.quality === "primal"; }
      if (e.rarity === "legendary" || e.rarity === "set" || e.rarity === "mythic") {
        addShake(5); flash = 0.35; flashColor = RARITY_COLOR[e.rarity];
        showBanner(e.quality === "primal" ? "PRIMAL!" : e.rarity === "mythic" ? "MYTHIC!" : e.quality === "ancestral" ? "ANCESTRAL!" : e.rarity === "set" ? "SET ITEM!" : "LEGENDARY!", e.name, RARITY_COLOR[e.rarity], 2.4);
        burst(e.x, e.y, 40, [RARITY_COLOR[e.rarity], "#ffd23f", "#fff"], 140, 2, 0.9);
      } else if (e.rarity === "rare") burst(e.x, e.y, 14, ["#ffd84a", "#fff"], 80, 1, 0.6);
      break;
    case "pickup":
      if (!mine(e.pid)) break;
      sfx.pickup(); found[e.rarity] = (found[e.rarity] ?? 0) + 1; runIds.add(e.item.id);
      if (e.rarity === "legendary" || e.rarity === "set" || e.rarity === "mythic") foundLegs.push({ name: e.name, rarity: e.rarity, quality: e.item.quality });
      if (e.rarity !== "common" && e.rarity !== "magic") ui.toast(`Picked up ${e.name} · Bag to equip`, RARITY_COLOR[e.rarity]);
      syncFromSim(profile, sim!, ME);
      break;
    case "scrapped": if (mine(e.pid)) scrappedIds.push(e.id); if (mine(e.pid) && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 18, text: `+${e.mats} mat`, color: "#b8a8d0", size: 0.7, t: 0, vx: 0 }); } break;
    case "bagFull": if (mine(e.pid)) ui.toast("Bag full! Open the Bag and scrap something.", "#ff6a6a"); break;
    case "ambush": ui.toast("Ambush! Enemies close in", "#ff8a5a", 1600); addShake(3); break;
    case "guardianSpawn": showBanner(e.kind === "king" ? "THE OSSUARY KING" : "THE HOLLOW WARDEN", "rises from the bone pit", "#ffd23f", 3); addShake(8); sfx.guardian(); burst(e.x, e.y, 60, ["#2b1f3a", "#ffd23f", "#f2ead3"], 140, 2, 0.9); break;
    case "enrage": showBanner("ENRAGED", "Faster and deadlier", "#ff4a4a", 2); sfx.guardian(); break;
    case "guardianStun": showBanner("STUNNED", "", "#9be0ff", 1); break;
    case "phase": showBanner(`PHASE ${Math.min(3, e.n)}`, e.text, "#ff3b6b", 3); sfx.guardian(); addShake(6); break;
    case "timeUp": showBanner("TIME'S UP", "Finish for reduced rewards", "#ff7a3c", 2.5); break;
    case "levelUp":
      if (!mine(e.pid)) break;
      sfx.complete(); burst(me().x, me().y - 8, 40, ["#ffd23f", "#fff", "#7dff9a"], 120, 1, 0.8);
      { const unlocked = CLASSES[me().cls].skills.map((id) => SKILL[id]).filter((d) => d.unlock === e.level); showBanner(`LEVEL ${e.level}`, unlocked.length ? `New skill: ${unlocked.map((d) => d.name).join(", ")}` : "Stronger", "#7dff9a", 2.5); }
      syncFromSim(profile, sim!, ME);
      break;
    case "boonOffer":
      // no pop-up mid-fight: a button appears, and the player opens it when it's safe
      if (!mine(e.pid) || !sim) break;
      showBanner("BOON READY", "Tap ★ Boon (top right) when it's safe", "#ffd23f", 2);
      if (!ui.invOpen && !paused) riftButtons();
      break;
    case "sigil": if (mine(e.pid)) { gotSigil++; showBanner("BONE SIGIL", "Opens the Throne of the Ossuary King", "#ff3b6b", 2.5); } break;
    case "riftComplete":
      completeInfo = { inTime: e.inTime, time: e.time };
      sfx.complete();
      showBanner(run?.kind === "chase" ? "KING SLAIN" : e.inTime ? "RIFT CLEARED" : "GUARDIAN SLAIN", `${fmtTime(e.time)} · grab your loot, then Finish`, "#7dff9a", 4);
      riftButtons();
      syncFromSim(profile, sim!, ME);
      break;
    case "equipChanged": break;
  }
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === "rift" && sim && coop && !canFreeze()) {
    coopFrame(dt);
    updateFx(dt);
    if (sim) render(Math.min(1, acc / DT), dt);
  } else if (mode === "rift" && sim) {
    if (hitstop > 0) hitstop -= dt; // solo only: freezes the sim; co-op uses a render-only freeze
    else if (!paused) acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 4 && !paused) {
      const p = me();
      const inp: PlayerInput = input.read(sim, p, toWorld);
      if (coop) hostStep(inp);
      else { step(sim, { [ME]: inp }); afterStep(); }
      acc -= DT; steps++;
      if (hitstop > 0) { acc = 0; break; }
    }
    if (steps === 4) acc = 0;
    updateFx(dt);
    if (sim) render(Math.min(1, acc / DT), dt);
  } else {
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
  for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].t += dt; if (bolts[i].t > 0.14) bolts.splice(i, 1); }
  shake = Math.max(0, shake - dt * 25);
  flash = Math.max(0, flash - dt);
  hurtFlash = Math.max(0, hurtFlash - dt);
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  if (sim) for (const p of sim.players) {
    if (!p.pet || p.pet === "none") continue;
    let pt = pets.get(p.pid);
    if (!pt) { pt = { x: p.x, y: p.y, flip: false }; pets.set(p.pid, pt); }
    const tx = p.x - p.fx * 14 - 6, ty = p.y - 4;
    const d = Math.hypot(tx - pt.x, ty - pt.y);
    if (d > 2) { const k = Math.min(1, dt * (d > 60 ? 8 : 4)); pt.flip = tx < pt.x; pt.x += (tx - pt.x) * k; pt.y += (ty - pt.y) * k; }
  }
}

// ------------------------------------------------------------------ render
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
let vignette: HTMLCanvasElement | null = null, vignetteDark = false;
const heroFrames = (cls: string) => (cls === "gloomstalker" ? bank.ranger : cls === "stormcaller" ? bank.mage : bank.hero);

function render(alpha: number, dt: number) {
  const s = sim!;
  const p = me();
  const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
  const W = wb.width, H = wb.height;
  const k = Math.min(1, dt * 12);
  camX += (px - W / 2 - camX) * k; camY += (py - H / 2 - camY) * k;
  const sx = Math.round(camX + (Math.random() - 0.5) * shake * 2), sy = Math.round(camY + (Math.random() - 0.5) * shake * 2);
  const g = wctx;
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0e0a14"; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(-sx, -sy);
  g.drawImage(mapCanvas!, sx, sy, W, H, sx, sy, W, H);
  const t = performance.now() / 1000;
  const onScreen = (x: number, y: number, m = 40) => x > sx - m && x < sx + W + m && y > sy - m && y < sy + H + m;

  for (const h of s.hazards) {
    if (!onScreen(h.x, h.y)) continue;
    const a = Math.min(1, h.life / 0.6);
    const frost = h.kind === "frost";
    g.globalAlpha = (h.max > 3 ? 0.35 : 0.5) * a;
    g.fillStyle = frost ? ((Math.floor(t * 6 + h.id) % 2) ? "#9be0ff" : "#5fb0e0") : ((Math.floor(t * 12 + h.id) % 2) ? "#ff5a1f" : "#ff8a1f");
    g.beginPath(); g.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); g.fill();
    if (h.max > 3) { g.globalAlpha = 0.8 * a; g.strokeStyle = frost ? "#d8f4ff" : "#ffd23f"; g.beginPath(); g.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
    if (Math.random() < 0.06) particles.push({ x: h.x + (Math.random() - 0.5) * h.r, y: h.y, vx: 0, vy: -20, life: 0.4, max: 0.4, color: frost ? "#fff" : "#ffd23f", size: 1, grav: 0 });
  }
  for (const z of s.zones) {
    if (!onScreen(z.x, z.y)) continue;
    if (z.kind === "pool") { g.globalAlpha = 0.55; g.fillStyle = (Math.floor(t * 10 + z.id) % 2) ? "#c2361f" : "#e0521f"; g.beginPath(); g.ellipse(z.x, z.y, z.r, z.r * 0.6, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    else telegraphCircle(g, z.x, z.y, z.r, 1 - z.delay / 1.4);
  }
  for (const e of s.enemies) {
    if (e.dead || !onScreen(e.x, e.y, 80)) continue;
    const def = ENEMIES[e.kind];
    if (e.kind === "brute" && e.state === "windup") telegraphCircle(g, e.tx, e.ty, def.slamRadius! * e.scale, 1 - e.t / def.windup);
    if (e.kind === "guardian" || e.kind === "king") {
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
      const tg = s.players.find((q) => q.pid === e.target);
      if (tg) { g.strokeStyle = "rgba(255,60,60,0.5)"; g.beginPath(); g.moveTo(e.x, e.y); g.lineTo(tg.x, tg.y); g.stroke(); }
    }
  }
  // loot (only yours; per-player drops)
  for (const l of s.loot) {
    if (l.owner !== ME || !onScreen(l.x, l.y, 100)) continue;
    const r = l.item.rarity;
    const col = RARITY_COLOR[r];
    const hidden = RARITY_ORDER_IDX(r) < RARITY_ORDER_IDX(profile.filter);
    const bob = Math.sin(t * 4 + l.id) * 1.5;
    const big = r === "legendary" || r === "set" || r === "mythic";
    const hgt = hidden ? 0 : big ? 90 : r === "rare" ? 40 : r === "magic" ? 22 : 0;
    if (hgt) {
      const wdt = big ? 6 + Math.sin(t * 8) : 3;
      const gr = g.createLinearGradient(0, l.y - hgt, 0, l.y);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, l.item.quality === "primal" ? "#ff3b3b" : col);
      g.globalAlpha = 0.65; g.fillStyle = gr; g.fillRect(Math.round(l.x - wdt / 2), l.y - hgt, wdt, hgt); g.globalAlpha = 1;
    }
    const ic = bank.icon(l.item.slot, r);
    g.globalAlpha = hidden ? 0.35 : 1;
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(l.x - 4, l.y + 3, 8, 2);
    g.drawImage(ic.img, Math.round(l.x - ic.w / 2), Math.round(l.y - ic.h + 2 + bob));
    g.globalAlpha = 1;
  }
  for (const b of bolts) {
    g.strokeStyle = (Math.floor(b.t * 60) % 2) ? "#ffffff" : "#9be0ff"; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, b.y1);
    for (let i = 1; i < 5; i++) { const k = i / 5; g.lineTo(b.x1 + (b.x2 - b.x1) * k + (Math.random() - 0.5) * 8, b.y1 + (b.y2 - b.y1) * k + (Math.random() - 0.5) * 8); }
    g.lineTo(b.x2, b.y2); g.stroke();
  }
  for (const gh of ghosts) { g.globalAlpha = 0.4 * (1 - gh.t / 0.25); drawSprite(g, heroFrames(gh.cls)[1], gh.x, gh.y, gh.flip, true); }
  g.globalAlpha = 1;
  type D = { y: number; f: () => void };
  const list: D[] = [];
  for (const e of s.enemies) {
    if (e.dead || !onScreen(e.x, e.y, 60)) continue;
    const ex = lerp(e.px, e.x, alpha), ey = lerp(e.py, e.y, alpha);
    list.push({ y: ey, f: () => drawEnemy(g, e, ex, ey, t) });
  }
  for (const m of s.summons) {
    if (!onScreen(m.x, m.y)) continue;
    const mx = lerp(m.px, m.x, alpha), my = lerp(m.py, m.y, alpha);
    list.push({ y: my, f: () => {
      const frames = m.kind === "raven" ? bank.raven : bank.imp;
      const fr = frames[Math.floor(t * 8 + m.id) % 2];
      const yy = m.kind === "raven" ? my - 8 + Math.sin(t * 6 + m.id) * 2 : my;
      shadow(g, mx, my, 3 * m.size);
      g.globalAlpha = m.life < 1.5 && Math.floor(t * 10) % 2 ? 0.5 : 1;
      drawSprite(g, fr, mx, yy, m.fx < 0, false, m.size);
      g.globalAlpha = 1;
    } });
  }
  for (const q of s.players) {
    if (q.dead) continue;
    const qx = lerp(q.px, q.x, alpha), qy = lerp(q.py, q.y, alpha);
    list.push({ y: qy, f: () => drawHero(g, q, qx, qy, t) });
    const pt = pets.get(q.pid);
    if (pt && bank.pets[q.pet]) list.push({ y: pt.y, f: () => drawPet(g, q, pt, t) });
  }
  list.sort((a, b) => a.y - b.y);
  for (const d of list) d.f();
  for (const pr of s.projectiles) {
    if (!onScreen(pr.x, pr.y)) continue;
    const x = lerp(pr.px, pr.x, alpha), y = lerp(pr.py, pr.y, alpha);
    const [nx, ny] = norm2(pr.vx, pr.vy);
    if (pr.kind === "lance" || pr.kind === "bolt") {
      const col = pr.returning ? "#7fd8ff" : pr.cold && !pr.fire ? "#9be0ff" : pr.fire ? "#ff5a1f" : "#d8d0f0";
      const L = pr.kind === "lance" ? 12 : 7;
      g.strokeStyle = col; g.lineWidth = pr.kind === "lance" ? Math.max(3, pr.r * 0.6) : 2;
      g.beginPath(); g.moveTo(x - nx * L, y - ny * L); g.lineTo(x + nx * 3, y + ny * 3); g.stroke();
      g.strokeStyle = "#fff8e0"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - nx * (L - 3), y - ny * (L - 3)); g.lineTo(x + nx * 4, y + ny * 4); g.stroke();
      if (pr.kind === "lance" && Math.random() < 0.5) particles.push({ x, y, vx: -nx * 20 + (Math.random() - 0.5) * 20, vy: -ny * 20 + (Math.random() - 0.5) * 20, life: 0.3, max: 0.3, color: col, size: 1, grav: 0 });
    } else if (pr.kind === "wave") {
      g.strokeStyle = "#ff8a1f"; g.lineWidth = 3; g.globalAlpha = Math.min(1, pr.life * 3);
      const a = Math.atan2(ny, nx);
      g.beginPath(); g.arc(x - nx * 6, y - ny * 6, 10, a - 1, a + 1); g.stroke();
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
  for (const a of arcs) {
    const k2 = a.t / 0.13;
    g.globalAlpha = 1 - k2;
    g.strokeStyle = a.ring ? "#ffd23f" : "#ffffff"; g.lineWidth = 3;
    const ang = Math.atan2(a.fy, a.fx), half = Math.acos(Math.max(-1, Math.min(1, a.arcCos)));
    g.beginPath();
    if (a.ring) g.arc(a.x, a.y, a.r * (0.6 + 0.4 * k2), 0, Math.PI * 2);
    else g.arc(a.x, a.y, a.r * (0.7 + 0.3 * k2), ang - half + k2 * 0.3, ang + half + k2 * 0.3);
    g.stroke();
    g.globalAlpha = 1; g.lineWidth = 1;
  }
  for (const r of rings) {
    const k2 = r.t / r.max;
    g.globalAlpha = 1 - k2; g.strokeStyle = r.color; g.lineWidth = 2;
    g.beginPath(); g.arc(r.x, r.y, r.r * (0.4 + 0.6 * k2), 0, Math.PI * 2); g.stroke();
    if (r.fill) { g.globalAlpha = 0.25 * (1 - k2); g.fillStyle = r.color; g.fill(); }
    g.globalAlpha = 1; g.lineWidth = 1;
  }
  for (const pa of particles) {
    g.globalAlpha = Math.min(1, (pa.life / pa.max) * 1.5);
    g.fillStyle = pa.color; g.fillRect(Math.round(pa.x), Math.round(pa.y), pa.size, pa.size);
  }
  g.globalAlpha = 1;
  g.restore();
  const dark = s.rift.mods.includes("gloom");
  if (!vignette || vignette.width !== W || vignette.height !== H || vignetteDark !== dark) {
    vignette = document.createElement("canvas"); vignette.width = W; vignette.height = H; vignetteDark = dark;
    const v = vignette.getContext("2d")!;
    const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (dark ? 0.12 : 0.25), W / 2, H / 2, Math.max(W, H) * (dark ? 0.45 : 0.7));
    gr.addColorStop(0, "rgba(5,2,10,0)"); gr.addColorStop(1, `rgba(5,2,10,${dark ? 0.95 : 0.75})`);
    v.fillStyle = gr; v.fillRect(0, 0, W, H);
  }
  g.drawImage(vignette, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wb, 0, 0, W * pix, H * pix);
  drawHud(s, sx, sy, t);
}
const RARITY_IDX: Record<string, number> = { common: 0, magic: 1, rare: 2, legendary: 3, set: 4, mythic: 5 };
const RARITY_ORDER_IDX = (r: string) => RARITY_IDX[r] ?? 0;

function norm2(x: number, y: number): [number, number] { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; }
function shadow(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  g.fillStyle = "rgba(0,0,0,0.4)"; g.beginPath(); g.ellipse(Math.round(x), Math.round(y) + 1, r + 1, r * 0.5, 0, 0, Math.PI * 2); g.fill();
}
function drawSprite(g: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, flip: boolean, white: boolean, scale = 1) {
  const img = white ? sp.flash : sp.img;
  const w = sp.w * scale, h = sp.h * scale;
  const dx = Math.round(x - w / 2), dy = Math.round(y - h + 2);
  if (flip) { g.save(); g.translate(dx + w, dy); g.scale(-1, 1); g.drawImage(img, 0, 0, w, h); g.restore(); }
  else g.drawImage(img, dx, dy, w, h);
}
function telegraphCircle(g: CanvasRenderingContext2D, x: number, y: number, r: number, k: number) {
  g.fillStyle = "rgba(255,40,40,0.18)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,60,60,0.35)"; g.beginPath(); g.arc(x, y, r * Math.max(0, Math.min(1, k)), 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,90,90,0.8)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}

function drawEnemy(g: CanvasRenderingContext2D, e: Enemy, x: number, y: number, t: number) {
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
  const frames = e.kind === "ghoul" ? bank.ghoul : e.kind === "archer" ? bank.archer : e.kind === "brute" ? bank.brute : e.kind === "pylon" ? bank.pylon : bank.guardian;
  const fr = frames[moving ? Math.floor(t * 8 + e.id) % frames.length : 0];
  const tgt = sim!.players.find((q) => q.pid === e.target);
  const flip = tgt ? tgt.x < e.x : false;
  const scale = e.kind === "king" ? 1.4 : e.scale;
  shadow(g, x, y, e.r);
  let yy = y;
  if (["windup", "slam", "nova", "chargeWind", "fire"].includes(e.state)) yy -= Math.floor(t * 20) % 2;
  if (e.kind === "guardian" || e.kind === "king") yy += Math.sin(t * 2) * 1.5 - 2;
  if ((e.kind === "guardian" || e.kind === "king") && e.state === "intro") g.globalAlpha = 1 - Math.max(0, e.t / 2) * 0.7;
  if (e.elite) {
    g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 6);
    g.fillStyle = e.affixes.includes("molten") ? "#ff5a1f" : e.affixes.includes("shielded") ? "#9be0ff" : "#c9a0ff";
    g.beginPath(); g.ellipse(x, y, e.r + 4, (e.r + 4) * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  if (e.state === "stun" || e.state === "tomb") { g.fillStyle = e.state === "tomb" ? "#ffd23f" : "#9be0ff"; for (let i = 0; i < 3; i++) g.fillRect(Math.round(x + Math.cos(t * 6 + i * 2) * 12), Math.round(yy - fr.h * scale - 2 + Math.sin(t * 6 + i * 2) * 2), 2, 2); }
  drawSprite(g, fr, x, yy, flip, e.flash > 0, scale);
  if (e.kind === "king") { g.globalAlpha = 0.25; g.fillStyle = "#ff3b6b"; g.fillRect(Math.round(x - fr.w * scale / 2), Math.round(yy - fr.h * scale + 2), Math.round(fr.w * scale), Math.round(fr.h * scale)); }
  if (e.enraged || e.state === "tomb") { g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 12); drawSprite(g, fr, x, yy, flip, true, scale); }
  if (e.slowT > 0) { g.globalAlpha = 0.3; g.fillStyle = "#9be0ff"; g.fillRect(Math.round(x - e.r), Math.round(yy - fr.h * scale + 2), e.r * 2, Math.round(fr.h * scale)); }
  g.globalAlpha = 1;
  if (e.shieldT > 0) { g.strokeStyle = "#9be0ff"; g.globalAlpha = 0.7; g.beginPath(); g.arc(x, yy - fr.h * scale / 2, e.r + 5, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
  if (e.burnT > 0 && Math.random() < 0.3) particles.push({ x: x + (Math.random() - 0.5) * e.r * 2, y: yy - Math.random() * fr.h, vx: 0, vy: -25, life: 0.35, max: 0.35, color: Math.random() < 0.5 ? "#ff8a1f" : "#ffd23f", size: 1, grav: 0 });
  if ((e.hp < e.maxHp || e.elite) && e.kind !== "guardian" && e.kind !== "king") {
    const w = e.r * 2 + 2;
    g.fillStyle = "#140c1c"; g.fillRect(Math.round(x - w / 2) - 1, Math.round(yy - fr.h * scale - 3), w + 2, 3);
    g.fillStyle = e.elite ? "#c9a0ff" : "#d93a3a"; g.fillRect(Math.round(x - w / 2), Math.round(yy - fr.h * scale - 2), Math.max(1, Math.round((w * e.hp) / e.maxHp)), 1);
  }
}

const emitFx: Emit = (x, y, vx, vy, life, color) => { if (particles.length < 600) particles.push({ x, y, vx, vy, life, max: life, color, size: 1, grav: 0 }); };
function drawHero(g: CanvasRenderingContext2D, p: Player, x: number, y: number, t: number) {
  shadow(g, x, y, 5);
  if (p.buff.t > 0) { g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 8); g.strokeStyle = p.buff.armorPct ? "#ffd23f" : "#7dff9a"; g.beginPath(); g.ellipse(x, y, 9, 4, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
  if (p.invuln > 0 && p.dashT <= 0 && Math.floor(t * 15) % 2 === 0) g.globalAlpha = 0.5;
  const swingK = p.cls === "ashknight" ? Math.max(0, p.swingT / (p.sk.cleave?.p.interval || 0.38)) : 0;
  const fr = drawHeroCos(g, bank, { pid: p.pid, cls: p.cls, cos: p.cos ?? {}, fx: p.fx, fy: p.fy, moving: p.moving, walk: p.walk, swingK }, x, y, t, emitFx);
  if (p.pid === ME && hurtFlash > 0.2) { g.globalAlpha = 0.6; drawSprite(g, fr, x, y, p.fx < 0, true); }
  g.globalAlpha = 1;
}

function drawPet(g: CanvasRenderingContext2D, q: Player, pt: { x: number; y: number; flip: boolean }, t: number) {
  shadow(g, pt.x, pt.y, 3);
  drawPetCos(g, bank, q.pet, q.cos?.petSkin, pt.x, pt.y, pt.flip, t, emitFx);
}

// ------------------------------------------------------------------ HUD
const SHORT: Record<string, string> = { cleave: "Cleave", ember_lance: "Lance", ash_dash: "Dash", warcry: "Warcry", flame_nova: "Nova", cinderlings: "Imps", hex_bolt: "Bolt", volley: "Volley", tumble: "Tumble", frost_snare: "Snare", rally_banner: "Banner", raven_swarm: "Ravens",
  spark: "Spark", magic_missile: "Missile", static_touch: "Touch", chain_lightning: "Chain", arcane_orb: "Orb", thunderstorm: "Storm", disintegrate: "Beam", blink: "Blink", mana_shield: "Shield", static_field: "Field", storm_avatar: "Avatar", black_hole: "Hole", arcane_torrent: "Torrent",
  searing_strike: "Sear", shield_bash: "Bash", whirling_ash: "Whirl", molten_hammer: "Hammer", iron_skin: "Iron", chain_hook: "Hook", phoenix_form: "Phoenix", inferno_pillar: "Inferno", bone_shot: "Bone", shadow_knives: "Knives", hex_rain: "Rain", soulpiercer: "Pierce", smoke_veil: "Smoke", night_hunt: "Hunt", banshee_wail: "Wail" };
function drawHud(s: SimState, sx: number, sy: number, t: number) {
  const c = ctx, S = dpr;
  c.save();
  c.scale(S, S);
  const W = cssW, H = cssH, ins = input.insets;
  const L = 10 + ins.left, T = 10 + ins.top;
  const font = (px: number) => `${px}px "GameFont", ui-monospace, monospace`;
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
  c.font = font(11);
  for (const l of s.loot) {
    if (l.owner !== ME || l.item.rarity === "common" || RARITY_ORDER_IDX(l.item.rarity) < RARITY_ORDER_IDX(profile.filter)) continue;
    const px = ((l.x - sx) * pix) / S, py = ((l.y - sy - 14) * pix) / S;
    if (px < -50 || px > W + 50 || py < -20 || py > H + 20) continue;
    const name = (l.item.quality ? l.item.quality[0].toUpperCase() + l.item.quality.slice(1) + " " : "") + l.item.name;
    c.lineWidth = 3; c.strokeStyle = "#000"; c.strokeText(name, px, py);
    c.fillStyle = RARITY_COLOR[l.item.rarity]; c.fillText(name, px, py);
  }
  // elite names
  c.font = font(10);
  for (const e of s.enemies) {
    if (e.dead || !e.elite) continue;
    const px = ((e.x - sx) * pix) / S, py = ((e.y - sy - e.r * 2 - 14) * pix) / S;
    if (px < -50 || px > W + 50 || py < -20 || py > H + 20) continue;
    const txt = e.affixes.map((a) => a[0].toUpperCase() + a.slice(1)).join(" · ");
    c.lineWidth = 3; c.strokeStyle = "#000"; c.strokeText(txt, px, py); c.fillStyle = "#c9a0ff"; c.fillText(txt, px, py);
  }
  const p = me();
  c.textAlign = "left";
  const lw = Math.min(170, W * 0.36);
  panel(c, L, T, lw + 12, 56);
  c.fillStyle = "#3a1018"; c.fillRect(L + 6, T + 6, lw, 16);
  c.fillStyle = p.hp / p.stats.maxHp < 0.3 && Math.floor(t * 4) % 2 ? "#ff6a6a" : "#d93a3a";
  c.fillRect(L + 6, T + 6, lw * Math.max(0, p.hp / p.stats.maxHp), 16);
  c.fillStyle = "#fff"; c.font = font(12); c.fillText(`${Math.ceil(p.hp)} / ${p.stats.maxHp}`, L + 12, T + 15);
  const R = CLASSES[p.cls].resource;
  c.fillStyle = "#1b1424"; c.fillRect(L + 6, T + 25, lw, 8);
  c.fillStyle = R.color; c.fillRect(L + 6, T + 25, lw * Math.max(0, p.res / R.max), 8);
  c.fillStyle = "#fff"; c.font = font(9); c.fillText(`${R.name} ${Math.floor(p.res)}`, L + 9, T + 29.5);
  c.fillStyle = "#1b1424"; c.fillRect(L + 6, T + 36, lw, 3);
  c.fillStyle = "#c9b8ff"; c.fillRect(L + 6, T + 36, lw * (p.level >= RIFT.levels.max ? 1 : p.xp / xpForLevel(p.level)), 3);
  c.fillStyle = "#b8a8d0"; c.font = font(10); { let lv = `Lv ${p.level}${p.boons.length ? " · " + p.boons.join(", ") : ""}`; while (lv.length > 4 && c.measureText(lv).width > lw) lv = lv.slice(0, -2) + "…"; c.fillText(lv, L + 6, T + 48); }
  const r = s.rift;
  const narrow = W < 600;
  const bw = narrow ? Math.min(W - 2 * L - 4, 300) : Math.min(320, W - 2 * lw - 80);
  const bx = narrow ? W / 2 - bw / 2 : W / 2 - bw / 2;
  const topY = narrow ? T + 64 : T;
  panel(c, bx - 6, topY, bw + 12, 46);
  const left = r.limit - (r.done ? r.doneAt : r.time);
  c.textAlign = "center"; c.font = font(14);
  c.fillStyle = left < 0 ? "#ff7a3c" : left < 60 ? (Math.floor(t * 2) % 2 ? "#ffd23f" : "#fff") : "#fff";
  c.fillText((left >= 0 ? fmtTime(left) : "+" + fmtTime(-left)) + `  ·  T${r.tier}`, W / 2, topY + 11);
  const gd = s.enemies.find((e) => e.id === r.guardianId && !e.dead);
  c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
  if (r.guardianSpawned && gd) {
    c.fillStyle = gd.enraged ? "#ff3b3b" : gd.kind === "king" ? "#ff3b6b" : "#ffd23f"; c.fillRect(bx, topY + 20, (bw * gd.hp) / gd.maxHp, 12);
    c.fillStyle = "#140c1c"; c.font = font(10); c.fillText((gd.kind === "king" ? "THE OSSUARY KING" : "THE HOLLOW WARDEN") + (gd.enraged ? " — ENRAGED" : ""), W / 2, topY + 26);
  } else {
    c.fillStyle = r.done ? "#7dff9a" : "#8a5cff"; c.fillRect(bx, topY + 20, (bw * r.progress) / r.need, 12);
    for (const at of RIFT.boonsAt) { c.fillStyle = "#ffd23f"; c.fillRect(bx + (bw * at) / 100, topY + 20, 1, 12); }
    c.fillStyle = "#fff"; c.font = font(10); c.fillText(r.done ? "CLEARED" : `${Math.floor((r.progress / r.need) * 100)}%`, W / 2, topY + 26);
  }
  c.fillStyle = "#b8a8d0"; c.font = font(9); c.fillText(r.kind === "chase" ? "chase boss" : modsLine(r.mods), W / 2, topY + 40);
  if (miniCanvas) {
    const ms = Math.min(90, W * 0.22), mx = W - ms - 10 - ins.right, my = narrow ? topY + 54 : T + 40;
    c.globalAlpha = 0.85; panel(c, mx - 3, my - 3, ms + 6, ms + 6);
    c.imageSmoothingEnabled = false; c.drawImage(miniCanvas, mx, my, ms, ms);
    const k = ms / (s.map.w * s.map.ts);
    for (const e of s.enemies) if (!e.dead && e.kind !== "guardian" && e.kind !== "king") { c.fillStyle = e.elite ? "#c9a0ff" : "#d93a3a"; c.fillRect(mx + e.x * k - 1, my + e.y * k - 1, e.elite ? 3 : 2, e.elite ? 3 : 2); }
    if (gd) { c.fillStyle = "#ffd23f"; c.fillRect(mx + gd.x * k - 3, my + gd.y * k - 3, 6, 6); }
    for (const l of s.loot) if (l.owner === ME && RARITY_ORDER_IDX(l.item.rarity) >= 2) { c.fillStyle = RARITY_COLOR[l.item.rarity]; c.fillRect(mx + l.x * k - 2, my + l.y * k - 2, 4, 4); }
    for (const q of s.players) { c.fillStyle = q.pid === ME ? "#fff" : "#7dff9a"; c.fillRect(mx + q.x * k - 2, my + q.y * k - 2, 4, 4); }
    c.globalAlpha = 1;
  }
  // skills
  const skills = p.skills.map((id, slot) => {
    const sk = p.sk[id], d = SKILL[id];
    const locked = d.unlock > p.level;
    let cd = 0;
    if (sk.p.interval) cd = Math.max(0, p.swingT) / sk.p.interval;
    else if ((p.charges[id] ?? 0) <= 0) cd = Math.max(0, p.chargeT[id] ?? 0) / Math.max(0.1, sk.p.cooldown);
    const maxC = sk.p.charges ?? 1;
    const poor = (sk.p.cost ?? 0) > p.res;
    return { slot, label: SHORT[id] ?? d.name.slice(0, 7), cd: locked ? 1 : poor ? Math.max(cd, 1 - p.res / sk.p.cost) : cd, locked, color: SKILL_COLOR(sk.tags), charges: maxC > 1 ? p.charges[id] ?? 0 : undefined, unlock: d.unlock };
  });
  if (input.touchMode) {
    for (const b of input.buttons) {
      const sk = skills[b.slot];
      if (!sk) continue;
      c.globalAlpha = input.isHeld(b.slot) ? 0.85 : 0.5;
      c.fillStyle = "#1b1424"; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = sk.locked ? "#4a3b5a" : sk.color; c.lineWidth = 3; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.stroke();
      if (sk.cd > 0) { c.fillStyle = "rgba(0,0,0,0.6)"; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, sk.cd)); c.fill(); }
      c.globalAlpha = sk.locked ? 0.5 : 1; c.fillStyle = "#fff"; c.textAlign = "center"; c.font = font(Math.round(b.r * 0.42));
      c.fillText(sk.locked ? `Lv${sk.unlock}` : sk.label + (sk.charges !== undefined ? ` ${sk.charges}` : ""), b.x, b.y);
      c.globalAlpha = 1;
    }
    if (input.stick) {
      const st = input.stick;
      c.globalAlpha = 0.3; c.fillStyle = "#fff"; c.beginPath(); c.arc(st.ox, st.oy, 50, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.7; const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy), m = Math.min(d, 50) / (d || 1);
      c.beginPath(); c.arc(st.ox + dx * m, st.oy + dy * m, 22, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    } else {
      c.globalAlpha = 0.2; c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(90 + ins.left, H - 110 - ins.bottom, 50, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1;
    }
  } else {
    const size = 46, gap = 6, total = skills.length * size + (skills.length - 1) * gap;
    let x0 = W / 2 - total / 2;
    const y0 = H - size - 14 - ins.bottom;
    for (const sk of skills) {
      panel(c, x0 - 2, y0 - 2, size + 4, size + 4);
      c.fillStyle = "#241b30"; c.fillRect(x0, y0, size, size);
      c.strokeStyle = sk.locked ? "#4a3b5a" : sk.color; c.lineWidth = 2; c.strokeRect(x0 + 1, y0 + 1, size - 2, size - 2);
      c.fillStyle = sk.locked ? "#6a5a7e" : "#fff"; c.textAlign = "center"; c.font = font(11); c.fillText(sk.locked ? `Lv ${sk.unlock}` : sk.label, x0 + size / 2, y0 + size / 2 + 3);
      c.font = font(9); c.fillStyle = "#b8a8d0"; c.fillText(KEY_LABELS[sk.slot], x0 + size / 2, y0 + 9);
      if (sk.charges !== undefined) { c.fillStyle = "#9be0ff"; c.fillText("×" + sk.charges, x0 + size - 9, y0 + size - 7); }
      if (sk.cd > 0 && !sk.locked) { c.fillStyle = "rgba(0,0,0,0.65)"; c.fillRect(x0, y0 + size * (1 - Math.min(1, sk.cd)), size, size * Math.min(1, sk.cd)); }
      x0 += size + gap;
    }
  }
  if (banner) {
    const a = Math.min(1, banner.t * 2);
    c.globalAlpha = a; c.textAlign = "center";
    const by = H * 0.32;
    let fs = Math.min(40, W / 11); c.font = font(fs);
    while (fs > 14 && c.measureText(banner.text).width > W - 24) { fs -= 2; c.font = font(fs); }
    c.lineWidth = 6; c.strokeStyle = "#000";
    c.strokeText(banner.text, W / 2, by); c.fillStyle = banner.color; c.fillText(banner.text, W / 2, by);
    if (banner.sub) {
      c.font = font(Math.min(16, W / 26)); c.lineWidth = 4;
      const sub = banner.sub.length > 60 && W < 500 ? banner.sub.slice(0, 58) + "…" : banner.sub;
      c.strokeText(sub, W / 2, by + 30); c.fillStyle = "#fff"; c.fillText(sub, W / 2, by + 30);
    }
    c.globalAlpha = 1;
  }
  if (p.dead) { c.fillStyle = "rgba(60,0,0,0.35)"; c.fillRect(0, 0, W, H); }
  if (hurtFlash > 0) {
    const gr = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    gr.addColorStop(0, "rgba(255,0,0,0)"); gr.addColorStop(1, `rgba(255,0,0,${hurtFlash})`);
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
  }
  if (flash > 0) { c.globalAlpha = Math.min(0.5, flash); c.fillStyle = flashColor; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
  if (paused) { c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(0, 0, W, H); }
  c.restore();
}

function panel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.fillStyle = "rgba(20,12,28,0.85)"; c.fillRect(x, y, w, h);
  c.strokeStyle = "#4a3b5a"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

let hubBg: number | null = null;
function drawHubBackdrop(t: number) {
  // the hub is static DOM; redraw the backdrop at ~10 fps to save battery
  if (hubBg !== null && t - hubBg < 0.1) return;
  hubBg = t;
  const W = wb.width, H = wb.height, g = wctx;
  g.fillStyle = "#0e0a14"; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    const x = ((i * 97 + t * (8 + (i % 5) * 3)) % (W + 20)) - 10;
    const y = H - ((i * 53 + t * (10 + (i % 7) * 4)) % (H + 20));
    g.fillStyle = i % 3 ? "#ff8a1f" : "#ffd23f"; g.globalAlpha = 0.3 + (i % 4) * 0.15;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  }
  g.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wb, 0, 0, W * pix, H * pix);
}

// ------------------------------------------------------------------ co-op / live
function afterStep() {
  const s = sim!;
  for (const e of s.events) handleEvent(e);
  if (sim) for (const q of sim.players) if (q.dashT > 0) ghosts.push({ x: q.x, y: q.y, t: 0, flip: q.fx < 0, cls: q.cls });
}
function snapOf(s: SimState) {
  const { map, events, _flows, ...rest } = s;
  return { ...rest, _flows: _flows.map((f) => Array.from(f)) };
}
function restoreSim(cfg: SimConfig, snap: any): SimState {
  const s = createSim(cfg);
  Object.assign(s, snap);
  s._flows = (snap._flows as number[][]).map((a) => Int16Array.from(a));
  s.events = [];
  return s;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1e5, Math.min(1e5, v)) : 0);
const cleanInput = (i: any): PlayerInput => ({ mx: num(i?.mx), my: num(i?.my), ax: num(i?.ax), ay: num(i?.ay), act: num(i?.act) | 0 });

function hostStep(local: PlayerInput) {
  const s = sim!, co = coop!;
  const inputs: Record<number, PlayerInput> = {};
  if (co.localCmds.length) local = { ...local, cmds: co.localCmds.splice(0) };
  inputs[ME] = local;
  const host = co.hostCmds.splice(0);
  const joiningNow = new Set(host.filter((h) => h.type === "join").map((h) => (h as any).setup.pid as number));
  let myCmds = !!local.cmds;
  for (const [pid, r] of co.remote) {
    if (!s.players.some((p) => p.pid === pid) && !joiningNow.has(pid)) continue;
    const i: PlayerInput = { ...r.inp };
    if (r.cmds.length) i.cmds = r.cmds.splice(0);
    inputs[pid] = i;
  }
  step(s, inputs, host);
  const f = { t: "f", k: s.tick, i: inputs, h: host.length ? host : undefined };
  for (const pid of co.live) online!.sendR(pid, f);
  for (const pid of co.joining) { online!.sendR(pid, { t: "snap", cfg: co.cfg, info: run, state: snapOf(s) }); co.live.add(pid); }
  co.joining.clear();
  if (s.tick % 30 === 0 && co.live.size) { const h = stateHash(s); for (const pid of co.live) online!.sendR(pid, { t: "hash", k: s.tick, h }); }
  for (const e of s.events) if (e.type === "riftComplete") online!.send({ t: "complete", inTime: e.inTime, time: e.time });
  for (const e of s.events) if (e.type === "dropRequest") online!.send({ t: "drop", owner: e.owner, opts: e.opts, x: e.x, y: e.y });
  afterStep();
  if (myCmds && ui.invOpen) openRiftInventory();
}

function guestStep(f: any) {
  const s = sim!, co = coop!;
  if (f.k <= s.tick) return;
  if (f.k !== s.tick + 1) { requestResync(); return; }
  step(s, f.i, f.h);
  afterStep();
  if (f.i?.[ME]?.cmds && ui.invOpen) openRiftInventory();
  void co;
}
function requestResync() {
  if (!coop || coop.resyncing) return;
  coop.resyncing = true; coop.queue = [];
  online!.sendR(0, { t: "resync" });
}

function coopFrame(dt: number) {
  const co = coop!;
  hitstop = 0;
  if (co.role === "host") {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 4) { hostStep(input.read(sim!, me(), toWorld)); acc -= DT; steps++; if (!sim || !coop) return; }
    if (steps === 4) acc = 0;
    return;
  }
  // guest: send our input at the tick rate, replay the host's ticks with a small jitter buffer
  co.inputAcc += dt;
  if (co.inputAcc >= DT) { co.inputAcc = Math.min(co.inputAcc - DT, DT); online!.sendU(0, { t: "in", i: input.read(sim!, me(), toWorld) }); }
  acc += dt;
  const frames = () => co.queue.filter((q) => q.t === "f").length;
  let steps = 0;
  while (co.queue.length && steps < 8) {
    const behind = frames() > 4;
    if (co.queue[0].t === "hash") { const h = co.queue.shift(); if (h.k === sim!.tick && h.h !== stateHash(sim!)) { console.warn("desync at", h.k); requestResync(); } continue; }
    if (acc < DT && !behind) break;
    guestStep(co.queue.shift());
    if (!sim || !coop) return;
    acc = Math.max(0, acc - DT); steps++;
  }
  if (!co.queue.length) acc = Math.min(acc, DT);
}

let hostEnded = false;
let pendingStart: (RunOpts & { sent?: boolean }) | null = null;
function startLiveRun(o: RunOpts) {
  const o2 = online!;
  if (o2.lobby && !o2.lobby.host) return;
  pendingStart = { ...o };
  if (!o2.lobby) { o2.host(); return; } // solo in the live build is a room of one: the server still mints every item
  pendingStart.sent = true;
  o2.send({ t: "runStart", kind: o.kind, tier: o.tier });
}
function onRunOk(m: any) {
  const o = pendingStart; pendingStart = null;
  if (!o || !online) return;
  profile = m.profile;
  let seed = o.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  if (o.weekly) seed = weeklySeed(isoWeek());
  const T = RIFT.tiers, c = char(profile);
  const peers = online.openPeers().filter((pid) => online!.peerInfo.has(pid));
  const players = [setupFor(profile, ME, online.name), ...peers.map((pid) => ({ ...online!.peerInfo.get(pid)!.setup, pid }))];
  const pity: SimConfig["pity"] = { [ME]: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity } };
  for (const pid of peers) pity[pid] = online.peerInfo.get(pid)!.pity;
  const cfg: SimConfig = { seed, kind: m.kind, tier: m.tier, players, mods: m.kind === "chase" ? [] : rollModifiers(seed, m.tier), mint: "external", pity };
  coop = newCoop("host", cfg);
  const info: RunInfo = { kind: m.kind, tier: m.tier, weekly: !!o.weekly && peers.length === 0, seed };
  for (const pid of peers) { online.sendR(pid, { t: "start", cfg, info }); coop.live.add(pid); coop.remote.set(pid, { inp: NO_INPUT, cmds: [] }); }
  beginRun(cfg, info);
}

/** Direct co-op: the host starts the run for the whole room. Items are made inside the shared game. */
function startDirectRun(o: RunOpts) {
  const d = online as Direct;
  const c = char(profile), T = RIFT.tiers;
  if (o.kind === "chase") { if (c.sigils <= 0) return; c.sigils--; saveProfile(profile); }
  let seed = o.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  const peers = d.openPeers().filter((pid) => d.peerInfo.has(pid));
  if (o.weekly && !peers.length) seed = weeklySeed(isoWeek());
  const players = [setupFor(profile, ME, d.name), ...peers.map((pid) => ({ ...d.peerInfo.get(pid)!.setup, pid, name: d.peerInfo.get(pid)!.name }))];
  const pity: SimConfig["pity"] = { [ME]: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity } };
  for (const pid of peers) pity[pid] = d.peerInfo.get(pid)!.pity;
  const cfg: SimConfig = { seed, kind: o.kind, tier: o.tier, players, mods: o.kind === "chase" ? [] : rollModifiers(seed, o.tier), pity };
  coop = newCoop("host", cfg);
  const info: RunInfo = { kind: o.kind, tier: o.tier, weekly: !!o.weekly && peers.length === 0, seed };
  for (const pid of peers) { d.sendR(pid, { t: "start", cfg, info }); coop.live.add(pid); coop.remote.set(pid, { inp: NO_INPUT, cmds: [] }); }
  d.setRunning(true);
  beginRun(cfg, info);
}

function wireOnline(o: Online | Direct) {
  if (!o.direct) o.onProfile = (p) => { profile = p; setMuted(profile.settings.mute); if (screen === "hub" && mode === "hub") goHub(); };
  o.onLobby = () => {
    ME = o.lobby ? o.lobby.pid : 0;
    if (!o.direct && pendingStart && !pendingStart.sent && o.lobby?.host) { pendingStart.sent = true; o.send({ t: "runStart", kind: pendingStart.kind, tier: pendingStart.tier }); }
    if (screen === "hub" && mode === "hub") goHub();
  };
  o.onServer = (m) => {
    switch (m.t) {
      case "runOk": onRunOk(m); break;
      case "runFail": pendingStart = null; ui.toast(m.reason, "#ff6a6a"); break;
      case "joinFail": ui.toast(m.reason, "#ff6a6a"); break;
      case "dropOk": if (coop?.role === "host") coop.hostCmds.push({ type: "spawnLoot", owner: m.owner, item: m.item, x: m.x, y: m.y }); break;
      case "peerLeft": if (coop?.role === "host") hostDropPeer(m.pid); break;
      case "roomClosed": if (coop?.role === "guest" && sim) { ui.toast("The host closed the room.", "#ff6a6a"); endRun(); } break;
    }
  };
  o.onPeerOpen = (pid) => {
    if (coop?.role !== "host" || !sim) return;
    const info = o.peerInfo.get(pid);
    if (!info || coop.live.has(pid) || coop.joining.has(pid)) return;
    coop.hostCmds.push({ type: "join", setup: { ...info.setup, pid }, pity: info.pity });
    coop.remote.set(pid, { inp: NO_INPUT, cmds: [] });
    coop.joining.add(pid);
    if (paused) { ui.hide(); resume(); } // the sim can't stay paused once someone shares it
    ui.toast(`${info.name} joined`, "#7dff9a");
  };
  o.onPeerClose = (pid) => {
    if (coop?.role === "host") hostDropPeer(pid);
    else if (coop?.role === "guest" && pid === 0 && sim) { ui.toast("Lost the host.", "#ff6a6a"); endRun(); }
  };
  o.onPeerMsg = (pid, m) => {
    if (coop?.role === "host") {
      const r = coop.remote.get(pid);
      if (m.t === "in" && r) r.inp = cleanInput(m.i);
      else if (m.t === "cmd" && r && r.cmds.length < 20) r.cmds.push(m.c);
      else if (m.t === "resync" && coop.live.has(pid)) { coop.live.delete(pid); coop.joining.add(pid); }
      return;
    }
    if (pid !== 0) return;
    if (m.t === "start" && !sim) { coop = newCoop("guest", m.cfg); beginRun(m.cfg, m.info); return; }
    if (m.t === "snap") {
      const s = restoreSim(m.cfg, m.state);
      if (!sim || !coop) { coop = newCoop("guest", m.cfg); beginRun(m.cfg, m.info, s); }
      else { sim = s; coop.resyncing = false; coop.queue = []; }
      // events that happened inside the gap are gone; recover the ones that matter from state
      if (s.rift.done && !completeInfo) { completeInfo = { inTime: s.rift.doneAt <= s.rift.limit, time: s.rift.doneAt }; riftButtons(); }
      if (s.boonOffers[ME] && !ui.invOpen) riftButtons();
      return;
    }
    if (!coop || coop.role !== "guest") return;
    if (m.t === "f" || m.t === "hash") { if (!coop.resyncing) coop.queue.push(m); return; }
    if (m.t === "end") { hostEnded = true; if (sim) endRun(); }
  };
  if (!o.direct) o.onClosed = () => {
    mode = "blocked";
    const root = document.getElementById("ui")!;
    root.className = "screen";
    root.innerHTML = `<div class="panel hub"><h1>RIFT ARPG</h1><p>Lost the connection to the server.</p><button class="big" onclick="location.reload()">Reconnect</button></div>`;
  };
}
function hostDropPeer(pid: number) {
  if (!coop) return;
  coop.live.delete(pid); coop.joining.delete(pid); coop.remote.delete(pid);
  if (sim?.players.some((p) => p.pid === pid)) coop.hostCmds.push({ type: "leave", pid });
}

async function bootLive() {
  const root = document.getElementById("ui")!;
  mode = "blocked";
  if (!onlineAvailable()) {
    root.className = "screen";
    root.innerHTML = `<div class="panel hub"><h1>RIFT ARPG</h1><p>Live build: sign-in is required. Start the server with <code>npm run server</code> and open the page it serves.</p></div>`;
    return;
  }
  let msg = "";
  for (;;) {
    const token = await signIn(root, msg);
    const o = new Online();
    wireOnline(o);
    if (await o.connect(token)) { online = o; break; }
    signOut(); msg = "Please sign in again.";
  }
  setLocalSaves(false);
  goHub();
}

// ------------------------------------------------------------------ boot
resize();
if (!OFFLINE_TEST) bootLive();
else {
  if (onlineAvailable() && typeof RTCPeerConnection !== "undefined") {
    // direct co-op by room code; the host runs the game, every phone keeps its own save
    const d: Direct = new Direct(() => { const c = char(profile), T = RIFT.tiers; return { setup: setupFor(profile, 0, d.name), pity: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity }, cls: c.cls, level: c.level }; });
    wireOnline(d);
    online = d;
  }
  goHub();
  setOnSaved((p) => cloudQueue(p));
  let pendingRemote: Profile | null = null;
  const useRemote = (p: Profile) => {
    if (mode !== "hub" || screen !== "hub") { pendingRemote = p; return; }
    profile = p; setMuted(profile.settings.mute);
    try { localStorage.setItem("rift-arpg-save", JSON.stringify(p)); } catch { /* ignore */ }
    ui.toast("Save restored from your account", "#7dff9a");
    goHub();
  };
  startCloud(() => profile, useRemote);
  (window as any).__applyPendingRemote = () => { if (pendingRemote) { const p = pendingRemote; pendingRemote = null; useRemote(p); } };
}
requestAnimationFrame(frame);
(window as any).__rift = { get sim() { return sim; }, startRun, get profile() { return profile; }, endRun, MODIFIER, get coop() { return coop; }, get online() { return online; }, stateHash };
