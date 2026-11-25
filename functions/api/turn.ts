// Cloudflare Pages Function: hands the game short-lived credentials for Cloudflare's TURN relay, so co-op works
// when two phones can't reach each other directly (common on mobile data). The relay key stays on Cloudflare.
// Set TURN_KEY_ID and TURN_KEY_API_TOKEN in the Pages project's settings (Settings → Variables and Secrets).
interface Env { TURN_KEY_ID?: string; TURN_KEY_API_TOKEN?: string }
const STUN = [{ urls: "stun:stun.cloudflare.com:3478" }];

export const onRequestGet = async ({ env }: { env: Env }): Promise<Response> => {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ iceServers: STUN, relay: false, why: "no key set" });
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials`;
  const init = { method: "POST", headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ ttl: 6 * 3600 }) };
  try {
    // newer endpoint returns a ready list; the older one returns a single entry
    let r = await fetch(`${base}/generate-ice-servers`, init);
    if (!r.ok) r = await fetch(`${base}/generate`, init);
    if (!r.ok) return json({ iceServers: STUN, relay: false, why: `relay api ${r.status}` });
    const d: any = await r.json();
    const list = Array.isArray(d.iceServers) ? d.iceServers : d.iceServers ? [d.iceServers] : [];
    return json({ iceServers: [...STUN, ...list], relay: list.length > 0 });
  } catch (e) {
    return json({ iceServers: STUN, relay: false, why: "relay api unreachable" });
  }
};
