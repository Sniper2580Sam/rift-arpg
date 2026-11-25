// POST /api/auth {access_token}: sign in with a Google token once; the game stays signed in for a year (cookie).
// DELETE /api/auth: sign out.
import { Env, json, googleSub, sessionCookie, clearCookie } from "../../src/cf/account";

export const onRequestPost = async ({ env, request }: { env: Env; request: Request }) => {
  if (!env.SESSION_KEY || !env.SAVES) return json({ error: "cloud saves aren't set up" }, 503);
  const body: any = await request.json().catch(() => ({}));
  const sub = typeof body.access_token === "string" ? await googleSub(body.access_token) : null;
  if (!sub) return json({ error: "Google sign-in didn't check out" }, 401);
  return json({ ok: true }, 200, { "set-cookie": await sessionCookie(env, sub) });
};
export const onRequestDelete = async () => json({ ok: true }, 200, { "set-cookie": clearCookie });
