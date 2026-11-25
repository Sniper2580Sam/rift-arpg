// Builds docs/ for GitHub Pages: the offline test build as an installable Home Screen app
// (manifest + service worker that caches the single page for offline play).
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
mkdirSync("docs", { recursive: true });
const VERSION = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 12);

// icons, drawn by the game's sprite code in a headless browser
const icon = await build({ entryPoints: ["scripts/icon-entry.ts"], bundle: true, format: "iife", write: false });
const { chromium } = require("playwright");
const b = await chromium.launch(); const pg = await b.newPage();
await pg.setContent(`<script>${icon.outputFiles[0].text}</script>`);
for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const url = await pg.evaluate((n) => window.drawIcon(n), size);
  writeFileSync("docs/" + name, Buffer.from(url.split(",")[1], "base64"));
}
await b.close();

writeFileSync("docs/manifest.webmanifest", JSON.stringify({
  name: "Riftbound", short_name: "Riftbound", start_url: "./", scope: "./", display: "fullscreen", orientation: "any",
  background_color: "#0b0710", theme_color: "#0b0710",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }],
}, null, 1));

writeFileSync("docs/sw.js", `// Offline cache: serve from cache at once, refresh it in the background when online.
const CACHE = "rift-${VERSION}";
const FILES = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
`);

const head = `<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Riftbound">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<script>if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));</script>
`;
const html = readFileSync("dist/index.html", "utf8").replace("<title>", head + "<title>");
writeFileSync("docs/index.html", html);
writeFileSync("docs/.nojekyll", "");
writeFileSync("docs/privacy.html", readFileSync("scripts/privacy.html", "utf8"));
console.log("docs/ built", VERSION);
