// Builds dist/index.html as ONE self-contained file (JS inlined). --live builds with OFFLINE_TEST=false.
import { build } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
const live = process.argv.includes("--live");
const res = await build({
  entryPoints: ["src/client/main.ts"], bundle: true, minify: true, format: "iife", target: "es2020", write: false,
  define: { OFFLINE_TEST: live ? "false" : "true" },
});
const js = res.outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const html = readFileSync("index.html", "utf8").replace("<script>/*GAME*/</script>", () => `<script>${js}</script>`);
mkdirSync("dist", { recursive: true });
const out = live ? "dist/index.live.html" : "dist/index.html";
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024).toFixed(0)} KB  OFFLINE_TEST=${!live}`);

// Artifact variant: the claude.ai host supplies the document skeleton, so strip ours.
if (!live) {
  const art = html
    .replace(/<!doctype html>\s*/i, "").replace(/<html[^>]*>\s*/i, "").replace(/<\/html>\s*/i, "")
    .replace(/<head>\s*/i, "").replace(/<\/head>\s*/i, "").replace(/<body>\s*/i, "").replace(/<\/body>\s*/i, "")
    .replace(/<meta charset[^>]*>\s*/i, "").replace(/<meta name="viewport"[^>]*>\s*/i, "")
    .replace(":root {", ":root { color-scheme:dark;");
  writeFileSync("dist/artifact.html", art);
  console.log("dist/artifact.html");
}
