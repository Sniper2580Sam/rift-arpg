// Desktop: WASD/arrows + mouse. LMB slot 1, RMB/E slot 2, Space/Shift/Q/1 slot 3, R/F/2 slot 4.
// Touch: floating left stick, auto-aim, four tap/hold buttons on the right.
import type { SimState, PlayerInput, Player } from "../sim/sim";

export interface TouchButton { slot: number; x: number; y: number; r: number }
export const KEY_LABELS = ["LMB", "RMB", "SPC", "R"];

export class Input {
  keys = new Set<string>();
  mouseX = 0; mouseY = 0; mouseL = false; mouseR = false;
  touchMode = false;
  stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  held = new Map<number, number>(); // pointerId -> slot
  buttons: TouchButton[] = [];
  onKey: ((k: string) => void) | null = null;
  enabled = true;
  insets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    addEventListener("keydown", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright", "tab"].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.onKey?.(k);
      this.keys.add(k);
    });
    addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener("blur", () => { this.keys.clear(); this.mouseL = this.mouseR = false; this.held.clear(); this.stick = null; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    addEventListener("pointerup", (e) => this.up(e));
    addEventListener("pointercancel", (e) => this.up(e));
    // iOS: stop double-tap zoom and long-press callouts on the play field
    canvas.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });
    canvas.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  layout(w: number, h: number) {
    const s = Math.min(1.15, Math.max(0.78, Math.min(w, h) / 430));
    const R = w - this.insets.right - 14, B = h - this.insets.bottom - 14;
    const big = 44 * s, sm = 32 * s;
    const cx = R - big, cy = B - big, ring = big + sm + 22 * s;
    this.buttons = [{ slot: 0, x: cx, y: cy, r: big }];
    // three buttons on an arc: left, diagonal, up
    [180, 225, 270].forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      this.buttons.push({ slot: i + 1, x: cx + Math.cos(a) * ring, y: cy + Math.sin(a) * ring, r: sm });
    });
  }

  private down(e: PointerEvent) {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      this.touchMode = true;
      for (const b of this.buttons) if (Math.hypot(e.clientX - b.x, e.clientY - b.y) < b.r * 1.3) { this.held.set(e.pointerId, b.slot); return; }
      if (e.clientX < innerWidth * 0.55 && !this.stick) this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      return;
    }
    this.touchMode = false;
    this.mouseX = e.clientX; this.mouseY = e.clientY;
    if (e.button === 0) this.mouseL = true;
    if (e.button === 2) this.mouseR = true;
  }
  private move(e: PointerEvent) {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      if (this.stick && this.stick.id === e.pointerId) { this.stick.x = e.clientX; this.stick.y = e.clientY; }
      return;
    }
    this.mouseX = e.clientX; this.mouseY = e.clientY;
  }
  private up(e: PointerEvent) {
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      if (this.stick?.id === e.pointerId) this.stick = null;
      this.held.delete(e.pointerId);
      return;
    }
    if (e.button === 0) this.mouseL = false;
    if (e.button === 2) this.mouseR = false;
  }

  isHeld(slot: number) { for (const v of this.held.values()) if (v === slot) return true; return false; }

  read(s: SimState, me: Player, toWorld: (x: number, y: number) => [number, number]): PlayerInput {
    const p = me;
    let mx = 0, my = 0;
    const k = this.keys;
    if (k.has("w") || k.has("arrowup")) my -= 1;
    if (k.has("s") || k.has("arrowdown")) my += 1;
    if (k.has("a") || k.has("arrowleft")) mx -= 1;
    if (k.has("d") || k.has("arrowright")) mx += 1;
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox, dy = this.stick.y - this.stick.oy, d = Math.hypot(dx, dy);
      if (d > 6) { const m = Math.min(1, d / 50); mx = (dx / d) * m; my = (dy / d) * m; }
    }
    if (!this.enabled) return { mx: 0, my: 0, ax: p.x + p.fx, ay: p.y + p.fy, act: 0 };
    let ax: number, ay: number;
    if (this.touchMode) {
      let best = 190, tx = 0, ty = 0, found = false;
      for (const e of s.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y) - (e.kind === "guardian" || e.kind === "king" || e.elite ? 40 : 0);
        if (d < best) { best = d; tx = e.x; ty = e.y; found = true; }
      }
      if (found) { ax = tx; ay = ty; }
      else if (mx || my) { ax = p.x + mx * 40; ay = p.y + my * 40; }
      else { ax = p.x + p.fx * 40; ay = p.y + p.fy * 40; }
    } else {
      [ax, ay] = toWorld(this.mouseX, this.mouseY);
    }
    let act = 0;
    if (this.mouseL || this.isHeld(0)) act |= 1;
    if (this.mouseR || k.has("e") || this.isHeld(1)) act |= 2;
    if (k.has(" ") || k.has("shift") || k.has("q") || k.has("1") || this.isHeld(2)) act |= 4;
    if (k.has("r") || k.has("f") || k.has("2") || this.isHeld(3)) act |= 8;
    return { mx, my, ax, ay, act };
  }
}
