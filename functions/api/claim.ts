// POST /api/claim {device, force}: hold the save on this device (heartbeat every ~45 s while playing).
// Refused (423) while another device holds it; force = "Take over".
import { Env, json, account, claim } from "../../src/cf/account";

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  const id = await account(env, request);
  if (!id) return json({ error: "signed out" }, 401);
  const b: any = await request.json().catch(() => null);
  if (!b || typeof b.device !== "string" || b.device.length > 40) return json({ error: "bad request" }, 400);
  const r = await claim(env, id, b.device, !!b.force);
  return json(r, r.ok ? 200 : 423);
};
