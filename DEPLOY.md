# Putting co-op online (free)

The co-op server runs on **Render** (free web service). Saves go to **Upstash Redis** (free database), because Render's free disk is wiped on every restart. Friends on other networks connect through a **TURN relay** (free tier, optional but recommended).

## 1. Database (Upstash), about 3 minutes
1. Sign up at https://upstash.com (Google or GitHub sign-in works).
2. Create a **Redis** database. Pick the region closest to Singapore (`ap-southeast-1`).
3. On the database page, find the **REST API** section and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## 2. Relay (TURN), about 3 minutes, optional
Without it, co-op usually works on the same Wi-Fi but often fails between a phone on mobile data and someone at home.
1. Sign up for a free TURN service, for example https://www.metered.ca (free plan).
2. Create TURN credentials and copy the server URLs (comma-separated), the username and the password.

## 3. Server (Render), about 5 minutes
1. Sign up at https://render.com with your GitHub account.
2. **New → Blueprint**, pick the `rift-arpg` repo. Render reads `render.yaml`.
3. Paste the values from steps 1 and 2 when it asks (`TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` can be left empty).
4. Apply. The first build takes a few minutes. Your link is `https://rift-arpg-XXXX.onrender.com`.

## Good to know
- The free server sleeps after about 15 minutes without players. The first visit after that takes about a minute to wake it.
- Every push to `main` redeploys it automatically. Saves survive, because they're in the database.
- Accounts are name + password, stored hashed. Anyone with the link can make an account.
- Local play is unchanged: `npm run server` still uses files in `server-data/`.
