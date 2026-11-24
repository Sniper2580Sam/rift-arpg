// Where the server keeps accounts, sessions and profiles.
// - Local (default): JSON files in DATA_DIR, as before.
// - Cloud: an Upstash Redis database over its REST API, when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set.
//   Free hosts wipe their disk on every restart, so the hosted server must use this.
// The server keeps everything in memory and writes through; writes to the same key are coalesced.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

export interface KV {
  name: string;
  get(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string): Promise<void>;
}

export function fileKV(dir: string): KV {
  mkdirSync(join(dir, "profiles"), { recursive: true });
  // keep the old layout: accounts.json, sessions.json, profiles/<name>.json
  const path = (k: string) => (k.startsWith("profile:") ? join(dir, "profiles", encodeURIComponent(k.slice(8)) + ".json") : join(dir, k + ".json"));
  return {
    name: `files in ${dir}`,
    async get(keys) { return keys.map((k) => (existsSync(path(k)) ? readFileSync(path(k), "utf8") : null)); },
    async set(k, v) { const f = path(k), tmp = f + ".tmp"; writeFileSync(tmp, v); renameSync(tmp, f); },
  };
}
export const fileProfileNames = (dir: string) => { try { return readdirSync(join(dir, "profiles")).filter((f) => f.endsWith(".json")).map((f) => decodeURIComponent(f.slice(0, -5))); } catch { return []; } };

export function upstashKV(url: string, token: string): KV {
  const call = async (cmd: unknown[]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetch(url.replace(/\/$/, ""), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(cmd) });
        const j: any = await r.json();
        if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`);
        return j.result;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((res) => setTimeout(res, 300 * 2 ** attempt));
      }
    }
  };
  return {
    name: "Upstash Redis",
    async get(keys) { return keys.length ? ((await call(["MGET", ...keys.map((k) => "rift:" + k)])) as (string | null)[]) : []; },
    async set(k, v) { await call(["SET", "rift:" + k, v]); },
  };
}

/** Write-behind queue: the latest value per key is written; flush() waits for everything. */
export function writer(kv: KV) {
  const pending = new Map<string, string>();
  let running: Promise<void> | null = null;
  const pump = async () => {
    while (pending.size) {
      const [k, v] = pending.entries().next().value as [string, string];
      pending.delete(k);
      try { await kv.set(k, v); } catch (e) { console.error(`[store] write ${k} failed, retrying`, e); pending.set(k, pending.get(k) ?? v); await new Promise((r) => setTimeout(r, 2000)); }
    }
    running = null;
  };
  return {
    put(k: string, v: unknown) { pending.set(k, JSON.stringify(v)); if (!running) running = pump(); },
    async flush() { while (running) await running; },
  };
}
