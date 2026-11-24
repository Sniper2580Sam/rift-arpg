// Shop preview of a premium skill effect: a short looping sketch of the skill's shape in the style's colours,
// drawn next to the hero in the small preview canvas (64x40 pixels).
import type { VfxStyle } from "../sim/data";

type Part = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string };
const parts: Part[] = [];
let lastT = 0;

const px = (g: CanvasRenderingContext2D, x: number, y: number, c: string, s = 1) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), s, s); };
function spray(x: number, y: number, n: number, sp: number, cols: string[]) {
  for (let i = 0; i < n && parts.length < 160; i++) { const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4, max: 0.4, color: cols[i % cols.length] }); }
}

/** kind: the skill's kind from skills.json. hx, hy: where the hero stands. t: seconds. */
export function drawFxPreview(g: CanvasRenderingContext2D, kind: string, st: VfxStyle, hx: number, hy: number, t: number) {
  const dt = Math.max(0, Math.min(0.05, t - lastT)); lastT = t;
  const cols = [st.main, st.accent, st.core];
  const cyc = 1.4, k = (t % cyc) / cyc, fire = (t % cyc) < dt + 0.001;
  const tx = 56, ty = hy - 4; // the target dummy
  // dummy
  g.fillStyle = "#5a4656"; g.fillRect(tx - 2, ty - 6, 4, 8); g.fillStyle = "#8a7f66"; g.fillRect(tx - 3, ty - 8, 6, 3);
  g.globalAlpha = 1;
  switch (kind) {
    case "projectile": {
      const x = hx + 6 + (tx - hx - 6) * Math.min(1, k * 1.6), y = hy - 5;
      if (k < 0.62) { px(g, x - 1, y - 1, st.main, 3); px(g, x, y, st.core); for (let i = 1; i < 6; i++) { g.globalAlpha = 1 - i / 6; px(g, x - i * 2, y, i % 2 ? st.accent : st.main); } g.globalAlpha = 1; if (Math.random() < 0.6) parts.push({ x, y, vx: -10, vy: (Math.random() - 0.5) * 10, life: 0.25, max: 0.25, color: st.accent }); }
      else if (k < 0.66) spray(tx, ty - 2, 14, 40, cols);
      break;
    }
    case "melee": {
      if (k < 0.35) {
        const a0 = -Math.PI / 2 + (k / 0.35) * Math.PI;
        for (let i = 0; i < 8; i++) { const a = a0 - i * 0.12, r = 11; g.globalAlpha = 1 - i / 8; px(g, hx + 3 + Math.cos(a) * r, hy - 5 + Math.sin(a) * r, i < 2 ? st.core : i < 5 ? st.main : st.accent, 2); }
        g.globalAlpha = 1;
      }
      if (fire) spray(hx + 12, hy - 5, 8, 30, cols);
      break;
    }
    case "dash": {
      const x = hx + (tx - 8 - hx) * Math.min(1, k * 2);
      if (k < 0.5) for (let i = 0; i < 10; i++) { g.globalAlpha = 1 - i / 10; px(g, x - i * 2, hy - 6 + (i % 3), cols[i % 3], 2); }
      g.globalAlpha = 1;
      if (k > 0.5 && k < 0.54) spray(tx - 6, hy - 5, 12, 35, cols);
      break;
    }
    case "shout": case "nova": {
      const rr = 3 + k * 22;
      g.globalAlpha = Math.max(0, 1 - k); g.strokeStyle = st.main; g.lineWidth = 2;
      g.beginPath(); g.ellipse(hx, hy - 3, rr, rr * 0.6, 0, 0, Math.PI * 2); g.stroke();
      if (kind === "nova") { g.strokeStyle = st.accent; g.lineWidth = 1; g.beginPath(); g.ellipse(hx, hy - 3, rr * 0.7, rr * 0.42, 0, 0, Math.PI * 2); g.stroke(); for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; px(g, hx + Math.cos(a) * rr, hy - 3 + Math.sin(a) * rr * 0.6, st.core); } }
      g.lineWidth = 1; g.globalAlpha = 1;
      if (fire) spray(hx, hy - 6, 10, 25, cols);
      break;
    }
    case "trap": {
      const x = tx - 2, y = ty + 1;
      if (k < 0.6) { g.globalAlpha = 0.4 + 0.4 * Math.sin(t * 20); g.strokeStyle = st.main; g.beginPath(); g.ellipse(x, y, 9, 5, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1; px(g, x - 1, y - 1, st.core, 2); }
      else if (k < 0.64) spray(x, y - 2, 18, 45, cols);
      break;
    }
    default: { // summon, build: a glowing rune where it appears, with sparks rising
      const x = (hx + tx) / 2, y = hy;
      g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 6); g.strokeStyle = st.main; g.beginPath(); g.ellipse(x, y, 8, 4, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = st.accent; g.beginPath(); g.ellipse(x, y, 5, 2.5, 0, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      if (Math.random() < 0.5) parts.push({ x: x + (Math.random() - 0.5) * 12, y, vx: 0, vy: -18, life: 0.5, max: 0.5, color: cols[Math.floor(Math.random() * 3)] });
      if (fire) spray(x, y - 4, 10, 25, cols);
    }
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const q = parts[i]; q.life -= dt; if (q.life <= 0) { parts.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; g.globalAlpha = Math.min(1, (q.life / q.max) * 1.5); px(g, q.x, q.y, q.color);
  }
  g.globalAlpha = 1;
}
