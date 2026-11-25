// Backend for the live build: accounts, saves, item minting, co-op room signalling.
// Local: npm run server (JSON files in ./server-data). Hosted: see DEPLOY.md (saves in Upstash Redis).
import { createServer, IncomingMessage, ServerResponse } from "http";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import { KV, fileKV, fileProfileNames, upstashKV, writer } from "./store";
import { WebSocketServer, WebSocket } from "ws";
import { RIFT, nextTrial } from "../sim/data";
import { Affix, rerollOptions } from "../sim/items";
import { makeRng } from "../sim/rng";
import { PlayerSetup } from "../sim/sim";
import { Profile, char, migrate, newProfile, setupFor } from "../client/profile";
import { HubOp, applyHubOp } from "../shared/ops";
import { RunInfo, RunMember, SaveReport, applySave, mintFor, sanitizeOpts } from "./ledger";

const PORT = Number(process.env.PORT ?? 8787);
const DATA = process.env.DATA_DIR ?? "server-data";
const PAGE = process.env.PAGE ?? "dist/index.live.html";

// ------------------------------------------------------------------ storage (everything in memory, written through)
const kv: KV = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? upstashKV(process.env.UPSTASH_REDIS_REST_URL, process.env.UPSTASH_REDIS_REST_TOKEN)
  : fileKV(DATA);
const out = writer(kv);
const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const [accRaw, sesRaw] = await kv.get(["accounts", "sessions"]);
const accounts = parse<Record<string, { salt: string; hash: string }>>(accRaw, {});
const sessions = parse<Record<string, string>>(sesRaw, {});
const profiles = new Map<string, Profile>();
{
  const names = [...new Set([...Object.keys(accounts), ...(kv.name.startsWith("files") ? fileProfileNames(DATA) : [])])];
  const raws = await kv.get(names.map((n) => "profile:" + n));
  names.forEach((n, i) => { const p = raws[i] && migrate(parse(raws[i], null)); if (p) profiles.set(n, p); });
}
function getProfile(name: string): Profile {
  let p = profiles.get(name);
  if (!p) { p = newProfile(); profiles.set(name, p); }
  return p;
}
function putProfile(name: string, p: Profile) { profiles.set(name, p); out.put("profile:" + name, p); }
const ICE: RTCIceServerLike[] = [
  ...(process.env.ICE_STUN ?? "").split(",").filter(Boolean).map((u) => ({ urls: u.trim() })),
  ...(process.env.TURN_URLS ? [{ urls: process.env.TURN_URLS.split(",").map((u) => u.trim()), username: process.env.TURN_USERNAME ?? "", credential: process.env.TURN_CREDENTIAL ?? "" }] : []),
];
interface RTCIceServerLike { urls: string | string[]; username?: string; credential?: string }

const rng = makeRng(randomBytes(4).readUInt32LE(0));
const hashPw = (pw: string, salt: string) => scryptSync(pw, salt, 32).toString("hex");
const NAME_RE = /^[A-Za-z0-9_\- ]{2,16}$/;

// ------------------------------------------------------------------ http
function body(req: IncomingMessage): Promise<any> {
  return new Promise((res) => { let s = ""; req.on("data", (d) => { s += d; if (s.length > 1e4) req.destroy(); }); req.on("end", () => { try { res(JSON.parse(s)); } catch { res({}); } }); });
}
function send(res: ServerResponse, code: number, v: unknown, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof v === "string" ? v : JSON.stringify(v));
}
const http = createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url?.startsWith("/?"))) {
    try { return send(res, 200, readFileSync(PAGE, "utf8"), "text/html; charset=utf-8"); } catch { return send(res, 500, "Build the live page first: npm run build:live", "text/plain"); }
  }
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, "ok", "text/plain");
  if (req.method === "GET" && req.url === "/api/ice") return send(res, 200, { iceServers: ICE });
  if (req.method === "POST" && req.url === "/api/login") {
    const { name, password } = await body(req);
    if (typeof name !== "string" || !NAME_RE.test(name) || typeof password !== "string" || password.length < 4) return send(res, 400, { error: "Name 2–16 letters/numbers, password 4+ characters." });
    const a = accounts[name];
    if (a) {
      const ok = timingSafeEqual(Buffer.from(hashPw(password, a.salt), "hex"), Buffer.from(a.hash, "hex"));
      if (!ok) return send(res, 401, { error: "Wrong password for that name." });
    } else {
      const salt = randomBytes(16).toString("hex");
      accounts[name] = { salt, hash: hashPw(password, salt) };
      out.put("accounts", accounts);
      putProfile(name, newProfile());
    }
    const token = randomBytes(24).toString("hex");
    sessions[token] = name; out.put("sessions", sessions);
    return send(res, 200, { token, name, created: !a });
  }
  send(res, 404, { error: "not found" });
});

// ------------------------------------------------------------------ rooms
interface Conn { ws: WebSocket; name: string; room?: Room; pid?: number; reroll?: { key: string; options: Affix[] } }
interface Room {
  code: string; members: Map<number, Conn>; host: Conn;
  run: (RunInfo & { members: Map<number, RunMember> }) | null;
  lastRun: (RunInfo & { members: Map<number, RunMember> }) | null;
}
const rooms = new Map<string, Room>();
const tx = (c: Conn | undefined, m: unknown) => { if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m)); };
function code(): string { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ"; let s = ""; for (let i = 0; i < 4; i++) s += A[randomBytes(1)[0] % A.length]; return rooms.has(s) ? code() : s; }
function pityOf(p: Profile) { const c = char(p), T = RIFT.tiers; return { ancestral: c.pityAnc >= T.ancestralPity, primal: c.pityPri >= T.primalPity }; }
function setupOf(c: Conn): PlayerSetup { return setupFor(getProfile(c.name), c.pid!, c.name); }
function memberList(r: Room) { return [...r.members.values()].map((m) => { const c = char(getProfile(m.name)); return { pid: m.pid, name: m.name, cls: c.cls, level: c.level }; }); }
function broadcastMembers(r: Room) { const list = memberList(r); for (const m of r.members.values()) tx(m, { t: "members", code: r.code, members: list, hostPid: r.host.pid, running: !!r.run }); }
function peerInfo(c: Conn) { return { t: "peer", pid: c.pid, name: c.name, setup: setupOf(c), pity: pityOf(getProfile(c.name)) }; }

function leaveRoom(c: Conn) {
  const r = c.room; if (!r) return;
  r.members.delete(c.pid!); c.room = undefined;
  if (c === r.host) { for (const m of r.members.values()) { m.room = undefined; tx(m, { t: "roomClosed" }); } rooms.delete(r.code); return; }
  tx(r.host, { t: "peerLeft", pid: c.pid });
  broadcastMembers(r);
}
const MAX_PARTY = 6;

// ------------------------------------------------------------------ websocket
const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 512 * 1024 });
wss.on("connection", (ws) => {
  let conn: Conn | null = null;
  ws.on("message", (raw) => {
    let m: any; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!conn) {
      const name = m.t === "hello" && sessions[m.token];
      if (!name) { ws.send(JSON.stringify({ t: "authFail" })); return; }
      conn = { ws, name };
      tx(conn, { t: "profile", profile: getProfile(name), name });
      return;
    }
    const c = conn, p = getProfile(c.name), r = c.room;
    switch (m.t) {
      case "op": {
        const res = applyHubOp(p, sanitizeOp(c, m.op));
        if (res && typeof res === "object") putProfile(c.name, res); else if (res) putProfile(c.name, p);
        tx(c, { t: "profile", profile: getProfile(c.name), ack: m.id, ok: !!res });
        if (r && !r.run && c !== r.host) { tx(r.host, peerInfo(c)); broadcastMembers(r); }
        if (r && c === r.host) broadcastMembers(r);
        break;
      }
      case "rerollOpts": {
        const ch = char(p);
        const it = m.target?.bag !== undefined ? ch.bag[m.target.bag] : m.target?.slot ? ch.equipment[m.target.slot as keyof typeof ch.equipment] : undefined;
        if (!it || (it.rerollIdx !== undefined && it.rerollIdx !== m.idx)) return tx(c, { t: "rerollOpts", options: [] });
        const options = rerollOptions(rng, it, m.idx | 0, 2);
        c.reroll = { key: `${it.id}:${m.idx}`, options };
        tx(c, { t: "rerollOpts", options });
        break;
      }
      case "host": {
        leaveRoom(c);
        const room: Room = { code: code(), members: new Map(), host: c, run: null, lastRun: null };
        c.room = room; c.pid = 0; room.members.set(0, c); rooms.set(room.code, room);
        tx(c, { t: "room", code: room.code, pid: 0, host: true });
        broadcastMembers(room);
        break;
      }
      case "join": {
        const room = rooms.get(String(m.code ?? "").toUpperCase());
        if (!room) return tx(c, { t: "joinFail", reason: "No room with that code." });
        if (room.members.size >= MAX_PARTY) return tx(c, { t: "joinFail", reason: "That room is full (6 players)." });
        if ([...room.members.values()].some((x) => x.name === c.name)) return tx(c, { t: "joinFail", reason: "You're already in that room." });
        leaveRoom(c);
        let pid = 1; while (room.members.has(pid)) pid++;
        c.room = room; c.pid = pid; room.members.set(pid, c);
        tx(c, { t: "room", code: room.code, pid, host: false });
        tx(room.host, peerInfo(c));
        if (room.run) room.run.members.set(pid, newMember(c));
        broadcastMembers(room);
        break;
      }
      case "leaveRoom": leaveRoom(c); tx(c, { t: "roomClosed" }); break;
      case "signal": if (r) tx(r.members.get(m.to), { t: "signal", from: c.pid, data: m.data }); break;
      // ---- host-only run messages
      case "runStart": {
        if (!r || c !== r.host) return;
        const ch = char(p);
        const kind = m.kind === "chase" ? "chase" : m.kind === "endless" ? "endless" : m.kind === "bounty" ? "bounty" : m.kind === "trial" ? "trial" : m.kind === "vault" ? "vault" : "rift";
        let tier = Math.max(1, Math.min(m.tier | 0, ch.highestTier));
        if (kind === "trial") tier = nextTrial(ch.trialBest);
        if (kind === "vault") { if ((ch.vaultKeys ?? 0) <= 0) return tx(c, { t: "runFail", reason: "No Gilded Key." }); ch.vaultKeys = (ch.vaultKeys ?? 0) - 1; putProfile(c.name, p); tier = ch.highestTier; } // always the next level up, never beyond
        const boss = kind === "chase" && m.boss === "seraph" ? "seraph" : "king";
        if (kind === "chase" && boss === "seraph") { if ((ch.feathers ?? 0) <= 0) return tx(c, { t: "runFail", reason: "No Pale Feather." }); ch.feathers = (ch.feathers ?? 0) - 1; putProfile(c.name, p); tier = Math.max(3, tier); }
        else if (kind === "chase") { if (ch.sigils <= 0) return tx(c, { t: "runFail", reason: "No Bone Sigil." }); ch.sigils--; putProfile(c.name, p); tier = Math.max(3, tier); }
        r.run = { kind, boss: kind === "chase" ? boss : undefined, tier, completed: false, inTime: false, time: 0, members: new Map() };
        for (const mem of r.members.values()) r.run.members.set(mem.pid!, newMember(mem));
        tx(c, { t: "runOk", tier, kind, profile: getProfile(c.name) });
        broadcastMembers(r);
        break;
      }
      case "drop": {
        if (!r || c !== r.host || !r.run) return;
        const mem = r.run.members.get(m.owner); if (!mem) return;
        const opts = sanitizeOpts(r.run, mem, m.opts ?? {}, rng, char(getProfile(mem.account)).equipment);
        if (!opts) return;
        tx(c, { t: "dropOk", owner: m.owner, x: m.x, y: m.y, item: mintFor(rng, mem, opts) });
        break;
      }
      case "complete": if (r && c === r.host && r.run && !r.run.completed) Object.assign(r.run, { completed: true, inTime: !!m.inTime, time: +m.time || 0 }); break;
      case "runEnd": if (r && c === r.host && r.run) { r.lastRun = r.run; r.run = null; broadcastMembers(r); } break;
      // ---- any player: bring in-run results home
      case "save": {
        const run = r ? r.run ?? r.lastRun : null;
        const mem = run?.members.get(c.pid!) ?? null;
        const problems = applySave(p, p.active, m.report as SaveReport, mem && mem.account === c.name ? mem : null, run, run?.members.size ?? 1);
        if (m.weeklyBest && m.week) { if (p.weekly.week !== m.week) p.weekly = { week: m.week, best: 0 }; if (run?.completed && run.inTime && (!p.weekly.best || run.time < p.weekly.best)) p.weekly.best = run.time; }
        if (problems.length) console.log(`[save] ${c.name}: ${problems.join("; ")}`);
        putProfile(c.name, p);
        tx(c, { t: "profile", profile: p, saved: true, problems: problems.length });
        break;
      }
    }
  });
  ws.on("close", () => { if (conn) leaveRoom(conn); });
});
function newMember(c: Conn): RunMember {
  const p = getProfile(c.name);
  return { account: c.name, pid: c.pid!, level: char(p).level, pity: pityOf(p), pending: new Map(), forced: 0, usedAnc: false, usedPri: false, drops: 0, mythic: false };
}
function sanitizeOp(c: Conn, op: HubOp): HubOp {
  // no payment provider yet: Aether packs can't be bought on the live server
  if (op?.t === "buyAether") return { t: "setting", k: "invalid", v: 0 };
  if (op?.t === "reroll") {
    // only accept a choice the server itself offered
    const p = getProfile(c.name), ch = char(p);
    const it = op.target?.bag !== undefined ? ch.bag[op.target.bag] : op.target?.slot ? ch.equipment[op.target.slot] : undefined;
    const offered = c.reroll && it && c.reroll.key === `${it.id}:${op.idx}` ? c.reroll.options : [];
    const choice = op.choice ? offered.find((o) => JSON.stringify(o) === JSON.stringify(op.choice)) ?? null : null;
    if (op.choice && !choice) return { t: "setting", k: "invalid", v: 0 };
    c.reroll = undefined;
    return { ...op, choice };
  }
  return op;
}

http.listen(PORT, () => console.log(`Rift ARPG server on port ${PORT} (saves: ${kv.name}; ${ICE.length ? "relay/STUN configured" : "no STUN/TURN: same network only"})`));
// hosts stop the server with SIGTERM on every deploy or sleep: finish writing saves first
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, async () => { await out.flush(); process.exit(0); });
