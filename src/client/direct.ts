// Direct co-op for the test builds: no game server. Players find each other by room code through the free
// public PeerJS matchmaking server, then talk phone-to-phone over WebRTC (PeerJS's free relay helps when
// a direct path fails). The host's phone runs the game; every phone keeps its own save, like solo.
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

/** Normally the free public PeerJS server. ?peer=host:port points at another one (used by the tests). */
function peerOpts(): any {
  const q = new URLSearchParams(location.search).get("peer");
  if (!q) return { debug: 0 };
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

  onLobby: () => void = () => {};
  onServer: (m: any) => void = () => {};
  onPeerOpen: (pid: number) => void = () => {};
  onPeerClose: (pid: number) => void = () => {};
  onPeerMsg: (pid: number, m: any) => void = () => {};

  constructor(private self: Self) {}

  setName(n: string) { this.name = n.trim().slice(0, 16) || this.name; saveName(this.name); this.pushSetup(); }

  // ---------------------------------------------------------------- host
  host(attempt = 0) {
    if (this.peer || this.connecting) return;
    this.connecting = true; this.onLobby();
    let code = ""; for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
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
    peer.on("disconnected", () => { try { peer.reconnect(); } catch { /* the room keeps working for people already in it */ } });
  }
  private accept(c: DataConnection) {
    const used = new Set([0, ...this.conns.keys()]);
    let pid = 1; while (used.has(pid)) pid++;
    if (pid >= MAX) { c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 500); }); return; }
    this.conns.set(pid, c);
    c.on("data", (d) => this.recv(pid, d));
    c.on("close", () => this.drop(pid));
    c.on("error", () => this.drop(pid));
  }
  setRunning(on: boolean) { this.running = on; if (this.lobby?.host) this.refreshMembers(); }

  // ---------------------------------------------------------------- guest
  join(code: string) {
    if (this.peer || this.connecting) return;
    code = code.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4);
    if (code.length !== 4) return this.onServer({ t: "joinFail", reason: "Room codes are 4 letters." });
    this.connecting = true; this.onLobby();
    const peer = new Peer(peerOpts());
    peer.on("open", () => {
      this.peer = peer;
      const c = peer.connect(PREFIX + code, { reliable: true, serialization: "json" });
      this.conns.set(0, c);
      const timer = setTimeout(() => { if (!this.open.has(0)) { this.leave(); this.onServer({ t: "joinFail", reason: "Couldn't reach that room. Check the code, or the networks may need a relay." }); } }, 15000);
      c.on("open", () => { clearTimeout(timer); const s = this.self(); c.send({ t: "hello", name: this.name, setup: s.setup, pity: s.pity, cls: s.cls, level: s.level }); });
      c.on("data", (d) => this.recv(0, d));
      c.on("close", () => this.hostGone());
      c.on("error", () => this.hostGone());
    });
    peer.on("error", (e: any) => {
      this.connecting = false;
      if (e?.type === "peer-unavailable") { this.leave(); this.onServer({ t: "joinFail", reason: `No room ${code}. Check the code.` }); }
      else if (!this.lobby) { this.leave(); this.fail(e); }
    });
  }
  private hostGone() {
    if (!this.conns.has(0)) return;
    const was = this.open.has(0);
    this.conns.delete(0); this.open.delete(0);
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
        this.peerInfo.set(pid, { pid, name: String(d.name ?? "Friend").slice(0, 16), setup: { ...d.setup, pid }, pity: d.pity ?? { ancestral: false, primal: false }, cls: d.cls, level: d.level } as PeerInfo);
        if (first) { this.open.add(pid); this.sendR(pid, { t: "welcome", pid }); this.refreshMembers(); this.onPeerOpen(pid); } else this.refreshMembers();
        return;
      }
    } else if (pid === 0) {
      if (d?.t === "full") { this.leave(); this.onServer({ t: "joinFail", reason: "That room is full (6 players)." }); return; }
      if (d?.t === "welcome") { this.myPid = d.pid; return; }
      if (d?.t === "members") {
        if (!this.lobby) { this.open.add(0); this.connecting = false; }
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
