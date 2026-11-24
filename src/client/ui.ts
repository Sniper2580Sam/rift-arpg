// DOM screens: hub (play / gear / skills / settings), inventory with compare + reroll, boon picker, results.
import { decorIcon } from "./hideout";
import { AFFIX as AFFIX_DEF } from "../sim/data";
import type { RunKind } from "../sim/sim";
import { driveAvailable, driveSignIn, driveSignOut, driveStatus } from "./gdrive";
import { drawHeroCos, drawPetCos, Emit } from "./cosdraw";
import { drawFxPreview } from "./fxpreview";
import { TALENTS, talentCanAdd, talentCanRemove, talentPoints, talentSpent, nextTrial, SETS, classAffinity, RELIC_SLOTS, RelicSlot, relicSlotOf, relicUnlock, SHOP, GEM, GEMS, gemText, ACHIEVEMENTS, SEASON_JOURNEY, chapterKey, lifeStats, rewardName, BOON, CLASSES, COSMETICS, CosKind, VFX, HIDEOUT, PARAGON_STATS, paragonSpent, paragonXp, cosAccess, ownsKey, shopCatalogue, validLoadout, EquipSlot, ITEMS, LEGENDARY, MODIFIER, PETS, RARITY_ORDER, RIFT, Rarity, SET, SKILL, slotTypeOf } from "../sim/data";
import { echoCost, BAG_SIZE, Holder, InvCmd, Item, Stats, affixQuality, affixText, computeStats, equipTarget, powerText, rerollCost, rerollOptions, Affix, scaledItem, slotCost, slotMult, SLOT_MAX } from "../sim/items";
import { makeRng } from "../sim/rng";
import { RARITY_COLOR, SpriteBank } from "./sprites";
import { BUILD_SLOTS, CharSave, Profile, STASH_SIZE, WEEKLY_TIER, char, isoWeek, seasonStats, xpProgress } from "./profile";
import { KEY_LABELS } from "./input";
import type { HubOp } from "../shared/ops";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
export const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SLOT_NAME: Record<string, string> = { weapon: "Weapon", offhand: "Off-hand", helm: "Helm", shoulders: "Shoulders", chest: "Chest", bracers: "Bracers", gloves: "Gloves", belt: "Belt", pants: "Pants", boots: "Boots", amulet: "Amulet", ring: "Ring", ring1: "Ring", ring2: "Ring" };
const RARITY_NAME: Record<Rarity, string> = { common: "Common", magic: "Magic", rare: "Rare", legendary: "Legendary", set: "Set", mythic: "Mythic" };
const SKILL_SLOT_NAME = ["Primary", "Secondary", "Utility", "Utility", "Utility", "Ultimate"];

export function effectiveDps(s: Stats): number {
  const avg = (s.dmgMin + s.dmgMax) / 2;
  return avg * (1 + s.dmgPct / 100) * (1 + (Math.min(100, s.critChance) / 100) * (s.critDmg / 100)) * (1 + s.atkSpeed / 100) * s.dmgMult;
}
export function fmtTime(s: number) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${r.toString().padStart(2, "0")}`; }

const iconCache = new Map<string, string>();
function icon(bank: SpriteBank, it: Item) {
  const k = it.slot + it.rarity;
  if (!iconCache.has(k)) {
    const spr = bank.icon(it.slot, it.rarity);
    const c = document.createElement("canvas"); c.width = 40; c.height = 40;
    const g = c.getContext("2d")!; g.imageSmoothingEnabled = false; g.drawImage(spr.img, 0, 0, 40, 40);
    iconCache.set(k, c.toDataURL());
  }
  return iconCache.get(k)!;
}
function cellHtml(bank: SpriteBank, it: Item | undefined, attrs: string, extra = "", label = "") {
  if (!it) return `<button class="cell empty" ${attrs}>${label ? `<span>${label}</span>` : ""}</button>`;
  return `<button class="cell r-${it.rarity} ${it.quality ? "q-" + it.quality : ""} ${extra}" ${attrs}><img alt="" src="${icon(bank, it)}">${extra.includes("isup") ? '<i class="up">▲</i>' : ""}${it.locked ? '<i class="lk" aria-label="locked">★</i>' : ""}</button>`;
}

export function itemHtml(raw: Item, h?: Holder, ctx?: { cls: string; level: number }): string {
  // worn items show their values with the slot upgrade (and masterwork crit) applied
  const worn = h ? (Object.entries(h.equipment).find(([, x]) => x === raw)?.[0] as EquipSlot | undefined) : undefined;
  const plus = worn ? h!.slotPlus?.[worn] ?? 0 : 0, crit = worn ? h!.slotCrit?.[worn] : undefined;
  const it = scaledItem(raw, plus, crit);
  const col = RARITY_COLOR[it.rarity];
  let out = `<div class="it-name" style="color:${col}">${it.locked ? "★ " : ""}${esc(it.name)}</div>`;
  if (plus) out += `<div class="it-plus">${SLOT_NAME[worn!]} slot +${plus}: stats +${Math.round((slotMult(plus) - 1) * 100)}%${crit ? ` · ✦ masterwork crit: ${esc(AFFIX_DEF[crit]?.text.replace("{v}", "X") ?? crit)} +50%` : ""}</div>`;
  out += `<div class="it-type">${it.quality ? `<b class="q-${it.quality}">${it.quality === "primal" ? "Primal" : "Ancestral"}</b> ` : ""}${RARITY_NAME[it.rarity]} ${SLOT_NAME[it.slot]} · item level ${it.ilvl}</div>`;
  if (it.dmgMin !== undefined) out += `<div class="it-base">${it.dmgMin}–${it.dmgMax} Damage</div>`;
  if (it.armor) out += `<div class="it-base">${it.armor} Armor</div>`;
  it.affixes.forEach((a, i) => {
    const q = Math.round(affixQuality(a) * 100);
    out += `<div class="it-affix${it.rerollIdx === i ? " locked" : ""}${a.id === crit ? " mw" : ""}">${a.id === crit ? "✦ " : ""}${esc(affixText(a))} <small class="range">${a.min}–${a.max}${q >= 100 ? " ★" : ""}</small></div>`;
  });
  if (it.echo) out += `<div class="it-plus">Echo ${"◆".repeat(it.echo)}: +${+(it.echo * RIFT.echo.dmgPct).toFixed(1)}% damage, +${+(it.echo * RIFT.echo.lifePct).toFixed(1)}% life</div>`;
  if (it.legendary) out += `<div class="it-power ${LEGENDARY[it.legendary].mythic ? "mythic" : ""}">${esc(powerText(it))}</div>`;
  if (it.set) {
    const sd = SET[it.set];
    const have = h ? new Set(Object.values(h.equipment).filter((e) => e?.set === it.set).map((e) => e!.slot)).size : 0;
    out += `<div class="it-set"><b>${esc(sd.name)}</b> (${have}/6 equipped)`;
    for (const [n, b] of Object.entries(sd.bonuses)) out += `<div class="${have >= +n ? "on" : ""}">(${n}) ${esc(b.text)}</div>`;
    out += `</div>`;
  }
  if (h && ctx && !worn) {
    const slot = equipTarget(h, raw);
    const cur = h.equipment[slot];
    {
      const a = computeStats(h.equipment, ctx), b = computeStats({ ...h.equipment, [slot]: raw }, ctx);
      const parts: string[] = [];
      const fmt = (v: number, label: string, unit = "") => { if (Math.abs(v) >= 0.5) parts.push(`<span class="${v > 0 ? "up" : "down"}">${v > 0 ? "+" : "−"}${Math.abs(Math.round(v))}${unit} ${label}</span>`); };
      fmt((effectiveDps(b) / effectiveDps(a) - 1) * 100, "damage", "%");
      fmt(b.maxHp - a.maxHp, "life"); fmt(b.armor - a.armor, "armor");
      if (cur?.legendary && cur.legendary !== it.legendary) parts.push(`<span class="down">loses ${esc(LEGENDARY[cur.legendary].name)}</span>`);
      out += `<div class="it-compare">vs ${cur ? "equipped" : "empty slot"}: ${parts.length ? parts.join(" · ") : "same stats"}</div>`;
    }
  }
  return out;
}

function isUpgrade(h: Holder, it: Item, ctx: { cls: string; level: number }): boolean {
  const slot = equipTarget(h, it);
  const cur = h.equipment[slot];
  if (!cur) return true;
  if ((it.legendary || it.set) && !cur.legendary && !cur.set) return true;
  const a = computeStats(h.equipment, ctx), b = computeStats({ ...h.equipment, [slot]: it }, ctx);
  return effectiveDps(b) > effectiveDps(a) * 1.02;
}

type Tab = "play" | "gear" | "skills" | "looks" | "shop" | "journey" | "settings";
export interface HubHandlers {
  enter: (o: { tier: number; seed: number | null; kind: RunKind; weekly?: boolean; boss?: "king" | "seraph" }) => void;
  invCmd: (c: InvCmd) => void;
  setClass: (cls: string) => void;
  setRune: (skill: string, rune: string) => void;
  setSkill: (slot: number, skill: string) => void;
  reroll: (bagOrSlot: { bag?: number; slot?: EquipSlot }, affixIdx: number, choice: Affix | null) => void;
  setting: (k: string, v: any) => void;
  /** set when the menu is open over the hideout: a button to go back to it */
  close?: () => void;
  /** any other hub op (storage, arsenal) */
  op?: (op: HubOp) => void;
  newSeason: () => void;
  reset: () => void;
  /** live build: the server rolls reroll options */
  rerollOptions?: (target: { bag?: number; slot?: EquipSlot }, idx: number) => Promise<Affix[]>;
  coop?: CoopHub;
}
export interface CoopHub {
  name: string;
  lobby: { code: string; pid: number; host: boolean; members: { pid: number; name: string; cls: string; level: number }[]; running: boolean } | null;
  host: () => void; join: (code: string) => void; leave: () => void;
  /** live build (accounts on the server) */
  signOut?: () => void;
  /** direct co-op in the test builds: no accounts, pick a name */
  direct?: boolean; connecting?: boolean; setName?: (n: string) => void;
}

export class UI {
  root = $("#ui");
  tab: Tab = "play";
  sel: { where: "bag"; i: number } | { where: "eq"; slot: EquipSlot } | { where: "stash"; i: number } | null = null;
  buildSel = -1;
  rerollState: { idx: number; options: Affix[] } | null = null;
  invOpen = false;
  skSlot = 0;
  tier = 1;
  private toastT = 0;
  /** shop preview: looks being tried on (not owned) */
  tryOn: Partial<Record<CosKind, string>> = {};
  /** a skill effect being previewed in the shop: "skill:style" */
  fxTry = "";
  constructor(private bank: SpriteBank) {}

  hide() { this.root.innerHTML = ""; this.root.className = ""; this.invOpen = false; }

  // ---------------------------------------------------------------- hub
  showHub(p: Profile, H: HubHandlers) {
    this.invOpen = false;
    const c = char(p);
    this.tier = Math.min(Math.max(1, this.tier), c.highestTier);
    this.root.className = "screen";
    const cd = CLASSES[c.cls];
    const tabs = (["play", "gear", "skills", "looks", "shop", "journey", "settings"] as Tab[]).map((t) => `<button class="tab ${this.tab === t ? "on" : ""}" data-tab="${t}"${t === "settings" ? ` aria-label="Settings"` : ""}>${t === "settings" ? "⚙" : t[0].toUpperCase() + t.slice(1)}</button>`).join("");
    let body = "";
    if (this.tab === "play") body = this.playTab(p, c, H);
    if (this.tab === "gear") body = this.gemsHtml(c) + this.relicsHtml(p, c) + this.trophiesHtml(p, c) + this.echoHtml(p, c) + this.gearTab(p, { cls: c.cls, level: c.level, equipment: c.equipment, bag: c.bag, materials: p.materials, shards: p.shards ?? 0, slotPlus: c.slotPlus ?? {}, slotCrit: c.slotCrit ?? {} }, true);
    if (this.tab === "skills") body = this.skillsTab(c);
    if (this.tab === "looks") body = this.looksTab(p);
    if (this.tab === "shop") body = this.shopTab(p, H);
    if (this.tab !== "shop") { this.tryOn = {}; this.fxTry = ""; }
    if (this.tab === "journey") body = this.journeyTab(p);
    if (this.tab === "settings") body = this.settingsTab(p);
    this.root.innerHTML = `
      <div class="panel hub">
        <div class="hub-head">
          <div><h1>RIFT ARPG</h1><div class="sub">working title · Season ${p.season.n} · ${H.coop ? "live build" : "test build"}</div></div>
          <div class="who"><b>${cd.name}</b> · Lv ${c.level}${c.paragon ? ` · P${c.paragon}` : ""}<div class="xpbar"><i style="width:${Math.round(xpProgress(c) * 100)}%"></i></div></div>${H.close ? `<button id="hub-close" class="hub-close" aria-label="Back to hideout">✕</button>` : ""}
        </div>
        <nav class="tabs">${tabs}</nav>
        <div class="tab-body">${body}</div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => el.onclick = () => { this.tab = el.dataset.tab as Tab; this.sel = null; this.rerollState = null; this.showHub(p, H); });
    const re = () => this.showHub(p, H);
    const cl = this.root.querySelector<HTMLElement>("#hub-close"); if (cl) cl.onclick = () => H.close!();
    if (this.tab === "play") this.bindPlay(p, c, H, re);
    if (this.tab === "gear") this.bindGear(p, { equipment: c.equipment, bag: c.bag, materials: p.materials }, H, re, true);
    this.root.querySelectorAll<HTMLElement>("[data-echo]").forEach((el) => el.onclick = () => { H.op?.({ t: "echo", slot: el.dataset.echo! }); re(); });
    const cs = this.root.querySelector<HTMLSelectElement>("[data-craft-set]"); if (cs) cs.onchange = () => { this.craftSet = cs.value; re(); };
    this.root.querySelectorAll<HTMLElement>("[data-craft]").forEach((el) => el.onclick = () => { const [set, slot] = el.dataset.craft!.split(":"); H.op?.({ t: "craftSet", set, slot }); this.toast("Crafted. It's in your bag.", "#7dff9a"); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-hallow]").forEach((el) => el.onclick = () => {
      if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Tap again to hallow"; return; }
      const [k, v] = el.dataset.hallow!.split(":"); H.op?.(k === "bag" ? { t: "hallow", bag: +v } : { t: "hallow", slot: v }); this.toast("Now ancestral", "#ffd23f"); re();
    });
    this.root.querySelectorAll<HTMLElement>("[data-relic]").forEach((el) => el.onclick = () => { const [sl, id] = el.dataset.relic!.split(":"); H.op?.({ t: "relic", slot: sl, id: id || null }); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-extract]").forEach((el) => el.onclick = () => {
      if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Tap again: destroy and extract"; return; }
      H.op?.({ t: "extract", bag: +el.dataset.extract! }); this.toast("Power extracted to the Reliquary", "#ffd23f"); re();
    });
    this.root.querySelectorAll<HTMLElement>("[data-gem]").forEach((el) => el.onclick = () => { const [slot, id] = el.dataset.gem!.split(":"); H.op?.({ t: "gem", slot: +slot, id: id || null }); re(); });
    if (this.tab === "skills") {
      this.root.querySelectorAll<HTMLElement>("[data-rune]").forEach((el) => el.onclick = () => { const [sk, r] = el.dataset.rune!.split(":"); H.setRune(sk, r); re(); });
      this.root.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => el.onclick = () => { this.skSlot = +el.dataset.slot!; re(); });
      this.root.querySelectorAll<HTMLElement>("[data-equip]").forEach((el) => el.onclick = () => { H.setSkill(this.skSlot, el.dataset.equip!); re(); });
      this.root.querySelectorAll<HTMLElement>("[data-pg]").forEach((el) => el.onclick = () => { const [k, d] = el.dataset.pg!.split(":"); H.op?.({ t: "paragon", stat: k, d: +d }); re(); });
      this.root.querySelectorAll<HTMLElement>("[data-tal]").forEach((el) => el.onclick = () => { const [k, d] = el.dataset.tal!.split(":"); H.op?.({ t: "talent", id: k, d: +d }); re(); });
      const tr = this.root.querySelector<HTMLElement>("[data-tal-reset]"); if (tr) tr.onclick = () => { H.op?.({ t: "talent", reset: true }); re(); };
      const pr = this.root.querySelector<HTMLElement>("[data-pg-reset]"); if (pr) pr.onclick = () => { H.op?.({ t: "paragon", reset: true }); re(); };
    }
    if (this.tab === "looks" || this.tab === "shop") this.bindLooks(p, H, re);
    if (this.tab === "settings") { this.bindSettings(p, H, re); this.bindDrive(); }
  }

  private playTab(p: Profile, c: CharSave, H: HubHandlers) {
    const t = this.tier, T = RIFT.tiers;
    const hp = Math.pow(T.hpGrowth, t - 1), leg = 1 + T.legendaryGrowth * (t - 1);
    const anc = t >= T.ancestralFrom ? Math.min(T.ancestralCap, T.ancestralBase + T.ancestralPerTier * (t - T.ancestralFrom)) : 0;
    const week = isoWeek();
    const wbest = p.weekly.week === week && p.weekly.best ? fmtTime(p.weekly.best) : "—";
    const classes = Object.entries(CLASSES).map(([id, d]) => `<button class="cls-card ${p.active === id ? "on" : ""}" data-cls="${id}"><b>${d.name}</b><span>Lv ${p.chars[id].level} · ${d.role}</span><small>${esc(d.desc)}</small></button>`).join("");
    return `${H.coop ? this.coopBox(H.coop) : ""}
      <div class="classes">${classes}</div>
      <div class="tier-row">
        <button id="t-down" aria-label="Lower tier">−</button>
        <div class="tier"><b>Tier ${t}</b><small>enemy life ×${hp.toFixed(1)} · legendary odds ×${leg.toFixed(2)}${anc ? ` · ancestral ${Math.round(anc * 100)}%` : ""}${t >= T.primalFrom ? " · primals can drop" : ""}</small></div>
        <button id="t-up" aria-label="Higher tier" ${t >= c.highestTier ? "disabled" : ""}>+</button>
      </div>
      <div class="dim small">Clear a tier in time to unlock the next one. Under 5 min unlocks 2, under 3 min unlocks 3. Highest: ${c.highestTier}. Ancestral pity: ${c.pityAnc}/${T.ancestralPity}.</div>
      <button id="enter" class="big">Enter a rift</button>
      <div class="row">
        <input id="seed" placeholder="rift code (optional)" maxlength="8" autocomplete="off" aria-label="Rift code">
        <button id="weekly">Weekly rift ${week.slice(5)} · T${WEEKLY_TIER} · best ${wbest}</button>
      </div>
      <button id="endless" class="endless">Endless waves from tier ${t} · best wave ${c.bestWave ?? 0}</button>
      <div class="dim small">Waves keep coming and get stronger, and faster quickly when you clear them fast. The party shares ${RIFT.endless.lives} lives. Loot comes at the end, more the further you get.</div>
      <button id="trial" class="trial">Trial ${nextTrial(c.trialBest)} · ${talentPoints(c.trialBest)}/${RIFT.trial.maxLevel} talent points earned</button>
      <div class="dim small">${esc(RIFT.trial.desc)} No loot: Trials pay in talent points, which you spend under Skills.</div>
      <button id="chase" class="chase" ${c.sigils > 0 ? "" : "disabled"}>Challenge the Ossuary King (uses 1 Bone Sigil · you have ${c.sigils})</button>
      <div class="dim small">Bone Sigils drop from guardians at tier ${T.sigilFrom}+. The King is a 3-phase fight with a ${Math.round(RIFT.chase.mythicChance * 100)}% mythic chance.</div>
      <button id="seraph" class="chase" ${(c.feathers ?? 0) > 0 ? "" : "disabled"}>Challenge the Pale Seraph (uses 1 Pale Feather · you have ${c.feathers ?? 0})</button>
      <div class="dim small">Every King kill leaves a Pale Feather, and guardians drop them at tier ${RIFT.seraph.featherFrom}+. Two guaranteed ancestral items and a ${Math.round(RIFT.seraph.mythicChance * 100)}% mythic chance.</div>
      <div class="help">
        <b>Desktop:</b> WASD move · skills on LMB, RMB (or E), Space (or Q) and R (or F) · I bag · M mute<br>
        <b>Touch:</b> left thumb moves · four skill buttons on the right · aiming is automatic (bosses and elites first)
      </div>`;
  }
  private coopBox(co: CoopHub) {
    const l = co.lobby;
    const who = co.direct
      ? `<div class="row small"><span class="dim">Your name</span><input id="co-name" value="${esc(co.name)}" maxlength="16" autocomplete="nickname" aria-label="Your name"></div>`
      : `<div class="dim small">Signed in as <b>${esc(co.name)}</b> · <button class="link" id="co-out">sign out</button></div>`;
    if (!l) return `<div class="coop"><b>Play together</b>${co.direct ? ` <span class="dim small">up to 6 · host on any phone or computer</span>` : ""}
      ${co.connecting ? `<div class="dim small">Connecting…</div>` : `<div class="row"><button id="co-host">Host a room</button><input id="co-code" placeholder="room code" maxlength="4" autocomplete="off" autocapitalize="characters" aria-label="Room code"><button id="co-paste" title="Paste code">Paste</button><button id="co-join">Join</button></div>`}${who}
      ${co.direct ? `<div class="dim small">The host's device runs the game, so keep it on this screen while you play. Each player keeps their own loot and save.</div>` : ""}</div>`;
    const hostName = l.members.find((m) => m.pid === 0)?.name ?? "the host";
    const list = l.members.map((m) => `<li>${esc(m.name)}${m.pid === 0 ? " (host)" : ""} · ${esc(CLASSES[m.cls]?.name ?? m.cls)} Lv ${m.level}</li>`).join("");
    return `<div class="coop"><b>Room ${esc(l.code)}</b> <button id="co-copy" data-code="${esc(l.code)}">Copy code</button> <span class="dim small">${l.members.length}/4 · share the code</span><ul>${list}</ul>
      <div class="dim small">${l.host ? "Entering a rift takes everyone in the room with you. Friends can also join mid-run." : l.running ? `${esc(hostName)} is in a rift. Joining…` : `Waiting for ${esc(hostName)} to start a rift.`}</div>
      <button id="co-leave">Leave room</button>${who}</div>`;
  }
  private bindPlay(p: Profile, c: CharSave, H: HubHandlers, re: () => void) {
    const co = H.coop;
    if (co) {
      const b = (id: string, f: () => void) => { const el = this.root.querySelector<HTMLElement>(id); if (el) el.onclick = f; };
      b("#co-host", () => co.host());
      b("#co-join", () => { const v = (this.root.querySelector("#co-code") as HTMLInputElement).value.trim().toUpperCase(); if (v) co.join(v); });
      b("#co-leave", () => co.leave());
      b("#co-copy", () => {
        const btn = this.root.querySelector<HTMLButtonElement>("#co-copy")!; const code = btn.dataset.code ?? "";
        const done = (ok: boolean) => { btn.textContent = ok ? "Copied" : "Copy failed"; setTimeout(() => { btn.textContent = "Copy code"; }, 1500); };
        const fallback = () => { const t = document.createElement("textarea"); t.value = code; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); t.setSelectionRange(0, code.length); let ok = false; try { ok = document.execCommand("copy"); } catch { ok = false; } t.remove(); done(ok); };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => done(true), fallback); else fallback();
      });
      b("#co-paste", () => {
        const inp = this.root.querySelector<HTMLInputElement>("#co-code")!;
        const fill = (t: string) => { const m = t.trim().toUpperCase().match(/\b[A-Z]{4}\b/g); if (m) inp.value = m[m.length - 1]; else inp.focus(); };
        if (navigator.clipboard?.readText) navigator.clipboard.readText().then(fill, () => inp.focus()); else inp.focus();
      });
      b("#co-out", () => co.signOut?.());
      const nm = this.root.querySelector<HTMLInputElement>("#co-name");
      if (nm && co.setName) nm.onchange = () => co.setName!(nm.value);
      if (co.lobby && !co.lobby.host) for (const id of ["#enter", "#weekly", "#chase", "#seraph"]) { const el = this.root.querySelector<HTMLButtonElement>(id); if (el) el.disabled = true; }
    }
    this.root.querySelectorAll<HTMLElement>("[data-cls]").forEach((el) => el.onclick = () => { H.setClass(el.dataset.cls!); this.tier = char(p).highestTier; re(); });
    $("#t-down").onclick = () => { this.tier = Math.max(1, this.tier - 1); re(); };
    $("#t-up").onclick = () => { this.tier = Math.min(c.highestTier, this.tier + 1); re(); };
    $("#enter").onclick = () => {
      const v = ($("#seed") as HTMLInputElement).value.trim().toUpperCase();
      const n = v ? parseInt(v, 36) : NaN;
      H.enter({ tier: this.tier, seed: Number.isFinite(n) ? n >>> 0 : null, kind: "rift" });
    };
    $("#weekly").onclick = () => H.enter({ tier: WEEKLY_TIER, seed: null, kind: "rift", weekly: true });
    $("#endless").onclick = () => H.enter({ tier: this.tier, seed: null, kind: "endless" });
    $("#trial").onclick = () => H.enter({ tier: nextTrial(c.trialBest), seed: null, kind: "trial" });
    $("#chase").onclick = () => H.enter({ tier: Math.max(3, c.highestTier), seed: null, kind: "chase" });
    $("#seraph").onclick = () => H.enter({ tier: Math.max(3, c.highestTier), seed: null, kind: "chase", boss: "seraph" });
  }

  // ---------------------------------------------------------------- gear
  gearTab(p: Profile | null, c: { cls: string; level: number } & Holder, allowReroll: boolean, materials?: number) {
    const h = c as Holder;
    const ctx = { cls: c.cls, level: c.level, slotPlus: h.slotPlus, slotCrit: h.slotCrit };
    const st = computeStats(h.equipment, ctx);
    const sel = this.sel;
    let selItem: Item | undefined;
    if (sel?.where === "bag") selItem = h.bag[sel.i];
    if (sel?.where === "eq") selItem = h.equipment[sel.slot];
    if (sel?.where === "stash") selItem = p?.stash?.[sel.i];
    if (!selItem) this.sel = null;
    const doll = (ITEMS.equipSlots as EquipSlot[]).map((slot) => {
      const lv = h.slotPlus?.[slot] ?? 0;
      const cell = cellHtml(this.bank, h.equipment[slot], `data-eq="${slot}" aria-label="${SLOT_NAME[slot]}${lv ? " +" + lv : ""}"`, sel?.where === "eq" && sel.slot === slot ? "on" : "", SLOT_NAME[slot]);
      return lv ? cell.replace(/<\/button>$/, `<i class="pl ${h.slotCrit?.[slot] ? "mw" : ""}">+${lv}</i></button>`) : cell;
    }).join("");
    let bag = "";
    for (let i = 0; i < BAG_SIZE; i++) {
      const it = h.bag[i];
      bag += it ? cellHtml(this.bank, it, `data-bag="${i}"`, `${sel?.where === "bag" && sel.i === i ? "on" : ""} ${isUpgrade(h, it, ctx) ? "isup" : ""}`) : `<div class="cell empty"></div>`;
    }
    let detail = `<div class="dim">Tap an item. ▲ marks upgrades. Set bonuses and legendary powers change how skills work.</div>`;
    if (selItem) {
      detail = itemHtml(selItem, h, ctx);
      detail += `<div class="row">`;
      const lockBtn = `<button id="lock">${selItem.locked ? "★ Unlock" : "☆ Lock"}</button>`;
      if (this.sel!.where === "bag") {
        if (selItem.slot === "ring") detail += `<button id="equip-r1">Equip ring 1</button><button id="equip-r2">Equip ring 2</button>`;
        else detail += `<button id="equip">Equip</button>`;
        detail += lockBtn;
        if (allowReroll && p) detail += `<button id="to-stash" ${(p.stash?.length ?? 0) >= STASH_SIZE ? "disabled" : ""}>To storage</button>`;
        detail += selItem.locked ? `<button class="warn" disabled title="Unlock it first">Scrap (locked)</button>` : `<button id="scrap" class="warn">Scrap</button>`;
      } else if (this.sel!.where === "stash") {
        detail += `<button id="from-stash" ${h.bag.length >= BAG_SIZE ? "disabled" : ""}>Take to bag</button>${lockBtn}`;
      } else detail += `<button id="unequip">Unequip</button>${lockBtn}`;
      detail += `</div>`;
      if (allowReroll && p && this.sel!.where !== "stash") detail += this.rerollHtml(selItem, p.materials);
      if (allowReroll && p && this.sel!.where === "eq") detail += this.slotHtml(this.sel!.slot, h, p);
    }
    const sets = Object.entries(st.setCounts).filter(([, n]) => n >= 2).map(([id, n]) => `${SET[id].name} ${n}/6`).join(", ");
    void sets;
    return `
      <div class="statline">Damage ${st.dmgMin}–${st.dmgMax} (+${st.dmgPct}%) · Crit ${st.critChance}%/+${st.critDmg}% · AS +${st.atkSpeed}% · Life ${st.maxHp} · Armor ${st.armor}${st.cdr ? ` · CDR ${st.cdr}%` : ""}${st.regen ? ` · ${st.regen} life/s` : ""}${st.lifeOnHit ? ` · ${Math.round(st.lifeOnHit)} life per hit` : ""}<br>Powers: ${st.mods.filter((m) => !(m as any).text).length} · Sets: ${sets || "none"} · Materials ${materials ?? p?.materials ?? 0} · Shards ${p?.shards ?? h.shards ?? 0}</div>
      <div class="doll">${doll}</div>
      <div class="bag-head"><span>Bag ${h.bag.length}/${BAG_SIZE}</span><span><button class="tiny-btn" data-scrapbelow="rare">Scrap common+magic</button><button class="tiny-btn" data-scrapbelow="legendary">Scrap all but legendary/set</button></span></div>
      <div class="bag">${bag}</div>
      <div class="detail">${detail}</div>
      ${allowReroll && p ? this.arsenalHtml(p, char(p)) + this.stashHtml(p) : ""}`;
  }

  private stashHtml(p: Profile) {
    const st = p.stash ?? [];
    let cells = "";
    const shown = Math.min(STASH_SIZE, Math.max(12, Math.ceil((st.length + 1) / 6) * 6));
    for (let i = 0; i < shown; i++) {
      const it = st[i];
      cells += it ? cellHtml(this.bank, it, `data-stash="${i}"`, this.sel?.where === "stash" && this.sel.i === i ? "on" : "") : `<div class="cell empty"></div>`;
    }
    return `<div class="bag-head"><span>Storage ${st.length}/${STASH_SIZE}</span><span class="dim small">shared by all your characters</span></div><div class="bag">${cells}</div>`;
  }
  private arsenalHtml(p: Profile, c: CharSave) {
    const b = c.builds ?? [];
    const slots = Array.from({ length: BUILD_SLOTS }, (_, i) => `<button class="${this.buildSel === i ? "on" : ""} ${b[i] ? "" : "empty"}" data-build="${i}">${b[i] ? esc(b[i]!.name) : `Empty ${i + 1}`}</button>`).join("");
    let detail = `<div class="dim small">Save your gear, skills and runes as a build, then swap builds with one tap. Items a build needs can be in your bag or storage.</div>`;
    const sel = this.buildSel >= 0 ? b[this.buildSel] : undefined;
    if (this.buildSel >= 0) {
      if (sel) {
        const all = new Set([...Object.values(c.equipment).map((it) => it!.id), ...c.bag.map((it) => it.id), ...(p.stash ?? []).map((it) => it.id)]);
        const items = Object.values(sel.equipment), missing = items.filter((id) => id && !all.has(id)).length;
        detail = `<div class="dim small">${items.length} items · ${sel.loadout.map((id) => esc(SKILL[id]?.name ?? id)).join(", ")}${missing ? ` · <span class="warn-t">${missing} item${missing > 1 ? "s" : ""} no longer owned</span>` : ""}</div>
          <div class="row"><button id="b-load">Wear this build</button><button id="b-save">Overwrite with current</button><button id="b-del" class="warn">Delete</button></div>`;
      } else detail = `<div class="row"><button id="b-save">Save current gear and skills here</button></div>`;
    }
    return `<div class="bag-head"><span>Arsenal</span><span class="dim small">${esc(CLASSES[c.cls].name)} builds</span></div><div class="builds">${slots}</div>${detail}`;
  }

  private slotHtml(slot: EquipSlot, h: Holder, p: Profile) {
    const lv = h.slotPlus?.[slot] ?? 0, cost = slotCost(lv), mats = p.materials, sh = p.shards ?? 0;
    let out = `<div class="reroll"><b>${SLOT_NAME[slot]} slot +${lv}</b>`;
    if (cost) {
      const ok = mats >= cost.materials && sh >= cost.shards;
      out += ` · upgrade to +${lv + 1}: whatever you wear here gets +${Math.round((slotMult(lv + 1) - 1) * 100)}% stats${lv + 1 >= SLOT_MAX ? " and a masterwork crit" : ""}. Costs ${cost.materials} materials and ${cost.shards} shard${cost.shards > 1 ? "s" : ""}.
        <span class="mats ${ok ? "" : "short"}">You have ${mats} materials, ${sh} shards${ok ? "" : " · scrap legendary and set items for shards"}</span>
        <div class="opts"><button id="slot-up" ${ok ? "" : "disabled"}>⇪ Upgrade to +${lv + 1}</button></div>`;
    } else out += ` (max)`;
    const crit = h.slotCrit?.[slot];
    if (crit) {
      const rc = ITEMS.slotUpgrade.critReroll, ok = mats >= rc.materials && sh >= rc.shards;
      out += `<div class="small">✦ Masterwork crit: <b>${esc(AFFIX_DEF[crit]?.text.replace("{v}", "X") ?? crit)}</b> gets +50% on anything worn here.</div>
        <div class="opts"><button id="slot-crit" ${ok ? "" : "disabled"}>↻ Reroll crit (${rc.materials} materials, ${rc.shards} shards)</button></div>`;
    }
    return out + `</div>`;
  }

  private rerollHtml(it: Item, mats: number) {
    const cost = rerollCost(it);
    // show values as they count in play (scaled by the item's + level)
    const sc = (a: Affix) => scaledItem({ ...it, affixes: [a] }).affixes[0];
    if (this.rerollState) {
      const cur = sc(it.affixes[this.rerollState.idx]);
      return `<div class="reroll"><b>Reroll:</b> pick one <span class="mats">Materials: ${mats}</span><div class="opts">
        <button data-pick="-1">Keep: ${esc(affixText(cur))}</button>
        ${this.rerollState.options.map((a, i) => `<button data-pick="${i}">${esc(affixText(sc(a)))} <small>${a.min}–${a.max}</small></button>`).join("")}</div></div>`;
    }
    const lock = it.rerollIdx;
    return `<div class="reroll"><b>Mystic:</b> reroll one stat for ${cost} materials${lock !== undefined ? " (only the stat you rerolled before)" : ""}. <span class="mats ${mats < cost ? "short" : ""}">You have ${mats}${mats < cost ? ` · need ${cost - mats} more (scrap items to get materials)` : ""}</span>
      <div class="opts">${it.affixes.map((a, i) => (lock === undefined || lock === i ? `<button data-reroll="${i}" ${mats < cost ? "disabled" : ""}>↻ ${esc(affixText(sc(a)))}</button>` : "")).join("")}</div></div>`;
  }

  bindGear(p: Profile | null, c: Holder, H: Pick<HubHandlers, "invCmd" | "reroll" | "rerollOptions" | "op">, re: () => void, allowReroll: boolean) {
    this.root.querySelectorAll<HTMLElement>("[data-stash]").forEach((el) => el.onclick = () => { this.sel = { where: "stash", i: +el.dataset.stash! }; this.rerollState = null; re(); });
    this.root.querySelectorAll<HTMLElement>("[data-build]").forEach((el) => el.onclick = () => { const i = +el.dataset.build!; this.buildSel = this.buildSel === i ? -1 : i; re(); });
    this.root.querySelectorAll<HTMLElement>("[data-eq]").forEach((el) => el.onclick = () => { this.sel = { where: "eq", slot: el.dataset.eq as EquipSlot }; this.rerollState = null; re(); });
    this.root.querySelectorAll<HTMLElement>("[data-bag]").forEach((el) => el.onclick = () => { this.sel = { where: "bag", i: +el.dataset.bag! }; this.rerollState = null; re(); });
    this.root.querySelectorAll<HTMLElement>("[data-scrapbelow]").forEach((el) => el.onclick = () => {
      if (el.dataset.armed) { H.invCmd({ type: "scrapBelow", rarity: el.dataset.scrapbelow as Rarity }); this.sel = null; re(); }
      else { el.dataset.armed = "1"; el.textContent = "Tap again to scrap"; }
    });
    const bind = (id: string, f: () => void) => { const el = this.root.querySelector<HTMLElement>(id); if (el) el.onclick = f; };
    const i = this.sel?.where === "bag" ? this.sel.i : -1;
    const equip = (to?: EquipSlot) => { const it = c.bag[i]; const slot = equipTarget(c, it, to); H.invCmd({ type: "equip", bagIndex: i, to }); this.sel = { where: "eq", slot }; re(); };
    bind("#equip", () => equip()); bind("#equip-r1", () => equip("ring1")); bind("#equip-r2", () => equip("ring2"));
    bind("#scrap", () => { H.invCmd({ type: "scrap", bagIndex: i }); this.sel = null; re(); });
    bind("#unequip", () => { H.invCmd({ type: "unequip", slot: (this.sel as any).slot }); this.sel = null; re(); });
    bind("#lock", () => {
      const s = this.sel; if (!s) return;
      if (s.where === "stash") H.op?.({ t: "lockStash", stashIndex: s.i });
      else H.invCmd(s.where === "bag" ? { type: "lock", bagIndex: s.i } : { type: "lock", slot: s.slot });
      re();
    });
    bind("#to-stash", () => { H.op?.({ t: "stash", bagIndex: i }); this.sel = null; re(); });
    bind("#from-stash", () => { if (this.sel?.where === "stash") H.op?.({ t: "unstash", stashIndex: this.sel.i }); this.sel = null; re(); });
    bind("#b-load", () => { H.op?.({ t: "buildLoad", idx: this.buildSel }); this.sel = null; this.toast("Build equipped", "#7dff9a"); re(); });
    bind("#b-save", () => { H.op?.({ t: "buildSave", idx: this.buildSel }); this.toast("Build saved", "#7dff9a"); re(); });
    let armed = false;
    bind("#b-del", () => { if (!armed) { armed = true; const el = this.root.querySelector<HTMLElement>("#b-del"); if (el) el.textContent = "Tap again to delete"; return; } H.op?.({ t: "buildDelete", idx: this.buildSel }); re(); });
    if (!allowReroll || !p) return;
    bind("#slot-up", () => { if (this.sel?.where !== "eq") return; const sl = this.sel.slot; H.op?.({ t: "slotUp", slot: sl }); this.toast(`${SLOT_NAME[sl]} slot upgraded`, "#7dff9a"); re(); });
    bind("#slot-crit", () => { if (this.sel?.where !== "eq") return; H.op?.({ t: "slotCrit", slot: this.sel.slot }); this.toast("Masterwork crit rerolled", "#ffd23f"); re(); });
    const target = this.sel?.where === "bag" ? { bag: this.sel.i } : this.sel?.where === "eq" ? { slot: this.sel.slot } : null;
    const it = this.sel?.where === "bag" ? c.bag[this.sel.i] : this.sel?.where === "eq" ? c.equipment[this.sel.slot] : undefined;
    this.root.querySelectorAll<HTMLElement>("[data-reroll]").forEach((el) => el.onclick = () => {
      if (!it) return;
      const idx = +el.dataset.reroll!;
      if (H.rerollOptions && target) { H.rerollOptions(target, idx).then((options) => { this.rerollState = { idx, options }; re(); }); return; }
      this.rerollState = { idx, options: rerollOptions(makeRng((Math.random() * 2 ** 32) >>> 0), it, idx, 2) };
      re();
    });
    this.root.querySelectorAll<HTMLElement>("[data-pick]").forEach((el) => el.onclick = () => {
      if (!target || !this.rerollState) return;
      const k = +el.dataset.pick!;
      H.reroll(target, this.rerollState.idx, k < 0 ? null : this.rerollState.options[k]);
      this.rerollState = null; re();
    });
  }

  // ---------------------------------------------------------------- skills
  private skillsTab(c: CharSave) {
    const R = CLASSES[c.cls].resource;
    const bar = validLoadout(c.cls, c.loadout);
    const slots = bar.map((id, i) => `<button class="sk-slot ${this.skSlot === i ? "on" : ""}" data-slot="${i}"><small>${KEY_LABELS[i]}</small><b>${esc(SKILL[id].name)}</b><span class="dim">${SKILL[id].type}</span></button>`).join("");
    const costText = (id: string) => {
      const P = SKILL[id].p;
      const parts: string[] = [];
      if (P.cost) parts.push(`${P.cost} ${R.name}`);
      if (P.gen) parts.push(`+${P.gen} ${R.name}`);
      if (P.genPerHit) parts.push(`+${P.genPerHit} ${R.name} per hit`);
      if (P.cooldown && P.cooldown >= 2) parts.push(`${P.cooldown}s cooldown`);
      return parts.join(" · ");
    };
    const group = (type: string, title: string) => CLASSES[c.cls].skills.filter((id) => SKILL[id].type === type).map((id) => {
      const d = SKILL[id];
      const locked = c.level < d.unlock;
      const uses = c.uses[id] ?? 0;
      const cur = c.runes[id];
      const at = bar.indexOf(id);
      const runes = d.runes.map((r) => {
        const ok = !locked && uses >= r.uses;
        return `<button class="rune ${cur === r.id ? "on" : ""}" ${ok ? `data-rune="${id}:${cur === r.id ? "" : r.id}"` : "disabled"} title="${esc(r.desc)}"><b>${esc(r.name)}</b><small>${ok ? esc(r.desc) : `after ${r.uses} uses (${uses})`}</small></button>`;
      }).join("");
      const btn = locked ? `<span class="lock">unlocks at level ${d.unlock}</span>` : at === this.skSlot ? `<span class="eq">equipped</span>` : `<button class="equip" data-equip="${id}">${at >= 0 ? `Move to slot ${this.skSlot + 1}` : `Equip in slot ${this.skSlot + 1}`}</button>`;
      return `<div class="skill ${locked ? "locked" : ""} ${at >= 0 ? "inbar" : ""}"><div class="sk-head"><b>${esc(d.name)}</b>${at >= 0 ? ` <span class="eq">${KEY_LABELS[at]}</span>` : ""} <span class="dim">${esc(costText(id))}</span> ${btn}</div><div class="dim small">${esc(d.desc)}</div>${runes ? `<div class="runes">${runes}</div>` : `<div class="dim small">Runes for this skill come in a later update.</div>`}</div>`;
    }).join("");
    const groups = ([["generator", "Generators: build " + R.name], ["core", "Core: spend " + R.name], ["support", "Support"], ["ultimate", "Ultimate (one at a time)"]] as const).map(([t, title]) => `<h3 class="sk-type">${title}</h3>${group(t, title)}`).join("");
    return `${this.talentsHtml(c)}${this.paragonHtml(c)}<div class="dim small">Pick any 4 skills, with at most one ultimate. Tap a slot, then a skill to put there. ${esc(R.name)}: ${R.regen ? `refills ${R.regen} per second` : `built by hits, fades after ${R.decayAfter}s out of combat`}, max ${R.max}. Runes unlock by using a skill.</div><div class="sk-bar">${slots}</div>${groups}`;
  }

  /** Paragon: shown once you hit max level. Points go into four capped stats; respec is free. */
  /** Echo Cores (Endless): strengthen worn items a step at a time. */
  private echoHtml(p: Profile, c: CharSave) {
    const n = p.echoCores ?? 0, E = RIFT.echo;
    if (!n) return `<div class="setting dim small">Echo Cores: reach Endless wave ${E.fromWave}+ to earn them. Each one adds ${E.dmgPct}% damage and ${E.lifePct}% life to an item, up to ${E.maxPerItem} per item.</div>`;
    const worn = Object.entries(c.equipment).filter(([, it]) => it) as [string, Item][];
    return `<div class="setting"><b>Echo Cores</b> <span class="dim small">${n} cores · each echo adds ${E.dmgPct}% damage and ${E.lifePct}% life · costs 1, 2, 3… cores · up to ${E.maxPerItem} per item</span>
      <div class="opts">${worn.map(([sl, it]) => { const e = it.echo ?? 0, cost = echoCost(it); return `<button data-echo="${sl}" ${e < E.maxPerItem && n >= cost ? "" : "disabled"}>${esc(it.name)} ${"◆".repeat(e)}${e < E.maxPerItem ? ` · ${cost}` : " · max"}</button>`; }).join("")}</div></div>`;
  }
  /** Boss trophies: King's Shards craft a chosen set piece; Seraph Hallows make a legendary or set item ancestral. */
  craftSet = "";
  private trophiesHtml(p: Profile, c: CharSave) {
    const sh = p.kingShards ?? 0, ha = p.hallows ?? 0, T = RIFT.trophies;
    if (!sh && !ha) return `<div class="setting dim small">Boss trophies: the Ossuary King drops King's Shards (craft any set piece) and the Pale Seraph drops Hallows (make an item ancestral).</div>`;
    const sets = [...SETS].sort((a, b) => classAffinity(c.cls, b.tag) - classAffinity(c.cls, a.tag));
    const cur = SET[this.craftSet] ? this.craftSet : sets[0].id, S = SET[cur];
    const craft = `<div class="relic-row"><b>Craft a set piece</b> <span class="dim small">${T.craftCost} shards each, at your level</span>
      <div><select data-craft-set>${sets.map((s) => `<option value="${s.id}" ${s.id === cur ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
      <div class="opts">${(Object.entries(S.pieces) as [string, string][]).map(([sl, name]) => `<button data-craft="${cur}:${sl}" ${sh >= T.craftCost && c.bag.length < BAG_SIZE ? "" : "disabled"}>${esc(name)}</button>`).join("")}</div></div>`;
    const elig = [...Object.entries(c.equipment).map(([sl, it]) => ({ it: it!, key: `slot:${sl}` })), ...c.bag.map((it, i) => ({ it, key: `bag:${i}` }))].filter(({ it }) => it && !it.quality && (it.rarity === "legendary" || it.rarity === "set"));
    const hallow = ha ? `<div class="relic-row"><b>Hallow an item</b> <span class="dim small">${T.hallowCost} Hallow: makes it ancestral (+${Math.round((ITEMS.ancestralMult - 1) * 100)}% to its numbers)</span>
      <div class="opts">${elig.length ? elig.map(({ it, key }) => `<button data-hallow="${key}" style="color:${RARITY_COLOR[it.rarity]}">${esc(it.name)}${key.startsWith("slot") ? " (worn)" : ""}</button>`).join("") : `<span class="dim small">No legendary or set item that isn't ancestral yet.</span>`}</div></div>` : "";
    return `<div class="setting"><b>Boss trophies</b> <span class="dim small">${sh} King's Shards · ${ha} Seraph Hallow${ha === 1 ? "" : "s"}</span>${sh ? craft : ""}${hallow}</div>`;
  }
  /** Reliquary: extract a legendary's power (the item is destroyed) and wear up to 3 powers on top of your gear. */
  private relicsHtml(p: Profile, c: CharSave) {
    const own = p.relics ?? [], dust = p.relicDust ?? 0, bounties = lifeStats(p).bounties, cost = RIFT.reliquary.extractCost;
    const names: Record<RelicSlot, string> = { weapon: "Weapon power", armor: "Armour power", jewelry: "Jewellery power" };
    const slot = (sl: RelicSlot) => {
      const need = relicUnlock(sl), cur = c.relicSlots?.[sl];
      if (bounties < need) return `<div class="pg-row dim small"><span>🔒 ${names[sl]}: finish ${need} bounties (${bounties}/${need})</span></div>`;
      const opts = own.filter((id) => LEGENDARY[id] && relicSlotOf(LEGENDARY[id].slot) === sl);
      return `<div class="relic-row"><b>${names[sl]}</b><span class="opts"><button class="${!cur ? "on" : ""}" data-relic="${sl}:">None</button>${opts.map((id) => `<button class="${cur === id ? "on" : ""}" data-relic="${sl}:${id}" title="${esc(powerText({ legendary: id } as Item))}">${esc(LEGENDARY[id].name)}</button>`).join("")}</span>
        ${cur ? `<div class="dim small">${esc(powerText({ legendary: cur } as Item))}</div>` : opts.length ? "" : `<div class="dim small">Nothing extracted for this slot yet.</div>`}</div>`;
    };
    const ex = c.bag.map((it, i) => ({ it, i })).filter(({ it }) => it.legendary && LEGENDARY[it.legendary] && !LEGENDARY[it.legendary].mythic && !own.includes(it.legendary));
    return `<div class="setting"><b>Reliquary</b> <span class="dim small">${dust} Relic Dust · wear extracted legendary powers on top of your gear. Bounties give Relic Dust.</span>
      ${RELIC_SLOTS.map(slot).join("")}
      ${ex.length ? `<div class="dim small">Extract from your bag (destroys the item, ${cost} dust):</div><div class="opts">${ex.map(({ it, i }) => `<button data-extract="${i}" ${dust >= cost && !it.locked ? "" : "disabled"}>${esc(LEGENDARY[it.legendary!].name)}${it.locked ? " ★" : ""}</button>`).join("")}</div>` : ""}</div>`;
  }
  /** Rift gems: socket up to 3. They level up when you clear a rift in time (tier 5+). */
  private gemsHtml(c: CharSave) {
    const own = Object.keys(c.gems ?? {}).filter((id) => GEM[id]), sl = (c.gemSlots ?? []).filter((id) => c.gems?.[id]);
    if (!own.length) return `<div class="setting dim small">Rift Gems: guardians from tier ${GEMS.fromTier} drop them. Socket up to ${GEMS.slots}; they level up each time you clear a rift in time.</div>`;
    const row = (id: string) => {
      const lv = c.gems![id], i = sl.indexOf(id), g = GEM[id];
      const btn = i >= 0 ? `<button data-gem="${i}:">Remove</button>` : `<button data-gem="${sl.length}:${id}" ${sl.length >= GEMS.slots ? "disabled" : ""}>Socket</button>`;
      return `<div class="pg-row"><span><b style="color:${g.color}">◆ ${esc(g.name)}</b> <span class="dim small">Lv ${lv}/${GEMS.maxLevel} · ${esc(gemText(id, lv))}</span></span><span class="opts">${btn}</span></div>`;
    };
    return `<div class="setting"><b>Rift Gems</b> <span class="dim small">${sl.length}/${GEMS.slots} socketed. Timed clears level socketed gems (more at higher tiers, up to level ${GEMS.levelCapPerTier}× the tier).</span>${[...sl, ...own.filter((id) => !sl.includes(id))].map(row).join("")}</div>`;
  }
  /** Class talent tree: three branches, points from Trials. Rows open as you spend in a branch. */
  private talentsHtml(c: CharSave) {
    const tree = TALENTS.classes[c.cls] ?? [], a = c.talents ?? {}, pts = talentPoints(c.trialBest), free = pts - talentSpent(a);
    if (!pts) return `<div class="setting dim small">Talents: pass Trials (a portal in your hideout, or the Play tab) to earn talent points for your class tree.</div>`;
    const br = (b: (typeof tree)[number]) => {
      const spent = b.nodes.reduce((x, n) => x + (a[n.id] ?? 0), 0);
      return `<div class="tal-br"><b style="color:${b.color}">${esc(b.name)}</b> <span class="dim small">${spent} spent</span>${b.nodes.map((n, j) => {
        const r = a[n.id] ?? 0, open = spent - r >= j * TALENTS.gate || r > 0;
        return `<div class="pg-row${open ? "" : " dim"}"><span><b>${esc(n.name)}</b> <span class="dim small">${r}/${n.max} · ${esc(n.text.replace("{v}", String(+(Math.max(1, r) * n.per).toFixed(1))))}${r ? "" : " per rank"}${open ? "" : ` · opens at ${j * TALENTS.gate} in ${esc(b.name)}`}</span></span><span class="opts"><button data-tal="${n.id}:-1" ${talentCanRemove(c.cls, a, n.id) ? "" : "disabled"}>−</button><button data-tal="${n.id}:1" ${talentCanAdd(c.cls, a, n.id, pts) ? "" : "disabled"}>+</button></span></div>`;
      }).join("")}</div>`;
    };
    return `<div class="setting"><b>Talents</b> <span class="dim small">${free} of ${pts} point${pts === 1 ? "" : "s"} to spend · next from Trial ${nextTrial(c.trialBest)}</span>${tree.map(br).join("")}<div class="opts"><button data-tal-reset ${talentSpent(a) ? "" : "disabled"}>Refund all</button></div></div>`;
  }
  private paragonHtml(c: CharSave) {
    const L = RIFT.levels.max;
    if (c.level < L) return `<div class="setting dim small">Paragon unlocks at level ${L}: XP past the cap earns points for damage, life, toughness and haste.</div>`;
    const PS = RIFT.paragon.stats as Record<string, { name: string; per: number; cap: number; text: string }>;
    const a = c.pAlloc ?? {}, free = (c.paragon ?? 0) - paragonSpent(a);
    const rows = PARAGON_STATS.map((k) => {
      const n = a[k] ?? 0, d = PS[k];
      return `<div class="pg-row"><span><b>${esc(d.name)}</b> <span class="dim small">${esc(d.text.replace("{v}", String(+(n * d.per).toFixed(1))))} · ${n}/${d.cap}</span></span><span class="opts"><button data-pg="${k}:-1" ${n ? "" : "disabled"}>−</button><button data-pg="${k}:1" ${free > 0 && n < d.cap ? "" : "disabled"}>+</button></span></div>`;
    }).join("");
    return `<div class="setting"><b>Paragon ${c.paragon ?? 0}</b> <span class="dim small">${free} point${free === 1 ? "" : "s"} to spend · next in ${Math.max(0, paragonXp(c.paragon ?? 0) - (c.pxp ?? 0)).toLocaleString()} XP</span>${rows}<div class="opts"><button data-pg-reset ${paragonSpent(a) ? "" : "disabled"}>Refund all</button></div></div>`;
  }

  // ---------------------------------------------------------------- looks (cosmetics)
  private looksTab(p: Profile) {
    const cur = p.cos ?? {};
    const swatch = (c: Record<string, any>) => {
      const cols = [c.m ?? c.X ?? c.blade ?? c.a, c.d ?? c.x ?? c.wood ?? c.b, c.t1 ?? c.U ?? c.gem ?? c.eye].filter(Boolean);
      return cols.length ? `<i class="sw">${cols.map((x) => `<i style="background:${x}"></i>`).join("")}</i>` : "";
    };
    const cls = char(p).cls;
    const group = (kind: CosKind, title: string, note: string) => {
      const list = COSMETICS[kind].filter((c: any) => !c.cls || c.cls === cls);
      const worn = cur[kind] ?? COSMETICS[kind][0].id;
      return `<div class="setting"><b>${title}</b>${note ? ` <span class="dim small">${note}</span>` : ""}
      <div class="opts">${list.map((c: any) => {
        const a = cosAccess(p, kind, c.id, cls), on = worn === c.id;
        const tag = c.unlock === "premium" ? "★ " : c.unlock === "earn" ? "◆ " : "";
        const lock = a.ok ? "" : a.why === "earn" ? ` · 🔒 ${esc(a.text)}` : " · Shop";
        const kls = [on ? "on" : "", c.unlock === "premium" ? "prem" : c.unlock === "earn" ? "earn" : "", a.ok ? "" : "locked"].join(" ");
        return `<button class="${kls}" data-cos="${kind}:${c.id}" data-lock="${a.ok ? "" : a.why}">${swatch(c)}${tag}${esc(c.name)}${c.cls ? ` <small class="dim">${esc(CLASSES[c.cls].name)}</small>` : ""}${lock}</button>`;
      }).join("")}</div>
      <div class="dim small">${esc(String((COSMETICS[kind].find((c) => c.id === worn) as any)?.desc ?? ""))}</div></div>`;
    };
    return `<div class="look-prev"><canvas id="lookPrev" width="64" height="40"></canvas><div class="dim small">Cosmetics only change how you look. Colours are free, ◆ styles are earned by playing, ★ styles come from the Shop (free in this test build).</div></div>
      ${group("dye", "Colour", (cur.armor && cur.armor !== "default") ? "shows with the base armour" : "")}${group("armor", "Armour", "")}${group("wings", "Wings", "")}${group("weapon", "Weapon", "")}${group("petSkin", "Pet skin", p.pet === "none" ? "pick a pet in Settings to see it" : "")}${this.fxGroup(p)}`;
  }
  /** The Shop: every premium cosmetic, theme, decoration and skill effect. Prices are 0 in the test build. */
  /** Feats: permanent account-wide goals. Some unlock a Wardrobe item. */
  private journeyTab(p: Profile) {
    const L = lifeStats(p), done = new Set(p.feats ?? []);
    const fmt = (n: number) => n.toLocaleString("en-US");
    const card = (a: (typeof ACHIEVEMENTS)[number]) => {
      const ok = done.has(a.id), have = Math.min(L[a.stat], a.goal);
      const bar = ok ? "" : `<div class="feat-bar"><i style="width:${Math.round((100 * have) / a.goal)}%"></i></div><div class="dim small">${fmt(have)} / ${fmt(a.goal)}</div>`;
      return `<div class="feat${ok ? " done" : ""}"><div class="feat-main"><b>${ok ? "✓ " : ""}${esc(a.name)}</b><div class="dim small">${esc(a.desc)}</div>${bar}</div>${a.reward ? `<span class="feat-reward">◆ ${esc(rewardName(a.reward))}</span>` : ""}</div>`;
    };
    const S = SEASON_JOURNEY, SL = seasonStats(p);
    const chapter = (c: (typeof S.chapters)[number], i: number) => {
      const ok = done.has(chapterKey(i));
      const tasks = c.tasks.map((t) => { const have = Math.min(SL[t.stat], t.goal), tk = have >= t.goal; return `<div class="jt${tk ? " done" : ""}"><span>${tk ? "✓" : "○"} ${esc(t.desc)}</span><span class="dim small">${fmt(have)}/${fmt(t.goal)}</span></div>`; }).join("");
      return `<div class="feat chapter${ok ? " done" : ""}"><div class="feat-main"><b>${ok ? "✓ " : ""}Chapter ${i + 1}: ${esc(c.name)}</b>${tasks}</div>${c.reward ? `<span class="feat-reward">◆ ${esc(rewardName(c.reward))}</span>` : ""}</div>`;
    };
    const nDone = S.chapters.filter((_, i) => done.has(chapterKey(i))).length;
    return `<div class="setting"><b>Season ${p.season.n} journey: ${esc(S.name)}</b> <span class="dim small">${nDone}/${S.chapters.length} chapters. ${esc(S.desc)}</span>
      <div class="feat-list">${S.chapters.map(chapter).join("")}</div></div>
      <div class="setting"><b>Feats</b> <span class="dim small">${done.size}/${ACHIEVEMENTS.length} done · they count across all heroes and seasons. ◆ rewards unlock in the Wardrobe.</span>
      <div class="feat-list">${[...ACHIEVEMENTS].sort((a, b) => Number(done.has(a.id)) - Number(done.has(b.id))).map(card).join("")}</div></div>`;
  }
  /** The Shop: every premium cosmetic, theme, decoration and skill effect, bought with Aether. Wearables can be tried on first. */
  private shopTab(p: Profile, H: HubHandlers) {
    const cls = char(p).cls, bal = p.aether ?? 0;
    const all = shopCatalogue();
    const sections: Record<string, typeof all> = {};
    for (const it of all) (sections[it.section] ??= []).push(it);
    const sw = (cols: string[]) => `<i class="sw">${cols.map((c) => `<i style="background:${c}"></i>`).join("")}</i>`;
    const look = (key: string) => {
      const [k, a, b] = key.split(":");
      if (k === "decor") { const ic = decorIcon(a); return ic ? `<img class="shop-ic" src="${ic.toDataURL()}" alt="">` : ""; }
      if (k === "theme") { const t = HIDEOUT.themes.find((x) => x.id === a); return t ? sw([t.map.floor[0], t.map.wallFace, t.carpet ?? t.map.wallTop, t.light ?? t.trim ?? t.map.speck[0]].filter(Boolean) as string[]) : ""; }
      if (k === "fx") { const st = VFX.styles[b]; return st ? sw([st.main, st.accent, st.core]) : ""; }
      return "";
    };
    const card = (it: (typeof all)[number]) => {
      const own = ownsKey(p, it.key), [k, kind, id] = it.key.split(":");
      const trying = k === "cos" && this.tryOn[kind as CosKind] === id;
      const other = it.cls && it.cls !== cls ? ` <small class="dim">${esc(CLASSES[it.cls]?.name ?? it.cls)}</small>` : "";
      const fxOn = k === "fx" && this.fxTry === `${kind}:${id}`;
      const tryBtn = k === "cos" && !own && (!it.cls || it.cls === cls) ? `<button class="try${trying ? " on" : ""}" data-try="${kind}:${trying ? "" : id}">${trying ? "Trying on" : "Preview"}</button>`
        : k === "fx" ? `<button class="try${fxOn ? " on" : ""}" data-try-fx="${fxOn ? "" : `${kind}:${id}`}">${fxOn ? "Playing" : "Preview"}</button>` : "";
      return `<div class="shop-item${own ? " owned" : ""}">${look(it.key)}<div class="shop-main"><b>★ ${esc(it.name)}</b>${other}${it.desc ? `<div class="dim small">${esc(it.desc)}</div>` : ""}</div>
        <span class="shop-btns">${tryBtn}${own ? `<span class="owned-tag">Owned</span>` : `<button data-buy="${esc(it.key)}" data-price="${it.price}" class="${bal >= it.price ? "" : "poor"}">${SHOP.symbol} ${it.price.toLocaleString("en-US")}</button>`}</span></div>`;
    };
    const tried = Object.keys(this.tryOn).length + (this.fxTry ? 1 : 0);
    const fxName = this.fxTry ? (() => { const [a, b] = this.fxTry.split(":"); return `${VFX.styles[b]?.name ?? b} ${SKILL[a]?.name ?? a}`; })() : "";
    return `<div class="shop-top"><div class="look-prev"><canvas id="lookPrev" width="64" height="40"></canvas><div><b class="aether">${SHOP.symbol} ${bal.toLocaleString("en-US")} ${SHOP.currency}</b>
        <div class="dim small">${fxName ? `Playing ${esc(fxName)}.` : tried ? "Previewing on your hero." : "Tap Preview to try a look or effect."}</div>${tried ? `<button data-try-clear>Stop preview</button>` : ""}</div></div></div>
      <div class="dim small">${SHOP.currency} buys looks only, never power. Earn it from feats, the season journey, timed tier ${SHOP.earn.riftFromTier}+ rifts, the Seraph and Endless wave ${SHOP.earn.endlessFromWave}+.</div>
      <div class="opts">${SHOP.packs.map((pk) => `<button class="pack" data-pack="${pk.id}" ${H.coop ? "disabled" : ""}>Get ${SHOP.symbol} ${pk.amount.toLocaleString("en-US")}</button>`).join("")}</div>
      <div class="dim small">${H.coop ? `Buying ${SHOP.currency} isn't switched on yet (no payment provider). Earn it by playing.` : "Test build: packs are free. Real purchases come with a payment provider later."}</div>
      ${Object.entries(sections).map(([name, items]) => `<div class="setting"><b>${esc(name)}</b> <span class="dim small">${items.filter((x) => ownsKey(p, x.key)).length}/${items.length} owned</span><div class="shop-list">${items.map(card).join("")}</div></div>`).join("")}`;
  }
  /** Premium skill effects: two styles per skill, equipped skills first. */
  private fxGroup(p: Profile) {
    const c = char(p), cls = CLASSES[c.cls], cur = p.cos?.fx ?? {};
    const eq = c.loadout ?? cls.loadout;
    const ids = [...eq, ...cls.skills.filter((id: string) => !eq.includes(id))].filter((id: string) => VFX.perSkill[id]);
    const sw = (st: { main: string; accent: string; core: string }) => `<i class="sw"><i style="background:${st.main}"></i><i style="background:${st.accent}"></i><i style="background:${st.core}"></i></i>`;
    const row = (id: string) => `<div class="fx-row"><span class="${eq.includes(id) ? "" : "dim"}">${esc(SKILL[id].name)}</span><span class="opts">
      <button class="${!cur[id] ? "on" : ""}" data-fx="${id}:default">Default</button>
      ${VFX.perSkill[id].map((sid) => { const st = VFX.styles[sid], own = ownsKey(p, `fx:${id}:${sid}`); return `<button class="${cur[id] === sid ? "on" : ""} prem${own ? "" : " locked"}" data-fx="${id}:${sid}" data-lock="${own ? "" : "premium"}">${sw(st)}★ ${esc(st.name)}${own ? "" : " · Shop"}</button>`; }).join("")}</span></div>`;
    return `<div class="setting"><b>Skill effects</b> <span class="dim small">★ premium · from the Shop</span>
      <div class="dim small">Re-colours a skill's projectiles, casts, blasts and trails. Your party sees them too.</div>${ids.map(row).join("")}</div>`;
  }
  private bindLooks(p: Profile, H: HubHandlers, re: () => void) {
    // locked premium goes to the Shop; locked earnable just says how to earn it
    const locked = (el: HTMLElement) => {
      const l = el.dataset.lock;
      if (l === "premium") { this.tab = "shop"; if (el.dataset.fx) this.fxTry = el.dataset.fx; re(); return true; }
      if (l === "earn") { this.toast(`Earn it: ${el.textContent!.split("🔒 ")[1] ?? "keep playing"}`, "#ffd23f"); return true; }
      return false;
    };
    this.root.querySelectorAll<HTMLElement>("[data-cos]").forEach((el) => el.onclick = () => { if (locked(el)) return; const [k, v] = el.dataset.cos!.split(":"); H.setting("cos." + k, v); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-fx]").forEach((el) => el.onclick = () => { if (locked(el)) return; const [k, v] = el.dataset.fx!.split(":"); H.setting("fx." + k, v); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-buy]").forEach((el) => el.onclick = () => {
      const price = +el.dataset.price!, key = el.dataset.buy!;
      if ((p.aether ?? 0) < price) { this.toast(`Not enough ${SHOP.currency} (${(price - (p.aether ?? 0)).toLocaleString("en-US")} more)`, "#ff6a6a"); return; }
      if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = `Buy for ${SHOP.symbol} ${price.toLocaleString("en-US")}?`; return; } // tap twice to buy
      H.op?.({ t: "buy", key });
      const [k, kind, id] = key.split(":");
      if (k === "cos" && this.tryOn[kind as CosKind] === id) { delete this.tryOn[kind as CosKind]; H.setting("cos." + kind, id); }
      this.toast("Added to your collection", "#7dff9a"); re();
    });
    this.root.querySelectorAll<HTMLElement>("[data-try]").forEach((el) => el.onclick = () => { const [k, v] = el.dataset.try!.split(":"); if (v) this.tryOn[k as CosKind] = v; else delete this.tryOn[k as CosKind]; re(); });
    this.root.querySelectorAll<HTMLElement>("[data-try-fx]").forEach((el) => el.onclick = () => { this.fxTry = el.dataset.tryFx!; re(); });
    const tc = this.root.querySelector<HTMLElement>("[data-try-clear]"); if (tc) tc.onclick = () => { this.tryOn = {}; this.fxTry = ""; re(); };
    this.root.querySelectorAll<HTMLElement>("[data-pack]").forEach((el) => el.onclick = () => { H.op?.({ t: "buyAether", pack: el.dataset.pack! }); this.toast(`${SHOP.currency} added (free in the test build)`, "#7dff9a"); re(); });
    const cv = this.root.querySelector<HTMLCanvasElement>("#lookPrev");
    if (!cv) return;
    const g = cv.getContext("2d")!; g.imageSmoothingEnabled = false;
    const cls = char(p).cls, cos = this.tab === "shop" ? { ...(p.cos ?? {}), ...this.tryOn } : p.cos ?? {};
    const fxT = this.tab === "shop" && this.fxTry ? this.fxTry.split(":") : null;
    const fxSt = fxT ? VFX.styles[fxT[1]] : undefined, fxKind = fxT ? SKILL[fxT[0]]?.kind ?? "projectile" : "";
    const pet = fxSt ? "none" : p.pet === "none" && this.tab === "shop" && this.tryOn.petSkin ? "bat" : p.pet;
    const parts: { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string }[] = [];
    const emit: Emit = (x, y, vx, vy, life, color) => { if (parts.length < 120) parts.push({ x, y, vx, vy, life, max: life, color }); };
    const t0 = performance.now(); let last = t0;
    const frame = () => {
      if (!cv.isConnected) return;
      const now = performance.now(), t = (now - t0) / 1000, dt = Math.min(0.05, (now - last) / 1000); last = now;
      g.clearRect(0, 0, cv.width, cv.height);
      if (fxSt) { // skill effect preview: the hero faces a dummy and casts on a loop
        const sk = (t % 1.4) < 0.3 ? 1 - (t % 1.4) / 0.3 : 0;
        drawHeroCos(g, this.bank, { pid: 0, cls, cos, fx: 1, fy: 0.2, moving: false, walk: 0, swingK: sk }, 14, 36, t, emit);
        drawFxPreview(g, fxKind, fxSt, 14, 36, t);
      } else {
      const turn = Math.floor(t / 3) % 3; // face right, face the camera, walk away
      const fx = turn === 0 ? 1 : turn === 1 ? 0.2 : 0.1, fy = turn === 0 ? 0.2 : turn === 1 ? 1 : -1;
      drawHeroCos(g, this.bank, { pid: 0, cls, cos, fx, fy, moving: true, walk: t * 30, swingK: (t % 1.2) < 0.3 ? 1 - (t % 1.2) / 0.3 : 0 }, 26, 36, t, emit);
      }
      if (pet !== "none") drawPetCos(g, this.bank, pet, cos.petSkin, 48, 36, true, t, emit);
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i]; q.life -= dt; if (q.life <= 0) { parts.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt; g.globalAlpha = Math.min(1, q.life / q.max * 1.5); g.fillStyle = q.color; g.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
      }
      g.globalAlpha = 1;
      requestAnimationFrame(frame);
    };
    frame();
  }

  // ---------------------------------------------------------------- settings
  private driveHtml() {
    if (!driveAvailable()) return "";
    const st = driveStatus();
    return `<div class="setting" id="drive-box"><b>Google sync</b><div class="dim small">Keeps your save in a hidden folder in your own Google Drive, so it follows you to other devices. Only this game can see that folder.</div>
      <div class="dim small" id="drive-st">${esc(st.text)}</div>
      <div class="opts">${st.signedIn ? `<button id="drive-out">Sign out</button>` : `<button id="drive-in">Sign in with Google</button>`}</div></div>`;
  }
  /** Redraws just the Google sync box (status changes arrive while the hub is open). */
  refreshDrive() {
    const box = this.root.querySelector("#drive-box");
    if (!box) return;
    box.outerHTML = this.driveHtml();
    this.bindDrive();
  }
  private bindDrive() {
    const i = this.root.querySelector<HTMLElement>("#drive-in"), o = this.root.querySelector<HTMLElement>("#drive-out");
    if (i) i.onclick = () => { driveSignIn(); };
    if (o) o.onclick = () => { driveSignOut(); };
  }
  private settingsTab(p: Profile) {
    const filters: [Rarity, string][] = [["common", "Show everything"], ["magic", "Hide commons"], ["rare", "Hide common + magic"], ["legendary", "Only legendary, set, mythic"]];
    return `${this.driveHtml()}
      <div class="setting"><b>Loot filter</b><div class="dim small">Hidden items are auto-scrapped into materials when you walk over them.</div>
        <div class="opts">${filters.map(([r, l]) => `<button class="${p.filter === r ? "on" : ""}" data-filter="${r}">${l}</button>`).join("")}</div></div>
      <div class="setting"><b>Pet</b><div class="dim small">Cosmetic. Any pet picks up your loot in a radius (bigger from level 15).</div>
        <div class="opts">${PETS.map((pt) => `<button class="${p.pet === pt.id ? "on" : ""}" data-pet="${pt.id}">${esc(pt.name)}</button>`).join("")}</div></div>
      <div class="setting"><b>Sound</b> <button data-toggle="mute">${p.settings.mute ? "Off" : "On"}</button> <b>Screen shake</b> <button data-toggle="shake">${p.settings.shake ? "On" : "Off"}</button></div>
      <div class="setting"><b>Season ${p.season.n}</b> <span class="dim small">started ${p.season.started}. A new season resets levels and gear for both classes. Pets and settings carry over.</span><br><button id="season" class="warn">Start a new season</button></div>
      <div class="setting"><button id="reset" class="warn">Reset save</button> <span class="dim small">Saved in this browser only (offline test build).</span></div>`;
  }
  private bindSettings(p: Profile, H: HubHandlers, re: () => void) {
    this.root.querySelectorAll<HTMLElement>("[data-filter]").forEach((el) => el.onclick = () => { H.setting("filter", el.dataset.filter); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-pet]").forEach((el) => el.onclick = () => { H.setting("pet", el.dataset.pet); re(); });
    this.root.querySelectorAll<HTMLElement>("[data-toggle]").forEach((el) => el.onclick = () => { const k = el.dataset.toggle as "mute" | "shake"; H.setting(k, !p.settings[k]); re(); });
    const arm = (id: string, f: () => void) => { const el = $(id); el.onclick = () => { if (el.dataset.armed) f(); else { el.dataset.armed = "1"; el.textContent = "Tap again to confirm"; } }; };
    arm("#season", () => { H.newSeason(); this.tab = "play"; });
    arm("#reset", () => { H.reset(); this.tab = "play"; });
  }

  // ---------------------------------------------------------------- in-rift screens
  showRiftInventory(c: { cls: string; level: number } & Holder, materials: number, onCmd: (c: InvCmd) => void, onClose: () => void) {
    this.invOpen = true;
    this.root.className = "screen";
    const re = () => this.showRiftInventory(c, materials, onCmd, onClose);
    this.root.innerHTML = `<div class="panel inv"><div class="inv-head"><b>Bag · rift paused</b><button id="close">Close</button></div>${this.gearTab(null, c, false, c.materials)}</div>`;
    this.bindGear(null, c, { invCmd: onCmd, reroll: () => {} }, re, false);
    $("#close").onclick = () => { this.sel = null; onClose(); };
  }

  showBoons(offer: string[], onPick: (id: string) => void, onLater?: () => void) {
    this.root.className = "screen";
    this.root.innerHTML = `<div class="panel boons"><h2>Choose a boon</h2><div class="dim small">Lasts until the end of this rift.</div>
      <div class="boon-list">${offer.map((id) => `<button class="boon" data-boon="${id}"><b>${esc(BOON[id].name)}</b><span>${esc(BOON[id].desc)}</span></button>`).join("")}</div>
      ${onLater ? `<button id="boon-later">Later</button>` : ""}</div>`;
    this.root.querySelectorAll<HTMLElement>("[data-boon]").forEach((el) => el.onclick = () => onPick(el.dataset.boon!));
    const later = this.root.querySelector<HTMLElement>("#boon-later"); if (later && onLater) later.onclick = onLater;
  }

  showResults(r: { title: string; sub: string; time: number; kills: number; found: Record<string, number>; legendaries: { name: string; rarity: Rarity; quality?: string }[]; lines: string[] }, onBack: () => void) {
    this.root.className = "screen";
    const f = r.found;
    const counts = (["mythic", "set", "legendary", "rare", "magic"] as Rarity[]).filter((k) => f[k]).map((k) => `<span style="color:${RARITY_COLOR[k]}">${f[k]} ${k}</span>`).join(", ");
    this.root.innerHTML = `
      <div class="panel results">
        <h2>${esc(r.title)}</h2>
        <div class="big-time">${fmtTime(r.time)}</div>
        <div>${esc(r.sub)}</div>
        <div class="stats">Kills ${r.kills} · Picked up: ${counts || "nothing special"}</div>
        ${r.legendaries.length ? `<div class="legs">${r.legendaries.map((n) => `<div style="color:${RARITY_COLOR[n.rarity]}">★ ${n.quality ? n.quality[0].toUpperCase() + n.quality.slice(1) + " " : ""}${esc(n.name)}</div>`).join("")}</div>` : ""}
        ${r.lines.map((l) => `<div class="dim">${esc(l)}</div>`).join("")}
        <button id="back" class="big">Return to hub</button>
      </div>`;
    $("#back").onclick = onBack;
  }

  toast(text: string, color = "#fff", ms = 2200) {
    const t = $("#toast");
    t.textContent = text; t.style.color = color; t.style.opacity = "1";
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => (t.style.opacity = "0"), ms);
  }
}

export function modsLine(mods: string[]) { return mods.map((m) => MODIFIER[m]?.name ?? m).join(" · "); }
export { slotTypeOf, RARITY_ORDER };
