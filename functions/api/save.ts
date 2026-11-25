// GET /api/save: the account's save, its revision and who holds the lock.
// PUT /api/save {save, base, device}: write it, only from the device holding the lock and only on top of revision `base`.
import { Env, json, account, readSave, readLock, writeSave, holds, claim, MAX_SAVE } from "../../src/cf/account";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) => {
  const id = await account(env, request);
  if (!id) return json({ error: "signed out" }, 401);
  const [s, lock] = await Promise.all([readSave(env, id), readLock(env, id)]);
  return json({ save: s.save, rev: s.rev, lock, now: Date.now() });
};

export const onRequestPut = async ({ env, request }: { env: Env; request: Request }) => {
  const id = await account(env, request);
  if (!id) return json({ error: "signed out" }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SAVE) return json({ error: "save too big" }, 413);
  const b: any = await request.json().catch(() => null);
  if (!b || typeof b.device !== "string" || typeof b.base !== "number" || !b.save || typeof b.save !== "object") return json({ error: "bad request" }, 400);
  if (!(await holds(env, id, b.device))) return json({ error: "taken over", lock: await readLock(env, id) }, 423);
  const w = await writeSave(env, id, b.save, b.base);
  if (!w.ok) return json({ error: "newer save in the cloud", rev: w.rev, save: w.save }, 409);
  await claim(env, id, b.device, false); // a save counts as a heartbeat
  return json({ ok: true, rev: w.rev });
};
