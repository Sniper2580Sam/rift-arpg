// Cloud saves (the Cloudflare site): sign in with Google once and stay signed in. The save lives on our backend
// (functions/api), one per Google account, and only one device plays it at a time: a second device asks to take over.
// The first sign-in brings over the best of this device's save and the old Google Drive save.
import { Profile, isFresh, migrate } from "./profile";
import { askWhich, readDriveSave } from "./gdrive";
import google from "../../data/google.json";

type State = "none" | "out" | "connecting" | "on" | "busy" | "taken" | "conflict" | "error";
let state: State = "none", lastErr = "", lastSync = 0;
let rev = 0, dirty: Profile | null = null, timer = 0, beat = 0, busyWrite = false, driveTok = "";
let local: () => Profile = () => ({} as Profile);
let useRemote: (p: Profile) => void = () => {};
let onChange: () => void = () => {};

const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } } };
const DEVICE = (() => { let d = store.get("rift-device"); if (!d) { d = Math.random().toString(36).slice(2, 12); store.set("rift-device", d); } return d; })();
const REV = "rift-cloud-rev", BASE = "rift-cloud-base"; // the cloud revision and save time this device last agreed on
const agreed = (r: number, p: Profile) => { rev = r; store.set(REV, String(r)); store.set(BASE, String(p.savedAt ?? 0)); lastSync = Date.now(); };
const set = (s: State, err = "") => { state = s; lastErr = err; onChange(); };

async function call(method: string, path: string, body?: unknown, keepalive = false) {
  const r = await fetch("api/" + path, { method, credentials: "same-origin", keepalive, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d: d as any };
}

export const cloudOn = () => state !== "none";
export function cloudStatus() {
  const t = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const text = state === "on" ? `Signed in · saved to the cloud${t ? " at " + t : ""}` : state === "connecting" ? "Connecting…" : state === "busy" ? "Playing on another device" : state === "taken" ? "Taken over by another device" : state === "conflict" ? "Waiting for you to pick a save" : state === "error" ? `Not saved to the cloud: ${lastErr}` : "Not signed in";
  return { state, text, signedIn: state !== "out" && state !== "none" };
}

/** At boot: is there a cloud here (the Cloudflare site), and is this device signed in? Resolves true when cloud saves are in charge. */
export async function startCloudSave(getLocal: () => Profile, remote: (p: Profile) => void, changed: () => void): Promise<boolean> {
  local = getLocal; useRemote = remote; onChange = changed;
  if (!location.protocol.startsWith("http") || (window as any).claude) return false;
  try {
    const { status, d } = await call("GET", "me");
    if (status !== 200 || !d.cloud) return false;
    rev = Number(store.get(REV) ?? 0);
    set(d.signedIn ? "connecting" : "out");
    if (!(await finishRedirect()) && d.signedIn) sync(false);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (state === "on" || state === "error")) sync(false); });
    addEventListener("online", () => { if (state === "error") sync(false); });
    addEventListener("pagehide", () => { if (dirty && state === "on") upload(dirty, true); });
    return true;
  } catch { return false; }
}

/** Sign in by going to Google's page and back (popups get stuck in iPhone Home Screen apps). */
export async function cloudSignIn() {
  set("connecting");
  const st = Math.random().toString(36).slice(2);
  store.set("rift-auth-state", st);
  const back = location.origin + location.pathname;
  const q = new URLSearchParams({ client_id: (google as any).clientId, redirect_uri: back, response_type: "token", scope: "openid https://www.googleapis.com/auth/drive.appdata", state: st, include_granted_scopes: "true", prompt: "select_account" });
  location.href = "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}
/** Back from Google's page: the token arrives in the address (#access_token=…). Returns true if this was a sign-in. */
async function finishRedirect(): Promise<boolean> {
  if (!location.hash.includes("access_token=") && !location.hash.includes("error=")) return false;
  const h = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", location.pathname + location.search); // keep the token out of the address bar
  if (h.get("error") || !h.get("access_token") || h.get("state") !== store.get("rift-auth-state")) { set("out", h.get("error") ?? "sign-in failed"); return true; }
  driveTok = h.get("access_token")!;
  const { status, d } = await call("POST", "auth", { access_token: driveTok });
  if (status !== 200) { set("out", d.error ?? "sign-in failed"); return true; }
  await sync(false);
  return true;
}
export async function cloudSignOut() { clearInterval(beat); await call("DELETE", "auth").catch(() => {}); set("out"); }

/** Every local save goes to the cloud a moment later. */
export function cloudSaveQueue(p: Profile) {
  if (state === "none" || state === "out") return;
  dirty = p;
  if (state !== "on") return; // kept until we're connected again
  clearTimeout(timer); timer = window.setTimeout(() => dirty && upload(dirty), 2500);
}

async function upload(p: Profile, keepalive = false) {
  if (busyWrite && !keepalive) { clearTimeout(timer); timer = window.setTimeout(() => dirty && upload(dirty), 1500); return; }
  busyWrite = true;
  try {
    const { status, d } = await call("PUT", "save", { save: p, base: rev, device: DEVICE }, keepalive);
    if (status === 200) { agreed(d.rev, p); if (dirty === p) dirty = null; onChange(); }
    else if (status === 409) { busyWrite = false; await sync(false); return; } // someone wrote first: compare again
    else if (status === 423) taken();
    else if (status === 401) set("out");
    else set("error", d.error ?? `error ${status}`);
  } catch { set("error", "offline"); }
  busyWrite = false;
}

function heartbeat() {
  clearInterval(beat);
  beat = window.setInterval(async () => {
    if (state !== "on" || document.visibilityState !== "visible") return;
    try { const { status } = await call("POST", "claim", { device: DEVICE }); if (status === 423) taken(); } catch { /* offline: try next time */ }
  }, 45000);
}

/** Connect: hold the save on this device (or ask to take over), then line up this device and the cloud. */
async function sync(force: boolean): Promise<void> {
  if (state !== "on") set("connecting");
  try {
    const g = await call("GET", "save");
    if (g.status === 401) { set("out"); return; }
    if (g.status !== 200) { set("error", g.d.error ?? `error ${g.status}`); return; }
    const c = await call("POST", "claim", { device: DEVICE, force });
    if (c.status === 423) { set("busy"); askTakeOver(c.d.lock?.at ? Date.now() - c.d.lock.at : 0); return; }
    if (c.status !== 200) { set("error", c.d.error ?? `error ${c.status}`); return; }
    heartbeat();
    await reconcile(g.d.save ? migrate(g.d.save) : null, g.d.rev ?? 0);
  } catch { set("error", "offline"); }
}

async function reconcile(remote: Profile | null, cloudRev: number) {
  const mine = local(), base = Number(store.get(BASE) ?? -1);
  if (!remote) return migrateFirst(mine);
  if (cloudRev === Number(store.get(REV) ?? -1)) {
    // the cloud hasn't moved since this device last agreed with it: send anything played here since
    rev = cloudRev; set("on");
    if ((mine.savedAt ?? 0) !== base) await upload(mine);
    return;
  }
  rev = cloudRev;
  if (isFresh(mine) || (mine.savedAt ?? 0) === base) { agreed(cloudRev, remote); set("on"); useRemote(remote); return; }
  if (isFresh(remote)) { set("on"); await upload(mine); return; }
  // both moved on (played offline here while another device saved): the player chooses
  set("conflict");
  askWhich(mine, remote, (keep) => {
    set("on");
    if (keep === "drive") { agreed(cloudRev, remote); useRemote(remote); } else upload(local());
  }, { mine: "This device", remote: "Cloud save", keepRemote: "Keep cloud save", sub: "This device and your cloud save both have progress the other doesn't." });
}

/** The cloud is empty for this account: bring over this device's save or the old Google Drive one. */
async function migrateFirst(mine: Profile) {
  rev = 0;
  let drive: Profile | null = null;
  if (driveTok) { try { drive = await readDriveSave(driveTok); } catch { /* no Drive save */ } }
  const useDrive = () => { set("on"); useRemote(drive!); upload(drive!); };
  if (!drive || isFresh(drive)) { set("on"); return upload(mine); }
  if (isFresh(mine)) return useDrive();
  set("conflict");
  askWhich(mine, drive, (keep) => { if (keep === "drive") useDrive(); else { set("on"); upload(local()); } },
    { mine: "This device", remote: "Old Google Drive save", keepRemote: "Keep Drive save", sub: "Moving to cloud saves: this device and your old Google Drive save are different." });
}

function taken() {
  clearInterval(beat); clearTimeout(timer); set("taken");
  overlay("Playing on another device", "Your save was opened on another device, so this one stopped saving. Anything since then on this device won't be kept.", "Play here instead", () => sync(true));
}
function askTakeOver(ago: number) {
  const s = Math.max(1, Math.round(ago / 1000));
  overlay("Playing on another device", `Your save is open on another device (last active ${s < 60 ? s + " s" : Math.round(s / 60) + " min"} ago). Take over here? The other device stops saving.`, "Take over", () => sync(true), () => sync(false));
}
function overlay(title: string, body: string, act: string, go: () => void, retry?: () => void) {
  document.getElementById("cloud-pick")?.remove();
  const el = document.createElement("div");
  el.innerHTML = `<div class="panel sync-panel"><h2>${title}</h2><div class="sub">${body}</div><div class="opts"><button data-go>${act}</button>${retry ? `<button data-retry>Check again</button>` : ""}</div></div>`;
  el.id = "cloud-pick";
  document.body.appendChild(el);
  el.querySelector<HTMLElement>("[data-go]")!.onclick = () => { el.remove(); go(); };
  const r = el.querySelector<HTMLElement>("[data-retry]"); if (r && retry) r.onclick = () => { el.remove(); retry(); };
}
