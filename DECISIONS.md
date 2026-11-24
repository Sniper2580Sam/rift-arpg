# Decisions log (build-out, 2026-11-24)

Calls made while Samuel was away. Each one is easy to reverse. **Brief conflicts** are marked ⚠ and need Samuel's OK.

## ⚠ Conflicts with the design brief

| # | Brief says | Built | Why | To match the brief |
|---|---|---|---|---|
| 1 ✅ Samuel approved keeping lockstep (2026-11-24); revisit if playtests show problems | Host sends **state**; client-side prediction for own hero, interpolation for others, ~20 ticks/s | Host runs the sim and sends **each tick's inputs** (30/s); guests replay them in the same deterministic sim. Hash check every second, automatic resync from a full snapshot. No prediction yet: your own hero reacts after one round trip (~30–60 ms on Wi-Fi). | Uses the deterministic sim the brief asks for. About 1–2 KB/s per guest instead of 50+ KB/s for state, so it suits phones on mobile data. Every guest sees exactly the host's world. | Add own-hero prediction on top (next step either way), or switch to state snapshots. |
| 2 | Offline test build: PWA with service worker and IndexedDB | One self-contained HTML file with localStorage saves | A service worker can't run from `file://` or inside the artifact page, and the flight needs a file that just opens. The save has a version number and migrations. | Add the PWA shell for hosted test builds later. |
| 3 | Backend validates by running the shared sim | The backend checks every item it receives against what it minted: unchanged, owned by that player, never claimed twice. Materials can only grow by the scrap value of real scraps. Levels, XP and rune uses are trusted within limits. | Replaying a whole run on the server is a big job. Item-level checks already block duplicated and fake loot, which is the brief's stated goal. | Replay runs on the server from the recorded inputs (lockstep makes this possible). |
| 4 | TURN relay on the backend | None. Co-op works on the same Wi-Fi or machine. | Local-only rule for this build-out: no external services. | Add a TURN server when hosting. The client accepts `?stun=` already. |

## Cuts (from the brief's "cut first" list)
- **Weekly leaderboard:** not built. The weekly seeded rift and your personal weekly best are in.
- Extra classes beyond the two in the brief: none added. Boons: kept, since they were cheap.

## Calls within the brief
- **Rift pacing (Samuel, 2026-11-24: clears took about a minute):** the guardian needs 3.2× the old progress, there are 58 packs instead of 42 with bigger packs, and ambush waves spawn just off-screen every 22–30 seconds (from 35 s), growing over time and with party size. The time limit is 7 minutes (was 5). Bot runs now reach the guardian in 2–4 minutes. A level-30 kit at T10 reaches it in about 2 minutes, where it took about 1 before. Untuned for real hands.
- **Equip slots:** the 12 slot types give 13 equip positions (two rings).
- **6 skills per class, fixed bar.** Builds come from runes (5 per skill, unlocked by use), sets and legendaries. The skills unlock at levels 1, 2, 3, 5, 7 and 9.
- **Tier scaling:** enemy HP ×1.4 per tier, damage ×1.14 per tier, legendary odds +15% per tier. Ancestral drops from T5, primal from T10. Pity: an ancestral is guaranteed after 12 rifts without one, a primal after 80. Tier 1 is eased (enemy HP ×0.85, damage ×0.75), so a fresh level-1 character can clear it.
- **Levels 1–30.** Level sync raises low-level players to the party's minimum power. They also get bonus XP until they catch up. Catch-up never lifts anyone above the host.
- **Sets:** all 6 are in now, each aimed at one skill tag. Their 6-piece bonuses multiply that skill's damage, and some also change how it behaves.
- **Mythics:** 3 for now. They drop only from the Ossuary King (6% chance, rolled by the server), and they can be ancestral or primal.
- **Chase boss, the Ossuary King:** entry uses one Bone Sigil (from guardians at T3+). He has 3 phases: fire pools, adds, and bone pylons that make him immune until broken.
- **Elites:** shielded, teleporting, mortar, molten and vortex. They get 1–3 affixes depending on tier.
- **Modifiers:** 2 or 3 per run, picked by the seed. The run code shown is the seed.
- **Boons:** pick 1 of 3 at 25%, 50% and 75% progress.
- **Pets** are cosmetic. They raise your pickup radius, and that radius grows at level 15. There's no gold in the game yet, so pets pick up items and materials.
- **Loot filter:** by rarity, with auto-scrap below the filter. Legendaries, sets and mythics are never scrapped. Filtering by slot, set or affix, and presets, are not built yet.
- **Hit-stop and pausing** only happen when nobody else shares the sim. In co-op, the bag and boon picker open without pausing.
- **Seasons:** a local "start new season" button in the test build. Gear and levels reset, pets and settings carry over, and the old profile is archived. The server has no 3-month schedule yet.
- **Live build solo:** a room of one, so the server still mints every item.
- **Server:** plain Node with `ws`. Accounts use scrypt-hashed passwords, and data is stored as JSON files in `server-data/`. Room codes are 4 letters, up to 4 players, and people can join mid-run.
- **Build flag (open item in the brief):** `OFFLINE_TEST` is a compile-time define. `npm run build` gives the offline test file. `npm run build:live` sets it to false, which removes local saves and blocks the game until you sign in to the server.

## Skill system rework (Samuel, 2026-11-24)
- ⚠ Replaces the brief's 6-slot bar (1 primary, 1 secondary, 3 utility, 1 ultimate). **Samuel's call:** 4 equipped skills, any mix of generator / core / support / ultimate, at most one ultimate. Each class gets 3–4 options per type and a resource pool: Ashknight Embers (built by hits, fades out of combat), Gloomstalker Focus (steady regen), new Stormcaller Mana (big pool, slow regen).
- Resource gear (affixes, legendaries, set bonuses) is part of the chase, so builds can skip a generator.
- Draft skill list: https://claude.ai/artifact/YUPZdMQxC5sKxrMwdLuYxh
- **Stormcaller (slice 1):** 13 skills across the 4 types, Mana (150, +8/s). Default bar: Spark, Chain Lightning, Blink, Arcane Orb. Damage skills are tagged area or single target. The new "Area of effect" affix grows the radius of area skills only (capped at +100%). Runes for the new skills come in a later slice. A fresh mage bot clears Tier 1 in about the same time as the other classes (seed-dependent).
- **Bigger hero on phones:** touch screens zoom in about a third more (pixel scale divisor 165 instead of 210). Desktop is unchanged.

## Cosmetics (Samuel, 2026-11-24)
- New **Looks** tab: 6 armour sets, 5 wings, 5 weapons and 5 pet skins, all drawn in code. Each one has its own shape, not just a colour: armour adds horns, antlers, crowns, spikes or skull pauldrons, a cape on some, and an aura (snow, embers, leaves, sparkles, wisps, soul-fire). Wings come in 5 shapes (bat, feathered with a halo, flame, floating shards, ice). Weapons change shape per class: sword becomes scythe, cleaver, crystal blade or bone club; bows and staff tops change too. Pet skins add a crown, horns or ice spikes, a trail, or a ghost float. Other players see them in co-op. They never touch the sim's numbers.
- One look per account, shared by all classes (like pets). Each armour skin recolours every class in its own way.
- **All cosmetics are free in this test build.** How they're earned or sold (the brief's cosmetics-only monetisation) is a later slice: a store, season rewards, or achievements. The server already refuses unknown cosmetic ids, so adding ownership later is one check.

## Runes for every skill (Samuel, 2026-11-24)
- All 40 skills across the 3 classes now have 5 runes, unlocked by using the skill (first one free; later ones at 30/80/160/300 uses for generators and core, 20/50/100/180 for supports, 10/25/50/90 for ultimates).
- Ashknight and Gloomstalker already use the new system (4 free slots, generator/core/support/ultimate, Embers and Focus). Each has 3–4 options per type, except Gloomstalker core (3).
- Rune patterns: element swaps (fire, cold, lightning), area or single-target conversions (e.g. Spark "Fork" and Bone Shot "Splinter" become area skills, so the area affix applies), resource builders or cost cuts, and vulnerability or control.
- Lava pools, rain and storms can now apply a rune's "take more damage" effect.
- Rune numbers are untuned. A test runs every rune for 12 seconds to check none is broken.

## Class-aligned drops (Samuel, 2026-11-24)
- Legendaries, set pieces and "+% tag damage" affixes are weighted towards the class you're playing: full weight if your class's skills use that tag, about a third if only a rune adds it, almost none otherwise. In a test, 89–96% of legendary/set drops were for tags the class's skills use.
- Weapon and offhand base names match the class (swords and shields, bows and quivers, staves and orbs).
- Two Stormcaller sets added: Stormweaver (lightning) and Arcanist (arcane). Their numbers are untuned, like the other sets.
- Scrap materials are currently only used for Mystic rerolls. More uses are an open item.

## Co-op hosting (Samuel chose "free cloud host", 2026-11-24)
- Server deploys to Render's free tier from `render.yaml` (region Singapore, closest to Perth). Saves move to Upstash Redis when its two env vars are set; local play still uses JSON files.
- STUN and TURN come from the server's settings (`/api/ice`). This resolves brief conflict 4 once a TURN service is added. Steps for Samuel: DEPLOY.md.
- Free-tier trade-off: the server sleeps after about 15 idle minutes, and the first join after that takes about a minute.

## Direct co-op in the test builds (Samuel chose "direct join now, server later", 2026-11-24)
- The normal site has Host / Join by 4-letter room code on the Play tab, with a name and no accounts. It uses the free public PeerJS matchmaking server and PeerJS's free relay for hard networks. Room ids are prefixed so other apps can't collide with them.
- The host's device runs the game, and the others send their moves to it (the same lockstep as before). Items are made inside the shared game, and each player saves their own progress on their own device. **No anti-cheat in this mode** (Samuel: fine at this stage).
- ⚠ This departs from the brief ("backend mints and saves every item") for test builds only. The hosted server path (render.yaml, DEPLOY.md) stays for the real game.
- If the host switches apps or locks their phone, Safari pauses the game for everyone.

## Rift pacing (2026-11-24)
- Samuel cleared maps in about 1 minute. Rifts now have denser and bigger packs, need more progress (320), and give 7 minutes. Ambush waves of 5+ enemies spawn around the player every 22–30 s from 35 s on, with more per minute. In bot tests the guardian appears at about 2–4 minutes.

## Lock, storage, arsenal (2026-11-24)
- ★ Lock on any item: it can't be scrapped (single or bulk), and merges never use it up. Lock is ignored by the anti-cheat item check.
- Storage: 60 slots shared by all characters, hub only. Arsenal: 5 saved builds per character (gear, skills, runes). Loading a build pulls items from equipment, bag and storage. Items it takes off go to the bag, or to storage if the bag is full.
- Room code has Copy and Paste buttons.

## + merging (Samuel chose "same named item, costs materials", 2026-11-24)
- Three copies of the same legendary (or the same set piece in the same slot) at +N merge into one +N+1, up to +5. The kept item is the one you selected, with its own rolls. The other two must be unlocked and can come from the bag or storage.
- Each + level scales base damage, armor and affix values by 10% (+5 = +50%). Legendary powers are not scaled.
- Cost in materials: 30 / 60 / 120 / 240 / 480 for +1 … +5. This gives scrap a second use.
- 15% of legendary and set drops arrive at +1. This is decided from the item id, so it doesn't shift the random rolls.
- ⚠ Balance: +5 on a full kit is a big power jump. The numbers are a first pass, and merging only happens in the hub.
