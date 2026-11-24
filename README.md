# Rift ARPG (working title) — Milestone 1 solo slice

Single-player test build (`OFFLINE_TEST=true`). No networking, accounts or backend yet.

## Run
    npm install
    npm run build        # -> dist/index.html (one self-contained file; open it in a browser)
    npm run serve        # build + serve on http://localhost:8080
    npm test             # determinism check, item mint spread, bot pacing, every legendary
    npm run typecheck    # sim is checked with NO DOM lib, so it can't touch the browser
    node scripts/build.mjs --live   # OFFLINE_TEST=false: game refuses to run without sign-in

## Layout
- `data/` skills, enemies, rift, affixes, item bases/rarities, 10 legendaries (JSON)
- `src/sim/` pure deterministic sim: seeded RNG in state, fixed 30 Hz tick, only + - * / sqrt in gameplay math,
  inputs in / events out, `stateHash()` for desync checks. `mintItem()` is the function the backend will own.
- `src/client/` canvas renderer (code-drawn pixel sprites), game feel, synth audio, input (mouse/keys/touch), DOM UI

## Controls
Desktop: WASD, LMB Cleave, RMB/E Ember Lance, Space Ash Dash, Q Cinderlings, I bag, M mute.
Touch: left thumb stick, auto-aim, buttons on the right.
