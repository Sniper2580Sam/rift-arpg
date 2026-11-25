import * as auth from "../functions/api/auth";
import * as me from "../functions/api/me";
import * as save from "../functions/api/save";
import * as claim from "../functions/api/claim";
import google from "../data/google.json";
const store = new Map<string, { body: string; etag: string }>(); let n = 0;
const SAVES = {
  async get(k: string) { const o = store.get(k); return o ? { etag: o.etag, json: async () => JSON.parse(o.body) } : null; },
  async put(k: string, body: string, opt?: any) { const cur = store.get(k); if (opt?.onlyIf?.etagMatches && cur?.etag !== opt.onlyIf.etagMatches) return null; store.set(k, { body, etag: "e" + ++n }); return {}; },
};
const env = { SAVES, SESSION_KEY: "test-key-123" };
(globalThis as any).fetch = async (u: string) => ({ ok: u.includes("good"), json: async () => ({ aud: (google as any).clientId, sub: "1234" }) });
let cookie = "";
const req = (method: string, body?: unknown) => new Request("https://x/api", { method, headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
const out = async (r: Response) => ({ s: r.status, d: await r.json() });
let fails = 0; const check = (name: string, ok: boolean, x = "") => { console.log((ok ? "ok   " : "FAIL ") + name + " " + x); if (!ok) fails++; };
(async () => {
  check("me signed out", (await out(await me.onRequestGet({ env, request: req("GET") }))).d.signedIn === false);
  check("bad token refused", (await auth.onRequestPost({ env, request: req("POST", { access_token: "bad" }) })).status === 401);
  const a = await auth.onRequestPost({ env, request: req("POST", { access_token: "good" }) });
  cookie = (a.headers.get("set-cookie") ?? "").split(";")[0];
  check("sign in sets cookie", a.status === 200 && cookie.startsWith("rb="));
  check("me signed in", (await out(await me.onRequestGet({ env, request: req("GET") }))).d.signedIn === true);
  check("empty save", (await out(await save.onRequestGet({ env, request: req("GET") }))).d.rev === 0);
  check("A claims", (await claim.onRequestPost({ env, request: req("POST", { device: "A" }) })).status === 200);
  let w = await out(await save.onRequestPut({ env, request: req("PUT", { save: { lvl: 24 }, base: 0, device: "A" }) }));
  check("A saves rev 1", w.s === 200 && w.d.rev === 1);
  check("B refused while A plays", (await claim.onRequestPost({ env, request: req("POST", { device: "B" }) })).status === 423);
  check("B can't write", (await save.onRequestPut({ env, request: req("PUT", { save: { lvl: 1 }, base: 1, device: "B" }) })).status === 423);
  check("B takes over", (await claim.onRequestPost({ env, request: req("POST", { device: "B", force: true }) })).status === 200);
  check("A now refused", (await save.onRequestPut({ env, request: req("PUT", { save: { lvl: 25 }, base: 1, device: "A" }) })).status === 423);
  w = await out(await save.onRequestPut({ env, request: req("PUT", { save: { lvl: 24, b: 1 }, base: 1, device: "B" }) }));
  check("B saves rev 2", w.s === 200 && w.d.rev === 2);
  w = await out(await save.onRequestPut({ env, request: req("PUT", { save: { lvl: 3 }, base: 1, device: "B" }) }));
  check("stale base gets 409 with the newer save", w.s === 409 && w.d.rev === 2 && w.d.save.b === 1);
  const g = await out(await save.onRequestGet({ env, request: req("GET") }));
  check("read back", g.d.rev === 2 && g.d.save.lvl === 24 && g.d.lock.device === "B");
  cookie = "rb=forged.9999999999.x";
  check("forged cookie refused", (await save.onRequestGet({ env, request: req("GET") })).status === 401);
  console.log(fails ? fails + " failed" : "cloud save backend: all checks passed"); if (fails) process.exit(1);
})();
