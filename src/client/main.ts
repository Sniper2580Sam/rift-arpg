// Client: fixed-step loop around the pure sim, code-drawn pixel renderer, game feel, HUD, hub flow.
import { isAbyssal, runeLevel, chiselsForRun, nextTrial, talentPoints, talentSpent, paragonSpent, trialPassed, trialTarget, coresForRun, trophiesForRun, dustForRun, SHOP, aetherForFeats, aetherForRun, GEM, RunTally, bumpLife, SEASON_JOURNEY, chapterKey, newChapters, lifeStats, newFeats, rewardName, CLASSES, ENEMIES, HIDEOUT, guardianDef, paragonXp, HideoutSpot, MAP, MODIFIER, RIFT, hideoutTheme, hideoutPreset, encodeHideout, decodeHideout, ownsKey, tierJump, VFX, VfxStyle, Rarity, SET, SKILL, xpForLevel } from "../sim/data";
import { drawHeroCos, drawPetCos, Emit } from "./cosdraw";
import { InvCmd, Item, applyInvCmd, noteFinds, rerollCost } from "../sim/items";
import { DT, Enemy, HostCmd, NO_INPUT, Player, PlayerCmd, PlayerInput, SimConfig, SimEvent, SimState, applyPlayerCmd, createSim, skillReady, stateHash, step, rollModifiers, resMax, RunKind, ChaseBoss, endlessLivesLeft } from "../sim/sim";
import { sfx, setMuted, unlockAudio } from "./audio";
import { Input, KEY_LABELS } from "./input";
import { Profile, char, isoWeek, seasonStats, loadProfile, saveProfile, setLocalSaves, setOnSaved, setupFor, syncFromSim, weeklySeed } from "./profile";
import { queue as cloudQueue, startCloud } from "./cloud";
import { driveQueue, driveRecheck, startDrive } from "./gdrive";
import { HubOp, applyHubOp } from "../shared/ops";
import { RARITY_COLOR, Sprite, buildSprites, renderMap } from "./sprites";
import { allSpots, decorIcon, labels as hideLabels, drawDecor, drawPortal, drawShowcase, drawStation, drawThemeAir, drawThemeFloor, drawThemeUnder, spotPos } from "./hideout";
import { UI, fmtTime, modsLine, GearSub, SkillSub, HubHandlers } from "./ui";
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
let runTally: RunTally | null = null;
let gemLines: string[] = [];
let gotAncestral = false, gotPrimal = false, gotSigil = 0, gotFeather = 0, gotKey = 0, runElites = 0, startLevel = 1;
let completeInfo: { inTime: boolean; time: number } | null = null;
let run: { kind: RunKind; tier: number; weekly: boolean; seed: number; boss?: ChaseBoss } | null = null;
let leaveArmed = 0;
// hideout: the station or portal you're standing at, whether the full menu is open over it, and decorating
let hideNear: HideoutSpot | null = null, menuOpen = false, decorating = false, menuStamp = "";
const inHideout = () => !!sim && run?.kind === "hideout";
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
interface Arc { x: number; y: number; fx: number; fy: number; r: number; ring: boolean; t: number; arcCos: number; vfx?: VfxStyle }
interface Ghost { x: number; y: number; t: number; flip: boolean; cls: string }
const bolts: { x1: number; y1: number; x2: number; y2: number; t: number; fx?: VfxStyle }[] = [];
const particles: Particle[] = [], nums: Num[] = [], rings: Ring[] = [], arcs: Arc[] = [], ghosts: Ghost[] = [];
const me = () => sim!.players.find((p) => p.pid === ME)!;

type RunOpts = { tier: number; seed: number | null; kind: RunKind; weekly?: boolean; boss?: ChaseBoss };
type RunInfo = { kind: RunKind; tier: number; weekly: boolean; seed: number; boss?: ChaseBoss };
/** Spend the key a chase run needs: a Bone Sigil for the King, a Pale Feather for the Seraph. */
function payChase(o: RunOpts): boolean {
  const c = char(profile);
  if (o.kind === "vault") { if ((c.vaultKeys ?? 0) <= 0) return false; c.vaultKeys = (c.vaultKeys ?? 0) - 1; saveProfile(profile); return true; }
  if (o.kind !== "chase") return true;
  if (o.boss === "seraph") { if ((c.feathers ?? 0) <= 0) return false; c.feathers = (c.feathers ?? 0) - 1; }
  else { if (c.sigils <= 0) return false; c.sigils--; }
  saveProfile(profile);
  return true;
}
function startRun(o: RunOpts) {
  unlockAudio();
  if (inHideout() && o.kind !== "hideout") {
    if (coop?.role === "guest") { ui.toast("Only the host can open a portal.", "#ffd23f"); return; }
    if (online?.direct && online.lobby && !online.lobby.host) { ui.toast("Only the host can open a portal.", "#ffd23f"); return; }
    leaveHideout();
  }
  if (online && !online.direct) return startLiveRun(o);
  if (online?.direct && online.lobby) { if (online.lobby.host) startDirectRun(o); return; }
  const c = char(profile);
  let seed = o.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  if (o.weekly) seed = weeklySeed(isoWeek());
  if (!payChase(o)) return;
  const T = RIFT.tiers;
  const cfg: SimConfig = {
    seed, kind: o.kind, tier: o.tier, boss: o.boss, players: [setupFor(profile, ME)], hideout: o.kind === "hideout" ? profile.hideout : undefined,
    mods: o.kind !== "rift" ? [] : rollModifiers(seed, o.tier),
    pity: { [ME]: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity } },
  };
  beginRun(cfg, { kind: o.kind, tier: o.tier, weekly: !!o.weekly, seed, boss: o.boss });
}

function beginRun(cfg: SimConfig, info: RunInfo, existing?: SimState) {
  const c = char(profile);
  if (cfg.kind !== "hideout") themePreview = "";
  sim = existing ?? createSim(cfg);
  run = info;
  const seed = info.seed;
  const md = sim.rift.map ? MAP[sim.rift.map] : undefined;
  const hth = sim.rift.kind === "hideout" ? hideoutTheme(sim.rift.hideout?.theme) : undefined;
  mapCanvas = renderMap(sim.map.tiles, sim.map.w, sim.map.h, sim.map.ts, seed, hth ? { ...hth.map, pattern: hth.pattern } : md?.theme);
  menuOpen = false; decorating = false; hideNear = null; hideDeath();
  miniCanvas = document.createElement("canvas");
  miniCanvas.width = sim.map.w; miniCanvas.height = sim.map.h;
  const m = miniCanvas.getContext("2d")!;
  for (let i = 0; i < sim.map.tiles.length; i++) if (sim.map.tiles[i] === 0) { m.fillStyle = md?.theme.wallLight ?? "#6a5a7e"; m.fillRect(i % sim.map.w, Math.floor(i / sim.map.w), 1, 1); }
  const p = me();
  camX = p.x - wb.width / 2; camY = p.y - wb.height / 2;
  particles.length = nums.length = rings.length = arcs.length = ghosts.length = 0; pets.clear();
  found = {}; foundLegs = []; completeInfo = null; acc = 0; hitstop = 0; paused = false; input.enabled = true; // a run started from the menu must not inherit its paused input
  gotAncestral = gotPrimal = false; gotSigil = 0; gotFeather = 0; gotKey = 0; runElites = 0; gemLines = []; startLevel = c.level;
  runIds = new Set([...Object.values(p.equipment).map((it) => it!.id), ...p.bag.map((it) => it.id)]); scrappedIds = [];
  mode = "rift"; screen = "rift";
  ui.hide();
  riftButtons();
  const party = sim.players.length > 1 ? ` · party of ${sim.players.length}` : "";
  if (info.kind === "hideout") { const host = sim.players.find((q) => q.pid === 0); showBanner(host && host.pid !== ME ? `${host.name}'s hideout` : "Your hideout", "Walk to a station or portal", "#c9b8ff", 2.2); }
  else if (info.kind === "vault") showBanner(RIFT.vault.name.toUpperCase(), `${RIFT.vault.timeLimit} seconds of treasure · tier ${info.tier} · ${RIFT.vault.chisels} Gilded Chisels at the end`, "#ffd23f", 3.5);
  else if (info.kind === "trial") showBanner(`TRIAL ${info.tier}`, `Clear ${RIFT.trial.waves} waves in ${fmtTime(RIFT.trial.timeLimit)} for a talent point`, "#7dd8ff", 3.5);
  else if (info.kind === "bounty") showBanner("BOUNTIES", `Tier ${info.tier} · four tasks on one map · gold markers on the minimap`, "#ffd23f", 3.5);
  else if (info.kind === "endless") showBanner("ENDLESS", `Tier ${info.tier} start · ${RIFT.endless.lives} lives · clear waves fast to climb faster`, "#ff8a5a", 3.5);
  else if (info.kind === "chase" && sim.rift.boss === "seraph") showBanner(RIFT.seraph.name, "Dodge the shard rings, then survive her Judgement.", "#bfe8ff", 3.5);
  else if (info.kind === "chase") showBanner(RIFT.chase.name, "Three phases. Dodge the fire, break the pylons.", "#ff3b6b", 3.5);
  else if (md?.id === "goodluck") showBanner(`GOOD LUCK ×${sim.rift.density}`, `Somebody left the gate open. Tier ${info.tier} · code ${seed.toString(36).toUpperCase()}${party}`, "#ff5a6a", 5);
  else if (md?.egg) showBanner(md.name.toUpperCase(), `${md.desc} Tier ${info.tier} · code ${seed.toString(36).toUpperCase()}${party}`, "#ffd75a", 5);
  else showBanner(info.weekly ? "WEEKLY RIFT" : md?.name ?? RIFT.name, `Tier ${info.tier} · code ${seed.toString(36).toUpperCase()} · ${modsLine(sim.rift.mods)}${party}`, "#c9b8ff", 3.5);
}

function hideoutButtons() {
  const root = document.getElementById("ui")!;
  root.className = "hudbtns";
  const n = hideNear;
  const guest = coop?.role === "guest";
  const act = !n ? "" : n.kind ? `<button id="h-act" class="h-act">${guest ? `${esc(n.name)} · host opens` : `Enter ${esc(n.name)}${n.kind === "chase" ? ` (${n.id === "seraph" ? `${char(profile).feathers ?? 0} feathers` : `${char(profile).sigils} sigils`})` : n.kind === "trial" ? ` ${trialTarget(char(profile))}` : n.kind === "vault" ? ` (${char(profile).vaultKeys ?? 0} keys)` : n.kind === "rift" || n.kind === "endless" ? ` · T${curTier()}` : ""}`}</button>` : `<button id="h-act" class="h-act">${esc(n.name)}</button>`;
  const pv = themePreview ? hideoutTheme(themePreview) : null;
  root.innerHTML = `${act}<button id="h-menu">Menu</button>${guest ? `<button id="h-leave">Leave room</button>` : ""}${pv ? `<div class="h-preview"><span>Visiting <b>★ ${esc(pv.name)}</b></span><button id="hp-buy">Buy ${SHOP.symbol} ${SHOP.prices.theme.toLocaleString("en-US")}</button><button id="hp-back">Back to my hideout</button></div>` : ""}`;
  if (pv) {
    const buy = document.getElementById("hp-buy")!;
    buy.onclick = () => {
      const price = SHOP.prices.theme;
      if ((profile.aether ?? 0) < price) { ui.toast(`Not enough ${SHOP.currency} (${(price - (profile.aether ?? 0)).toLocaleString("en-US")} more)`, "#ff6a6a"); return; }
      if (buy.dataset.sure !== "1") { buy.dataset.sure = "1"; buy.textContent = `Buy for ${SHOP.symbol} ${price.toLocaleString("en-US")}?`; return; }
      hubOp({ t: "buy", key: `theme:${pv.id}` });
      hubOp({ t: "hideout", theme: pv.id });
      themePreview = ""; ui.toast(`${pv.name} is yours.`, "#7dff9a"); enterHideout();
    };
    document.getElementById("hp-back")!.onclick = () => { themePreview = ""; enterHideout(); };
  }
  const a = document.getElementById("h-act"); if (a) a.onclick = () => useSpot(n!);
  document.getElementById("h-menu")!.onclick = () => openMenu();
  const l = document.getElementById("h-leave"); if (l) l.onclick = () => { online?.leave(); endRun(); };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** Unspent points shown under the hideout's talent and passive-tree stations. */
function stationNote(id: string): string {
  const c = char(profile);
  if (id === "difficulty") return `Tier ${curTier()}${isAbyssal(curTier()) ? " · Abyssal" : ""}`;
  if (id === "altar") { const f = talentPoints(c) - talentSpent(c.talents); return !c.subclass && talentPoints(c) ? "pick a subclass" : f > 0 ? `${f} point${f === 1 ? "" : "s"} to spend` : ""; }
  if (id === "starchart") { const f = (c.paragon ?? 0) - (c.passives?.length ?? 0) + ((c.paragon ?? 0) - paragonSpent(c.pAlloc ?? {})); return f > 0 ? `${f} point${f === 1 ? "" : "s"} to spend` : ""; }
  return "";
}
/** Bosses use the tier picked on the Play tab (at least 3, at most your highest). */
/** The difficulty picked at the Difficulty Obelisk (or on the Play tab), saved on the character. */
const curTier = () => { const c = char(profile); return Math.max(1, Math.min(c.tier ?? c.highestTier, c.highestTier)); };
/** Bosses use the picked tier, at least 3. */
const bossTier = () => Math.max(3, curTier());
function useSpot(n: HideoutSpot) {
  if (n.kind) {
    const c = char(profile);
    if (n.kind === "chase" && n.id === "seraph") { if ((c.feathers ?? 0) <= 0) { ui.toast(`You need a Pale Feather (the King leaves one, and guardians drop them at tier ${RIFT.seraph.featherFrom}+).`, "#bfe8ff"); return; } startRun({ tier: bossTier(), seed: null, kind: "chase", boss: "seraph" }); }
    else if (n.kind === "chase") { if (c.sigils <= 0) { ui.toast("You need a Bone Sigil (they drop from guardians at tier 3+).", "#ffd23f"); return; } startRun({ tier: bossTier(), seed: null, kind: "chase" }); }
    else if (n.kind === "vault") { if ((c.vaultKeys ?? 0) <= 0) { ui.toast("You need a Gilded Key: catch a Gilded Imp in a rift (tier 2+) before it escapes.", "#ffd23f"); return; } startRun({ tier: curTier(), seed: null, kind: "vault" }); }
    else if (n.kind === "trial") startRun({ tier: trialTarget(c), seed: null, kind: "trial" });
    else startRun({ tier: curTier(), seed: null, kind: n.kind as RunKind });
    return;
  }
  if (n.tab === "decorate") return startDecorating();
  if (n.tab === "difficulty") { menuOpen = true; if (sim) pause(); ui.showDifficulty(profile, hubHandlers(), () => { menuOpen = false; ui.hide(); resume(); hideoutButtons(); }); return; }
  // each workstation opens its own sub-tab (Blacksmith -> rerolls and upgrades, Jeweler -> gems, ...)
  if (n.sub && n.tab === "gear") ui.gearSub = n.sub as GearSub;
  if (n.sub && n.tab === "skills") ui.skillSub = n.sub as SkillSub;
  if (n.sub && n.tab === "journey") ui.journeySub = n.sub as "feats" | "collection";
  openMenu(n.tab);
}
/** Decorating: a tray of themes and decorations. Walk to a spot and tap an item to place it on your tile. */
let shareOpen = false, layoutConfirm = "";
/** a premium theme being visited from the Shop before buying: only the room changes, nothing is saved */
let themePreview = "";
function previewTheme(id: string) {
  if (coop || online?.direct) { ui.toast("Theme visits work when you're on your own.", "#ffd23f"); return; }
  themePreview = id; menuOpen = false; ui.hide(); enterHideout();
}
function startDecorating() {
  if (themePreview) { ui.toast("Go back to your own hideout to decorate.", "#ffd23f"); return; }
  if (!canFreeze() || coop?.role === "guest") { ui.toast("Decorate when nobody else is in your hideout.", "#ffd23f"); return; }
  decorating = true; hideNear = null;
  decorTray();
}
function decorTray() {
  if (!decorating || !sim) return;
  const root = document.getElementById("ui")!;
  root.className = "decor-tray";
  const h = profile.hideout ?? { theme: HIDEOUT.themes[0].id, decor: [] };
  const themes = HIDEOUT.themes.map((t) => {
    const own = !t.premium || ownsKey(profile, `theme:${t.id}`);
    return `<button class="dt-theme${t.id === h.theme ? " on" : ""}${t.premium ? " prem" : ""}" data-theme="${t.id}">${t.premium ? "★ " : ""}${esc(t.name)}${own ? "" : " · Shop"}</button>`;
  }).join("");
  const items = HIDEOUT.decor.map((d) => {
    const own = !d.premium || ownsKey(profile, `decor:${d.id}`);
    const ic = decorIcon(d.id);
    return `<button class="dt-item${d.premium ? " prem" : ""}${own ? "" : " locked"}" data-decor="${d.id}" title="${esc(d.name)}">${ic ? `<img src="${ic.toDataURL()}" alt="">` : ""}<small>${d.premium ? "★ " : ""}${esc(d.name)}</small></button>`;
  }).join("");
  const cur = hideoutPreset(h.layout).id;
  const layouts = HIDEOUT.layouts.map((l) => `<button class="dt-layout${l.id === cur ? " on" : ""}${l.id === layoutConfirm ? " warn" : ""}" data-layout="${l.id}" title="${esc(l.desc)}">${esc(l.name)}${l.id === layoutConfirm ? ` · tap again` : ""}</button>`).join("");
  const lp = hideoutPreset(layoutConfirm || cur);
  const note = layoutConfirm ? `${esc(lp.name)} comes with ${lp.props!.length} props and replaces your ${h.decor.length} decorations. Tap it again to use it.` : esc(lp.desc);
  root.innerHTML = `<div class="dt-head"><b>Decorate</b><span class="dim">${h.decor.length}/${HIDEOUT.maxDecor} · walk somewhere, tap an item to place it there</span><button id="dt-remove">Remove nearest</button><button id="dt-share">Share</button><button id="dt-done">Done</button></div>
    <div class="dt-row">${themes}</div>
    <div class="dt-row"><span class="dt-lab">Layout</span>${layouts}</div><div class="dt-note dim">${note}</div>
    <div class="dt-row">${items}</div>
    ${shareOpen ? `<div class="dt-share"><div class="dim">Copy your code to share this design, or paste someone's code to use theirs. Anything you don't own is left out.</div>
      <textarea id="dt-code" rows="2" spellcheck="false" placeholder="RIFTHOME1:...">${esc(encodeHideout(h))}</textarea>
      <div class="dt-head"><button id="dt-copy">Copy my code</button><button id="dt-paste">Use pasted code</button><button id="dt-share-x">Close</button></div></div>` : ""}`;
  root.querySelectorAll<HTMLElement>("[data-layout]").forEach((b) => b.onclick = () => {
    const l = hideoutPreset(b.dataset.layout);
    // a layout with props replaces your decorations: ask with a second tap when you have some
    if (l.props && h.decor.length && layoutConfirm !== l.id) { layoutConfirm = l.id; decorTray(); return; }
    layoutConfirm = "";
    if (l.id === cur && !l.props) return;
    hubOp({ t: "hideout", layout: l.id, props: !!l.props });
    enterHideout(); decorating = true; decorTray();
  });
  document.getElementById("dt-share")!.onclick = () => { shareOpen = !shareOpen; decorTray(); };
  if (shareOpen) {
    const ta = document.getElementById("dt-code") as HTMLTextAreaElement;
    document.getElementById("dt-share-x")!.onclick = () => { shareOpen = false; decorTray(); };
    document.getElementById("dt-copy")!.onclick = () => {
      const code = encodeHideout(h); ta.value = code; ta.select();
      navigator.clipboard?.writeText(code).then(() => ui.toast("Design code copied.", "#7ad06a"), () => ui.toast("Select the code and copy it.", "#ffd23f"));
    };
    document.getElementById("dt-paste")!.onclick = () => {
      const d = decodeHideout(ta.value);
      if (!d) { ui.toast("That isn't a hideout design code.", "#ff6a6a"); return; }
      if (!hubOp({ t: "hideout", design: d })) { ui.toast("That code couldn't be used.", "#ff6a6a"); return; }
      const got = profile.hideout!, skipped: string[] = [];
      if (got.theme !== d.theme) skipped.push(`the ${hideoutTheme(d.theme).name} theme`);
      const left = d.decor.length - got.decor.length;
      if (left > 0) skipped.push(`${left} decoration${left > 1 ? "s" : ""}`);
      ui.toast(skipped.length ? `Design applied without ${skipped.join(" and ")} (not owned, or doesn't fit the room).` : "Design applied.", skipped.length ? "#ffd23f" : "#7ad06a");
      shareOpen = false; enterHideout(); decorating = true; decorTray();
    };
  }
  root.querySelectorAll<HTMLElement>("[data-theme]").forEach((b) => b.onclick = () => {
    const id = b.dataset.theme!, t = hideoutTheme(id);
    if (t.premium && !ownsKey(profile, `theme:${id}`)) { decorating = false; openMenu("shop"); return; }
    if (id === h.theme) return;
    hubOp({ t: "hideout", theme: id });
    enterHideout(); decorating = true; decorTray();
  });
  root.querySelectorAll<HTMLElement>("[data-decor]").forEach((b) => b.onclick = () => {
    const id = b.dataset.decor!, d = HIDEOUT.decor.find((x) => x.id === id)!;
    if (d.premium && !ownsKey(profile, `decor:${id}`)) { decorating = false; openMenu("shop"); return; }
    const p = me(), m = sim!.map, x = Math.floor(p.x / m.ts), y = Math.floor(p.y / m.ts);
    if (m.tiles[y * m.w + x] !== 0) { ui.toast("Stand on open floor to place.", "#ffd23f"); return; }
    if ((profile.hideout?.decor.length ?? 0) >= HIDEOUT.maxDecor) { ui.toast(`Hideout is full (${HIDEOUT.maxDecor}). Remove something first.`, "#ffd23f"); return; }
    if (profile.hideout?.decor.some((o) => o.x === x && o.y === y)) { ui.toast("Something is already here. Step aside.", "#ffd23f"); return; }
    hubOp({ t: "hideout", place: { id, x, y } });
    sim!.rift.hideout = profile.hideout; sfx.pickup();
    decorTray();
  });
  document.getElementById("dt-remove")!.onclick = () => {
    const p = me(), ts = sim!.map.ts, list = profile.hideout?.decor ?? [];
    let bi = -1, bd = 28;
    list.forEach((d, i) => { const dd = Math.hypot((d.x + 0.5) * ts - p.x, (d.y + 0.5) * ts - p.y); if (dd < bd) { bd = dd; bi = i; } });
    if (bi < 0) { ui.toast("Stand next to a decoration to remove it.", "#ffd23f"); return; }
    hubOp({ t: "hideout", remove: bi });
    sim!.rift.hideout = profile.hideout;
    decorTray();
  };
  document.getElementById("dt-done")!.onclick = () => { decorating = false; shareOpen = false; layoutConfirm = ""; hideoutButtons(); };
}
/** Which station or portal the local hero stands at (checked every frame; buttons redraw only on change). */
function hideoutTick() {
  if (!inHideout() || menuOpen || ui.invOpen || decorating) return;
  const p = me(), th = hideoutTheme(sim!.rift.hideout?.theme);
  let best: HideoutSpot | null = null, bd = 30;
  for (const s of allSpots()) { const [x, y] = spotPos(sim!.map, th, s, sim!.rift.hideout?.layout); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = s; } }
  if (best !== hideNear) { hideNear = best; hideoutButtons(); }
}
function leaveHideout() {
  // never copy the hideout hero back into the save: nothing changes there in play, while the menu changes the save
  // directly, so syncing would undo (or duplicate) gear moved in the menu
  sim = null; run = null; coop = null; menuOpen = false; decorating = false; hideNear = null;
}
/** Home: your hideout. In a direct room the host's hideout is shared and guests wait for it. */
function enterHideout() {
  driveRecheck();
  const apply = (window as any).__applyPendingRemote; if (apply) { (window as any).__applyPendingRemote = null; setTimeout(apply, 0); }
  if (inHideout() && coop?.role === "guest") { ui.hide(); hideoutButtons(); return; }
  if (sim) leaveHideout();
  if (online?.direct && online.lobby?.host) { startDirectRun({ kind: "hideout", tier: 1, seed: null }); return; }
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const own = profile.hideout ?? { theme: HIDEOUT.themes[0].id, decor: [] };
  const cfg: SimConfig = { seed, kind: "hideout", tier: 1, players: [setupFor(profile, ME, online?.name)], hideout: themePreview ? { ...own, theme: themePreview } : profile.hideout, mods: [] };
  beginRun(cfg, { kind: "hideout", tier: 1, weekly: false, seed });
}
function openMenu(tab?: string) {
  if (tab) ui.tab = tab as any;
  menuOpen = true; menuStamp = JSON.stringify([char(profile), profile.cos, profile.pet, profile.hideout]);
  if (sim) pause();
  showMenu();
}
function closeMenu() {
  menuOpen = false;
  ui.hide();
  // the hero in the hideout was built from the old profile: rebuild it if gear, class or looks changed
  const changed = menuStamp !== JSON.stringify([char(profile), profile.cos, profile.pet, profile.hideout]);
  if (changed && inHideout() && coop?.role !== "guest") { enterHideout(); return; }
  resume();
}
function refreshMenu() { if (menuOpen) showMenu(); else if (!sim && mode === "hub") goHub(); }

function riftButtons() {
  if (inHideout()) return hideoutButtons();
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
/** Death panel: what killed you, the damage in your last seconds, and a Respawn button that costs rift time. */
function showDeath(killer: string, recap: [string, number][], penalty: number) {
  hideDeath();
  const el = document.createElement("div"); el.id = "death"; el.className = "death";
  const total = recap.reduce((a, [, n]) => a + n, 0) || 1, coopRun = !!sim && sim.players.length > 1;
  const pen = run?.kind === "endless" ? "uses a life" : `−${penalty} s`;
  el.innerHTML = `<b class="death-title">You fell</b><div class="dim small">Killing blow: ${esc(killer)}</div>
    <div class="recap">${recap.map(([src, n]) => `<div class="rc-row"><span>${esc(src)}</span><span class="rc-bar"><i style="width:${Math.round((n / total) * 100)}%"></i></span><b>${n.toLocaleString("en-US")}</b></div>`).join("")}</div>
    <div class="dim small">${coopRun ? "The timer runs while an ally is standing. An ally can revive you for free by standing on your marker." : "The timer is paused while you're down."}</div>
    <button id="d-respawn" class="big" disabled>Respawn (${pen})</button>`;
  document.body.appendChild(el);
  const b = el.querySelector<HTMLButtonElement>("#d-respawn")!;
  setTimeout(() => { b.disabled = false; }, RIFT.deathPenalty.minWait * 1000 + 50);
  b.onclick = () => { b.disabled = true; playerCmd({ type: "respawn" }); if (sim && !me().dead) { hideDeath(); if (penalty && run?.kind !== "endless") showBanner("BACK IN", `−${penalty} s on the timer`, "#ffb0b0", 1.6); } };
}
function hideDeath() { document.getElementById("death")?.remove(); }
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
  hideDeath();
  if (run.kind === "hideout") { saveProfile(profile); finishOnline(); leaveHideout(); goHub(); return; }
  const s = sim, p = me(), c = char(profile), T = RIFT.tiers;
  syncFromSim(profile, s, ME);
  for (const [k, v] of Object.entries(p.uses)) c.uses[k] = (c.uses[k] ?? 0) + v;
  const lines: string[] = [];
  if (c.level > startLevel) lines.push(`Level ${startLevel} → ${c.level}`);
  const newRunes = CLASSES[c.cls].skills.flatMap((id) => SKILL[id].runes.filter((r) => runeLevel(id, r.id) > startLevel && runeLevel(id, r.id) <= c.level).map((r) => `${SKILL[id].name}: ${r.name}`));
  if (newRunes.length) lines.push(`New runes: ${newRunes.join(", ")}`);
  if (gotSigil) lines.push(`Bone Sigil found (${c.sigils} owned). The Ossuary King awaits.`);
  if (gemLines.length) lines.push(`Gems levelled: ${gemLines.join(", ")}`);
  if (gotKey) lines.push(`Gilded Key found (${c.vaultKeys ?? 0} owned). The Gilded Vault portal is in your hideout.`);
  if (gotFeather) lines.push(`Pale Feather found (${c.feathers ?? 0} owned). The Pale Seraph awaits.`);
  // counters for feats (lifetime, kept across seasons) and the season journey (this season only)
  const tally: RunTally = {
    kind: run.kind, boss: run.boss, tier: run.tier, completed: !!completeInfo, inTime: !!completeInfo?.inTime,
    kills: s.rift.kills, elites: runElites, legendaries: foundLegs.length, mythics: foundLegs.filter((f) => f.rarity === "mythic").length, ancestrals: foundLegs.filter((f) => f.quality === "ancestral").length,
    deaths: p.deaths ?? 0, party: s.players.length, wave: s.rift.wave ?? 0,
  };
  runTally = tally; // the live build sends it with the save; the server keeps its own count
  profile.life = bumpLife(lifeStats(profile), tally);
  profile.journey = { season: profile.season.n, stats: bumpLife(seasonStats(profile), tally) };
  const cores = coresForRun(tally);
  if (cores) { profile.echoCores = (profile.echoCores ?? 0) + cores; lines.push(`+${cores} Echo Core${cores > 1 ? "s" : ""} (strengthen items in Gear)`); }
  const tro = trophiesForRun(tally);
  if (tro.shards) { profile.kingShards = (profile.kingShards ?? 0) + tro.shards; lines.push(`+${tro.shards} King's Shards (craft set pieces in Gear)`); }
  if (tro.hallows) { profile.hallows = (profile.hallows ?? 0) + tro.hallows; lines.push(`+${tro.hallows} Seraph Hallow (make an item ancestral in Gear)`); }
  const chis = chiselsForRun(tally);
  if (chis) { profile.chisels = (profile.chisels ?? 0) + chis; lines.push(`+${chis} Gilded Chisels (add or re-roll affixes in Gear)`); }
  const dust = dustForRun(tally);
  if (dust) { profile.relicDust = (profile.relicDust ?? 0) + dust; lines.push(`+${dust} Relic Dust (extract legendary powers in Gear)`); }
  const runAether = aetherForRun(tally);
  if (runAether) { profile.aether = (profile.aether ?? 0) + runAether; lines.push(`+${runAether} ${SHOP.symbol} ${SHOP.currency}`); }
  if (completeInfo) {
    if (run.kind !== "trial") c.riftsCleared++;
    if (run.kind === "rift") {
      const up = Math.min(T.max, run.tier + tierJump(completeInfo.time));
      if (completeInfo.inTime && up > c.highestTier) { const was = c.highestTier; c.highestTier = up; lines.push(up - Math.max(was, run.tier) > 1 ? `Fast clear! Tier ${up} unlocked (+${up - run.tier})` : `Tier ${up} unlocked!`); }
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
    if (run.kind === "chase" && run.boss === "seraph") c.seraphs = (c.seraphs ?? 0) + 1;
    else if (run.kind === "chase") c.kings = (c.kings ?? 0) + 1;
    if (run.kind === "trial" && completeInfo.inTime && (run.tier > (c.trialBest ?? 0) || c.trialRe !== undefined)) {
      const before = talentPoints(c);
      trialPassed(c, run.tier);
      lines.push(`Trial ${run.tier} passed! +${talentPoints(c) - before} talent point${talentPoints(c) - before === 1 ? "" : "s"} (${talentPoints(c)} total). Spend them under Skills → Talents.`);
    } else if (run.kind === "trial") lines.push(completeInfo.inTime ? "Already passed: no new point. Try the next level." : `Not in time. Clear all ${RIFT.trial.waves} waves within ${fmtTime(RIFT.trial.timeLimit)}.`);
    const wave = s.rift.wave ?? 0;
    if (run.kind === "endless" && wave > (c.bestWave ?? 0)) { c.bestWave = wave; lines.push(`New best: wave ${wave}`); }
    checkFeats(lines);
    saveProfile(profile);
    const title = run.kind === "vault" ? "The Gilded Vault" : run.kind === "trial" ? (completeInfo.inTime ? `Trial ${run.tier} passed` : `Trial ${run.tier} failed`) : run.kind === "bounty" ? "Bounties complete" : run.kind === "endless" ? `Endless: wave ${wave}` : run.kind === "chase" ? (run.boss === "seraph" ? "The Pale Seraph falls" : "The Ossuary King falls") : completeInfo.inTime ? "Rift cleared in time!" : "Guardian slain";
    const sub = run.kind === "vault" ? "The vault sealed itself again." : run.kind === "trial" ? (completeInfo.inTime ? "Talent points make your hero stronger in every activity." : "No talent point this time.") : run.kind === "endless" ? `Reached difficulty level ${s.rift.level ?? 0} from tier ${run.tier}. The chest grows every ${RIFT.endless.rewards.perWaves} waves.` : completeInfo.inTime ? "Bonus loot for time remaining." : "The timer ran out, so the rewards were smaller.";
    finishOnline();
    screen = "results";
    ui.showResults({ title, sub, time: completeInfo.time, kills: s.rift.kills, found, legendaries: foundLegs, lines }, goHub);
  } else { checkFeats(); saveProfile(profile); finishOnline(); sim = null; run = null; mode = "hub"; goHub(); return; } // goHub starts the hideout run, so clear first
  sim = null; run = null; mode = "hub";
}

/** Mark newly reached feats as done; their rewards unlock through the Earn rule. Lines go on the results screen. */
function checkFeats(lines?: string[]): boolean {
  const n = newFeats(profile), ch = newChapters(profile, seasonStats(profile));
  if (!n.length && !ch.length) return false;
  const keys = [...n.map((a) => a.id), ...ch.map(chapterKey)];
  profile.feats = [...(profile.feats ?? []), ...keys];
  const ae = aetherForFeats(keys);
  if (ae) { profile.aether = (profile.aether ?? 0) + ae; lines?.push(`+${ae} ${SHOP.symbol} ${SHOP.currency} from feats`); }
  for (const a of n) lines?.push(`Feat: ${a.name}${a.reward ? ` · ${rewardName(a.reward)} unlocked in the Wardrobe` : ""}`);
  for (const i of ch) { const c = SEASON_JOURNEY.chapters[i]; lines?.push(`Season journey: ${c.name} complete${c.reward ? ` · ${rewardName(c.reward)} unlocked in the Wardrobe` : ""}`); }
  return true;
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
  online.send({ t: "save", report: { equipment: c.equipment, bag: c.bag, scrapped, materials: profile.materials, shards: profile.shards ?? 0, level: c.level, xp: c.xp, paragon: c.paragon ?? 0, pxp: c.pxp ?? 0, sigils: c.sigils, feathers: c.feathers ?? 0, vaultKeys: c.vaultKeys ?? 0, gems: c.gems ?? {}, gemSlots: c.gemSlots ?? [], uses: c.uses, highestTier: c.highestTier, pityAnc: c.pityAnc, pityPri: c.pityPri, bestTimes: c.bestTimes, riftsCleared: c.riftsCleared, tally: runTally ? { kills: runTally.kills, elites: runTally.elites, deaths: runTally.deaths, wave: runTally.wave } : undefined }, week: isoWeek(), weeklyBest: run.weekly });
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
  return !!r;
}
/** The local input, except in the hideout: next to a station or portal, the main attack button uses it instead of attacking. */
let hideTapHeld = false;
function readInput(): PlayerInput {
  const inp = input.read(sim!, me(), toWorld);
  if (!inHideout() || decorating) return inp;
  const down = (inp.act & 1) !== 0;
  if (hideNear && down) {
    if (!hideTapHeld) { hideTapHeld = true; const spot = hideNear; setTimeout(() => useSpot(spot), 0); }
    return { ...inp, act: inp.act & ~1 };
  }
  hideTapHeld = down; // a held attack that walks into a spot doesn't fire it; lift and press again
  return inp;
}
function goHub() { if (checkFeats()) saveProfile(profile); enterHideout(); }
function showMenu() {
  if (!sim) { mode = "hub"; screen = "hub"; }
  ui.showHub(profile, hubHandlers());
}
function hubHandlers(): HubHandlers {
  return {
    close: sim ? closeMenu : undefined,
    previewTheme,
    enter: startRun,
    invCmd: (cmd) => hubOp({ t: "inv", cmd }),
    setClass: (cls) => hubOp({ t: "setClass", cls }),
    setRune: (skill, rune) => hubOp({ t: "setRune", skill, rune }),
    setSkill: (slot, skill) => hubOp({ t: "setSkill", slot, skill }),
    reroll: (target, idx, choice) => hubOp({ t: "reroll", target, idx, choice }),
    setting: (k, v) => hubOp({ t: "setting", k, v }),
    op: hubOp,
    newSeason: () => { hubOp({ t: "newSeason" }); menuOpen = false; goHub(); },
    reset: () => { hubOp({ t: "reset" }); menuOpen = false; goHub(); },
    rerollOptions: online && !online.direct ? (target, idx) => (online as Online).rerollOptions(target, idx) : undefined,
    coop: !online ? undefined : online.direct
      ? { name: online.name, lobby: online.lobby, direct: true, connecting: online.connecting, host: () => (online as Direct).host(), join: (code) => (online as Direct).join(code), leave: () => online!.leave(), setName: (n: string) => { (online as Direct).setName(n); refreshMenu(); } }
      : { name: online.name, lobby: online.lobby, host: () => online!.host(), join: (code) => online!.join(code), leave: () => online!.leave(), signOut: () => { signOut(); location.reload(); } },
  };
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
document.addEventListener("visibilitychange", () => { if (document.hidden && sim && !inHideout()) { syncFromSim(profile, sim, ME); if (!ui.invOpen && !completeInfo) openRiftInventory(); } });

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
  ghoul: ["#6f8f5a", "#4a6640", "#9bc27a"], archer: ["#f2ead3", "#c9bf9f"], brute: ["#9a7aa8", "#6b4f7a", "#4a3456"], guardian: ["#f2ead3", "#ffd23f", "#2b1f3a"], hexer: ["#5a3f73", "#c06aff", "#f2ead3"], gorehorn: ["#7a4a3a", "#f2ead3", "#4a2a22"], shieldbearer: ["#8d93ab", "#f2ead3", "#565b74"],
  king: ["#f2ead3", "#ff3b6b", "#2b1f3a"], hound: ["#f2ead3", "#c9bf9f", "#8a7f66"], pylon: ["#f2ead3", "#ffd23f"],
};
/** The premium effect a player picked for a skill, if any. */
function fxOf(pid: number | undefined, skill: string | undefined): VfxStyle | undefined {
  if (pid === undefined || !skill || !sim) return undefined;
  const id = sim.players.find((q) => q.pid === pid)?.cos?.fx?.[skill];
  return id ? VFX.styles[id] : undefined;
}
/** Trail and burst particles in a style's own shape. */
function fxParticles(st: VfxStyle, x: number, y: number, n: number, speed: number) {
  for (let i = 0; i < n && particles.length < 600; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    const cols = [st.main, st.accent, st.core];
    const color = st.trail === "prism" ? `hsl(${Math.floor((performance.now() / 4 + i * 47) % 360)},90%,70%)` : cols[Math.floor(Math.random() * 3)];
    const up = st.trail === "ember" || st.trail === "wisp" || st.trail === "smoke" ? -30 : st.trail === "drip" || st.trail === "leaf" || st.trail === "snow" ? 25 : 0;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + up, life: 0.5, max: 0.5, color, size: st.trail === "sparkle" || st.trail === "prism" ? 1 : st.trail === "smoke" ? 3 : 2, grav: st.trail === "drip" ? 120 : 0 });
  }
}
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
      if (e.elite) runElites++;
      burst(e.x, e.y, e.kind === "brute" || e.elite ? 26 : e.kind === "guardian" || e.kind === "king" ? 80 : 12, BLOOD[e.kind] ?? BLOOD.ghoul, e.kind === "guardian" || e.kind === "king" ? 160 : 90, e.kind === "ghoul" ? 1 : 2, 0.6, 150);
      if (e.kind === "guardian" || e.kind === "king") { hitstop = 0.4; addShake(12); flash = 0.5; flashColor = "#fff"; sfx.bigKill(); }
      else if (e.kind === "brute" || e.elite) { hitstop = Math.max(hitstop, 0.07); addShake(5); sfx.bigKill(); }
      else sfx.kill();
      break;
    case "swing":
      { const v = fxOf(e.pid, e.skill); arcs.push({ x: e.x, y: e.y, fx: e.fx, fy: e.fy, r: e.range, ring: e.ring, t: 0, arcCos: e.arcCos, vfx: v }); if (v) fxParticles(v, e.x + e.fx * e.range * 0.6, e.y + e.fy * e.range * 0.6, 10, 60); }
      sfx.swing();
      if (e.hits > 0 && mine(e.pid)) { addShake(e.ring ? 3 : 1); hitstop = Math.max(hitstop, e.ring ? 0.05 : 0.018); }
      break;
    case "cast": {
      const sk = SKILL[e.skill];
      if (!sk) break;
      const v = fxOf(e.pid, e.skill);
      if (v) { fxParticles(v, e.x, e.y, 18, 90); rings.push({ x: e.x, y: e.y, r: e.r ?? 24, t: 0, max: 0.35, color: v.main, fill: sk.kind === "nova" }); if (sk.kind !== "projectile" && sk.kind !== "melee") break; }
      if (sk.kind === "projectile") sfx.lance();
      if (sk.kind === "dash") sfx.dash();
      if (sk.kind === "summon") { sfx.summon(); burst(e.x, e.y, 20, ["#ff8a1f", "#ffd23f"], 80, 1, 0.5); }
      if (sk.kind === "shout") { sfx.shout(); rings.push({ x: e.x, y: e.y, r: e.r ?? 100, t: 0, max: 0.5, color: e.skill === "rally_banner" ? "#7dff9a" : "#ffd23f" }); addShake(2); }
      if (sk.kind === "nova") { sfx.explosion(); const p = sim?.players.find((q) => q.pid === e.pid); const col = p ? SKILL_COLOR(p.sk[e.skill].tags) : "#ff8a1f"; rings.push({ x: e.x, y: e.y, r: e.r ?? 56, t: 0, max: 0.3, color: col, fill: true }); burst(e.x, e.y, 24, [col, "#fff"], 160, 1, 0.4); addShake(2.5); }
      if (sk.kind === "trap") { sfx.ui(); rings.push({ x: e.x, y: e.y, r: e.r ?? 30, t: 0, max: 0.25, color: sk.tags.includes("construct") ? "#e8dcb0" : "#9be0ff" }); }
      if (sk.kind === "build") { sfx.summon(); burst(e.x, e.y, 14, ["#e8dcb0", "#c9bf9f", "#ffd23f"], 70, 1, 0.45); }
      if (e.skill === "ossuary_colossus") { burst(e.x, e.y, 40, ["#e8dcb0", "#ffd23f", "#fff"], 140, 1, 0.7); addShake(7); if (mine(e.pid)) showBanner("COLOSSUS", "Smash everything", "#ffd23f", 1.8); }
      break;
    }
    case "waveStart": showBanner(`WAVE ${e.wave}`, e.boss ? "An elite brute leads this one" : `${e.count} enemies`, e.boss ? "#ffd23f" : "#ff8a5a", 1.6); sfx.shout(); break;
    case "waveClear": if (e.cleared && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 24, text: e.jump > 1 ? `FAST +${e.jump}` : "cleared", color: e.jump > 1 ? "#ffd23f" : "#b8a8d0", size: e.jump > 1 ? 1.4 : 0.9, t: 0, vx: 0 }); } break;
    case "endlessOver": break;
    case "block":
      if (mine(e.pid) && sim && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 18, text: "Block", color: "#bfe8ff", size: 1, t: 0, vx: 0 }); }
      break;
    case "playerHurt":
      if (!mine(e.pid)) break;
      if (!e.amount) { if (sim && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 14, text: "absorbed", color: "#bfe8ff", size: 1, t: 0, vx: 0 }); } break; }
      addShake(3); hurtFlash = 0.35; sfx.hurt();
      if (sim && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 14, text: "-" + e.amount, color: "#ff4a4a", size: 1, t: 0, vx: 0 }); }
      break;
    case "playerDeath": if (mine(e.pid)) { sfx.death(); showDeath(e.killer, e.recap, e.penalty); } else if (sim && sim.players.length > 1) showBanner(`${sim.players.find((q) => q.pid === e.pid)?.name ?? "An ally"} fell`, "Stand on their marker to revive them", "#ff8a8a", 2); break;
    case "respawn": if (mine(e.pid)) { hideDeath(); if (e.penalty) showBanner("BACK IN", `−${e.penalty} s on the timer`, "#ffb0b0", 1.6); } break;
    case "revived": if (mine(e.pid)) { hideDeath(); showBanner("REVIVED", `${sim?.players.find((q) => q.pid === e.by)?.name ?? "An ally"} picked you up · no penalty`, "#7dff9a", 2); } else if (mine(e.by)) showBanner("REVIVED", "No penalty for them", "#7dff9a", 1.4); break;
    case "cheatDeath": if (mine(e.pid)) { showBanner("THE LAST EMBER", "Death refused", "#ff3b6b", 2); flash = 0.4; flashColor = "#ff3b6b"; } break;
    case "slam": rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.35, color: e.big ? "#ffd23f" : "#ff6a6a" }); addShake(e.big ? 6 : 3); sfx.slam(); burst(e.x, e.y, 12, ["#5c4a6e", "#8a7f66"], 90, 1, 0.5); break;
    case "explosion": { const v = fxOf(e.pid, e.skill); if (v) { rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.35, color: v.main, fill: true }); fxParticles(v, e.x, e.y, 20, 120); addShake(2.5); sfx.explosion(); break; } }
      rings.push({ x: e.x, y: e.y, r: e.r, t: 0, max: 0.3, color: e.cold ? "#9be0ff" : "#ff8a1f" }); burst(e.x, e.y, 16, e.cold ? ["#9be0ff", "#fff"] : ["#ff8a1f", "#ffd23f", "#ff5a1f"], 110, 1, 0.45); addShake(2.5); sfx.explosion(); break;
    case "teleport": burst(e.x, e.y, 14, ["#c9a0ff", "#fff"], 70, 1, 0.4); break;
    case "chain": if (bolts.length < 40) bolts.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, t: 0, fx: fxOf(e.pid, e.skill) }); break;
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
      if (noteFinds(profile, [e.item]).length) ui.findCard(e.item);
      if (e.rarity === "legendary" || e.rarity === "set" || e.rarity === "mythic") foundLegs.push({ name: e.name, rarity: e.rarity, quality: e.item.quality });
      if (Object.values(me().equipment).some((it) => it?.id === e.item.id)) ui.toast(`Equipped ${e.name} (empty slot)`, RARITY_COLOR[e.rarity]);
      else if (e.rarity !== "common" && e.rarity !== "magic") ui.toast(`Picked up ${e.name} · Bag to equip`, RARITY_COLOR[e.rarity]);
      syncFromSim(profile, sim!, ME);
      break;
    case "scrapped": if (mine(e.pid)) scrappedIds.push(e.id); if (mine(e.pid) && nums.length < 70) { const p = me(); nums.push({ x: p.x, y: p.y - 18, text: `+${e.mats} mat`, color: "#b8a8d0", size: 0.7, t: 0, vx: 0 }); } break;
    case "bagFull": if (mine(e.pid)) ui.toast("Bag full! Open the Bag and scrap something.", "#ff6a6a"); break;
    case "ambush": ui.toast("Ambush! Enemies close in", "#ff8a5a", 1600); addShake(3); break;
    case "guardianSpawn": showBanner(e.kind === "king" ? "THE OSSUARY KING" : guardianDef(e.variant).name.toUpperCase(), e.kind === "king" ? "rises from the bone pit" : `${guardianDef(e.variant).sub} · ${guardianDef(e.variant).tip}`, "#ffd23f", 3); addShake(8); sfx.guardian(); burst(e.x, e.y, 60, ["#2b1f3a", "#ffd23f", "#f2ead3"], 140, 2, 0.9); break;
    case "enrage": showBanner("ENRAGED", "Faster and deadlier", "#ff4a4a", 2); sfx.guardian(); break;
    case "guardianStun": showBanner("STUNNED", "", "#9be0ff", 1); break;
    case "phase": showBanner(`PHASE ${Math.min(3, e.n)}`, e.text, "#ff3b6b", 3); sfx.guardian(); addShake(6); break;
    case "timeUp": if (run?.kind === "trial" || run?.kind === "vault") break; showBanner("TIME'S UP", "Finish for reduced rewards", "#ff7a3c", 2.5); break;
    case "paragonUp":
      if (!mine(e.pid)) break;
      sfx.complete(); burst(me().x, me().y - 8, 40, ["#c9a0ff", "#fff", "#ffd23f"], 120, 1, 0.8);
      showBanner(`PARAGON ${e.level}`, "A point to spend at the Skill Shrine", "#c9a0ff", 2.5);
      syncFromSim(profile, sim!, ME);
      break;
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
    case "bountyTask": showBanner(e.left ? "BOUNTY DONE" : "ALL BOUNTIES DONE", e.left ? `${e.text} · ${e.left} to go` : "Grab your cache, then Finish", "#ffd23f", 2.5); sfx.guardian(); break;
    case "gem": if (mine(e.pid)) showBanner("RIFT GEM!", `${GEM[e.id]?.name ?? e.id} · socket it in Gear`, GEM[e.id]?.color ?? "#ffd23f", 3); break;
    case "gemUp": if (mine(e.pid)) gemLines.push(`${GEM[e.id]?.name ?? e.id} → level ${e.level}`); break;
    case "impAlert": showBanner("GILDED IMP!", `Catch it in ${RIFT.imp.escapeAfter}s before it escapes`, "#ffd23f", 2.2); sfx.shout(); break;
    case "impEscape": burst(e.x, e.y - 6, 30, ["#ffd23f", "#fff0a0", "#8a6d22"], 90, 1, 0.6); showBanner("IT GOT AWAY", "The imp vanished with its hoard", "#b8a8d0", 2); break;
    case "impKill": burst(e.x, e.y - 6, 50, ["#ffd23f", "#fff0a0", "#c9a23a"], 140, 1, 0.9); break;
    case "vaultKey": if (mine(e.pid)) { gotKey++; showBanner("GILDED KEY", "Opens the Gilded Vault in your hideout", "#ffd23f", 2.5); } break;
    case "feather": if (mine(e.pid)) { gotFeather++; showBanner("PALE FEATHER", "Opens the Sanctum of the Pale Seraph", "#bfe8ff", 2.5); } break;
    case "riftComplete":
      completeInfo = { inTime: e.inTime, time: e.time };
      sfx.complete();
      if (run?.kind === "vault") showBanner("THE VAULT SEALS", "Grab what you can, then Finish", "#ffd23f", 4);
      else if (run?.kind === "trial") showBanner(e.inTime ? "TRIAL PASSED" : "TRIAL FAILED", e.inTime ? `${fmtTime(e.time)} · tap Finish` : "The timer ran out · tap Finish to try again", e.inTime ? "#7dff9a" : "#ff7a3c", 4);
      else if (run?.kind === "endless") showBanner(`WAVE ${sim?.rift.wave ?? 0}`, "Out of lives · grab your chest, then Finish", "#ff8a5a", 4);
      else showBanner(run?.kind === "chase" ? (run.boss === "seraph" ? "SERAPH SLAIN" : "KING SLAIN") : e.inTime ? "RIFT CLEARED" : "GUARDIAN SLAIN", `${fmtTime(e.time)} · grab your loot, then Finish`, "#7dff9a", 4);
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
      const inp: PlayerInput = readInput();
      if (coop) hostStep(inp);
      else { step(sim, { [ME]: inp }); afterStep(); }
      acc -= DT; steps++;
      if (hitstop > 0) { acc = 0; break; }
    }
    if (steps === 4) acc = 0;
    updateFx(dt);
    if (sim) render(Math.min(1, acc / DT), dt);
    hideoutTick();
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
const heroFrames = (cls: string) => (cls === "gloomstalker" ? bank.ranger : cls === "stormcaller" ? bank.mage : cls === "bonewright" ? bank.wright : bank.hero);

function render(alpha: number, dt: number) {
  const s = sim!;
  const p = me();
  if (!p) return; // joining a room: the host's world arrives before our hero is in it
  const px = lerp(p.px, p.x, alpha), py = lerp(p.py, p.y, alpha);
  const W = wb.width, H = wb.height;
  const k = Math.min(1, dt * 12);
  camX += (px - W / 2 - camX) * k; camY += (py - H / 2 - camY) * k;
  const sx = Math.round(camX + (Math.random() - 0.5) * shake * 2), sy = Math.round(camY + (Math.random() - 0.5) * shake * 2);
  const g = wctx;
  g.imageSmoothingEnabled = false;
  g.fillStyle = (sim?.rift.kind === "hideout" ? hideoutTheme(sim.rift.hideout?.theme).map.void : sim?.rift.map && MAP[sim.rift.map]?.theme.void) || "#0e0a14"; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(-sx, -sy);
  const t = performance.now() / 1000;
  const hth = s.rift.kind === "hideout" ? hideoutTheme(s.rift.hideout?.theme) : undefined;
  if (hth?.map.open) drawThemeUnder(g, s.map, hth, t);
  g.drawImage(mapCanvas!, sx, sy, W, H, sx, sy, W, H);
  if (hth) drawThemeFloor(g, s.map, hth, t, s.rift.hideout?.layout);
  const onScreen = (x: number, y: number, m = 40) => x > sx - m && x < sx + W + m && y > sy - m && y < sy + H + m;

  for (const h of s.hazards) {
    if (!onScreen(h.x, h.y)) continue;
    const a = Math.min(1, h.life / 0.6);
    const frost = h.kind === "frost";
    if (h.kind === "bone") { drawSpikes(g, h, a, t); continue; }
    g.globalAlpha = (h.max > 3 ? 0.35 : 0.5) * a;
    g.fillStyle = frost ? ((Math.floor(t * 6 + h.id) % 2) ? "#9be0ff" : "#5fb0e0") : ((Math.floor(t * 12 + h.id) % 2) ? "#ff5a1f" : "#ff8a1f");
    g.beginPath(); g.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); g.fill();
    if (h.max > 3) { g.globalAlpha = 0.8 * a; g.strokeStyle = frost ? "#d8f4ff" : "#ffd23f"; g.beginPath(); g.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
    if (Math.random() < 0.06) particles.push({ x: h.x + (Math.random() - 0.5) * h.r, y: h.y, vx: 0, vy: -20, life: 0.4, max: 0.4, color: frost ? "#fff" : "#ffd23f", size: 1, grav: 0 });
  }
  // bounty shrine: a gold ring that fills while someone holds it
  for (const bt of s.rift.bounty ?? []) {
    if (bt.kind !== "shrine" || !onScreen(bt.x, bt.y)) continue;
    const R = RIFT.bounty.shrineRadius;
    g.globalAlpha = bt.done ? 0.25 : 0.35 + 0.1 * Math.sin(t * 3); g.strokeStyle = "#ffd23f"; g.lineWidth = 2;
    g.beginPath(); g.ellipse(bt.x, bt.y, R, R * 0.6, 0, 0, Math.PI * 2); g.stroke();
    if (bt.have > 0) { g.globalAlpha = 0.9; g.strokeStyle = "#fff0a0"; g.beginPath(); g.ellipse(bt.x, bt.y, R, R * 0.6, 0, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * bt.have) / bt.need); g.stroke(); }
    g.lineWidth = 1; g.globalAlpha = 1;
    g.fillStyle = "#ffd23f"; g.fillRect(Math.round(bt.x) - 1, Math.round(bt.y) - 12, 3, 10); g.fillStyle = "#fff0a0"; g.fillRect(Math.round(bt.x) - 2, Math.round(bt.y) - 15, 5, 4);
  }
  for (const z of s.zones) {
    if (!onScreen(z.x, z.y)) continue;
    if (z.kind === "mire") {
      // the Matron's pools: a ring while landing, then murky water that slows
      const landing = z.tickT > 0 && z.life > 4.4;
      g.globalAlpha = landing ? 0.3 : 0.5; g.fillStyle = (Math.floor(t * 4 + z.id) % 2) ? "#2f5a55" : "#3a6a5a";
      g.beginPath(); g.ellipse(z.x, z.y, z.r, z.r * 0.6, 0, 0, Math.PI * 2); g.fill();
      g.globalAlpha = landing ? 0.9 : 0.4; g.strokeStyle = "#7dd6c8"; g.stroke(); g.globalAlpha = 1;
      if (Math.random() < 0.05) particles.push({ x: z.x + (Math.random() - 0.5) * z.r, y: z.y, vx: 0, vy: -12, life: 0.5, max: 0.5, color: "#c6ff6a", size: 1, grav: 0 });
    } else if (z.kind === "pool") { g.globalAlpha = 0.55; g.fillStyle = (Math.floor(t * 10 + z.id) % 2) ? "#c2361f" : "#e0521f"; g.beginPath(); g.ellipse(z.x, z.y, z.r, z.r * 0.6, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
    else telegraphCircle(g, z.x, z.y, z.r, 1 - z.delay / 1.4, z.kind === "frost");
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
    // a set piece shines in its set's colour, a primal in red, an ancestral with a gold core
    const setCol = l.item.set ? SET[l.item.set]?.color : undefined;
    const q = l.item.quality;
    const col = q === "primal" ? "#ff3b3b" : setCol ?? RARITY_COLOR[r];
    const hidden = RARITY_ORDER_IDX(r) < RARITY_ORDER_IDX(profile.filter);
    const bob = Math.sin(t * 4 + l.id) * 1.5;
    const big = r === "legendary" || r === "set" || r === "mythic";
    const hgt = hidden ? 0 : big ? (q ? 130 : 100) : r === "rare" ? 40 : r === "magic" ? 22 : 0;
    if (hgt) {
      const wdt = big ? 6 + Math.sin(t * 8) : 3;
      const gr = g.createLinearGradient(0, l.y - hgt, 0, l.y);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, col);
      g.globalAlpha = 0.65; g.fillStyle = gr; g.fillRect(Math.round(l.x - wdt / 2), l.y - hgt, wdt, hgt);
      if (big) {
        // a bright core, a ring that pulses out along the floor, and motes drifting up the beam
        g.globalAlpha = 0.8; g.fillStyle = q === "ancestral" ? "#ffd23f" : "#fff"; g.fillRect(Math.round(l.x - 1), l.y - hgt * 0.8, 2, hgt * 0.8);
        const ph = (t * 0.8 + l.id * 0.13) % 1;
        g.globalAlpha = 0.6 * (1 - ph); g.strokeStyle = col; g.lineWidth = 1;
        g.beginPath(); g.ellipse(l.x, l.y + 2, 4 + ph * 16, (4 + ph * 16) * 0.45, 0, 0, Math.PI * 2); g.stroke();
        for (let i = 0; i < (q ? 6 : 4); i++) {
          const k = (t * 0.6 + i / (q ? 6 : 4) + l.id * 0.07) % 1;
          g.globalAlpha = 0.9 * (1 - k); g.fillStyle = i % 2 ? col : "#fff";
          g.fillRect(Math.round(l.x + Math.sin(t * 3 + i * 2 + l.id) * 4), Math.round(l.y - k * hgt * 0.9), 1, 1);
        }
      }
      g.globalAlpha = 1;
    }
    const ic = bank.icon(l.item.slot, r, setCol);
    g.globalAlpha = hidden ? 0.35 : 1;
    g.fillStyle = "rgba(0,0,0,0.4)"; g.fillRect(l.x - 4, l.y + 3, 8, 2);
    g.drawImage(ic.img, Math.round(l.x - ic.w / 2), Math.round(l.y - ic.h + 2 + bob));
    g.globalAlpha = 1;
  }
  for (const b of bolts) {
    g.strokeStyle = (Math.floor(b.t * 60) % 2) ? (b.fx?.core ?? "#ffffff") : (b.fx?.main ?? "#9be0ff"); g.lineWidth = 1; g.beginPath(); g.moveTo(b.x1, b.y1);
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
    if (m.build) { list.push({ y: my, f: () => drawConstruct(g, s, m, mx, my, t) }); continue; }
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
  if (hth) {
    for (const d of s.rift.hideout?.decor ?? []) { if (s.map.tiles[d.y * s.map.w + d.x] !== 0) continue; const x = (d.x + 0.5) * s.map.ts, y = (d.y + 1) * s.map.ts - 2; list.push({ y: d.id === "rug" ? -1e9 : y, f: () => drawDecor(g, d.id, x, y, t) }); }
    for (const st of HIDEOUT.stations) {
      const [x, y] = spotPos(s.map, hth, st, s.rift.hideout?.layout);
      if (st.id === "showcase") {
        // the owner's hero on a plinth, in their current gear look (co-op visitors see the host's)
        const host = s.players.find((q) => q.pid === 0) ?? s.players[0];
        list.push({ y, f: () => drawShowcase(g, st, x, y, t, hideNear === st, (hx, hy) => {
          if (!host) return 12;
          const look = gearLook(host);
          const cos = look.set && profile.settings.setLooks !== false ? { ...(host.cos ?? {}), dye: "set:" + look.set } : host.cos ?? {};
          const fr = drawHeroCos(g, bank, { pid: host.pid, cls: host.cls, cos, fx: 0.4, fy: 0.9, moving: false, walk: 0, swingK: 0 }, hx, hy, t, emitFx);
          gearMarks(g, { ...host, moving: false, fx: 0.4 } as Player, look, hx, hy, fr.h, t);
          return fr.h;
        }) });
        continue;
      }
      list.push({ y, f: () => drawStation(g, st, x, y, t, hideNear === st, stationNote(st.id)) });
    }
    for (const po of HIDEOUT.portals) { const [x, y] = spotPos(s.map, hth, po, s.rift.hideout?.layout); list.push({ y: -1e8, f: () => drawPortal(g, po, x, y, t, hideNear === po, po.kind === "chase" ? (po.id === "seraph" ? `T${bossTier()} · ${char(profile).feathers ?? 0} feathers` : `T${bossTier()} · ${char(profile).sigils} sigils`) : po.kind === "endless" ? `best wave ${char(profile).bestWave ?? 0}` : po.kind === "trial" ? `trial ${trialTarget(char(profile))}` : po.kind === "vault" ? `${char(profile).vaultKeys ?? 0} keys` : `tier ${curTier()}`) }); }
  }
  for (const q of s.players) {
    if (q.dead) { list.push({ y: q.y, f: () => drawFallen(g, q, q.x, q.y, t) }); continue; }
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
    const pv = pr.team === 0 ? fxOf(pr.pid, pr.skill) : undefined;
    if (pv) {
      // premium effect: a glowing head in the style's colours with its own trail
      g.globalAlpha = 0.35; g.fillStyle = pv.accent; g.beginPath(); g.arc(x, y, pr.r + 4, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = pv.main; g.lineWidth = Math.max(3, pr.r * 0.7);
      g.beginPath(); g.moveTo(x - nx * 12, y - ny * 12); g.lineTo(x + nx * 3, y + ny * 3); g.stroke();
      g.strokeStyle = pv.core; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x - nx * 9, y - ny * 9); g.lineTo(x + nx * 4, y + ny * 4); g.stroke();
      if (Math.random() < 0.6) fxParticles(pv, x - nx * 6, y - ny * 6, 1, 15);
      continue;
    }
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
    g.strokeStyle = a.vfx ? a.vfx.main : a.ring ? "#ffd23f" : "#ffffff"; g.lineWidth = a.vfx ? 4 : 3;
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
  if (hth) drawThemeAir(g, s.map, hth, t);
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
function telegraphCircle(g: CanvasRenderingContext2D, x: number, y: number, r: number, k: number, frost = false) {
  g.fillStyle = frost ? "rgba(90,180,255,0.18)" : "rgba(255,40,40,0.18)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = frost ? "rgba(140,210,255,0.4)" : "rgba(255,60,60,0.35)"; g.beginPath(); g.arc(x, y, r * Math.max(0, Math.min(1, k)), 0, Math.PI * 2); g.fill();
  g.strokeStyle = frost ? "rgba(190,235,255,0.9)" : "rgba(255,90,90,0.8)"; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}

function drawEnemy(g: CanvasRenderingContext2D, e: Enemy, x: number, y: number, t: number) {
  const moving = Math.abs(e.x - e.px) + Math.abs(e.y - e.py) > 0.05;
  const frames = e.kind === "ghoul" ? bank.ghoul : e.kind === "hound" ? bank.hound : e.kind === "hexer" ? bank.hexer : e.kind === "gorehorn" ? bank.gorehorn : e.kind === "shieldbearer" ? bank.shieldbearer : e.kind === "archer" ? bank.archer : e.kind === "brute" ? bank.brute : e.kind === "pylon" ? bank.pylon : e.kind === "imp" ? bank.hoard : e.variant === "seraph" ? bank.seraph : e.variant ? bank.guardianOf(e.variant) : bank.guardian;
  const fr = frames[moving ? Math.floor(t * 8 + e.id) % frames.length : 0];
  const tgt = sim!.players.find((q) => q.pid === e.target);
  const flip = tgt ? tgt.x < e.x : false;
  const scale = e.variant === "seraph" ? 1.25 : e.kind === "king" ? 1.4 : e.scale;
  shadow(g, x, y, e.r);
  let yy = y;
  if (["windup", "slam", "nova", "chargeWind", "fire"].includes(e.state)) yy -= Math.floor(t * 20) % 2;
  // Gorehorn: a line shows where it will charge
  if (e.kind === "gorehorn" && e.state === "windup") {
    g.globalAlpha = 0.35 + 0.25 * Math.sin(t * 20); g.strokeStyle = "#ff5a3a"; g.lineWidth = 4;
    const L = (ENEMIES.gorehorn.chargeSpeed ?? 230) * (ENEMIES.gorehorn.chargeTime ?? 0.6);
    g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + e.tx * L, y - 3 + e.ty * L); g.stroke(); g.lineWidth = 1; g.globalAlpha = 1;
  }
  // Hexer: its staff glows while casting
  if (e.kind === "hexer" && e.state === "windup" && Math.random() < 0.5) particles.push({ x: x + (Math.random() - 0.5) * 8, y: y - 10, vx: 0, vy: -20, life: 0.3, max: 0.3, color: "#c06aff", size: 1, grav: 0 });
  if (e.kind === "guardian" || e.kind === "king") yy += Math.sin(t * 2) * 1.5 - 2;
  // the Seraph rises during Judgement
  if (e.variant === "seraph" && e.state === "tomb") yy -= 10;
  if ((e.kind === "guardian" || e.kind === "king") && e.state === "intro") g.globalAlpha = 1 - Math.max(0, e.t / 2) * 0.7;
  if (e.kind === "imp") { // a gold glow and a trail of coins
    g.globalAlpha = 0.3 + 0.2 * Math.sin(t * 8); g.fillStyle = "#ffd23f"; g.beginPath(); g.ellipse(x, y, e.r + 6, (e.r + 6) * 0.5, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    if (moving && Math.random() < 0.4) particles.push({ x: x + (Math.random() - 0.5) * 6, y: y - 4, vx: 0, vy: -10, life: 0.5, max: 0.5, color: Math.random() < 0.5 ? "#ffd23f" : "#fff0a0", size: 1, grav: 0 });
  }
  if (e.elite) {
    g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 6);
    g.fillStyle = e.affixes.includes("molten") ? "#ff5a1f" : e.affixes.includes("frozen") || e.affixes.includes("shielded") ? "#9be0ff" : e.affixes.includes("thorns") ? "#7aff6a" : "#c9a0ff";
    g.beginPath(); g.ellipse(x, y, e.r + 4, (e.r + 4) * 0.5, 0, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  if (e.state === "stun" || e.state === "tomb") { g.fillStyle = e.state === "tomb" ? "#ffd23f" : "#9be0ff"; for (let i = 0; i < 3; i++) g.fillRect(Math.round(x + Math.cos(t * 6 + i * 2) * 12), Math.round(yy - fr.h * scale - 2 + Math.sin(t * 6 + i * 2) * 2), 2, 2); }
  drawSprite(g, fr, x, yy, flip, e.flash > 0, scale);
  if (e.kind === "king" && e.variant !== "seraph") { g.globalAlpha = 0.25; g.fillStyle = "#ff3b6b"; g.fillRect(Math.round(x - fr.w * scale / 2), Math.round(yy - fr.h * scale + 2), Math.round(fr.w * scale), Math.round(fr.h * scale)); }
  if (e.enraged || e.state === "tomb") { g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 12); drawSprite(g, fr, x, yy, flip, true, scale); }
  if (e.slowT > 0) { g.globalAlpha = 0.3; g.fillStyle = "#9be0ff"; g.fillRect(Math.round(x - e.r), Math.round(yy - fr.h * scale + 2), e.r * 2, Math.round(fr.h * scale)); }
  g.globalAlpha = 1;
  if (e.kind === "shieldbearer") {
    // the tower shield, drawn on the side it faces
    const sx = Math.round(x + e.tx * 7), sy = Math.round(yy - 7 + e.ty * 4);
    g.fillStyle = "#140c1c"; g.fillRect(sx - 4, sy - 6, 8, 12);
    g.fillStyle = e.flash > 0 ? "#fff" : "#8d93ab"; g.fillRect(sx - 3, sy - 5, 6, 10);
    g.fillStyle = "#ffd23f"; g.fillRect(sx - 1, sy - 3, 2, 6);
  }
  if (e.shieldT > 0) { g.strokeStyle = "#9be0ff"; g.globalAlpha = 0.7; g.beginPath(); g.arc(x, yy - fr.h * scale / 2, e.r + 5, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
  if (e.burnT > 0 && Math.random() < 0.3) particles.push({ x: x + (Math.random() - 0.5) * e.r * 2, y: yy - Math.random() * fr.h, vx: 0, vy: -25, life: 0.35, max: 0.35, color: Math.random() < 0.5 ? "#ff8a1f" : "#ffd23f", size: 1, grav: 0 });
  if ((e.hp < e.maxHp || e.elite) && e.kind !== "guardian" && e.kind !== "king") {
    const w = e.r * 2 + 2;
    g.fillStyle = "#140c1c"; g.fillRect(Math.round(x - w / 2) - 1, Math.round(yy - fr.h * scale - 3), w + 2, 3);
    g.fillStyle = e.elite ? "#c9a0ff" : "#d93a3a"; g.fillRect(Math.round(x - w / 2), Math.round(yy - fr.h * scale - 2), Math.max(1, Math.round((w * e.hp) / e.maxHp)), 1);
  }
}

const emitFx: Emit = (x, y, vx, vy, life, color) => { if (particles.length < 600) particles.push({ x, y, vx, vy, life, max: life, color, size: 1, grav: 0 }); };
function drawSpikes(g: CanvasRenderingContext2D, h: SimState["hazards"][number], a: number, t: number) {
  g.globalAlpha = 0.25 * a; g.fillStyle = "#8a7f66";
  g.beginPath(); g.ellipse(h.x, h.y, h.r, h.r * 0.6, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = a;
  // a fixed scatter of spikes per hazard, rising as it appears
  const n = Math.min(18, Math.round(h.r / 3));
  const rise = Math.min(1, (h.max - h.life) / 0.2);
  for (let i = 0; i < n; i++) {
    const k = (h.id * 7919 + i * 104729) % 1000 / 1000, ang = i * 2.399 + h.id, rr = Math.sqrt(k) * h.r * 0.9;
    const x = Math.round(h.x + Math.cos(ang) * rr), y = Math.round(h.y + Math.sin(ang) * rr * 0.6);
    const ht = Math.round((2 + (i % 3)) * rise);
    g.fillStyle = "#140c1c"; g.fillRect(x - 1, y - ht, 3, ht + 1);
    g.fillStyle = (i + Math.floor(t * 2)) % 5 === 0 ? "#ffffff" : "#e8dcb0"; g.fillRect(x, y - ht, 1, ht);
  }
  g.globalAlpha = 1;
}

/** Bonewright constructs, drawn in code: turret, mortar, totem (with its aura ring) and lantern. */
function drawConstruct(g: CanvasRenderingContext2D, s: SimState, m: SimState["summons"][number], x: number, y: number, t: number) {
  const owner = s.players.find((q) => q.pid === m.pid);
  const P = owner?.sk[m.skill]?.p;
  const blink = m.life < 1.5 && Math.floor(t * 10) % 2 === 0;
  const boosted = (m.boostT ?? 0) > 0;
  const R = (cx: number, cy: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(cx), Math.round(cy), w, h); };
  if ((m.build === 3 || m.build === 4) && P?.radius) {
    g.globalAlpha = 0.18 + 0.06 * Math.sin(t * 3 + m.id);
    g.strokeStyle = m.build === 3 ? "#ffd23f" : "#7dff9a";
    g.beginPath(); g.ellipse(x, y, P.radius, P.radius * 0.6, 0, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 0.06; g.fillStyle = g.strokeStyle; g.fill();
  }
  g.globalAlpha = blink ? 0.45 : 1;
  shadow(g, x, y, 5);
  const k = "#140c1c", bone = "#e8dcb0", boneD = "#c9bf9f", wood = "#7a4a2a";
  const d = m.fx < 0 ? -1 : 1;
  if (m.build === 1 || m.build === 5) {
    // tripod legs, bone drum, barrel facing its target
    R(x - 5, y - 2, 2, 3, k); R(x + 3, y - 2, 2, 3, k); R(x - 1, y - 2, 2, 3, k);
    R(x - 4, y - 9, 8, 7, k); R(x - 3, y - 8, 6, 5, bone); R(x - 3, y - 4, 6, 1, boneD);
    R(x - 1, y - 7, 2, 2, boosted ? "#ffd23f" : "#ff5a1f");
    if (d > 0) { R(x + 3, y - 7, 5, 3, k); R(x + 4, y - 6, 4, 1, boneD); } else { R(x - 8, y - 7, 5, 3, k); R(x - 8, y - 6, 4, 1, boneD); }
  } else if (m.build === 2) {
    // squat mortar with a tube pointing up
    R(x - 6, y - 5, 12, 6, k); R(x - 5, y - 4, 10, 4, wood); R(x - 5, y - 4, 10, 1, "#9a6a3a");
    R(x - 3, y - 12, 6, 8, k); R(x - 2, y - 11, 4, 7, bone); R(x - 2, y - 12, 4, 1, "#3b2d3a");
    if (boosted) R(x - 1, y - 9, 2, 2, "#ffd23f");
  } else if (m.build === 3) {
    // totem pole topped with a horned skull
    R(x - 2, y - 14, 4, 15, k); R(x - 1, y - 13, 2, 13, wood);
    R(x - 4, y - 19, 8, 6, k); R(x - 3, y - 18, 6, 4, bone);
    R(x - 2, y - 17, 1, 1, "#ff3b3b"); R(x + 1, y - 17, 1, 1, "#ff3b3b");
    R(x - 5, y - 20, 1, 3, boneD); R(x + 4, y - 20, 1, 3, boneD);
    R(x - 3, y - 9, 6, 1, "#ffd23f");
  } else {
    // lantern on a crooked post
    R(x - 1, y - 14, 2, 15, k); R(x, y - 13, 1, 13, wood); R(x, y - 15, 4, 1, k);
    const glow = 0.6 + 0.4 * Math.sin(t * 5 + m.id);
    R(x + 2, y - 14, 5, 6, k); R(x + 3, y - 13, 3, 4, glow > 0.7 ? "#d8ffb0" : "#7dff9a");
    g.globalAlpha = (blink ? 0.2 : 0.35) * glow; g.fillStyle = "#7dff9a"; g.beginPath(); g.arc(x + 4.5, y - 11, 6, 0, Math.PI * 2); g.fill();
    if (Math.random() < 0.05) particles.push({ x: x + 4, y: y - 12, vx: (Math.random() - 0.5) * 6, vy: -14, life: 0.7, max: 0.7, color: "#7dff9a", size: 1, grav: 0 });
  }
  g.globalAlpha = 1;
}

function drawHero(g: CanvasRenderingContext2D, p: Player, x: number, y: number, t: number) {
  if ((p.colossusT ?? 0) > 0) {
    // the Colossus: a big bone golem; the Bonewright rides inside
    shadow(g, x, y, 11);
    if (p.buff.t > 0) { g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 8); g.strokeStyle = "#ffd23f"; g.beginPath(); g.ellipse(x, y, 16, 6, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
    const fr = bank.colossus[p.moving ? Math.floor(p.walk / 10) % 2 : 0];
    const ending = (p.colossusT ?? 0) < 2 && Math.floor(t * 8) % 2 === 0;
    g.globalAlpha = ending ? 0.6 : 1;
    drawSprite(g, fr, x, y, p.fx < 0, false, 1.6);
    if (p.pid === ME && hurtFlash > 0.2) { g.globalAlpha = 0.5; drawSprite(g, fr, x, y, p.fx < 0, true, 1.6); }
    g.globalAlpha = 1;
    if (Math.random() < 0.15) particles.push({ x: x + (Math.random() - 0.5) * 10, y: y - 14, vx: 0, vy: -16, life: 0.5, max: 0.5, color: "#ffd23f", size: 1, grav: 0 });
    if (profile.settings.hpbar && !p.dead) hpOverHead(g, p, x, y - fr.h * 1.6 - 3);
    return;
  }
  shadow(g, x, y, 5);
  if (p.buff.t > 0) { g.globalAlpha = 0.3 + 0.1 * Math.sin(t * 8); g.strokeStyle = p.buff.armorPct ? "#ffd23f" : "#7dff9a"; g.beginPath(); g.ellipse(x, y, 9, 4, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
  if (p.invuln > 0 && p.dashT <= 0 && Math.floor(t * 15) % 2 === 0) g.globalAlpha = 0.5;
  const swingK = p.cls === "ashknight" ? Math.max(0, p.swingT / (p.sk.cleave?.p.interval || 0.38)) : 0;
  const au = p.aura ? AURA[p.aura] : undefined, ending = (p.auraT ?? 0) < 1.5 && Math.floor(t * 8) % 2 === 0;
  if (au && !ending) auraBack(g, au, x, y, t);
  // a running self-buff makes the hero bigger (drawn scaled around the feet)
  const sc = au && !ending ? au.scale : 1;
  if (sc !== 1) { g.save(); g.translate(x, y); g.scale(sc, sc); g.translate(-x, -y); }
  if (au?.fade && !ending) g.globalAlpha = Math.min(g.globalAlpha, au.fade);
  const look = gearLook(p);
  const cos = look.set && profile.settings.setLooks !== false ? { ...(p.cos ?? {}), dye: "set:" + look.set } : p.cos ?? {};
  const fr = drawHeroCos(g, bank, { pid: p.pid, cls: p.cls, cos, fx: p.fx, fy: p.fy, moving: p.moving, walk: p.walk, swingK }, x, y, t, emitFx);
  if (!p.dead) gearMarks(g, p, look, x, y, fr.h, t);
  if (au?.tint && !ending) { g.globalAlpha = 0.25 + 0.12 * Math.sin(t * 10); drawSprite(g, fr, x, y, p.fx < 0, true); g.globalAlpha = 1; }
  if (p.pid === ME && hurtFlash > 0.2) { g.globalAlpha = 0.6; drawSprite(g, fr, x, y, p.fx < 0, true); }
  if (sc !== 1) g.restore();
  g.globalAlpha = 1;
  if (au && !ending) auraFront(g, au, x, y - fr.h * sc / 2, t);
  if (profile.settings.hpbar && !p.dead) hpOverHead(g, p, x, y - fr.h - 3);
}
/** What your gear shows on the hero: the set you wear 4+ pieces of (6 = full set), and your legendary slots. */
type GearLook = { set?: string; full: boolean; weapon?: string; helm: boolean; boots: boolean; mythic: boolean; primal: boolean };
function gearLook(p: Player): GearLook {
  const n: Record<string, number> = {}; let best: string | undefined;
  for (const it of Object.values(p.equipment)) if (it?.set) { n[it.set] = (n[it.set] ?? 0) + 1; if (!best || n[it.set] > n[best]) best = it.set; }
  const eq = p.equipment, leg = (it?: Item) => !!it && (it.rarity === "legendary" || it.rarity === "mythic");
  const set = best && n[best] >= 4 ? best : undefined;
  return {
    set, full: !!set && n[set] >= 6,
    weapon: leg(eq.weapon) ? (eq.weapon!.rarity === "mythic" ? "#ff3b6b" : "#ff8a1f") : undefined,
    helm: leg(eq.helm), boots: leg(eq.boots),
    mythic: Object.values(eq).some((it) => it?.rarity === "mythic"),
    primal: Object.values(eq).some((it) => it?.quality === "primal"),
  };
}
/** Legendary marks and set effects: a glowing weapon, a crown glint, a trail behind legendary boots, a full set's idle sparks, a primal ember. */
function gearMarks(g: CanvasRenderingContext2D, p: Player, L: GearLook, x: number, y: number, h: number, t: number) {
  const r = Math.random;
  if (L.weapon && r() < 0.35) emitFx(x + (p.fx < 0 ? -5 : 5) + (r() - 0.5) * 4, y - 8 - r() * 6, 0, -10, 0.5, L.weapon);
  if (L.helm) { const a = 0.5 + 0.5 * Math.sin(t * 3 + p.pid); g.globalAlpha = 0.5 + 0.5 * a; g.fillStyle = "#ffd23f"; g.fillRect(Math.round(x) - 1, Math.round(y - h - 1), 3, 1); g.fillRect(Math.round(x), Math.round(y - h - 2), 1, 1); g.globalAlpha = 1; }
  if (L.boots && p.moving && r() < 0.6) emitFx(x + (r() - 0.5) * 4, y, -p.fx * 6, -2, 0.6, r() < 0.5 ? "#ff8a1f" : "#ffd23f");
  if (L.set) {
    const col = SET[L.set].color;
    if (L.full) {
      // full set: a ring at the feet and sparks in the set's colour
      g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4); g.strokeStyle = col; g.beginPath(); g.ellipse(x, y + 1, 8, 3, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      if (r() < 0.3) emitFx(x + (r() - 0.5) * 10, y - r() * h, 0, -12, 0.7, col);
    } else if (r() < 0.08) emitFx(x + (r() - 0.5) * 8, y - r() * h, 0, -8, 0.5, col);
  }
  if (L.primal && r() < 0.15) emitFx(x + (r() - 0.5) * 8, y - 2, 0, -14, 0.6, "#ff3b3b");
  if (L.mythic && r() < 0.12) emitFx(x + (r() - 0.5) * 10, y - h * 0.5, (r() - 0.5) * 6, -6, 0.8, "#ff3b6b");
}
/** Self-buff looks: each buff skill changes the hero while it runs (size, glow, particles) in its own theme. */
type Aura = { color: string; glow: string; scale: number; tint?: boolean; fade?: number; ring?: boolean; bubble?: boolean; sparks?: "bolt" | "ember" | "smoke" | "steel" | "spark" | "bone" };
const AURA: Record<string, Aura> = {
  storm_avatar: { color: "#5fb0ff", glow: "#bfe8ff", scale: 1.3, tint: true, sparks: "bolt" },
  phoenix_form: { color: "#ff8a1f", glow: "#ffd23f", scale: 1.2, tint: true, sparks: "ember" },
  iron_skin: { color: "#c9ced8", glow: "#ffffff", scale: 1.1, tint: true, ring: true, sparks: "steel" },
  mana_shield: { color: "#7a8cff", glow: "#c9b8ff", scale: 1, bubble: true, sparks: "spark" },
  smoke_veil: { color: "#5a4e6a", glow: "#9a8aaa", scale: 1, fade: 0.55, sparks: "smoke" },
  overcharge: { color: "#ffd23f", glow: "#fff0a0", scale: 1.1, tint: true, sparks: "spark" },
  night_hunt: { color: "#7dff9a", glow: "#c8ffd0", scale: 1.1, tint: true, sparks: "spark" },
};
function auraBack(g: CanvasRenderingContext2D, a: Aura, x: number, y: number, t: number) {
  const r = 10 * a.scale;
  const gr = g.createRadialGradient(x, y - r, 1, x, y - r, r * 1.8);
  gr.addColorStop(0, a.glow + "88"); gr.addColorStop(1, a.color + "00");
  g.fillStyle = gr; g.beginPath(); g.arc(x, y - r, r * 1.8, 0, Math.PI * 2); g.fill();
  if (a.ring) { g.globalAlpha = 0.5 + 0.2 * Math.sin(t * 6); g.strokeStyle = a.glow; g.beginPath(); g.ellipse(x, y, 11, 4.5, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; }
}
function auraFront(g: CanvasRenderingContext2D, a: Aura, x: number, cy: number, t: number) {
  if (a.bubble) { g.globalAlpha = 0.35 + 0.15 * Math.sin(t * 4); g.strokeStyle = a.glow; g.lineWidth = 1.5; g.beginPath(); g.arc(x, cy, 13, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 0.12; g.fillStyle = a.color; g.fill(); g.lineWidth = 1; g.globalAlpha = 1; }
  if (particles.length > 300) return;
  const rnd = Math.random;
  if (a.sparks === "bolt" && rnd() < 0.35) { // little lightning forks around the body
    const a0 = rnd() * Math.PI * 2, r0 = 8 + rnd() * 6; g.strokeStyle = rnd() < 0.5 ? a.glow : "#ffffff"; g.beginPath(); g.moveTo(x + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
    g.lineTo(x + Math.cos(a0 + 0.3) * (r0 + 5) + (rnd() - 0.5) * 4, cy + Math.sin(a0 + 0.3) * (r0 + 5)); g.lineTo(x + Math.cos(a0 + 0.1) * (r0 + 10), cy + Math.sin(a0 + 0.1) * (r0 + 10)); g.stroke();
  }
  if (a.sparks === "ember" && rnd() < 0.6) particles.push({ x: x + (rnd() - 0.5) * 14, y: cy + 6, vx: (rnd() - 0.5) * 10, vy: -30 - rnd() * 20, life: 0.6, max: 0.6, color: rnd() < 0.5 ? a.color : a.glow, size: 1, grav: 0 });
  if (a.sparks === "smoke" && rnd() < 0.4) particles.push({ x: x + (rnd() - 0.5) * 16, y: cy + 4, vx: (rnd() - 0.5) * 8, vy: -8, life: 0.9, max: 0.9, color: rnd() < 0.5 ? a.color : a.glow, size: 2, grav: 0 });
  if ((a.sparks === "spark" || a.sparks === "steel") && rnd() < 0.3) particles.push({ x: x + (rnd() - 0.5) * 18, y: cy + (rnd() - 0.5) * 18, vx: 0, vy: -6, life: 0.4, max: 0.4, color: a.glow, size: 1, grav: 0 });
}
/** Optional life bar over each hero's head (Settings). */
function hpOverHead(g: CanvasRenderingContext2D, p: Player, x: number, y: number) {
  const w = 16, k = Math.max(0, Math.min(1, p.hp / p.stats.maxHp)), bx = Math.round(x - w / 2), by = Math.round(y);
  g.fillStyle = "#140c1c"; g.fillRect(bx - 1, by - 1, w + 2, 4);
  g.fillStyle = k > 0.5 ? "#5ee06a" : k > 0.25 ? "#ffd23f" : "#ff4a4a"; g.fillRect(bx, by, Math.round(w * k), 2);
  if (p.barrier && p.barrier > 0.5) { g.fillStyle = "#bfe8ff"; g.fillRect(bx, by - 1, Math.max(1, Math.round((w * Math.min(1, p.barrier / p.stats.maxHp)))), 1); }
}

/** A fallen hero: a grave marker, and in co-op a ring that fills while an ally stands on it to revive them. */
function drawFallen(g: CanvasRenderingContext2D, p: Player, x: number, y: number, t: number) {
  shadow(g, x, y, 5);
  g.fillStyle = "#140c1c"; g.fillRect(Math.round(x) - 3, Math.round(y) - 11, 6, 11); g.fillRect(Math.round(x) - 5, Math.round(y) - 8, 10, 3);
  g.fillStyle = "#c9b8ff"; g.fillRect(Math.round(x) - 2, Math.round(y) - 10, 4, 9); g.fillRect(Math.round(x) - 4, Math.round(y) - 7, 8, 1);
  if (sim && sim.players.length > 1) {
    const D = RIFT.deathPenalty, k = Math.min(1, (p.reviveT ?? 0) / D.reviveTime);
    g.globalAlpha = 0.35 + 0.2 * Math.sin(t * 5); g.strokeStyle = "#7dff9a"; g.beginPath(); g.ellipse(x, y, D.reviveRange, D.reviveRange * 0.5, 0, 0, Math.PI * 2); g.stroke();
    if (k > 0) { g.globalAlpha = 0.9; g.lineWidth = 2; g.beginPath(); g.ellipse(x, y, D.reviveRange, D.reviveRange * 0.5, 0, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); g.stroke(); g.lineWidth = 1; }
    g.globalAlpha = 1;
  }
}

function drawPet(g: CanvasRenderingContext2D, q: Player, pt: { x: number; y: number; flip: boolean }, t: number) {
  shadow(g, pt.x, pt.y, 3);
  drawPetCos(g, bank, q.pet, q.cos?.petSkin, pt.x, pt.y, pt.flip, t, emitFx);
}

// ------------------------------------------------------------------ HUD
const SHORT: Record<string, string> = { cleave: "Cleave", ember_lance: "Lance", ash_dash: "Dash", warcry: "Warcry", flame_nova: "Nova", cinderlings: "Imps", hex_bolt: "Bolt", volley: "Volley", tumble: "Tumble", frost_snare: "Snare", rally_banner: "Banner", raven_swarm: "Ravens",
  spark: "Spark", magic_missile: "Missile", static_touch: "Touch", chain_lightning: "Chain", arcane_orb: "Orb", thunderstorm: "Storm", disintegrate: "Beam", blink: "Blink", mana_shield: "Shield", static_field: "Field", storm_avatar: "Avatar", black_hole: "Hole", arcane_torrent: "Torrent",
  rivet_shot: "Rivet", bone_mallet: "Mallet", bone_turret: "Turret", spike_ward: "Spikes", marrow_mortar: "Mortar", scrap_burst: "Burst", war_totem: "Totem", mending_lantern: "Lantern", recoil_vault: "Vault", bone_plating: "Plating", overcharge: "Charge", ossuary_colossus: "Colossus", bone_battery: "Battery",
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
  // hideout station and portal names, drawn sharp at screen resolution
  for (const lb of hideLabels) {
    const px = ((lb.x - sx) * pix) / S, py = ((lb.y - sy) * pix) / S, fs = Math.round((lb.size * pix) / S * 0.9);
    c.font = font(fs); c.textBaseline = "alphabetic";
    const w = c.measureText(lb.text).width;
    c.fillStyle = "rgba(10,6,14,0.75)"; c.fillRect(px - w / 2 - 4, py - fs * 0.85, w + 8, fs * 1.1);
    c.fillStyle = lb.color; c.fillText(lb.text, px, py);
    if (lb.bold) c.fillRect(px - w / 2, py + 3, w, 2);
  }
  hideLabels.length = 0; c.textBaseline = "middle";
  c.font = font(11);
  for (const l of s.loot) {
    if (l.owner !== ME || l.item.rarity === "common" || RARITY_ORDER_IDX(l.item.rarity) < RARITY_ORDER_IDX(profile.filter)) continue;
    const px = ((l.x - sx) * pix) / S, py = ((l.y - sy - 14) * pix) / S;
    if (px < -50 || px > W + 50 || py < -20 || py > H + 20) continue;
    const name = (l.item.quality ? l.item.quality[0].toUpperCase() + l.item.quality.slice(1) + " " : "") + l.item.name;
    c.lineWidth = 3; c.strokeStyle = "#000"; c.strokeText(name, px, py);
    c.fillStyle = l.item.set && SET[l.item.set] ? SET[l.item.set].color : RARITY_COLOR[l.item.rarity]; c.fillText(name, px, py);
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
  // barrier: a pale band over the top of the life bar
  if (p.barrier && p.barrier > 0.5) { c.fillStyle = "#bfe8ffcc"; c.fillRect(L + 6, T + 6, lw * Math.min(1, p.barrier / p.stats.maxHp), 5); }
  c.fillStyle = "#fff"; c.font = font(12); c.fillText(`${Math.ceil(p.hp)} / ${p.stats.maxHp}${p.barrier && p.barrier > 0.5 ? ` +${Math.ceil(p.barrier)}` : ""}`, L + 12, T + 15);
  const R = CLASSES[p.cls].resource;
  c.fillStyle = "#1b1424"; c.fillRect(L + 6, T + 25, lw, 8);
  c.fillStyle = R.color; c.fillRect(L + 6, T + 25, lw * Math.max(0, Math.min(1, p.res / resMax(p))), 8);
  c.fillStyle = R.id === "marrow" ? "#140c1c" : "#fff"; c.font = font(9); c.fillText(`${R.name} ${Math.floor(p.res)} / ${resMax(p)}`, L + 9, T + 29.5);
  c.fillStyle = "#1b1424"; c.fillRect(L + 6, T + 36, lw, 3);
  c.fillStyle = "#c9b8ff"; c.fillRect(L + 6, T + 36, lw * (p.level >= RIFT.levels.max ? p.pxp / paragonXp(p.paragon) : p.xp / xpForLevel(p.level)), 3);
  c.fillStyle = "#b8a8d0"; c.font = font(10); { let lv = `Lv ${p.level}${p.paragon ? ` · P${p.paragon}` : ""}${p.boons.length ? " · " + p.boons.join(", ") : ""}`; while (lv.length > 4 && c.measureText(lv).width > lw) lv = lv.slice(0, -2) + "…"; c.fillText(lv, L + 6, T + 48); }
  const r = s.rift;
  const narrow = W < 600;
  if (r.kind !== "hideout") {
  const bw = narrow ? Math.min(W - 2 * L - 4, 300) : Math.min(320, W - 2 * lw - 80);
  const bx = narrow ? W / 2 - bw / 2 : W / 2 - bw / 2;
  const topY = narrow ? T + 64 : T;
  panel(c, bx - 6, topY, bw + 12, 46);
  const left = r.limit - (r.done ? r.doneAt : r.time);
  c.textAlign = "center"; c.font = font(14);
  c.fillStyle = left < 0 ? "#ff7a3c" : left < 60 ? (Math.floor(t * 2) % 2 ? "#ffd23f" : "#fff") : "#fff";
  const gd = s.enemies.find((e) => e.id === r.guardianId && !e.dead && (e.kind === "guardian" || e.kind === "king"));
  if (r.kind === "vault") {
    c.fillStyle = "#ffd23f"; c.fillText(`Gilded Vault  ·  ${fmtTime(Math.max(0, left))}  ·  T${r.tier}`, W / 2, topY + 11);
    c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
    c.fillStyle = "#ffd23f"; c.fillRect(bx, topY + 20, (bw * Math.max(0, left)) / r.limit, 12);
    c.fillStyle = "#140c1c"; c.font = font(10); c.fillText(r.done ? "SEALED" : "loot everything", W / 2, topY + 26);
  } else if (r.kind === "trial") {
    const alive = s.enemies.reduce((a, e) => a + (e.dead ? 0 : 1), 0), TR = RIFT.trial;
    c.fillText(`Trial ${r.tier}  ·  wave ${Math.min(r.wave ?? 0, TR.waves)}/${TR.waves}  ·  ${fmtTime(Math.max(0, left))}`, W / 2, topY + 11);
    c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
    c.fillStyle = left < 20 ? "#ff7a3c" : "#7dd8ff"; c.fillRect(bx, topY + 20, (bw * Math.max(0, left)) / r.limit, 12);
    c.fillStyle = "#140c1c"; c.font = font(10);
    c.fillText(r.done ? (completeInfo?.inTime ? "PASSED" : "FAILED") : r.waveAt! > 0 ? `wave ${(r.wave ?? 0) + 1} in ${Math.ceil(r.waveAt! - r.time)}` : `${alive} left`, W / 2, topY + 26);
  } else if (r.kind === "endless") {
    c.fillStyle = "#fff"; c.fillText(`Wave ${r.wave ?? 0}  ·  Lv ${r.level ?? 0}  ·  ${fmtTime(r.done ? r.doneAt : r.time)}`, W / 2, topY + 11);
    const alive = s.enemies.reduce((a, e) => a + (e.dead ? 0 : 1), 0), lives = Math.max(0, endlessLivesLeft(s));
    c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
    const secs = r.done ? 0 : r.waveAt! > 0 ? r.waveAt! - r.time : r.time - r.waveStart!;
    c.fillStyle = "#fff"; c.font = font(10);
    c.fillText(r.done ? "RUN OVER" : r.waveAt! > 0 ? `next wave in ${Math.ceil(secs)}` : `${alive} left · ${Math.floor(secs)}s${secs < RIFT.endless.fastClear[0][0] ? " · fast!" : ""}`, W / 2, topY + 26);
    c.fillStyle = "#ff8a8a"; c.font = font(9); c.fillText("♥".repeat(lives) + ` lives`, W / 2, topY + 40);
  } else if (r.kind === "bounty") {
    const tasks = r.bounty ?? [], dn = tasks.filter((q) => q.done).length;
    c.fillStyle = "#fff"; c.fillText(`Bounties ${dn}/${tasks.length}  ·  ${fmtTime(r.done ? r.doneAt : r.time)}  ·  T${r.tier}`, W / 2, topY + 11);
    c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
    c.fillStyle = r.done ? "#7dff9a" : "#ffd23f"; c.fillRect(bx, topY + 20, (bw * dn) / Math.max(1, tasks.length), 12);
    const cur = tasks.filter((q) => !q.done);
    c.fillStyle = "#140c1c"; c.font = font(10); c.fillText(r.done ? "ALL DONE" : `${dn} done`, W / 2, topY + 26);
    c.fillStyle = "#fff0a0"; c.font = font(9);
    const short: Record<string, string> = { elite: "Gravelord", totems: "Totems", shrine: "Shrine", cull: "Kills" };
    c.fillText(cur.map((q) => `${short[q.kind]}${q.need > 1 ? ` ${Math.floor(q.have)}/${q.need}` : ""}`).join(" · "), W / 2, topY + 40);
  } else {
  c.fillText((left >= 0 ? fmtTime(left) : "+" + fmtTime(-left)) + `  ·  T${r.tier}`, W / 2, topY + 11);
  c.fillStyle = "#1b1424"; c.fillRect(bx, topY + 20, bw, 12);
  if (r.guardianSpawned && gd) {
    c.fillStyle = gd.enraged ? "#ff3b3b" : gd.variant === "seraph" ? "#bfe8ff" : gd.kind === "king" ? "#ff3b6b" : "#ffd23f"; c.fillRect(bx, topY + 20, (bw * gd.hp) / gd.maxHp, 12);
    c.fillStyle = "#140c1c"; c.font = font(10); c.fillText((gd.variant === "seraph" ? "THE PALE SERAPH" : gd.kind === "king" ? "THE OSSUARY KING" : guardianDef(gd.variant).name.toUpperCase()) + (gd.enraged ? " — ENRAGED" : ""), W / 2, topY + 26);
  } else {
    c.fillStyle = r.done ? "#7dff9a" : "#8a5cff"; c.fillRect(bx, topY + 20, (bw * r.progress) / r.need, 12);
    for (const at of RIFT.boonsAt) { c.fillStyle = "#ffd23f"; c.fillRect(bx + (bw * at) / 100, topY + 20, 1, 12); }
    c.fillStyle = "#fff"; c.font = font(10); c.fillText(r.done ? "CLEARED" : `${Math.floor((r.progress / r.need) * 100)}%`, W / 2, topY + 26);
  }
  c.fillStyle = "#b8a8d0"; c.font = font(9); c.fillText(r.kind === "chase" ? "chase boss" : modsLine(r.mods), W / 2, topY + 40);
  }
  if (miniCanvas) {
    const ms = Math.min(90, W * 0.22), mx = W - ms - 10 - ins.right, my = narrow ? topY + 54 : T + 40;
    // keep the map's shape: a wide map gets a wide, short minimap (markers and map share one scale)
    const k = ms / (Math.max(s.map.w, s.map.h) * s.map.ts), mw = s.map.w * s.map.ts * k, mh = s.map.h * s.map.ts * k;
    c.globalAlpha = 0.85; panel(c, mx + ms - mw - 3, my - 3, mw + 6, mh + 6);
    const ox = mx + ms - mw;
    c.imageSmoothingEnabled = false; c.drawImage(miniCanvas, ox, my, mw, mh);
    for (const e of s.enemies) if (!e.dead && e.kind !== "guardian" && e.kind !== "king") { c.fillStyle = e.elite ? "#c9a0ff" : "#d93a3a"; c.fillRect(ox + e.x * k - 1, my + e.y * k - 1, e.elite ? 3 : 2, e.elite ? 3 : 2); }
    if (gd) { c.fillStyle = "#ffd23f"; c.fillRect(ox + gd.x * k - 3, my + gd.y * k - 3, 6, 6); }
    for (const bt of s.rift.bounty ?? []) {
      if (bt.done || bt.kind === "cull") continue;
      const pts = bt.kind === "totems" ? s.enemies.filter((e) => bt.ids.includes(e.id) && !e.dead).map((e) => [e.x, e.y]) : [[bt.x, bt.y]];
      for (const [x, y] of pts) { c.strokeStyle = Math.floor(t * 3) % 2 ? "#ffd23f" : "#fff0a0"; c.strokeRect(ox + x * k - 3.5, my + y * k - 3.5, 7, 7); }
    }
    for (const l of s.loot) if (l.owner === ME && RARITY_ORDER_IDX(l.item.rarity) >= 2) { c.fillStyle = RARITY_COLOR[l.item.rarity]; c.fillRect(ox + l.x * k - 2, my + l.y * k - 2, 4, 4); }
    for (const q of s.players) { c.fillStyle = q.pid === ME ? "#fff" : "#7dff9a"; c.fillRect(ox + q.x * k - 2, my + q.y * k - 2, 4, 4); }
    c.globalAlpha = 1;
  }
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
  const { map, events, _flows, _wide, ...rest } = s;
  return { ...rest, _flows: _flows.map((f) => Array.from(f)), _wide: _wide?.map((f) => Array.from(f)) };
}
function restoreSim(cfg: SimConfig, snap: any): SimState {
  const s = createSim(cfg);
  Object.assign(s, snap);
  s._flows = (snap._flows as number[][]).map((a) => Int16Array.from(a));
  s._wide = (snap._wide as number[][] | undefined)?.map((a) => Int16Array.from(a));
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
    while (acc >= DT && steps < 4) { hostStep(readInput()); acc -= DT; steps++; if (!sim || !coop) return; }
    if (steps === 4) acc = 0;
    return;
  }
  // guest: send our input at the tick rate, replay the host's ticks with a small jitter buffer
  co.inputAcc += dt;
  if (co.inputAcc >= DT) { co.inputAcc = Math.min(co.inputAcc - DT, DT); online!.sendU(0, { t: "in", i: readInput() }); }
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
  o2.send({ t: "runStart", kind: o.kind, tier: o.tier, boss: o.boss });
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
  const cfg: SimConfig = { seed, kind: m.kind, tier: m.tier, boss: o.boss, players, mods: m.kind !== "rift" ? [] : rollModifiers(seed, m.tier), mint: "external", pity };
  coop = newCoop("host", cfg);
  const info: RunInfo = { kind: m.kind, tier: m.tier, weekly: !!o.weekly && peers.length === 0, seed, boss: o.boss };
  for (const pid of peers) { online.sendR(pid, { t: "start", cfg, info }); coop.live.add(pid); coop.remote.set(pid, { inp: NO_INPUT, cmds: [] }); }
  beginRun(cfg, info);
}

/** Direct co-op: the host starts the run for the whole room. Items are made inside the shared game. */
function startDirectRun(o: RunOpts) {
  const d = online as Direct;
  const c = char(profile), T = RIFT.tiers;
  if (!payChase(o)) return;
  let seed = o.seed ?? ((Math.random() * 0xffffffff) >>> 0);
  const peers = d.openPeers().filter((pid) => d.peerInfo.has(pid));
  if (o.weekly && !peers.length) seed = weeklySeed(isoWeek());
  const players = [setupFor(profile, ME, d.name), ...peers.map((pid) => ({ ...d.peerInfo.get(pid)!.setup, pid, name: d.peerInfo.get(pid)!.name }))];
  const pity: SimConfig["pity"] = { [ME]: { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity } };
  for (const pid of peers) pity[pid] = d.peerInfo.get(pid)!.pity;
  const cfg: SimConfig = { seed, kind: o.kind, tier: o.tier, boss: o.boss, players, mods: o.kind !== "rift" ? [] : rollModifiers(seed, o.tier), pity, hideout: o.kind === "hideout" ? profile.hideout : undefined };
  coop = newCoop("host", cfg);
  const info: RunInfo = { kind: o.kind, tier: o.tier, weekly: !!o.weekly && peers.length === 0, seed, boss: o.boss };
  for (const pid of peers) { d.sendR(pid, { t: "start", cfg, info }); coop.live.add(pid); coop.remote.set(pid, { inp: NO_INPUT, cmds: [] }); }
  d.setRunning(true);
  beginRun(cfg, info);
}

function wireOnline(o: Online | Direct) {
  if (!o.direct) o.onProfile = (p) => { profile = p; setMuted(profile.settings.mute); refreshMenu(); };
  o.onLobby = () => {
    ME = o.lobby ? o.lobby.pid : 0;
    if (!o.direct && pendingStart && !pendingStart.sent && o.lobby?.host) { pendingStart.sent = true; o.send({ t: "runStart", kind: pendingStart.kind, tier: pendingStart.tier, boss: pendingStart.boss }); }
    refreshMenu();
  };
  o.onServer = (m) => {
    switch (m.t) {
      case "runOk": onRunOk(m); break;
      case "runFail": pendingStart = null; ui.toast(m.reason, "#ff6a6a"); break;
      case "joinFail": ui.toast(m.reason, "#ff6a6a"); break;
      case "dropOk": if (coop?.role === "host") coop.hostCmds.push({ type: "spawnLoot", owner: m.owner, item: m.item, x: m.x, y: m.y }); break;
      case "peerLeft": if (coop?.role === "host") hostDropPeer(m.pid); break;
      case "roomClosed": if (coop?.role === "guest" && sim) { ui.toast("Lost the host.", "#ff6a6a"); endRun(); } break;
      case "reconnecting": ui.toast("Connection lost. Reconnecting to the host…", "#ffd23f"); break;
      case "reconnected": ui.toast("Reconnected", "#7dff9a"); break;
    }
  };
  o.onPeerOpen = (pid) => {
    // a friend joined while the host is home alone: share the hideout with them
    if (!coop && inHideout() && o.direct && o.lobby?.host) { if (menuOpen) { menuOpen = false; ui.hide(); } enterHideout(); return; }
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
    if (m.t === "start" && (!sim || inHideout())) { if (sim) leaveHideout(); coop = newCoop("guest", m.cfg); beginRun(m.cfg, m.info); return; }
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
    root.innerHTML = `<div class="panel hub"><h1>RIFTBOUND</h1><p>Lost the connection to the server.</p><button class="big" onclick="location.reload()">Reconnect</button></div>`;
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
    root.innerHTML = `<div class="panel hub"><h1>RIFTBOUND</h1><p>Live build: sign-in is required. Start the server with <code>npm run server</code> and open the page it serves.</p></div>`;
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
  setOnSaved((p) => { cloudQueue(p); driveQueue(p); });
  let pendingRemote: Profile | null = null;
  const useRemote = (p: Profile) => {
    if (sim && !inHideout()) { pendingRemote = p; return; } // mid-run: after it ends
    menuOpen = false;
    if (sim) { sim = null; run = null; coop = null; } // drop the old hideout without writing it back over the restored save
    profile = p; setMuted(profile.settings.mute);
    try { localStorage.setItem("rift-arpg-save", JSON.stringify(p)); } catch { /* ignore */ }
    ui.toast("Save restored from your account", "#7dff9a");
    goHub();
  };
  startCloud(() => profile, useRemote);
  startDrive(() => profile, (p) => { useRemote(p); }, () => !sim || inHideout(), () => { if (menuOpen || mode === "hub") ui.refreshDrive?.(); });
  (window as any).__applyPendingRemote = () => { if (pendingRemote) { const p = pendingRemote; pendingRemote = null; useRemote(p); } };
}
requestAnimationFrame(frame);
(window as any).__rift = { get sim() { return sim; }, startRun, get profile() { return profile; }, endRun, MODIFIER, get coop() { return coop; }, get online() { return online; }, stateHash };
