// Draws a hero or pet with its cosmetics: palette skin, armour overlay, cape, wings, weapon shape and aura.
// Shared by the game renderer and the Looks tab preview. Visual only.
import { COSMETICS, CosChoice } from "../sim/data";
import type { Sprite, SpriteBank } from "./sprites";

export type Emit = (x: number, y: number, vx: number, vy: number, life: number, color: string) => void;
export interface HeroView { pid: number; cls: string; cos: CosChoice; fx: number; fy: number; moving: boolean; walk: number; swingK: number }

const cosOf = (kind: "armor" | "wings" | "weapon" | "petSkin", id: string | undefined) => COSMETICS[kind].find((c) => c.id === id) as Record<string, any> | undefined;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickC = (c: string[]) => c[Math.floor(Math.random() * c.length)];

export function blit(g: CanvasRenderingContext2D, sp: Sprite, x: number, y: number, flip: boolean, white = false) {
  const img = white ? sp.flash : sp.img;
  const dx = Math.round(x - sp.w / 2), dy = Math.round(y - sp.h + 2);
  if (flip) { g.save(); g.translate(dx + sp.w, dy); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore(); }
  else g.drawImage(img, dx, dy);
}
function px(g: CanvasRenderingContext2D, x: number, y: number, col: string) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), 1, 1); }
function line(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, col: string, w = 1) {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.lineWidth = 1;
}

function aura(kind: string, cols: string[], x: number, y: number, emit: Emit) {
  if (Math.random() > 0.18) return;
  const c = pickC(cols);
  switch (kind) {
    case "wisp": emit(x + rnd(-5, 5), y - rnd(2, 12), 0, -12, 0.8, c); break;
    case "sparkle": emit(x + rnd(-7, 7), y - rnd(0, 16), 0, 0, 0.35, c); break;
    case "snow": emit(x + rnd(-8, 8), y - 18, rnd(-3, 3), 10, 1, c); break;
    case "ember": emit(x + rnd(-5, 5), y - rnd(2, 10), rnd(-4, 4), -26, 0.5, c); break;
    case "leaf": emit(x + rnd(-6, 6), y - rnd(6, 10), rnd(-6, 6), 8, 1.2, c); break;
    case "soul": emit(x + (Math.random() < 0.5 ? -5 : 5) + rnd(-1, 1), y - 7, 0, -15, 0.6, c); break;
    case "smoke": emit(x + rnd(-3, 3), y - rnd(0, 4), rnd(-3, 3), -6, 0.7, c); break;
  }
}

function drawSword(g: CanvasRenderingContext2D, w: Record<string, any> | undefined, hx: number, hy: number, ang: number, emit?: Emit) {
  const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
  const tip = (l: number) => [hx + dx * l, hy + dy * l] as const;
  switch (w?.style) {
    case "flame": {
      const [tx, ty] = tip(11);
      line(g, hx, hy, tx, ty, w.blade, 2); line(g, hx, hy, tx, ty, w.glow[0], 1);
      if (emit && Math.random() < 0.5) { const k = rnd(3, 11); emit(hx + dx * k, hy + dy * k, rnd(-4, 4), -22, 0.35, pickC(w.glow)); }
      break;
    }
    case "crystal": {
      const [tx, ty] = tip(14);
      line(g, hx, hy, tx, ty, w.blade, 1); line(g, hx + nx, hy + ny, hx + dx * 10 + nx, hy + dy * 10 + ny, w.gem, 1);
      px(g, tx, ty, "#ffffff"); px(g, tx + nx, ty + ny, w.gem); px(g, tx - nx, ty - ny, w.gem); px(g, tx + dx, ty + dy, "#ffffff");
      if (emit && Math.random() < 0.12) emit(tx, ty, rnd(-5, 5), 12, 0.5, pickC(w.glow));
      break;
    }
    case "void": {
      const [tx, ty] = tip(11);
      line(g, hx, hy, tx, ty, w.wood, 2);
      line(g, tx, ty, tx + nx * 5 - dx * 2, ty + ny * 5 - dy * 2, w.blade, 2);
      px(g, tx + nx * 5 - dx * 3, ty + ny * 5 - dy * 3, w.gem);
      if (emit && Math.random() < 0.25) emit(tx + nx * 3, ty + ny * 3, 0, -10, 0.6, pickC(w.glow));
      break;
    }
    case "royal": {
      const [tx, ty] = tip(11);
      line(g, hx, hy, tx, ty, w.blade, 3);
      line(g, hx + dx * 2 + nx * 3, hy + dy * 2 + ny * 3, hx + dx * 2 - nx * 3, hy + dy * 2 - ny * 3, w.wood, 1);
      px(g, hx + dx * 2, hy + dy * 2, w.gem);
      break;
    }
    case "bone": {
      const [tx, ty] = tip(10);
      line(g, hx, hy, tx, ty, w.blade, 2);
      g.fillStyle = w.blade; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 3, 3);
      px(g, tx, ty, w.wood);
      if (emit && Math.random() < 0.15) emit(tx, ty - 1, 0, -12, 0.4, w.gem);
      break;
    }
    default: {
      const [tx, ty] = tip(11);
      line(g, hx, hy, tx, ty, "#cfd6e6", 2);
      g.fillStyle = "#ff8a1f"; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 2, 2);
    }
  }
}

function drawBow(g: CanvasRenderingContext2D, w: Record<string, any> | undefined, x: number, y: number, fx: number, fy: number, t: number, emit?: Emit) {
  const ang = Math.atan2(fy, fx), cx = x + fx * 4, cy = y - 7 + fy * 2;
  const end = (s: number) => [cx + Math.cos(ang + s * 1.1) * 6, cy + Math.sin(ang + s * 1.1) * 6] as const;
  g.strokeStyle = w?.style === "royal" ? w.blade : w?.style ? w.blade : "#8a5a2a"; g.lineWidth = w?.style === "royal" ? 2 : 1;
  g.beginPath(); g.arc(cx, cy, 6, ang - 1.1, ang + 1.1); g.stroke(); g.lineWidth = 1;
  const [ax, ay] = end(-1), [bx, by] = end(1);
  switch (w?.style) {
    case "flame": if (emit && Math.random() < 0.4) { const [ex, ey] = Math.random() < 0.5 ? [ax, ay] : [bx, by]; emit(ex, ey, rnd(-3, 3), -22, 0.35, pickC(w.glow)); } break;
    case "crystal": for (const [ex, ey] of [[ax, ay], [bx, by]]) { px(g, ex, ey - 1, "#ffffff"); px(g, ex - 1, ey, w.gem); px(g, ex + 1, ey, w.gem); px(g, ex, ey + 1, w.gem); } break;
    case "void": { const a = t * 6; px(g, cx + Math.cos(a) * 8, cy + Math.sin(a) * 4, w.gem); px(g, cx + Math.cos(a + Math.PI) * 8, cy + Math.sin(a + Math.PI) * 4, w.blade); break; }
    case "royal": px(g, cx + Math.cos(ang) * 6, cy + Math.sin(ang) * 6, w.gem); break;
    case "bone": for (const [ex, ey] of [[ax, ay], [bx, by]]) { px(g, ex + (ex - cx) * 0.3, ey + (ey - cy) * 0.3, w.blade); } break;
  }
}

function drawWrench(g: CanvasRenderingContext2D, w: Record<string, any> | undefined, x: number, y: number, flip: boolean, t: number, emit?: Emit) {
  const d = flip ? -1 : 1, hx = x + d * 6, hy = y - 4;
  const shaft = w?.blade ?? "#c9bf9f", head = w?.gem ?? "#f2ead3";
  for (let i = 0; i < 6; i++) px(g, hx + d * Math.floor(i / 2), hy - i, shaft);
  const tx = hx + d * 3, ty = hy - 7;
  px(g, tx - 1, ty, head); px(g, tx + 1, ty, head); px(g, tx - 1, ty - 1, head); px(g, tx + 1, ty - 1, head); px(g, tx, ty + 1, head);
  if (w?.style === "flame" && emit && Math.random() < 0.3) emit(tx, ty - 1, rnd(-3, 3), -20, 0.35, pickC(w.glow));
  if (w?.style === "crystal" || w?.style === "void") px(g, tx, ty - 1, w.gem);
  void t;
}

function drawStaffTop(g: CanvasRenderingContext2D, w: Record<string, any> | undefined, x: number, y: number, flip: boolean, t: number, emit?: Emit) {
  if (!w?.style) return;
  const tx = x + (flip ? -5 : 4), ty = y - 14;
  switch (w.style) {
    case "flame": {
      const f = Math.floor(t * 8) % 2;
      px(g, tx, ty - 1, "#ffd23f"); px(g, tx, ty - 2, "#ff8a1f"); px(g, tx + (f ? -1 : 1), ty - 2, "#ff5a1f"); if (f) px(g, tx, ty - 3, "#ffd23f");
      if (emit && Math.random() < 0.3) emit(tx, ty - 3, rnd(-3, 3), -20, 0.4, pickC(w.glow));
      break;
    }
    case "crystal": px(g, tx, ty - 1, w.blade); px(g, tx, ty - 2, w.blade); px(g, tx - 1, ty - 1, w.gem); px(g, tx + 1, ty - 1, w.gem); px(g, tx, ty - 3, "#ffffff"); break;
    case "void": {
      g.fillStyle = "#2a1a4a"; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 3, 3, 3); px(g, tx, ty - 2, w.gem);
      const a = t * 6; px(g, tx + Math.cos(a) * 3, ty - 2 + Math.sin(a) * 2, w.blade);
      if (emit && Math.random() < 0.2) emit(tx, ty - 2, rnd(-3, 3), -8, 0.6, pickC(w.glow));
      break;
    }
    case "royal": for (const [ox, oy, c] of [[-1, -1, "#ffd23f"], [0, -1, "#ffd23f"], [1, -1, "#ffd23f"], [-1, -2, "#ffd23f"], [1, -2, "#ffd23f"], [0, -2, w.gem]] as const) px(g, tx + ox, ty + oy, c); break;
    case "bone": {
      g.fillStyle = w.blade; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 3, 3, 3);
      px(g, tx - 1, ty - 2, "#140c1c"); px(g, tx + 1, ty - 2, "#140c1c");
      if (emit && Math.random() < 0.15) emit(tx, ty - 3, 0, -12, 0.4, w.gem);
      break;
    }
  }
}

/** The whole hero: wings, cape, weapon, body, armour overlay, halo and aura, layered by facing. */
export function drawHeroCos(g: CanvasRenderingContext2D, bank: SpriteBank, h: HeroView, x: number, y: number, t: number, emit?: Emit) {
  const cos = h.cos ?? {};
  const frames = bank.heroSkin(h.cls, cos.armor, cos.weapon);
  const fr = h.moving ? 1 + (Math.floor(h.walk / 7) % 2) : 0;
  const flip = h.fx < 0, back = h.fy > -0.6;
  const a = cosOf("armor", cos.armor), wc = cosOf("weapon", cos.weapon), wg = cosOf("wings", cos.wings);
  const wings = bank.wings(cos.wings), cape = bank.cape(cos.armor), over = bank.overlay(cos.armor);
  const drawWings = () => {
    if (!wings) return;
    const fl = Math.floor(t * (h.moving ? 9 : 3) + h.pid) % 2;
    const spread = wg?.shape === "shards" ? Math.round(Math.sin(t * 2.5)) : 0;
    const bob = h.moving ? 0 : Math.round(Math.sin(t * 2));
    if (spread) { blit(g, wings[fl], x - spread, y - 5 + bob, flip); } else blit(g, wings[fl], x, y - 5 + bob, flip);
    if (emit && wg?.glow && Math.random() < 0.25) {
      const side = Math.random() < 0.5 ? -1 : 1, wx = x + side * rnd(4, 11), wy = y - rnd(6, 14);
      if (wg.shape === "flame") emit(wx, wy, rnd(-3, 3), -24, 0.45, pickC(wg.glow));
      else if (wg.shape === "crystal") emit(wx, wy, rnd(-3, 3), 10, 0.8, pickC(wg.glow));
      else emit(wx, wy, 0, -6, 0.7, pickC(wg.glow));
    }
  };
  if (back) { drawWings(); if (cape) blit(g, cape, x, y, flip); }
  if (h.cls === "ashknight") {
    const ang = Math.atan2(h.fy, h.fx) + (h.swingK > 0.5 ? (h.swingK - 0.5) * 3 : -0.6);
    const hx = x + (flip ? -3 : 3), hy = y - 6;
    if (h.fy < 0) drawSword(g, wc, hx, hy, ang, emit);
    blit(g, frames[fr], x, y, flip);
    if (over) blit(g, over, x, y - 6, flip);
    if (h.fy >= 0) drawSword(g, wc, hx, hy, ang, emit);
  } else {
    blit(g, frames[fr], x, y, flip);
    if (over) blit(g, over, x, y - 6, flip);
    if (h.cls === "gloomstalker") drawBow(g, wc, x, y, h.fx, h.fy, t, emit);
    else if (h.cls === "bonewright") drawWrench(g, wc, x, y, flip, t, emit);
    else drawStaffTop(g, wc, x, y, flip, t, emit);
  }
  if (!back) { if (cape) blit(g, cape, x, y, flip); drawWings(); }
  if (wg?.halo) { g.strokeStyle = wg.halo; g.beginPath(); g.ellipse(Math.round(x) + 0.5, Math.round(y) - 18.5 + Math.sin(t * 2), 3.5, 1.2, 0, 0, Math.PI * 2); g.stroke(); }
  if (emit && a?.aura) aura(a.aura, a.auraColor, x, y, emit);
  return frames[fr];
}

/** A pet in its skin, with its extra (crown, horns, ice spikes) and trail effect. */
export function drawPetCos(g: CanvasRenderingContext2D, bank: SpriteBank, pet: string, skin: string | undefined, x: number, y: number, flip: boolean, t: number, emit?: Emit) {
  const fr = bank.pet(pet, skin); if (!fr) return;
  const sk = cosOf("petSkin", skin);
  let yy = y - (pet === "bat" ? 8 + Math.sin(t * 5) * 2 : 0);
  if (sk?.ghost) yy -= 3 + Math.sin(t * 3) * 1.5;
  if (sk?.ghost) g.globalAlpha = 0.55 + 0.15 * Math.sin(t * 3);
  const sp = fr[Math.floor(t * 6) % 2];
  blit(g, sp, x, yy, flip);
  g.globalAlpha = 1;
  const top = Math.round(yy - sp.h + 2), cx = Math.round(x);
  switch (sk?.extra) {
    case "crown": for (const [ox, oy, c] of [[-1, -1, "#ffd23f"], [0, -1, "#ffd23f"], [1, -1, "#ffd23f"], [-1, -2, "#ffd23f"], [1, -2, "#ffd23f"], [0, -2, "#ff3b6b"]] as const) px(g, cx + ox, top + oy, c); break;
    case "icecrown": for (const [ox, oy] of [[-2, -1], [0, -2], [0, -1], [2, -1]]) px(g, cx + ox, top + oy, oy === -2 ? "#ffffff" : "#9be0ff"); break;
    case "horns": for (const [ox, oy] of [[-3, 0], [-3, -1], [2, 0], [2, -1]]) px(g, cx + ox, top + oy, "#3a0a14"); px(g, cx - 4, top - 2, "#3a0a14"); px(g, cx + 3, top - 2, "#3a0a14"); break;
  }
  if (emit && sk?.fx) aura(sk.fx === "smoke" ? "smoke" : sk.fx, sk.fxColor, x, yy + 6, emit);
}
