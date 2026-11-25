// Cloud saves on Cloudflare Pages Functions: Google sign-in once, then a long-lived session cookie; one save per
// Google account in the SAVES R2 bucket, and a lock so only one device plays the save at a time.
import google from "../../data/google.json";

export interface Env { SAVES?: R2Bucket; SESSION_KEY?: string }
type R2Bucket = any;

const CLIENT_ID: string = (google as any).clientId ?? "";
export const LOCK_SECS = 90; // a device that hasn't been heard from for this long no longer holds the save
const YEAR = 365 * 24 * 3600;
const MAX_SAVE = 2_000_000;

export const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(key: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
/** The account id: a hash of the Google account id, so the bucket never holds the raw id. */
async function accountId(sub: string) { return b64u(await crypto.subtle.digest("SHA-256", enc.encode("riftbound:" + sub))).slice(0, 32); }

export async function sessionCookie(env: Env, sub: string) {
  const id = await accountId(sub), exp = Math.floor(Date.now() / 1000) + YEAR;
  const v = `${id}.${exp}.${await hmac(env.SESSION_KEY!, id + "." + exp)}`;
  return `rb=${v}; Max-Age=${YEAR}; Path=/api; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = "rb=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Lax";

/** The signed-in account for a request, or null. */
export async function account(env: Env, req: Request): Promise<string | null> {
  if (!env.SESSION_KEY) return null;
  const m = /(?:^|;\s*)rb=([^;]+)/.exec(req.headers.get("cookie") ?? "");
  if (!m) return null;
  const [id, exp, sig] = m[1].split(".");
  if (!id || !exp || !sig || Number(exp) * 1000 < Date.now()) return null;
  return (await hmac(env.SESSION_KEY, id + "." + exp)) === sig ? id : null;
}

/** Checks a Google access token belongs to this game and returns the Google account id. */
export async function googleSub(token: string): Promise<string | null> {
  const r = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
  if (!r.ok) return null;
  const d: any = await r.json();
  if ((d.aud !== CLIENT_ID && d.azp !== CLIENT_ID) || !d.sub) return null;
  return String(d.sub);
}

export interface Lock { device: string; at: number }
const saveKey = (id: string) => `save/${id}.json`, lockKey = (id: string) => `lock/${id}.json`;

export async function readLock(env: Env, id: string): Promise<Lock | null> {
  const o = await env.SAVES.get(lockKey(id));
  return o ? ((await o.json()) as Lock) : null;
}
const live = (l: Lock | null) => !!l && Date.now() - l.at < LOCK_SECS * 1000;
/** Take or refresh the lock. Refused while another device holds it, unless `force` (Take over). */
export async function claim(env: Env, id: string, device: string, force: boolean): Promise<{ ok: boolean; lock: Lock | null }> {
  const cur = await readLock(env, id);
  if (cur && cur.device !== device && live(cur) && !force) return { ok: false, lock: cur }; // a quiet device's lock is free to take
  const lock = { device, at: Date.now() };
  await env.SAVES.put(lockKey(id), JSON.stringify(lock));
  return { ok: true, lock };
}
/** A device may write while it holds the lock, or once the holder has gone quiet (the revision check still guards the save). */
export async function holds(env: Env, id: string, device: string) {
  const cur = await readLock(env, id);
  return !cur || cur.device === device || !live(cur);
}

export async function readSave(env: Env, id: string): Promise<{ save: unknown; rev: number; etag?: string }> {
  const o = await env.SAVES.get(saveKey(id));
  if (!o) return { save: null, rev: 0 };
  const d: any = await o.json();
  return { save: d.save ?? null, rev: d.rev ?? 0, etag: o.etag };
}
/** Write only if nobody wrote since `base` (the revision this device last saw). */
export async function writeSave(env: Env, id: string, save: unknown, base: number): Promise<{ ok: boolean; rev: number; save?: unknown }> {
  const cur = await readSave(env, id);
  if (cur.rev !== base) return { ok: false, rev: cur.rev, save: cur.save };
  const body = JSON.stringify({ save, rev: cur.rev + 1, at: Date.now() });
  if (body.length > MAX_SAVE) return { ok: false, rev: cur.rev };
  const put = await env.SAVES.put(saveKey(id), body, cur.etag ? { onlyIf: { etagMatches: cur.etag } } : undefined);
  if (!put) { const now = await readSave(env, id); return { ok: false, rev: now.rev, save: now.save }; }
  return { ok: true, rev: cur.rev + 1 };
}
export { MAX_SAVE };
