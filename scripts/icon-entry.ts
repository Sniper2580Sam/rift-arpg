// Draws the app icon from the game's own code-drawn hero sprite (used by scripts/site.mjs).
import { buildSprites } from "../src/client/sprites";
(window as any).drawIcon = (size: number) => {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0b0710"; g.fillRect(0, 0, size, size);
  const grd = g.createRadialGradient(size / 2, size * 0.62, size * 0.05, size / 2, size * 0.62, size * 0.5);
  grd.addColorStop(0, "rgba(255,138,31,0.55)"); grd.addColorStop(1, "rgba(255,138,31,0)");
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const s = buildSprites().hero[0];
  const k = Math.floor((size * 0.62) / Math.max(s.w, s.h));
  g.imageSmoothingEnabled = false;
  g.drawImage(s.img, Math.round((size - s.w * k) / 2), Math.round((size - s.h * k) / 2), s.w * k, s.h * k);
  return c.toDataURL("image/png");
};
