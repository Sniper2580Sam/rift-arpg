// Artifact page only: mirror the save to the viewer's private cloud document, because the page's
// browser storage can come back empty (new page origin, Safari clearing site data, private mode).
// Device storage stays the first copy so the game still saves with no signal (planes).
import { Profile, isFresh, migrate } from "./profile";

type DocRef = { get(): Promise<{ exists: boolean; data(): any }>; set(d: Record<string, unknown>): Promise<void> };
let ref: DocRef | null = null;
let ready = false, busy = false, dirty: Profile | null = null, timer = 0;

const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

/** Connects to the cloud copy. Calls `useRemote` if the cloud has a newer save than this device. */
export async function startCloud(local: () => Profile, useRemote: (p: Profile) => void) {
  const c = (window as any).claude;
  if (!c?.use) return; // plain file or another host: device storage only
  try {
    const [db, user] = await Promise.all([c.use("db"), c.use("user")]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    ref = db.doc(`data/users/${uid}/save`) as DocRef;
    const snap = await withTimeout(ref.get(), 10000);
    const mine = local();
    if (snap.exists) {
      const d = snap.data();
      const remote = typeof d?.json === "string" ? migrate(JSON.parse(d.json)) : null;
      if (remote && (isFresh(mine) || (remote.savedAt ?? 0) > (mine.savedAt ?? 0))) { ready = true; useRemote(remote); return; }
    }
    ready = true;
    if (!isFresh(mine)) queue(mine);
  } catch { ready = !!ref; /* offline: keep playing on device storage, push later */ }
}

export function queue(p: Profile) {
  if (!ref || !ready) return;
  dirty = p;
  clearTimeout(timer);
  timer = window.setTimeout(flush, 3000);
}
async function flush() {
  if (!ref || busy || !dirty) return;
  const p = dirty; dirty = null; busy = true;
  try { await withTimeout(ref.set({ json: JSON.stringify(p), savedAt: p.savedAt ?? Date.now(), v: p.version }), 15000); }
  catch { dirty ??= p; }
  busy = false;
  if (dirty) timer = window.setTimeout(flush, 10000);
}
addEventListener("online", () => { if (dirty) flush(); });
addEventListener("pagehide", () => { if (dirty) flush(); });
