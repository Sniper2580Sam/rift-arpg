// DOM screens: hub (play / gear / skills / settings), inventory with compare + reroll, boon picker, results.
import { BOON, CLASSES, EquipSlot, ITEMS, LEGENDARY, MODIFIER, PETS, RARITY_ORDER, RIFT, Rarity, SET, SKILL, slotTypeOf } from "../sim/data";
import { BAG_SIZE, Holder, InvCmd, Item, Stats, affixQuality, affixText, computeStats, equipTarget, powerText, rerollCost, rerollOptions, Affix } from "../sim/items";
import { makeRng } from "../sim/rng";
import { RARITY_COLOR, SpriteBank } from "./sprites";
import { CharSave, Profile, WEEKLY_TIER, char, isoWeek, xpProgress } from "./profile";
import { KEY_LABELS } from "./input";

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
  return `<button class="cell r-${it.rarity} ${it.quality ? "q-" + it.quality : ""} ${extra}" ${attrs}><img alt="" src="${icon(bank, it)}">${extra.includes("isup") ? '<i class="up">▲</i>' : ""}</button>`;
}

export function itemHtml(it: Item, h?: Holder, ctx?: { cls: string; level: number }): string {
  const col = RARITY_COLOR[it.rarity];
  let out = `<div class="it-name" style="color:${col}">${esc(it.name)}</div>`;
  out += `<div class="it-type">${it.quality ? `<b class="q-${it.quality}">${it.quality === "primal" ? "Primal" : "Ancestral"}</b> ` : ""}${RARITY_NAME[it.rarity]} ${SLOT_NAME[it.slot]} · item level ${it.ilvl}</div>`;
  if (it.dmgMin !== undefined) out += `<div class="it-base">${it.dmgMin}–${it.dmgMax} Damage</div>`;
  if (it.armor) out += `<div class="it-base">${it.armor} Armor</div>`;
  it.affixes.forEach((a, i) => {
    const q = Math.round(affixQuality(a) * 100);
    out += `<div class="it-affix${it.rerollIdx === i ? " locked" : ""}">${esc(affixText(a))} <small class="range">${a.min}–${a.max}${q >= 100 ? " ★" : ""}</small></div>`;
  });
  if (it.legendary) out += `<div class="it-power ${LEGENDARY[it.legendary].mythic ? "mythic" : ""}">${esc(powerText(it))}</div>`;
  if (it.set) {
    const sd = SET[it.set];
    const have = h ? Object.values(h.equipment).filter((e) => e?.set === it.set).length : 0;
    out += `<div class="it-set"><b>${esc(sd.name)}</b> (${have}/6 equipped)`;
    for (const [n, b] of Object.entries(sd.bonuses)) out += `<div class="${have >= +n ? "on" : ""}">(${n}) ${esc(b.text)}</div>`;
    out += `</div>`;
  }
  if (h && ctx) {
    const slot = equipTarget(h, it);
    const cur = h.equipment[slot];
    if (cur !== it) {
      const a = computeStats(h.equipment, ctx), b = computeStats({ ...h.equipment, [slot]: it }, ctx);
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

type Tab = "play" | "gear" | "skills" | "settings";
export interface HubHandlers {
  enter: (o: { tier: number; seed: number | null; kind: "rift" | "chase"; weekly?: boolean }) => void;
  invCmd: (c: InvCmd) => void;
  setClass: (cls: string) => void;
  setRune: (skill: string, rune: string) => void;
  reroll: (bagOrSlot: { bag?: number; slot?: EquipSlot }, affixIdx: number, choice: Affix | null) => void;
  setting: (k: string, v: any) => void;
  newSeason: () => void;
  reset: () => void;
}

export class UI {
  root = $("#ui");
  tab: Tab = "play";
  sel: { where: "bag"; i: number } | { where: "eq"; slot: EquipSlot } | null = null;
  rerollState: { idx: number; options: Affix[] } | null = null;
  invOpen = false;
  tier = 1;
  private toastT = 0;
  constructor(private bank: SpriteBank) {}

  hide() { this.root.innerHTML = ""; this.root.className = ""; this.invOpen = false; }

  // ---------------------------------------------------------------- hub
  showHub(p: Profile, H: HubHandlers) {
    this.invOpen = false;
    const c = char(p);
    this.tier = Math.min(Math.max(1, this.tier), c.highestTier);
    this.root.className = "screen";
    const cd = CLASSES[c.cls];
    const tabs = (["play", "gear", "skills", "settings"] as Tab[]).map((t) => `<button class="tab ${this.tab === t ? "on" : ""}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("");
    let body = "";
    if (this.tab === "play") body = this.playTab(p, c);
    if (this.tab === "gear") body = this.gearTab(p, { cls: c.cls, level: c.level, equipment: c.equipment, bag: c.bag, materials: p.materials }, true);
    if (this.tab === "skills") body = this.skillsTab(c);
    if (this.tab === "settings") body = this.settingsTab(p);
    this.root.innerHTML = `
      <div class="panel hub">
        <div class="hub-head">
          <div><h1>RIFT ARPG</h1><div class="sub">working title · Season ${p.season.n} · test build</div></div>
          <div class="who"><b>${cd.name}</b> · Lv ${c.level}<div class="xpbar"><i style="width:${Math.round(xpProgress(c) * 100)}%"></i></div></div>
        </div>
        <nav class="tabs">${tabs}</nav>
        <div class="tab-body">${body}</div>
      </div>`;
    this.root.querySelectorAll<HTMLElement>("[data-tab]").forEach((el) => el.onclick = () => { this.tab = el.dataset.tab as Tab; this.sel = null; this.rerollState = null; this.showHub(p, H); });
    const re = () => this.showHub(p, H);
    if (this.tab === "play") this.bindPlay(p, c, H, re);
    if (this.tab === "gear") this.bindGear(p, { equipment: c.equipment, bag: c.bag, materials: p.materials }, H, re, true);
    if (this.tab === "skills") this.root.querySelectorAll<HTMLElement>("[data-rune]").forEach((el) => el.onclick = () => { const [sk, r] = el.dataset.rune!.split(":"); H.setRune(sk, r); re(); });
    if (this.tab === "settings") this.bindSettings(p, H, re);
  }

  private playTab(p: Profile, c: CharSave) {
    const t = this.tier, T = RIFT.tiers;
    const hp = Math.pow(T.hpGrowth, t - 1), leg = 1 + T.legendaryGrowth * (t - 1);
    const anc = t >= T.ancestralFrom ? Math.min(T.ancestralCap, T.ancestralBase + T.ancestralPerTier * (t - T.ancestralFrom)) : 0;
    const week = isoWeek();
    const wbest = p.weekly.week === week && p.weekly.best ? fmtTime(p.weekly.best) : "—";
    const classes = Object.entries(CLASSES).map(([id, d]) => `<button class="cls-card ${p.active === id ? "on" : ""}" data-cls="${id}"><b>${d.name}</b><span>Lv ${p.chars[id].level} · ${d.role}</span><small>${esc(d.desc)}</small></button>`).join("");
    return `
      <div class="classes">${classes}</div>
      <div class="tier-row">
        <button id="t-down" aria-label="Lower tier">−</button>
        <div class="tier"><b>Tier ${t}</b><small>enemy life ×${hp.toFixed(1)} · legendary odds ×${leg.toFixed(2)}${anc ? ` · ancestral ${Math.round(anc * 100)}%` : ""}${t >= T.primalFrom ? " · primals can drop" : ""}</small></div>
        <button id="t-up" aria-label="Higher tier" ${t >= c.highestTier ? "disabled" : ""}>+</button>
      </div>
      <div class="dim small">Clear a tier before the timer runs out to unlock the next one. Highest: ${c.highestTier}. Ancestral pity: ${c.pityAnc}/${T.ancestralPity}.</div>
      <button id="enter" class="big">Enter the Sunken Ossuary</button>
      <div class="row">
        <input id="seed" placeholder="rift code (optional)" maxlength="8" autocomplete="off" aria-label="Rift code">
        <button id="weekly">Weekly rift ${week.slice(5)} · T${WEEKLY_TIER} · best ${wbest}</button>
      </div>
      <button id="chase" class="chase" ${c.sigils > 0 ? "" : "disabled"}>Challenge the Ossuary King (uses 1 Bone Sigil · you have ${c.sigils})</button>
      <div class="dim small">Bone Sigils drop from guardians at tier ${T.sigilFrom}+. The King is a 3-phase fight with a ${Math.round(RIFT.chase.mythicChance * 100)}% mythic chance.</div>
      <div class="help">
        <b>Desktop:</b> WASD move · LMB primary · RMB/E secondary · Space, Q, R utilities · F ultimate · I bag · M mute<br>
        <b>Touch:</b> left thumb moves · six buttons on the right · aiming is automatic (bosses and elites first)
      </div>`;
  }
  private bindPlay(p: Profile, c: CharSave, H: HubHandlers, re: () => void) {
    this.root.querySelectorAll<HTMLElement>("[data-cls]").forEach((el) => el.onclick = () => { H.setClass(el.dataset.cls!); this.tier = char(p).highestTier; re(); });
    $("#t-down").onclick = () => { this.tier = Math.max(1, this.tier - 1); re(); };
    $("#t-up").onclick = () => { this.tier = Math.min(c.highestTier, this.tier + 1); re(); };
    $("#enter").onclick = () => {
      const v = ($("#seed") as HTMLInputElement).value.trim().toUpperCase();
      const n = v ? parseInt(v, 36) : NaN;
      H.enter({ tier: this.tier, seed: Number.isFinite(n) ? n >>> 0 : null, kind: "rift" });
    };
    $("#weekly").onclick = () => H.enter({ tier: WEEKLY_TIER, seed: null, kind: "rift", weekly: true });
    $("#chase").onclick = () => H.enter({ tier: Math.max(3, c.highestTier), seed: null, kind: "chase" });
  }

  // ---------------------------------------------------------------- gear
  gearTab(p: Profile | null, c: { cls: string; level: number } & Holder, allowReroll: boolean, materials?: number) {
    const ctx = { cls: c.cls, level: c.level };
    const h = c as Holder;
    const st = computeStats(h.equipment, ctx);
    const sel = this.sel;
    let selItem: Item | undefined;
    if (sel?.where === "bag") selItem = h.bag[sel.i];
    if (sel?.where === "eq") selItem = h.equipment[sel.slot];
    if (!selItem) this.sel = null;
    const doll = (ITEMS.equipSlots as EquipSlot[]).map((slot) => cellHtml(this.bank, h.equipment[slot], `data-eq="${slot}" aria-label="${SLOT_NAME[slot]}"`, sel?.where === "eq" && sel.slot === slot ? "on" : "", SLOT_NAME[slot])).join("");
    let bag = "";
    for (let i = 0; i < BAG_SIZE; i++) {
      const it = h.bag[i];
      bag += it ? cellHtml(this.bank, it, `data-bag="${i}"`, `${sel?.where === "bag" && sel.i === i ? "on" : ""} ${isUpgrade(h, it, ctx) ? "isup" : ""}`) : `<div class="cell empty"></div>`;
    }
    let detail = `<div class="dim">Tap an item. ▲ marks upgrades. Set bonuses and legendary powers change how skills work.</div>`;
    if (selItem) {
      detail = itemHtml(selItem, h, ctx);
      detail += `<div class="row">`;
      if (this.sel!.where === "bag") {
        if (selItem.slot === "ring") detail += `<button id="equip-r1">Equip ring 1</button><button id="equip-r2">Equip ring 2</button>`;
        else detail += `<button id="equip">Equip</button>`;
        detail += `<button id="scrap" class="warn">Scrap</button>`;
      } else detail += `<button id="unequip">Unequip</button>`;
      detail += `</div>`;
      if (allowReroll && p) detail += this.rerollHtml(selItem, p.materials);
    }
    const sets = Object.entries(st.setCounts).filter(([, n]) => n >= 2).map(([id, n]) => `${SET[id].name} ${n}/6`).join(", ");
    void sets;
    return `
      <div class="statline">Damage ${st.dmgMin}–${st.dmgMax} (+${st.dmgPct}%) · Crit ${st.critChance}%/+${st.critDmg}% · AS +${st.atkSpeed}% · Life ${st.maxHp} · Armor ${st.armor}${st.cdr ? ` · CDR ${st.cdr}%` : ""}${st.regen ? ` · ${st.regen} life/s` : ""}<br>Powers: ${st.mods.filter((m) => !(m as any).text).length} · Sets: ${sets || "none"} · Materials ${materials ?? p?.materials ?? 0}</div>
      <div class="doll">${doll}</div>
      <div class="bag-head"><span>Bag ${h.bag.length}/${BAG_SIZE}</span><span><button class="tiny-btn" data-scrapbelow="rare">Scrap common+magic</button><button class="tiny-btn" data-scrapbelow="legendary">Scrap all but legendary/set</button></span></div>
      <div class="bag">${bag}</div>
      <div class="detail">${detail}</div>`;
  }

  private rerollHtml(it: Item, mats: number) {
    const cost = rerollCost(it);
    if (this.rerollState) {
      const cur = it.affixes[this.rerollState.idx];
      return `<div class="reroll"><b>Reroll:</b> pick one<div class="opts">
        <button data-pick="-1">Keep: ${esc(affixText(cur))}</button>
        ${this.rerollState.options.map((a, i) => `<button data-pick="${i}">${esc(affixText(a))} <small>${a.min}–${a.max}</small></button>`).join("")}</div></div>`;
    }
    const lock = it.rerollIdx;
    return `<div class="reroll"><b>Mystic:</b> reroll one stat for ${cost} materials${lock !== undefined ? " (only the stat you rerolled before)" : ""}.
      <div class="opts">${it.affixes.map((a, i) => (lock === undefined || lock === i ? `<button data-reroll="${i}" ${mats < cost ? "disabled" : ""}>↻ ${esc(affixText(a))}</button>` : "")).join("")}</div></div>`;
  }

  bindGear(p: Profile | null, c: Holder, H: Pick<HubHandlers, "invCmd" | "reroll">, re: () => void, allowReroll: boolean) {
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
    if (!allowReroll || !p) return;
    const target = this.sel?.where === "bag" ? { bag: this.sel.i } : this.sel?.where === "eq" ? { slot: this.sel.slot } : null;
    const it = this.sel?.where === "bag" ? c.bag[this.sel.i] : this.sel?.where === "eq" ? c.equipment[this.sel.slot] : undefined;
    this.root.querySelectorAll<HTMLElement>("[data-reroll]").forEach((el) => el.onclick = () => {
      if (!it) return;
      const idx = +el.dataset.reroll!;
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
    const rows = CLASSES[c.cls].skills.map((id, slot) => {
      const d = SKILL[id];
      const locked = c.level < d.unlock;
      const uses = c.uses[id] ?? 0;
      const cur = c.runes[id];
      const runes = d.runes.map((r) => {
        const ok = !locked && uses >= r.uses;
        return `<button class="rune ${cur === r.id ? "on" : ""}" ${ok ? `data-rune="${id}:${cur === r.id ? "" : r.id}"` : "disabled"} title="${esc(r.desc)}"><b>${esc(r.name)}</b><small>${ok ? esc(r.desc) : `after ${r.uses} uses (${uses})`}</small></button>`;
      }).join("");
      return `<div class="skill ${locked ? "locked" : ""}"><div class="sk-head"><b>${esc(d.name)}</b> <span class="dim">${SKILL_SLOT_NAME[slot]} · ${KEY_LABELS[slot]} · ${d.tags.filter((t) => t !== "projectile").join(" · ")}</span>${locked ? ` <span class="lock">unlocks at level ${d.unlock}</span>` : ""}</div><div class="dim small">${esc(d.desc)}</div><div class="runes">${runes}</div></div>`;
    }).join("");
    return `<div class="dim small">Runes unlock by using the skill. Tap a rune to select it, tap again to clear it. Runes can add tags (e.g. Searing Edge makes Cleave a fire skill), which changes which items and sets affect the skill.</div>${rows}`;
  }

  // ---------------------------------------------------------------- settings
  private settingsTab(p: Profile) {
    const filters: [Rarity, string][] = [["common", "Show everything"], ["magic", "Hide commons"], ["rare", "Hide common + magic"], ["legendary", "Only legendary, set, mythic"]];
    return `
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

  showBoons(offer: string[], onPick: (id: string) => void) {
    this.root.className = "screen";
    this.root.innerHTML = `<div class="panel boons"><h2>Choose a boon</h2><div class="dim small">Lasts until the end of this rift.</div>
      <div class="boon-list">${offer.map((id) => `<button class="boon" data-boon="${id}"><b>${esc(BOON[id].name)}</b><span>${esc(BOON[id].desc)}</span></button>`).join("")}</div></div>`;
    this.root.querySelectorAll<HTMLElement>("[data-boon]").forEach((el) => el.onclick = () => onPick(el.dataset.boon!));
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
