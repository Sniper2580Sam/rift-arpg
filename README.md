# Riftbound

Milestones 1–6 build-out. See TEST.md (what to try) and DECISIONS.md (calls made, brief conflicts).

- Test build (`OFFLINE_TEST=true`): `dist/index.html`, one offline file, solo, local saves.
- Live build: `npm run server` builds `dist/index.live.html` and starts the local backend on http://localhost:8787 (sign-in, saves, item minting, co-op rooms over WebRTC).

## Run
    npm install
    npm run build        # -> dist/index.html (one self-contained file; open it in a browser)
    npm run serve        # build + serve on http://localhost:8080
    npm test             # determinism, mint spread, bot pacing, every legendary/set/mythic, server item checks
    npm run server       # live build + local backend (accounts, saves, minting, co-op signalling)
    npm run typecheck    # sim is checked with NO DOM lib, so it can't touch the browser
    node scripts/build.mjs --live   # OFFLINE_TEST=false: game refuses to run without sign-in

## Layout
- `data/` skills, enemies, rift, affixes, item bases/rarities, 10 legendaries (JSON)
- `src/sim/` pure deterministic sim: seeded RNG in state, fixed 30 Hz tick, only + - * / sqrt in gameplay math,
  inputs in / events out, `stateHash()` for desync checks. `mintItem()` is the function the backend will own.
- `src/server/` local Node backend; `ledger.ts` holds the item-authority rules (unit tested)
- `src/shared/ops.ts` hub operations run on both the client and the server
- `src/client/net.ts` sign-in, server socket, WebRTC data channels; co-op lockstep lives in `main.ts`
- `src/client/` canvas renderer (code-drawn pixel sprites), game feel, synth audio, input (mouse/keys/touch), DOM UI

## Controls
Desktop: WASD, LMB Cleave, RMB/E Ember Lance, Space Ash Dash, Q Cinderlings, I bag, M mute.
Touch: left thumb stick, auto-aim, buttons on the right.
