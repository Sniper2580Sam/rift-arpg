// Phone app (GitHub Pages) only: Google sign-in keeps the save in a hidden app folder in the
// player's own Google Drive (scope drive.appdata), so the same save follows them between devices.
// Device storage stays the first copy; Drive is a mirror that wins only when it is newer.
import google from "../../data/google.json";
import { Profile, isFresh, migrate } from "./profile";

const CLIENT_ID: string = (google as any).clientId ?? "";
const SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const FILE = "rift-arpg-save.json";
const FLAG = "rift-gdrive";
const API = "https://www.googleapis.com";

let token = "", expires = 0, fileId = "", busy = false, dirty: Profile | null = null, timer = 0;
let state: "off" | "connecting" | "on" | "error" = "off", lastSync = 0, lastErr = "";
let local: () => Profile = () => ({} as Profile);
let useRemote: (p: Profile) => void = () => {};
let onChange: () => void = () => {};
let client: any = null;

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } } };

/** Sync is offered on the hosted https page with a client id, never in the claude.ai artifact (it has its own cloud copy). */
export function driveAvailable() {
  return !!CLIENT_ID && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1") && !(window as any).claude;
}
export function driveStatus() {
  const t = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const text = state === "on" ? `Signed in · synced${t ? " at " + t : ""}` : state === "connecting" ? "Connecting…" : state === "error" ? `Not synced: ${lastErr}` : store.get(FLAG) ? "Tap anywhere to reconnect" : "Not signed in";
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
export function startDrive(getLocal: () => Profile, remote: (p: Profile) => void, changed: () => void) {
  local = getLocal; useRemote = remote; onChange = changed;
  if (!driveAvailable() || !store.get(FLAG)) return;
  const once = () => { removeEventListener("pointerdown", once, true); connect(true); };
  addEventListener("pointerdown", once, true);
}

export async function driveSignIn() { await connect(false); }
export function driveSignOut() {
  try { if (token) (window as any).google?.accounts?.oauth2?.revoke(token, () => {}); } catch { /* ignore */ }
  token = ""; fileId = ""; state = "off"; store.set(FLAG, null); onChange();
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
    const mine = local();
    if (fileId) {
      const remote = migrate(await (await api(`/drive/v3/files/${fileId}?alt=media`)).json());
      if (remote && (isFresh(mine) || (remote.savedAt ?? 0) > (mine.savedAt ?? 0))) { state = "on"; lastSync = Date.now(); onChange(); useRemote(remote); return; }
    }
    state = "on"; onChange();
    if (!isFresh(mine) || !fileId) { dirty = mine; await flush(); }
  } catch (e) {
    state = "error"; lastErr = (e as Error).message; onChange();
  }
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
    lastSync = Date.now(); state = "on";
  } catch (e) { dirty ??= p; state = "error"; lastErr = (e as Error).message; }
  busy = false; onChange();
  if (!token) { needReconnect(); return; }
  if (dirty && state === "on") timer = window.setTimeout(flush, 10000);
}
addEventListener("online", () => { if (dirty && state === "on") flush(); });
addEventListener("pagehide", () => { if (dirty && state === "on") flush(); });
