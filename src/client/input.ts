// Desktop: WASD/arrows + mouse (LMB Cleave, RMB Ember Lance, Space Ash Dash, Q Cinderlings).
// Touch: floating left stick, auto-aim, tap/hold buttons on the right.
import type { SimState, PlayerInput } from "../sim/sim";

export interface TouchButton { id: "primary" | "secondary" | "dash" | "ult"; x: number; y: number; r: number; label: string }

export class Input {
  keys = new Set<string>();
  mouseX = 0; mouseY = 0; mouseL = false; mouseR = false;
  touchMode = false;
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  held = new Map<number, TouchButton["id"]>();
  buttons: TouchButton[] = [];
  onKey: ((k: string) => void) | null = null;
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "tab"].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.onKey?.(k);
      this.keys.add(k);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => { this.keys.clear(); this.mouseL = this.mouseR = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    addEventListener("pointerup", (e) => this.up(e));
    addEventListener("pointercancel", (e) => this.up(e));
  }

  layout(w: number, h: number) {
    const s = Math.min(1.2, Math.max(0.8, Math.min(w, h) / 420));
    this.buttons = [
      { id: "primary", x: w - 78 * s, y: h - 82 * s, r: 40 * s, label: "Cleave" },
      { id: "secondary", x: w - 170 * s, y: h - 56 * s, r: 29 * s, label: "Lance" },
      { id: "dash", x: w - 158 * s, y: h - 142 * s, r: 29 * s, label: "Dash" },
      { id: "ult", x: w - 74 * s, y: h - 178 * s, r: 29 * s, label: "Imps" },
    ];
  }

  private down(e: PointerEvent) {
    if (e.pointerType === "touch") {
      this.touchMode = true;
      e.preventDefault();
      for (const b of this.buttons) if (Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.25) { this.held.set(e.pointerId, b.id); return; }
      if (e.clientX < innerWidth * 0.5 && !this.stick) this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      return;
    }
    this.touchMode = false;
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    if (e.button === 0) this.mouseL = true;
    if (e.button === 2) this.mouseR = true;
  }
  private move(e: PointerEvent) {
    if (e.pointerType === "touch") {
      if (this.stick && this.stick.id === e.pointerId) { this.stick.x = e.clientX; this.stick.y = e.clientY; }
      return;
    }
    this.mouseX = e.clientX; this.mouseY = e.clientY;
  }
  private up(e: PointerEvent) {
    if (e.pointerType === "touch") {
      if (this.stick?.id === e.pointerId) this.stick = null;
      this.held.delete(e.pointerId);
      return;
    }
    if (e.button === 0) this.mouseL = false;
    if (e.button === 2) this.mouseR = false;
  }

  isHeld(id: TouchButton["id"]) { for (const v of this.held.values()) if (v === id) return true; return false; }

  /** toWorld maps CSS pixels to world coordinates using the current camera. */
  read(s: SimState, toWorld: (x: number, y: number) => [number, number]): PlayerInput {
    const p = s.player;
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has("w") || k.has("arrowup")) my -= 1;
    if (k.has("s") || k.has("arrowdown")) my += 1;
    if (k.has("a") || k.has("arrowleft")) mx -= 1;
    if (k.has("d") || k.has("arrowright")) mx += 1;
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy, d = Math.hypot(dx, dy);
      const max = 50;
      if (d > 6) { const m = Math.min(1, d / max); mx = (dx / d) * m; my = (dy / d) * m; }
    }
    if (!this.enabled) return { mx: 0, my: 0, ax: p.x + p.fx, ay: p.y + p.fy, primary: false, secondary: false, dash: false, ult: false };
    let ax: number, ay: number;
    if (this.touchMode) {
      // auto-aim: nearest live enemy in range, else movement direction, else current facing
      let best = 170, tx = 0, ty = 0, found = false;
      for (const e of s.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < best) { best = d; tx = e.x; ty = e.y; found = true; }
      }
      if (found) { ax = tx; ay = ty; }
      else if (mx || my) { ax = p.x + mx * 20; ay = p.y + my * 20; }
      else { ax = p.x + p.fx * 20; ay = p.y + p.fy * 20; }
    } else {
      [ax, ay] = toWorld(this.mouseX, this.mouseY);
    }
    return {
      mx, my, ax, ay,
      primary: this.mouseL || this.isHeld("primary"),
      secondary: this.mouseR || k.has("e") || k.has("2") || this.isHeld("secondary"),
      dash: k.has(" ") || k.has("shift") || k.has("3") || this.isHeld("dash"),
      ult: k.has("q") || k.has("4") || this.isHeld("ult"),
    };
  }
}
