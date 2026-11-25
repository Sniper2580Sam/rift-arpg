// GET /api/me: tells the game cloud saves exist here, and whether this device is signed in.
import { Env, json, account } from "../../src/cf/account";

export const onRequestGet = async ({ env, request }: { env: Env; request: Request }) =>
  json({ cloud: !!(env.SESSION_KEY && env.SAVES), signedIn: !!(await account(env, request)) });
