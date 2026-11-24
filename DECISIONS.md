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

## Slot upgrades replace + merging (Samuel, 2026-11-24)
- Merging copies was clunky. Players chase better rolls and different affixes, so keeping copies around clogged the bag. Merging is removed.
- Scrapping a legendary or set item gives 1 **Rift Shard** (mythic 5; ancestral ×2, primal ×5) as well as materials.
- Each character upgrades **gear slots** +1…+5 with materials and shards: 30/1, 60/2, 120/4, 240/8, 480/16. Each level gives the item worn there +10% base stats and affixes. Legendary powers are not scaled. Swapping items keeps the slot level.
- **Masterwork crit** at +5 (Samuel: "like Diablo 4 masterworking"): the slot rolls one affix type, and that affix gets +50% on anything worn there. Rerolling costs 100 materials and 5 shards. Rolls are deterministic from the slot and the roll count, so client and server agree.
- Old saves: an item's + moves onto the slot it was worn in.
- ⚠ Balance: a full +5 kit is +50% stats before crits. Shard income is ~1 per legendary/set drop, so maxing all 13 slots takes ~400 shards.
## Font, boon button, density (2026-11-24)
- Font changed from Pixelify Sans (its 5 looked like an S) to Jersey 10, which is also pixel-style and OFL-licensed, at 130% size. Faux bold is off, because it smeared the pixels.
- Boons no longer pop up mid-fight. A pulsing "★ Boon" button appears at the top right, and solo play pauses only while the picker is open. "Later" closes the picker. Boons earned while one is waiting stack up (×2, ×3).
- Density up again: 80 packs (spacing 80), packs about 35% bigger, ambushes every 16–22 s starting with 6 enemies, and progress needed is 420. Tiers 1 and 2 use 55% and 80% density (and progress) so fresh characters aren't swamped.

## Bonewright, the 4th class (Samuel chose "new class, full build-out", 2026-11-24)
- Asked for by Samuel's wife: a builder with a "panic button" ultimate. The theme is an original bone engineer, not a mech.
- 13 skills, each with 5 runes. Resource: Marrow (100, refills 11/s).
  - Generators: Rivet Shot (weak ranged) and Bone Mallet (melee; hits add time to nearby constructs).
  - Constructs: Bone Turret (up to 2), Marrow Mortar, War Totem (+25% damage aura), Mending Lantern (heals 4%/s), Spike Ward, and Overcharge (boosts constructs).
  - Other skills: Scrap Burst (nova), Recoil Vault (dash), Bone Plating (party armor).
  - Ultimates: Ossuary Colossus, the panic button at level 6. For 14 s you heal 50%, take 60% less damage, deal 40% more, and your basic attack becomes a ground slam. Bone Battery at level 12 rings you with 6 turrets.
- Constructs are timed and can't be attacked. The Effigy rune taunts enemies near the totem.
- Two new sets: Gravewright's Toolkit (constructs) and Colossus Plate (Colossus uptime). Four new legendaries: Foreman's Grips, Marrow Engine, Ossuary Blueprint and Colossus Core. Existing summon legendaries also work on constructs.
- ⚠ Balance: first pass from bot runs only. The fresh T1 clear time matches the other classes. The Colossus is deliberately strong.

## Maps (2026-11-24)
- data/maps.json holds every map: layout (cave, linear, open, rooms), size, colour theme, floor decoration and pick weight.
- The rift code picks the map with a weighted hash, so the same code is always the same map (co-op and weekly stay in sync).
- Normal maps: Sunken Ossuary (cave), Long Catacombs (linear), Flooded Halls (open), Rot Gardens (rooms). Pack count scales with open floor (0.6–1.4×).
- Easter eggs: Gilded Vault (~1.4% of codes: half the enemies, 6× drops, 3× legendary weight) and Good Luck (~0.7%: 10–50× density, progress needed scales with density/5).
- Good Luck caps live enemies at 1,200 so phones keep up (about 4 ms per tick in node; enemy separation switches to a spatial grid above 120 enemies).
- Mana/resource bar now uses the real max (base + res_max affixes) and shows "current / max".

## Difficulty and feedback batch (Samuel chose "Tougher, smarter enemies", 2026-11-24)
- Enemy damage grows 20% per tier (was 14%), and base hits are harder (ghoul 9, archer 12, brute 30, guardian 20, king 26). T1 starts at 85% damage.
- Elites: 24% of packs (was 18%), +50% damage (was +30%), and one more affix every 3 tiers (up to 4). New affixes: Frozen (frost bombs that slow you), Fast (+50% speed), Thorns (hurts whoever hits it).
- Death penalty: the respawn wait is 4 s, then 8, 12, 16, up to 20 s for each death in the same rift. The rift timer keeps running.
- Boons that only boost one tag (Legion: minions, Splinters: projectiles) are only offered if one of your skills has that tag.
- Picking up an item for an empty gear slot equips it straight away.
- Loot never lands in walls: drops snap to the nearest floor tile.
- Premium skill effects (data/vfx.json): 8 styles, 2 per skill. They re-colour projectiles, casts, swings, blasts and chains. They're cosmetic only and free in the test build, like the other cosmetics.

## Google sign-in sync (Samuel chose "your own Google Drive", 2026-11-24)
- The phone app (GitHub Pages) has Settings → Google sync. Signing in stores the save in the player's own Drive app folder (scope drive.appdata). Every local save is mirrored there a few seconds later. On a new device, the newer save wins.
- No server is involved, so the brief's "backend saves everything" still applies to the real game; when the server goes live, Google becomes a login there.
- Google access tokens last an hour, and Google needs a tap to refresh one, so the game reconnects on the next tap. It's hidden in the artifact (which has its own Claude-account sync) and in the offline file.
- Untested on a real iPhone home-screen app: Google's sign-in window may behave differently there.

## Tier skips and kiting pressure (2026-11-24)
- Samuel (level 12, tier 7, mage) still found it easy. In bot tests a stand-still bot struggles at T7, so the gap is kiting.
- Fast clears skip tiers: under 3 min unlocks +3, under 5 min +2, in time +1 (`tierJumps` in rift.json; the ledger allows the same jump).
- Enemies move 3% faster per tier (up to +40%).
- New Bone Hound (fast, fragile pack hunter, speed 104 vs heroes' ~80) in packs from tier 4.
- Maps: the Flooded Cavern is now a round, irregular cavern instead of a box. New ring map, the Hollow Pit, loops around a central chasm. Normal maps now have about equal odds.
