// Phone app (GitHub Pages) only: Google sign-in keeps the save in a hidden app folder in the
// player's own Google Drive (scope drive.appdata), so the same save follows them between devices.
// Device storage stays the first copy; Drive is a mirror. "Base" is the save both last agreed on:
// if only one side moved past it, that side wins quietly; if both did, the player picks which to keep.
import google from "../../data/google.json";
import { CLASSES } from "../sim/data";
import { Profile, isFresh, migrate } from "./profile";

const CLIENT_ID: string = (google as any).clientId ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE = "rift-arpg-save.json";
const FLAG = "rift-gdrive";
const BASE = "rift-gdrive-base";
const API = "https://www.googleapis.com";

let token = "", expires = 0, fileId = "", busy = false, dirty: Profile | null = null, timer = 0;
let state: "off" | "connecting" | "on" | "error" | "conflict" = "off", lastSync = 0, lastErr = "";
let local: () => Profile = () => ({} as Profile);
let useRemote: (p: Profile) => void = () => {};
let onChange: () => void = () => {};
let canApply: () => boolean = () => true;
let knownVer = ""; // Drive's version of the file the last time this device read or wrote it
const driveVer = async () => fileId ? String((await (await api(`/drive/v3/files/${fileId}?fields=version`)).json()).version ?? "") : "";
let client: any = null;

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };

/** Sync is offered on the hosted https page with a client id, never in the claude.ai artifact (it has its own cloud copy). */
export function driveAvailable() {
  return !!CLIENT_ID && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") && !(window as any).claude;
}
export function driveStatus() {
  const t = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const text = state === "on" ? `Signed in · synced${t ? " at " + t : ""}` : state === "connecting" ? "Connecting…" : state === "conflict" ? "Waiting for you to pick a save" : state === "error" ? `Not synced: ${lastErr}` : store.get(FLAG) ? "Tap anywhere to reconnect" : "Not signed in";
  return { signedIn: state === "on" || !!store.get(FLAG), state, text };
}

function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => ok(); s.onerror = () => fail(new Error("Google sign-in didn't load"));
    document.head.appendChild(s);
  });
}

/** Asks Google for an access token. `silent` skips the account picker when the player already agreed. */
function getToken(silent: boolean): Promise<void> {
  return new Promise((ok, fail) => {
    client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: (r: any) => { if (r.error) { fail(new Error(r.error)); return; } token = r.access_token; expires = Date.now() + (r.expires_in - 60) * 1000; ok(); },
      error_callback: (e: any) => fail(new Error(e?.type === "popup_closed" ? "sign-in closed" : e?.type ?? "sign-in failed")),
    });
    client.requestAccessToken({ prompt: silent ? "" : "consent" });
  });
}

async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) { token = ""; throw new Error("sign-in expired"); }
  if (!r.ok) throw new Error(`Drive error ${r.status}`);
  return r;
}

/** Called once at boot. Reconnects on the first tap if the player signed in before (Google needs a tap to open its window). */
export function startDrive(getLocal: () => Profile, remote: (p: Profile) => void, safe: () => boolean, changed: () => void) {
  local = getLocal; useRemote = remote; onChange = changed; canApply = safe;
  if (!driveAvailable() || !store.get(FLAG)) return;
  const once = () => { removeEventListener("pointerdown", once, true); connect(true); };
  addEventListener("pointerdown", once, true);
}

export async function driveSignIn() { await connect(false); }
export function driveSignOut() {
  try { if (token) (window as any).google?.accounts?.oauth2?.revoke(token, () => {}); } catch { /* ignore */ }
  token = ""; fileId = ""; state = "off"; store.set(FLAG, null); store.set(BASE, null); onChange();
}

async function connect(silent: boolean) {
  if (state === "connecting") return;
  state = "connecting"; onChange();
  try {
    await loadGis();
    await getToken(silent);
    store.set(FLAG, "1");
    const q = encodeURIComponent(`name='${FILE}'`);
    const list = await (await api(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
    fileId = list.files?.[0]?.id ?? "";
    await reconcile();
    retries = 0;
  } catch (e) {
    state = "error"; lastErr = (e as Error).message; onChange();
    // a quiet reconnect can fail (phones block Google's window without a fresh tap): try again on the next taps
    if (silent && store.get(FLAG) && retries++ < 3) { const once = () => { removeEventListener("pointerdown", once, true); connect(true); }; addEventListener("pointerdown", once, true); }
  }
}
let retries = 0;

const setBase = (t: number | undefined) => store.set(BASE, String(t ?? 0));
const take = (remote: Profile) => { setBase(remote.savedAt); lastSync = Date.now(); state = "on"; onChange(); useRemote(remote); };
const upload = async (mine: Profile) => { state = "on"; onChange(); dirty = mine; await flush(); };

/** Compares this device with Drive. Quiet when only one side changed since they last agreed; asks when both did. */
async function reconcile() {
  clearTimeout(timer); // a queued upload must not overwrite Drive before we've compared
  const mine = local();
  if (!fileId) return upload(mine);
  knownVer = await driveVer();
  const remote = migrate(await (await api(`/drive/v3/files/${fileId}?alt=media`)).json());
  if (!remote) return upload(mine);
  const base = Number(store.get(BASE) ?? -1);
  const r = remote.savedAt ?? 0, m = mine.savedAt ?? 0;
  if (r === m) { setBase(r); state = "on"; lastSync = Date.now(); onChange(); return; }
  if (isFresh(mine)) return take(remote);
  if (isFresh(remote) || r === base) return upload(mine); // only this device moved on
  if (m === base) return take(remote); // only Drive moved on (you played somewhere else)
  // both changed since they last agreed (or this device never synced): the player chooses
  state = "conflict"; onChange();
  askWhich(mine, remote, (keep) => { if (keep === "drive") take(remote); else upload(local()); });
}

/** Checks Drive again when the game comes back to the front (maybe after playing on another device) and when you return home. */
export function driveRecheck() {
  if (state !== "on" || busy || !fileId || !token || Date.now() > expires) return;
  reconcile().catch((e) => { state = "error"; lastErr = (e as Error).message; onChange(); });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && canApply()) driveRecheck(); });

function summary(p: Profile) {
  const when = p.savedAt ? new Date(p.savedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "unknown";
  const chars = Object.values(p.chars ?? {}).filter((c) => c.level > 1 || c.riftsCleared > 0).sort((a, b) => b.level - a.level);
  const rows = chars.length ? chars.map((c) => `<div>${CLASSES[c.cls]?.name ?? c.cls} · Lv ${c.level} · T${c.highestTier}</div>`).join("") : `<div class="dim">No progress yet</div>`;
  return `<div class="dim small">Saved ${when}</div>${rows}<div class="dim small">${p.materials ?? 0} materials · ${(p.stash ?? []).length} in storage</div>`;
}
/** The warning card: two saves side by side, keep one. The other is replaced. */
function askWhich(mine: Profile, remote: Profile, done: (keep: "device" | "drive") => void) {
  document.getElementById("sync-pick")?.remove();
  const el = document.createElement("div");
  el.id = "sync-pick";
  el.innerHTML = `<div class="panel sync-panel"><h2>Two different saves</h2>
    <div class="sub">This device and your Google Drive both have progress the other doesn't. Pick the one to keep. The other one is replaced and can't be brought back.</div>
    <div class="sync-cols"><div class="sync-col"><b>This device</b>${summary(mine)}<button data-keep="device">Keep this device</button></div>
    <div class="sync-col"><b>Google Drive</b>${summary(remote)}<button data-keep="drive">Keep Drive</button></div></div></div>`;
  document.body.appendChild(el);
  el.querySelectorAll<HTMLElement>("[data-keep]").forEach((b) => b.onclick = () => {
    const k = b.dataset.keep as "device" | "drive";
    if (b.dataset.armed !== "1") { el.querySelectorAll<HTMLElement>("[data-keep]").forEach((o) => { o.dataset.armed = ""; o.textContent = o.dataset.keep === "device" ? "Keep this device" : "Keep Drive"; }); b.dataset.armed = "1"; b.textContent = "Tap again to confirm"; return; }
    el.remove(); done(k);
  });
}

/** Every local save is mirrored to Drive a few seconds later. */
export function driveQueue(p: Profile) {
  if (state !== "on") return;
  dirty = p;
  clearTimeout(timer);
  timer = window.setTimeout(flush, 3000);
}

/** Tokens last an hour. When one runs out, ask Google again on the next tap and keep the save queued. */
let waiting = false;
function needReconnect() {
  state = "error"; lastErr = "tap to reconnect"; onChange();
  if (waiting) return;
  waiting = true;
  const once = () => { removeEventListener("pointerdown", once, true); waiting = false; state = "off"; connect(true); };
  addEventListener("pointerdown", once, true);
}

async function flush() {
  if (busy || !dirty) return;
  if (!token || Date.now() > expires) { needReconnect(); return; }
  // someone else (another device) wrote to Drive since we last looked: compare instead of overwriting
  if (fileId && knownVer) {
    try { if ((await driveVer()) !== knownVer) { dirty = null; await reconcile(); return; } }
    catch (e) { state = "error"; lastErr = (e as Error).message; onChange(); return; }
  }
  const p = dirty; dirty = null; busy = true;
  const body = JSON.stringify(p);
  try {
    if (fileId) await api(`/upload/drive/v3/files/${fileId}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body });
    else {
      const meta = JSON.stringify({ name: FILE, parents: ["appDataFolder"], mimeType: "application/json" });
      const b = "rift" + Math.random().toString(36).slice(2);
      const multipart = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`;
      const r = await (await api(`/upload/drive/v3/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body: multipart })).json();
      fileId = r.id;
    }
    knownVer = await driveVer();
    lastSync = Date.now(); state = "on"; setBase(p.savedAt);
  } catch (e) { dirty ??= p; state = "error"; lastErr = (e as Error).message; }
  busy = false; onChange();
  if (!token) { needReconnect(); return; }
  if (dirty && state === "on") timer = window.setTimeout(flush, 10000);
}
addEventListener("online", () => { if (dirty && state === "on") flush(); });
addEventListener("pagehide", () => { if (dirty && state === "on") flush(); });
