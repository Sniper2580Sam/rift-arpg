// Direct co-op for the test builds: no game server. Players find each other by room code through the free
// public PeerJS matchmaking server, then talk phone-to-phone over WebRTC. When a direct path fails, Cloudflare's
// TURN relay carries it (on the Cloudflare Pages build), or PeerJS's own free relay elsewhere. The host's phone runs the game; every phone keeps its own save, like solo.
import { Peer, DataConnection } from "peerjs";
import type { PlayerSetup } from "../sim/sim";
import type { Lobby, Member, PeerInfo } from "./net";

const PREFIX = "rift-arpg-x7q2-"; // keeps our room ids apart from other apps on the shared server
const NAME_KEY = "rift-arpg-name";
const CHUNK = 12000;
const MAX = 6;
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function savedName(): string {
  try { const n = localStorage.getItem(NAME_KEY); if (n) return n; } catch { /* ignore */ }
  return "Player " + Math.floor(100 + Math.random() * 900);
}
export function saveName(n: string) { try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }

/** Cloudflare's TURN relay, when the app is hosted on Cloudflare Pages: /api/turn hands out short-lived
 *  credentials (functions/api/turn.ts). Elsewhere (the offline file, the artifact page) PeerJS's own defaults apply. */
let relayIce: any[] | null = null;
const relayReady: Promise<void> = location.protocol.startsWith("http") && !new URLSearchParams(location.search).get("peer")
  ? fetch("api/turn", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.relay && Array.isArray(d.iceServers)) relayIce = d.iceServers; }).catch(() => {})
  : Promise.resolve();
/** Wait briefly for relay credentials before opening a connection (never longer than 2 s). */
const withRelay = (f: () => void) => { Promise.race([relayReady, new Promise((r) => setTimeout(r, 2000))]).then(f); };

/** Normally the free public PeerJS server. ?peer=host:port points at another one (used by the tests). */
function peerOpts(): any {
  const q = new URLSearchParams(location.search).get("peer");
  if (!q) return relayIce ? { debug: 0, config: { iceServers: relayIce } } : { debug: 0 };
  const [host, port] = q.split(":");
  return { debug: 0, host, port: Number(port || 9000), path: "/", secure: false, config: { iceServers: [] } };
}

type Self = () => { setup: PlayerSetup; pity: PeerInfo["pity"]; cls: string; level: number };

export class Direct {
  readonly direct = true;
  name = savedName();
  lobby: Lobby | null = null;
  peerInfo = new Map<number, PeerInfo>();
  connecting = false;
  private peer: Peer | null = null;
  private conns = new Map<number, DataConnection>(); // host: pid → guest; guest: 0 → host
  private open = new Set<number>();
  private chunks = new Map<string, string[]>();
  private chunkId = 0;
  private running = false;
  private myPid = 1;
  /** Phones drop WebRTC when the app goes to the background. A guest keeps trying the same room for a while,
   *  asking for its old seat back (matched by this token), and the host re-registers its room code. */
  private token = Math.random().toString(36).slice(2);
  private code = "";
  private rejoinUntil = 0;
  private rejoinTimer: any = null;
  get reconnecting() { return this.rejoinUntil > 0; }

  onLobby: () => void = () => {};
  onServer: (m: any) => void = () => {};
  onPeerOpen: (pid: number) => void = () => {};
  onPeerClose: (pid: number) => void = () => {};
  onPeerMsg: (pid: number, m: any) => void = () => {};

  constructor(private self: Self) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const p = this.peer as any;
      if (this.lobby?.host && p && p.disconnected && !p.destroyed) { try { p.reconnect(); } catch { /* retried on the next return */ } }
      if (this.reconnecting && !this.peer && !this.connecting) this.retryJoin(0);
    });
  }

  setName(n: string) { this.name = n.trim().slice(0, 16) || this.name; saveName(this.name); this.pushSetup(); }

  // ---------------------------------------------------------------- host
  host(attempt = 0) {
    if (this.peer || this.connecting) return;
    this.connecting = true; this.onLobby();
    let code = ""; for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
    withRelay(() => this.openHost(code, attempt));
  }
  private openHost(code: string, attempt: number) {
    const peer = new Peer(PREFIX + code, peerOpts());
    peer.on("open", () => {
      this.peer = peer; this.connecting = false;
      this.lobby = { code, pid: 0, host: true, members: [], running: false };
      this.refreshMembers();
    });
    peer.on("connection", (c) => this.accept(c));
    peer.on("error", (e: any) => {
      if (e?.type === "unavailable-id" && attempt < 5) { peer.destroy(); this.connecting = false; this.host(attempt + 1); return; }
      if (!this.peer) { peer.destroy(); this.connecting = false; this.fail(e); }
    });
    peer.on("disconnected", () => { setTimeout(() => { if (this.peer === peer && peer.disconnected && !peer.destroyed) try { peer.reconnect(); } catch { /* tried again when the app comes back */ } }, 1000); });
  }
  private accept(c: DataConnection) {
    const used = new Set([0, ...this.conns.keys()]);
    let pid = 1; while (used.has(pid)) pid++;
    if (pid >= MAX) { c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 500); }); return; }
    this.conns.set(pid, c);
    const ref = { pid };
    c.on("data", (d: any) => {
      // a returning guest: free its old seat (the old connection may not have timed out yet) and give it back
      if (d?.t === "hello" && d.token && !this.peerInfo.has(ref.pid)) {
        const old = [...this.peerInfo.values()].find((q) => (q as any).token === d.token && q.pid !== ref.pid);
        if (old) {
          const oc = this.conns.get(old.pid); this.drop(old.pid); try { oc?.close(); } catch { /* gone already */ }
          this.conns.delete(ref.pid); ref.pid = old.pid; this.conns.set(ref.pid, c);
        }
      }
      this.recv(ref.pid, d);
    });
    c.on("close", () => { if (this.conns.get(ref.pid) === c) this.drop(ref.pid); });
    c.on("error", () => { if (this.conns.get(ref.pid) === c) this.drop(ref.pid); });
  }
  setRunning(on: boolean) { this.running = on; if (this.lobby?.host) this.refreshMembers(); }

  // ---------------------------------------------------------------- guest
  join(code: string) {
    if (this.peer || this.connecting) return;
    code = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (code.length !== 4) return this.onServer({ t: "joinFail", reason: "Room codes are 4 letters." });
    this.code = code; this.rejoinUntil = 0;
    this.connecting = true; this.onLobby();
    withRelay(() => this.openGuest(code));
  }
  private retryJoin(delay = 3000) {
    clearTimeout(this.rejoinTimer);
    if (!this.reconnecting) return;
    if (Date.now() > this.rejoinUntil) { this.giveUp(); return; }
    this.rejoinTimer = setTimeout(() => { if (this.reconnecting && !this.peer && !this.connecting) { this.connecting = true; withRelay(() => this.openGuest(this.code)); } }, delay);
  }
  private giveUp() {
    clearTimeout(this.rejoinTimer); this.rejoinUntil = 0;
    this.conns.clear(); this.open.clear(); this.teardown();
    this.onServer({ t: "roomClosed" }); this.onLobby();
  }
  /** Close a failed rejoin attempt and schedule the next one. */
  private failAttempt(peer: Peer) {
    this.conns.delete(0); this.connecting = false;
    try { peer.destroy(); } catch { /* ignore */ }
    if (this.peer === peer) this.peer = null;
    this.retryJoin();
  }
  private openGuest(code: string) {
    const peer = new Peer(peerOpts());
    peer.on("open", () => {
      this.peer = peer;
      const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
      this.conns.set(0, c);
      const timer = setTimeout(() => {
        if (this.open.has(0) || this.conns.get(0) !== c) return;
        if (this.reconnecting) { this.failAttempt(peer); return; }
        this.leave(); this.onServer({ t: "joinFail", reason: "Couldn't reach that room. Check the code, or the networks may need a relay." });
      }, this.reconnecting ? 8000 : 15000);
      c.on("open", () => { clearTimeout(timer); const s = this.self(); c.send({ t: "hello", name: this.name, setup: s.setup, pity: s.pity, cls: s.cls, level: s.level, token: this.token }); });
      c.on("data", (d) => this.recv(0, d));
      c.on("close", () => { if (this.conns.get(0) === c) this.hostGone(); });
      c.on("error", () => { if (this.conns.get(0) === c) this.hostGone(); });
    });
    peer.on("error", (e: any) => {
      this.connecting = false;
      if (this.reconnecting && !this.open.has(0)) { this.failAttempt(peer); return; }
      if (e?.type === "peer-unavailable") { this.leave(); this.onServer({ t: "joinFail", reason: `No room ${code}. Check the code.` }); }
      else if (!this.lobby) { this.leave(); this.fail(e); }
    });
  }
  private hostGone() {
    if (!this.conns.has(0)) return;
    const was = this.open.has(0);
    this.conns.delete(0); this.open.delete(0);
    if (was && this.lobby && !this.reconnecting) {
      // keep the room and the run; try to get back in for up to 2 minutes (the host may be away from the app)
      try { this.peer?.destroy(); } catch { /* ignore */ }
      this.peer = null; this.connecting = false;
      this.rejoinUntil = Date.now() + 120000;
      this.onServer({ t: "reconnecting" }); this.onLobby();
      this.retryJoin(1000);
      return;
    }
    if (this.reconnecting) { const p = this.peer; if (p) this.failAttempt(p); else this.retryJoin(); return; }
    this.teardown();
    if (was) { this.onPeerClose(0); this.onServer({ t: "roomClosed" }); }
    this.onLobby();
  }

  /** Guests tell the host when their gear, class or skills change in the hub. */
  pushSetup() {
    if (!this.lobby || this.lobby.host || !this.open.has(0)) return;
    const s = this.self();
    this.conns.get(0)?.send({ t: "setup", name: this.name, setup: s.setup, pity: s.pity, cls: s.cls, level: s.level });
  }

  // ---------------------------------------------------------------- shared
  leave() {
    clearTimeout(this.rejoinTimer); this.rejoinUntil = 0;
    if (this.lobby?.host) for (const c of this.conns.values()) c.close();
    else this.conns.get(0)?.close();
    this.conns.clear(); this.open.clear(); this.peerInfo.clear();
    this.teardown();
    this.onLobby();
  }
  private teardown() { this.lobby = null; this.connecting = false; this.running = false; try { this.peer?.destroy(); } catch { /* ignore */ } this.peer = null; }
  private fail(e: any) {
    const t = e?.type ?? "";
    this.onServer({ t: "joinFail", reason: t === "network" || t === "server-error" || t === "socket-error" ? "Couldn't reach the matchmaking server. Check your connection." : t === "browser-incompatible" ? "This browser can't do co-op." : "Co-op connection failed. Try again." });
    this.onLobby();
  }
  private drop(pid: number) {
    if (!this.conns.has(pid)) return;
    const was = this.open.has(pid);
    this.conns.delete(pid); this.open.delete(pid); this.peerInfo.delete(pid);
    if (was) { this.onPeerClose(pid); this.onServer({ t: "peerLeft", pid }); }
    this.refreshMembers();
  }
  private refreshMembers() {
    if (!this.lobby?.host) return;
    const s = this.self();
    const members: Member[] = [{ pid: 0, name: this.name, cls: s.cls, level: s.level }, ...[...this.peerInfo.values()].map((p) => ({ pid: p.pid, name: p.name, cls: (p as any).cls ?? p.setup.cls, level: (p as any).level ?? p.setup.level }))];
    this.lobby.members = members; this.lobby.running = this.running;
    for (const pid of this.open) this.sendR(pid, { t: "members", members, running: this.running, code: this.lobby.code });
    this.onLobby();
  }
  private recv(pid: number, d: any) {
    if (d?.t === "chunk") {
      const key = `${pid}:${d.id}`, parts = this.chunks.get(key) ?? []; parts[d.i] = d.d; this.chunks.set(key, parts);
      if (parts.filter((x) => x !== undefined).length === d.n) { this.chunks.delete(key); this.recv(pid, JSON.parse(parts.join(""))); }
      return;
    }
    if (this.lobby?.host || (!this.lobby && pid !== 0)) {
      if (d?.t === "hello" || d?.t === "setup") {
        const first = !this.peerInfo.has(pid);
        this.peerInfo.set(pid, { pid, name: String(d.name ?? "Friend").slice(0, 16), setup: { ...d.setup, pid }, pity: d.pity ?? { ancestral: false, primal: false }, cls: d.cls, level: d.level, token: typeof d.token === "string" ? d.token.slice(0, 20) : (this.peerInfo.get(pid) as any)?.token } as PeerInfo);
        if (first) { this.open.add(pid); this.sendR(pid, { t: "welcome", pid }); this.refreshMembers(); this.onPeerOpen(pid); } else this.refreshMembers();
        return;
      }
    } else if (pid === 0) {
      if (d?.t === "full") { this.leave(); this.onServer({ t: "joinFail", reason: "That room is full (6 players)." }); return; }
      if (d?.t === "welcome") { this.myPid = d.pid; return; }
      if (d?.t === "members") {
        if (!this.lobby || this.reconnecting) { this.open.add(0); this.connecting = false; }
        if (this.reconnecting) { clearTimeout(this.rejoinTimer); this.rejoinUntil = 0; this.onServer({ t: "reconnected" }); }
        this.lobby = { code: d.code, pid: this.myPid, host: false, members: d.members, running: d.running };
        this.onLobby();
        return;
      }
    }
    this.onPeerMsg(pid, d);
  }
  openPeers() { return [...this.open]; }
  sendR(pid: number, m: unknown) {
    const c = this.conns.get(pid); if (!c?.open) return;
    const s = JSON.stringify(m);
    if (s.length <= CHUNK) { c.send(m); return; }
    const id = ++this.chunkId, n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) c.send({ t: "chunk", id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) });
  }
  sendU(pid: number, m: unknown) { this.sendR(pid, m); }
  /** The live server's messages (saves, drops) have no meaning here. */
  send(_m: unknown) { /* no server */ }
}
