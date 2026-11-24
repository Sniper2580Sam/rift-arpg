// DOM screens: hub, inventory (paperdoll + bag + compare), rift results. Kept out of the canvas for phone readability.
import { ITEMS, LEGENDARY, SKILLS, Slot } from "../sim/data";
import { BAG_SIZE, Holder, InvCmd, Item, affixText, computeStats, Stats } from "../sim/items";
import { RARITY_COLOR, SpriteBank } from "./sprites";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const SLOT_NAME: Record<Slot, string> = { weapon: "Weapon", helm: "Helm", chest: "Chest", gloves: "Gloves", boots: "Boots" };
const RARITY_NAME = { common: "Common", magic: "Magic", rare: "Rare", legendary: "Legendary" };

export function effectiveDps(s: Stats): number {
  const avg = (s.dmgMin + s.dmgMax) / 2;
  return (avg * (1 + s.dmgPct / 100) * (1 + (Math.min(100, s.critChance) / 100) * (s.critDmg / 100))) / 0.38;
}

function iconUrl(bank: SpriteBank, it: Item): string {
  const spr = bank.icon(it.slot, it.rarity);
  const c = document.createElement("canvas"); c.width = 40; c.height = 40;
  const g = c.getContext("2d")!; g.imageSmoothingEnabled = false; g.drawImage(spr.img, 0, 0, 40, 40);
  return c.toDataURL();
}
const iconCache = new Map<string, string>();
function icon(bank: SpriteBank, it: Item) {
  const k = it.slot + it.rarity;
  if (!iconCache.has(k)) iconCache.set(k, iconUrl(bank, it));
  return iconCache.get(k)!;
}

export function itemHtml(it: Item, compareTo?: Holder): string {
  const col = RARITY_COLOR[it.rarity];
  let h = `<div class="it-name" style="color:${col}">${esc(it.name)}</div>`;
  h += `<div class="it-type">${RARITY_NAME[it.rarity]} ${SLOT_NAME[it.slot]}</div>`;
  if (it.dmgMin !== undefined) h += `<div class="it-base">${it.dmgMin}–${it.dmgMax} Damage</div>`;
  if (it.armor) h += `<div class="it-base">${it.armor} Armor</div>`;
  for (const a of it.affixes) h += `<div class="it-affix">${esc(affixText(a))}</div>`;
  if (it.legendary) h += `<div class="it-power">${esc(LEGENDARY[it.legendary].text)}</div>`;
  if (compareTo) {
    const cur = computeStats(compareTo);
    const eq = { ...compareTo.equipment, [it.slot]: it };
    const nxt = computeStats({ equipment: eq });
    const parts: string[] = [];
    const dps = (effectiveDps(nxt) / effectiveDps(cur) - 1) * 100;
    const fmt = (v: number, label: string, unit = "") => {
      if (Math.abs(v) < 0.5) return;
      parts.push(`<span class="${v > 0 ? "up" : "down"}">${v > 0 ? "+" : "−"}${Math.abs(Math.round(v))}${unit} ${label}</span>`);
    };
    fmt(dps, "damage", "%");
    fmt(nxt.maxHp - cur.maxHp, "life");
    fmt(nxt.armor - cur.armor, "armor");
    const curLeg = compareTo.equipment[it.slot]?.legendary;
    if (curLeg && curLeg !== it.legendary) parts.push(`<span class="down">loses ${esc(LEGENDARY[curLeg].name)} power</span>`);
    if (compareTo.equipment[it.slot] !== it) h += `<div class="it-compare">${parts.length ? parts.join(" · ") : "<span>same stats</span>"}</div>`;
  }
  return h;
}

export class UI {
  root = $("#ui");
  selected: { where: "bag"; i: number } | { where: "eq"; slot: Slot } | null = null;
  invOpen = false;
  private toastT = 0;

  constructor(private bank: SpriteBank) {}

  hide() { this.root.innerHTML = ""; this.root.className = ""; this.invOpen = false; }

  showHub(p: { materials: number; riftsCleared: number; bestTime: number; bagCount: number; offline: boolean },
    onEnter: (seed: number | null) => void, onInv: () => void, onReset: () => void) {
    this.invOpen = false;
    this.root.className = "screen";
    const best = p.bestTime ? fmtTime(p.bestTime) : "—";
    this.root.innerHTML = `
      <div class="panel hub">
        <h1>RIFT ARPG</h1>
        <div class="sub">working title · Milestone 1 solo slice${p.offline ? " · OFFLINE_TEST build" : ""}</div>
        <div class="class-card">
          <div class="cls">The Ashknight</div>
          <div class="skills">${SKILLS.map((s) => `<div><b>${s.name}</b> <span class="tags">${s.tags.filter((t) => t !== "projectile" && t !== "physical").join(" · ")}</span><br><span class="dim">${esc(s.desc)}</span></div>`).join("")}</div>
        </div>
        <button id="enter" class="big">Enter the Sunken Ossuary</button>
        <div class="row">
          <button id="inv">Inventory (${p.bagCount}/${BAG_SIZE})</button>
          <input id="seed" placeholder="rift code (optional)" maxlength="8" autocomplete="off">
        </div>
        <div class="stats">Rifts cleared: ${p.riftsCleared} · Best time: ${best} · Materials: ${p.materials}</div>
        <div class="help">
          <b>Desktop:</b> WASD move · Left mouse Cleave · Right mouse / E Ember Lance · Space Ash Dash · Q Cinderlings · I inventory · M mute<br>
          <b>Touch:</b> left thumb moves · buttons on the right · aiming is automatic
        </div>
        <div class="help dim">Kill enemies to fill the bar, then defeat the Hollow Warden before the 5:00 timer runs out for bonus loot.</div>
        <button id="reset" class="tiny">reset save</button>
      </div>`;
    $("#enter").onclick = () => {
      const v = ($("#seed") as HTMLInputElement).value.trim().toUpperCase();
      const n = v ? parseInt(v, 36) : NaN;
      onEnter(Number.isFinite(n) ? n >>> 0 : null);
    };
    $("#inv").onclick = onInv;
    $("#reset").onclick = () => { if (($("#reset").textContent ?? "").startsWith("sure")) onReset(); else $("#reset").textContent = "sure? tap again"; };
  }

  showInventory(h: Holder, onCmd: (c: InvCmd) => void, onClose: () => void, title = "Inventory") {
    this.invOpen = true;
    this.root.className = "screen";
    const st = computeStats(h);
    const sel = this.selected;
    let selItem: Item | undefined;
    if (sel?.where === "bag") selItem = h.bag[sel.i];
    if (sel?.where === "eq") selItem = h.equipment[sel.slot];
    if (!selItem) this.selected = null;
    const slots = (ITEMS.slots as Slot[]).map((slot) => {
      const it = h.equipment[slot];
      const on = sel?.where === "eq" && sel.slot === slot;
      return `<div class="cell eq ${on ? "on" : ""} ${it ? "r-" + it.rarity : ""}" data-eq="${slot}">${it ? `<img src="${icon(this.bank, it)}">` : `<span>${SLOT_NAME[slot]}</span>`}</div>`;
    }).join("");
    let bag = "";
    for (let i = 0; i < BAG_SIZE; i++) {
      const it = h.bag[i];
      const on = sel?.where === "bag" && sel.i === i;
      const up = it && isUpgrade(h, it);
      bag += `<div class="cell ${on ? "on" : ""} ${it ? "r-" + it.rarity : "empty"}" data-bag="${it ? i : ""}">${it ? `<img src="${icon(this.bank, it)}">${up ? '<i class="up">▲</i>' : ""}` : ""}</div>`;
    }
    let detail = `<div class="dim">Tap an item to see it. ▲ marks upgrades.</div>`;
    if (selItem) {
      detail = itemHtml(selItem, sel!.where === "bag" ? h : undefined);
      detail += `<div class="row">`;
      if (sel!.where === "bag") detail += `<button id="equip">Equip</button><button id="scrap" class="warn">Scrap</button>`;
      else detail += `<button id="unequip">Unequip</button>`;
      detail += `</div>`;
    }
    const powers = Object.keys(st.powers).length;
    this.root.innerHTML = `
      <div class="panel inv">
        <div class="inv-head"><b>${esc(title)}</b><button id="close">Close</button></div>
        <div class="statline">Damage ${st.dmgMin}–${st.dmgMax} (+${st.dmgPct}%) · Crit ${st.critChance}% / +${st.critDmg}% · Life ${st.maxHp} · Armor ${st.armor}${st.cdr ? ` · CDR ${st.cdr}%` : ""}${powers ? ` · ${powers} legendary power${powers > 1 ? "s" : ""}` : ""} · Materials ${h.materials}</div>
        <div class="doll">${slots}</div>
        <div class="bag">${bag}</div>
        <div class="detail">${detail}</div>
      </div>`;
    const rerender = () => this.showInventory(h, onCmd, onClose, title);
    this.root.querySelectorAll<HTMLElement>("[data-eq]").forEach((el) => el.onclick = () => { this.selected = { where: "eq", slot: el.dataset.eq as Slot }; rerender(); });
    this.root.querySelectorAll<HTMLElement>("[data-bag]").forEach((el) => el.onclick = () => { if (el.dataset.bag !== "") { this.selected = { where: "bag", i: +el.dataset.bag! }; rerender(); } });
    $("#close").onclick = () => { this.selected = null; onClose(); };
    const eqb = this.root.querySelector<HTMLElement>("#equip");
    if (eqb) eqb.onclick = () => { const i = (this.selected as any).i; const slot = h.bag[i].slot; onCmd({ type: "equip", bagIndex: i }); this.selected = { where: "eq", slot }; rerender(); };
    const sc = this.root.querySelector<HTMLElement>("#scrap");
    if (sc) sc.onclick = () => { onCmd({ type: "scrap", bagIndex: (this.selected as any).i }); this.selected = null; rerender(); };
    const ue = this.root.querySelector<HTMLElement>("#unequip");
    if (ue) ue.onclick = () => { onCmd({ type: "unequip", slot: (this.selected as any).slot }); this.selected = null; rerender(); };
  }

  showResults(r: { inTime: boolean; time: number; kills: number; found: Record<string, number>; legendaries: string[] }, onBack: () => void) {
    this.root.className = "screen";
    const f = r.found;
    this.root.innerHTML = `
      <div class="panel results">
        <h2>${r.inTime ? "Rift cleared in time!" : "Guardian slain"}</h2>
        <div class="big-time">${fmtTime(r.time)}</div>
        <div>${r.inTime ? "Bonus loot awarded for time remaining." : "The timer ran out, so the guardian dropped less."}</div>
        <div class="stats">Kills ${r.kills} · Picked up: <span style="color:${RARITY_COLOR.legendary}">${f.legendary ?? 0} legendary</span>, <span style="color:${RARITY_COLOR.rare}">${f.rare ?? 0} rare</span>, <span style="color:${RARITY_COLOR.magic}">${f.magic ?? 0} magic</span>, ${f.common ?? 0} common</div>
        ${r.legendaries.length ? `<div class="legs">${r.legendaries.map((n) => `<div style="color:${RARITY_COLOR.legendary}">★ ${esc(n)}</div>`).join("")}</div>` : ""}
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

function isUpgrade(h: Holder, it: Item): boolean {
  const cur = h.equipment[it.slot];
  if (!cur) return true;
  if (it.legendary && !cur.legendary) return true;
  const a = computeStats(h), b = computeStats({ equipment: { ...h.equipment, [it.slot]: it } });
  return effectiveDps(b) > effectiveDps(a) * 1.01 || (effectiveDps(b) >= effectiveDps(a) * 0.99 && b.maxHp + b.armor > a.maxHp + a.armor);
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}
