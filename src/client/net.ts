// Live build networking: sign-in, server connection (profile, hub ops, item minting) and
// WebRTC data channels between the host and up to three guests (signalled through the server).
import type { Affix } from "../sim/items";
import type { PlayerSetup } from "../sim/sim";
import type { Profile } from "./profile";
import type { HubOp } from "../shared/ops";

export function onlineAvailable(): boolean { return location.protocol === "http:" || location.protocol === "https:"; }

const TOKEN_KEY = "rift-arpg-token";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/** Shows the sign-in form until we have a token, then resolves. */
export function signIn(root: HTMLElement, msg = ""): Promise<string> {
  const saved = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  if (saved && !msg) return Promise.resolve(saved);
  return new Promise((done) => {
    root.className = "screen";
    root.innerHTML = `<div class="panel hub signin"><h1>RIFT ARPG</h1><div class="sub">live test build · local server</div>
      <p class="dim small">New name = new account. Your items are created and stored by the server.</p>
      <input id="nm" placeholder="name" maxlength="16" autocomplete="username" aria-label="Name">
      <input id="pw" placeholder="password" type="password" autocomplete="current-password" aria-label="Password">
      <button id="go" class="big">Sign in</button><div id="err" class="err">${esc(msg)}</div></div>`;
    const go = async () => {
      const name = (root.querySelector("#nm") as HTMLInputElement).value.trim();
      const password = (root.querySelector("#pw") as HTMLInputElement).value;
      const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ name, password }) }).then((x) => x.json()).catch(() => ({ error: "Server not reachable." }));
      if (r.error) { (root.querySelector("#err") as HTMLElement).textContent = r.error; return; }
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ }
      done(r.token);
    };
    (root.querySelector("#go") as HTMLElement).onclick = go;
    (root.querySelector("#pw") as HTMLElement).onkeydown = (e) => { if ((e as KeyboardEvent).key === "Enter") go(); };
  });
}
export function signOut() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }

export interface Member { pid: number; name: string; cls: string; level: number }
export interface Lobby { code: string; pid: number; host: boolean; members: Member[]; running: boolean }
export interface PeerInfo { pid: number; name: string; setup: PlayerSetup; pity: { ancestral: boolean; primal: boolean } }

interface Peer { pc: RTCPeerConnection; r?: RTCDataChannel; u?: RTCDataChannel; open: boolean; chunks: Map<number, string[]> }
const CHUNK = 15000;

export class Online {
  ws!: WebSocket;
  name = "";
  lobby: Lobby | null = null;
  peers = new Map<number, Peer>();
  peerInfo = new Map<number, PeerInfo>();
  private opId = 0;
  private rerollWait: ((o: Affix[]) => void) | null = null;
  private chunkId = 0;
  iceServers: RTCIceServer[] = [];

  // callbacks wired by main.ts
  onProfile: (p: Profile, info: { saved?: boolean; ok?: boolean }) => void = () => {};
  onLobby: () => void = () => {};
  onServer: (m: any) => void = () => {};
  onPeerOpen: (pid: number) => void = () => {};
  onPeerClose: (pid: number) => void = () => {};
  onPeerMsg: (pid: number, m: any) => void = () => {};
  onClosed: () => void = () => {};

  constructor() {
    const q = new URLSearchParams(location.search).get("stun");
    if (q) this.iceServers = [{ urls: q }];
  }

  connect(token: string): Promise<boolean> {
    return new Promise((res) => {
      this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      let first = true;
      this.ws.onopen = () => this.send({ t: "hello", token });
      this.ws.onclose = () => { if (first) res(false); else this.onClosed(); };
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.t === "authFail") { first = false; res(false); return; }
        if (first && m.t === "profile") { first = false; this.name = m.name; this.onProfile(m.profile, {}); res(true); return; }
        this.handle(m);
      };
    });
  }
  send(m: unknown) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m)); }
  op(op: HubOp) { this.send({ t: "op", op, id: ++this.opId }); }
  rerollOptions(target: unknown, idx: number): Promise<Affix[]> {
    return new Promise((res) => { this.rerollWait = res; this.send({ t: "rerollOpts", target, idx }); });
  }
  host() { this.send({ t: "host" }); }
  join(code: string) { this.send({ t: "join", code }); }
  leave() { this.send({ t: "leaveRoom" }); this.closePeers(); }

  private handle(m: any) {
    switch (m.t) {
      case "profile": this.onProfile(m.profile, { saved: m.saved, ok: m.ok }); return;
      case "rerollOpts": this.rerollWait?.(m.options); this.rerollWait = null; return;
      case "room":
        this.lobby = { code: m.code, pid: m.pid, host: m.host, members: [], running: false };
        if (!m.host) this.dialHost();
        this.onLobby(); return;
      case "members": if (this.lobby) { this.lobby.members = m.members; this.lobby.running = m.running; } this.onLobby(); return;
      case "peer": this.peerInfo.set(m.pid, m); this.onServer(m); return;
      case "peerLeft": this.dropPeer(m.pid); this.peerInfo.delete(m.pid); this.onServer(m); return;
      case "roomClosed": this.lobby = null; this.closePeers(); this.onLobby(); this.onServer(m); return;
      case "signal": this.signal(m.from, m.data); return;
      default: this.onServer(m);
    }
  }

  // ---------------------------------------------------------------- WebRTC
  private newPeer(pid: number): Peer {
    this.dropPeer(pid);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, open: false, chunks: new Map() };
    this.peers.set(pid, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: "signal", to: pid, data: { ice: e.candidate.toJSON() } }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" || pc.connectionState === "closed") this.dropPeer(pid, true); };
    pc.ondatachannel = (e) => this.bindChannel(pid, peer, e.channel);
    return peer;
  }
  private bindChannel(pid: number, peer: Peer, ch: RTCDataChannel) {
    if (ch.label === "r") peer.r = ch; else peer.u = ch;
    ch.onopen = () => this.checkOpen(pid, peer);
    ch.onclose = () => this.dropPeer(pid, true);
    ch.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === "chunk") {
        const parts = peer.chunks.get(m.id) ?? []; parts[m.i] = m.d; peer.chunks.set(m.id, parts);
        if (parts.filter((x) => x !== undefined).length === m.n) { peer.chunks.delete(m.id); this.onPeerMsg(pid, JSON.parse(parts.join(""))); }
        return;
      }
      this.onPeerMsg(pid, m);
    };
    if (ch.readyState === "open") this.checkOpen(pid, peer);
  }
  private checkOpen(pid: number, peer: Peer) {
    if (!peer.open && peer.r?.readyState === "open" && peer.u?.readyState === "open") { peer.open = true; this.onPeerOpen(pid); }
  }
  /** Guests call the host. */
  private async dialHost() {
    const peer = this.newPeer(0);
    this.bindChannel(0, peer, peer.pc.createDataChannel("r", { ordered: true }));
    this.bindChannel(0, peer, peer.pc.createDataChannel("u", { ordered: false, maxRetransmits: 0 }));
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send({ t: "signal", to: 0, data: { sdp: peer.pc.localDescription } });
  }
  private async signal(from: number, d: any) {
    let peer = this.peers.get(from);
    if (d.sdp?.type === "offer") {
      peer = this.newPeer(from);
      await peer.pc.setRemoteDescription(d.sdp);
      await peer.pc.setLocalDescription(await peer.pc.createAnswer());
      this.send({ t: "signal", to: from, data: { sdp: peer.pc.localDescription } });
    } else if (d.sdp?.type === "answer" && peer) await peer.pc.setRemoteDescription(d.sdp);
    else if (d.ice && peer) { try { await peer.pc.addIceCandidate(d.ice); } catch { /* late candidate */ } }
  }
  private dropPeer(pid: number, notify = false) {
    const p = this.peers.get(pid); if (!p) return;
    this.peers.delete(pid);
    try { p.pc.close(); } catch { /* ignore */ }
    if (notify && p.open) this.onPeerClose(pid);
  }
  closePeers() { for (const pid of [...this.peers.keys()]) this.dropPeer(pid); }

  /** Reliable, ordered. Large messages are split into chunks. */
  sendR(pid: number, m: unknown) {
    const ch = this.peers.get(pid)?.r; if (!ch || ch.readyState !== "open") return;
    const s = JSON.stringify(m);
    if (s.length <= CHUNK) { ch.send(s); return; }
    const id = ++this.chunkId, n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++) ch.send(JSON.stringify({ t: "chunk", id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  /** Unreliable, unordered: latest-wins data like inputs. */
  sendU(pid: number, m: unknown) { const ch = this.peers.get(pid)?.u; if (ch?.readyState === "open") ch.send(JSON.stringify(m)); }
  openPeers() { return [...this.peers.entries()].filter(([, p]) => p.open).map(([pid]) => pid); }
}
