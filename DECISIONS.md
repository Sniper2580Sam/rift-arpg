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
- **Server:** plain Node with `ws`. Accounts use scrypt-hashed passwords, and data is stored as JSON files in `server-data/`. Room codes are 4 letters, up to 6 players (Samuel raised it from the brief's 4 on 2026-11-24), and people can join mid-run.
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

## Endless mode (Samuel's idea, 2026-11-24)
- Play tab → Endless, starting at the chosen tier. A round arena (the Endless Ossuary). Waves of 8+ enemies come from the edges, with a 3 s breather between waves.
- Each cleared wave raises the difficulty level by 1, or by 2 or 3 for a clear under 20 s or under 10 s. Per level: enemy HP ×1.06, damage ×1.04, a bigger wave (up to 70), and every 4 levels harder pack types (Bone Hounds and so on). Every 5th wave an elite brute leads, and a boon is offered. A wave that drags past 60 s lets the next one in anyway.
- The party shares 3 lives (+1 per extra player). When they're gone, everyone stands up and a chest drops: 2 items + 1 per 3 waves (max 16), with 1 guaranteed legendary/set per 5 waves and a Bone Sigil chance from wave 15. Normal drops during the run are ×0.35. Best wave is saved per character.
- Untuned: bots die around wave 5–6, but they stand still. Watch how far real play gets.

## Hideout, shop and cosmetic unlocks (2026-11-24)
- Home is a walkable hideout (sim kind "hideout"). Stations open menu tabs (Blacksmith/Stash → Gear, Rift Board → Play, Shrine → Skills, Wardrobe → Looks, Shop, Decorate). Portals start Rift, Endless and the Ossuary King.
- Co-op: in a direct room the host's hideout is a shared sim, so joining puts guests in it and portals take the whole party. Only the host opens portals and decorates, and only when alone (decorating changes the room).
- Themes: Old Crypt and Ruined Camp free (basic), Gilded Throne Hall and Astral Sanctum premium (bigger rooms, marble or starfield floors, carpets, braziers, aurora, motes). Up to 40 decorations, 8 free and 8 premium.
- Every premium item has a shop key (cos:/theme:/decor:/fx:). The Shop tab lists them at price 0; "buy" records ownership in profile.owned. Items worn before this change were grandfathered in.
- Cosmetics: colours (dyes) are free and recolour the base armour. Earned armour: Riftbreaker (clear tier 10), Kingslayer (slay the Ossuary King), Vanguard (Endless wave 20). Each class has one premium class-only armour. Everything else is premium.

## Sync conflicts, projectile stacking, turret boons, party size (2026-11-24)
- Rooms hold up to 6 players (Samuel's call; the brief now says 1–6).
- Google Drive sync remembers the save both sides last agreed on. If only one side changed, it wins quietly. If both changed (or a device with its own progress signs in), a card shows both saves and the player picks which to keep (tap twice to confirm). Before each upload it checks Drive's file version, so a device left open can't silently overwrite progress made on another. It also re-checks when the game returns to the front and when you return to the hideout.
- Extra projectiles: projectiles fired together are one volley. The first hit on an enemy does full damage, and further hits from the same volley do 30% (rift.json volleyRepeat). Extra projectiles now widen coverage instead of multiplying single-target damage.
- Bonewright constructs: "+N projectiles" adds shots per turret volley, and "+N minions" raises how many can stand at once (one per cast). The Bone Battery ring grows instead.
- Hideout station and portal names are drawn at screen resolution (they were blurry when scaled up).
- Fast moves (dashes, blinks, knockback) are split into small steps, so nothing can skip into a wall; anyone who still ends up inside a wall is moved to the nearest floor.
- Life per Hit heals at most 4% of max life per second (rift.json lifeOnHitCap). Volley's 7 piercing arrows could land 20+ hits per cast, which healed more than a full health bar.
- Runs started from the menu turn controls back on (they stayed off after the menu paused input).
- The minimap keeps the map's shape, so enemy dots line up on the wide Catacombs.

## Content pass (2026-11-24, Samuel: "do all of 1-6")
- **Guardians:** four, one picked per rift from its seed (data/guardians.json). Hollow Warden (novas, charges, raises ghouls). Drowned Matron (tier 2+, slowing mire pools under you, raises hounds). Bell Reaver (tier 3+, three charges in a row, re-aiming each time, fire grid). Ashen Scribe (tier 4+, backs away, blinks to range, spiral shard rings). Each has its own colours, size and a tip on the spawn banner. A sim test checks every guardian uses its own attacks and can be beaten.
- **Paragon:** at level 30, XP keeps filling paragon levels (9,000 XP each, +2% per level; rift.json paragon). Each gives a point for Power (+1% damage), Vitality (+1% life), Toughness (−0.5% damage taken) or Haste (+0.5% cooldown and move speed), capped at 50/50/50/40 points. Respec is free. Spent at the Skill Shrine (Skills tab). The XP cost is a first guess.
- **New enemies** (new packs in rift.json): Bone Hexer (tier 2+, stays back and curses the ground under you: a delayed blast you can step out of). Gorehorn (tier 3+, shows a red line, then charges along it; hitting a wall stuns it). Shieldbearer (tier 5+, a tower shield blocks 75% of damage from the front and turns slowly, so flank it; comes with archers).
- **Second chase boss, the Pale Seraph** (rift.json `seraph`): a ranged duellist who backs away between attacks. Phase 1 spiral shard rings, blinks and fire grids. Phase 2 (below 66%) she calls a choir of Shieldbearers, Hexers and archers. Phase 3 (below 33%) is Judgement: she rises out of reach for 9 s and rains blasts on everyone plus slow shard rings, then falls stunned for 5 s. The King is a damage check (pylons); the Seraph is a survival check. She has 15% more life than the King.
  - **Key:** a Pale Feather. Every King kill leaves one, and guardians drop them at tier 8+ (12%). Spent at the new "Pale Seraph" hideout portal or the hub button. The live server checks and spends feathers like sigils.
  - **Loot:** 5 items (+2 in time). Two are always ancestral (on top of a mythic, if one rolls; 10% chance). The server allows three forced items for her instead of two.
  - **Cosmetic:** Wings of Judgement (earned, first Seraph kill). The premium "Seraph wings" stay in the shop.
  - In the sim she is the King's enemy kind with `variant: "seraph"`, so all the boss rules (intro, immunity, knockback, separation) apply without new special cases.
- **Feats (achievements)** (data/achievements.json, Journey tab, new "Hall of Feats" station in the hideout): 19 account-wide goals across rifts, tiers, kills, elites, a flawless tier 8+ clear, both chase bosses, Endless waves, mythic/ancestral finds, paragon, levelling all four heroes and a six-player clear. Ten unlock a Wardrobe item. The four existing earned items (Riftbreaker, Kingslayer, Endless Vanguard, Wings of Judgement) now come from feats, plus six new ones: Abyssal dye (tier 20), Bloodletter weapon (10,000 kills), Hunter's Mark pet skin (250 elites), Wardbreaker weapon (flawless tier 8+), Mythic gold dye (find a mythic) and Ascendant wings (paragon 50).
  - Lifetime counters live on the profile (`life`) and are topped up from the heroes, so old saves get credit straight away. Feats, counters, purchases and the hideout now carry over a season reset (purchases and the hideout were lost before; fixed).
  - Known gap: the live (server) build doesn't record the run counters yet (kills, elites, flawless, finds), so those feats only advance in the solo and direct co-op builds. Tier, boss, wave, paragon and level feats work everywhere.
- **Season journey** (data/season.json, top of the Journey tab): "Bone and Feather", four chapters of three tasks each (levels, rifts, kills, tiers, finds, elites, both chase bosses, Endless waves, paragon). Finishing a chapter unlocks its reward for good: chapter 2 Bonefire dye, chapter 3 Bonefire pet skin, chapter 4 Bonefire Regalia armour. It's free for everyone (no paid track), in line with cosmetics-only.
  - Counters are this season's only (`profile.journey`, plus this season's heroes) and start over with a new season. Done chapters are stored with the feats, so rewards stay after the season ends.
  - A new season reuses the same journey until a new season.json ships. Same live-build gap as feats.
- **Feat counters on the live server** (fixes the gap above): the server now adds each run's counters once per player per run (`countRun` in ledger.ts). Legendary, mythic and ancestral finds come from the items the server itself minted for that player. Kills and elites come from the player's report, clamped to 25 kills and 1.5 elites a second of run time. Flawless needs a reported 0 deaths, and old clients count as not flawless. Party size comes from the room. The server also records King and Seraph kills and the best Endless wave on the hero (the wave is capped at one per 4 s), and writes newly done feats and journey chapters into the profile.
- **Slower general mobs** (Samuel, 2026-11-24: "with the stronger enemies, reduce the speed of the general mobs; keep the dogs as fast weaker enemies"): about 15% slower. Ghoul 60→50, archer 44→38, brute 30→26, hexer 40→34, gorehorn 46→40 (its charge is unchanged), shieldbearer 34→30. Hounds stay at 104 with low life and damage. Bosses are unchanged.

## Endgame activities (2026-11-25, Samuel: "5-6 end game activities each with unique rewards that upgrade your character", "do all of these")
- **Rift Gems** (data/gems.json, top of the Gear tab): six gems. Bane of the Mighty (elite and boss damage), Ember Heart (damage), Stormlink (chance to arc lightning to 3 enemies), Bulwark Stone (less damage taken below half life, capped at 60%), Gale Shard (move speed and cooldown reduction) and Bloodstone (heal on kill). Each hero sockets 3. Guardians from tier 5 drop one you don't have (the first is certain, then 30%). A timed clear levels every socketed gem by 1 (+1 per 5 tiers above 5), up to 3× the tier and at most 50. The server clamps levels to one clear's worth and allows one new gem per run. Gems belong to the hero, so a new season resets them like gear.
- **Aether, the premium currency** (data/shop.json, Samuel: "add costs to all premium content… purchasable as well as earnable from really hard content or season achievements"). It buys cosmetics only, never power. Prices: armour 1,200 (class-only armour 960), wings 1,000, weapons 700, pet skins 500, themes 1,500, decor 150, skill effects 250. Earned from feats (11 of them pay 100 to 500 once), season journey chapters (100/150/200/300), timed tier 15+ clears (10, +2 per tier above 15), each Seraph kill (20) and Endless wave 30+ (2 per wave past 29). Packs of 500/1,100/2,400 are free in the test build. The live server refuses packs until a payment provider is added. It carries over a season reset. Items owned from the free test period stay owned.
- **Shop preview:** armour, wings, weapons and pet skins have a Preview button that tries the look on your hero in a small sticky preview (a bat stands in if you have no pet). Themes and skill effects show colour swatches, and decorations show their sprite. Buying takes two taps and equips a previewed look straight away.
- **Hideout interact:** next to a station or portal, the main attack button uses it (press, not hold, so walking up while attacking doesn't fire it). The top button still works.
- **Bounties** (new hideout portal, rift.json `bounty`): a 10-minute run on a normal rift map with four tasks: slay the Gravelord (a tough elite brute), break 3 bone totems, hold a shrine for 20 s while the dead attack it, and slay 60 enemies. Gold markers on the minimap. Finishing all four drops a cache (a guaranteed legendary or set item plus 2 more) and gives 3 Relic Dust (+1 per 5 tiers).
- **Reliquary** (Gear tab): spend 2 Relic Dust and a legendary from your bag (destroyed) to keep its power. Wear one power per slot, on top of your gear: weapon (from the start), armour (after 5 bounties) and jewellery (after 15). A power you already wear on an item doesn't stack. Mythics can't be extracted. Extracted powers and dust reset with a new season, like gear.
- **Boss trophies** (rift.json `trophies`, Gear tab): each King kill gives 3 King's Shards (+2 if in time). 10 shards craft the set piece you choose at your level. The result is seeded from the hero's craft count, so the client and the live server make the same item. Each Seraph kill gives a Hallow, which makes a legendary or set item ancestral (+25% to its numbers). Trophies are account-wide and reset with the season.
- **Echo Cores** (rift.json `echo`, Gear tab): Endless runs that reach wave 10 pay 1 core, +1 per 5 more waves. A core adds an echo to a worn item: +1.5% damage and +1.5% life each, up to 5 per item. Echoes cost 1, 2, 3, 4 and 5 cores, so 15 per item fully echoed. They stay on the item. A fully echoed set of 13 items is about +97% damage and life, so this is a long-term sink.

## 2026-11-24: Skill effect previews in the Shop
Every skill effect in the Shop has a Preview button. The preview box shows your hero facing a target dummy, casting the skill's shape on a loop in that style's colours: a bolt for projectiles, an arc for melee, a trail for dashes, rings for shouts and novas, a primed circle for traps, and a rune for summons and builds (src/client/fxpreview.ts). It is a sketch of the shape, not the in-run effect itself. Tapping a locked effect in Looks opens the Shop with that effect already playing.

## 2026-11-24: Trials and class Talent trees (endgame activity 6)
- **Trials** (hideout portal and Play tab): 5 waves in the Endless arena within 2 minutes. Trial level N uses tier N enemies at Endless difficulty level 1.5×N. No loot drops (XP ×1.5). You always face the next level up, to 30; the live server picks the level itself.
- **Talent points**: one per new Trial level passed in time (`trialBest`), max 30. The server raises `trialBest` itself from what it saw, one level at a time.
- **Talent trees** (data/talents.json): each class has 3 branches with 4 nodes of 3 ranks each (36 ranks, 30 points, so you choose). Rows open at 0/3/6/9 points spent in the branch. You can't remove a point that a higher row relies on. Respec is free. Talents use the normal stat keys plus hpPct/armorPct/takenPct/regenPct and tag:<tag>. They are shown under Skills.
- Balance is a first guess: a geared bot clears Trial 1 in about 1 minute. The level curve past 15 needs playtesting.

## 2026-11-24: Gilded Imp and the Gilded Vault (endgame activity 7)
- **Gilded Imp**: 30% of rifts from tier 2 hide one, placed at least 500 px from the start. When a hero comes near, it runs away, weaving, for 12 s, then escapes. If you catch it, every player gets 4 items (the first is legendary or set) and a **Gilded Key**. It gives no rift progress.
- **Gilded Vault** (hideout portal or Play tab, costs 1 key): 90 s on the vault map (6× drops) at your highest tier, with no guardian. It pays **2 Gilded Chisels** when it seals.
- **Gilded Chisel** (Gear tab): once per item, either add one new affix or re-roll the two weakest affixes (never the enchanted one). It is seeded from the item id, so the client and server agree.
- The Vault is a key you spend from the hideout, not a portal that opens mid-rift. Switching maps mid-run would need a new co-op hand-off.
- Live server: keys are clamped to +1 per save, like feathers. The server can't prove an imp kill, which is the same trust level as feathers.

## 2026-11-24: Abyssal tiers 16–30 (endgame activity 8)
- The tier cap went from 20 to 30. Enemy life grows ×1.4 per tier up to 20 (×598 at T20), then ×1.2 per tier (×3,700 at T30). Damage grows ×1.2 per tier, then ×1.08. One shared helper (`tierHpMult`/`tierDmgMult`) is used by the sim, bounty totems and the tier picker.
- **Abyssal tiers (16+)** get a 4th rift modifier and ×1.5 elite packs. Ancestral odds cap at 40% instead of 25%, and primal odds rise 25% per Abyssal tier. Ancestral and primal odds come from `lootChances` in both the sim and the server.
- The gem level cap went from 50 to 75, so gems keep levelling through tier 25.
- This is meant to absorb the new power sources: gems, the reliquary, echoes, talents, chisels and paragon. The numbers are first guesses and need a playtest with a fully geared hero.

## 2026-11-25: Samuel's playtest list, batch 1 (quick fixes)
- **Black screen after leaving a rift early:** endRun called goHub, which started the hideout run, and then cleared `sim`. It now clears the run state before going home.
- **Enemy speed down about 25%** (hounds about 15%, so they stay the fast ones). Tier speed scaling is now +1.5% per tier, capped at ×1.2. It was +3% capped at ×1.4, which was the main cause of swarming at high tiers.
- **Elite thorns:** at most once a second, 12% of the elite's hit, capped at 4% of your life. It was every 0.5 s at 35% with no cap.
- **Ossuary King bones:** each has 2% of the King's life (was 4%). If you're too slow, he enrages instead of healing 20% and repeating the phase.
- **Bag:** a "Scrap all (not ★ locked)" button. **Loot filter:** "Only ancestral, primal, mythic" and "Only primal and mythic".
- **Settings:** "Life over head" draws a small bar over each hero. **Skills:** tags show as coloured chips.
- **Bosses use the tier picked on the Play tab** (minimum 3, maximum your highest). The hideout portals show it, and the live server honours it.
- The "Start a new season" button only shows in test builds.

## 2026-11-25: Batch 2, death rework (Samuel)
- **Timer pauses** while no hero is standing: in solo while you're dead, in co-op only once the whole party is down.
- **Respawn button** (usable after 1 s): costs 10 s of rift time, +5 s for each further death in the run, up to 30 s. In Endless it costs nothing extra, because Endless spends lives. If nobody presses it for 60 s, it respawns automatically (for disconnected guests).
- **Revive:** an ally standing on your grave marker for 2 s brings you back at 50% life with no penalty. A ring fills on the marker as they revive you.
- **Death recap:** the panel shows the killing blow and up to 5 sources of the damage you took in your last 6 s. Melee hits, shots and ground effects are labelled with the enemy's name (and elite), thorns, molten or volatile.

## 2026-11-25: Batch 3, difficulty and rift length (Samuel)
- **Tier curve (Diablo-like):** enemy life doubles every 5 tiers (×1.1487 per tier) and damage rises ×1.5 every 5 tiers (×1.0845 per tier), all the way to T30. The old curve was ×1.4 life per tier. **Mid tiers are now much easier:** T10 life is ×3.5 (was ×20), T20 ×13 and T30 ×56. Expect to climb tiers much faster. If that feels too easy, raise the base instead of the curve.
- **Longer rifts:** progress needed 420 → 900, packs 80 → 100, timer 7 → 12 min. A bot at its right tier now finds the guardian at about 7–9 min. Fast-clear unlocks: under 4 min unlocks +3, under 6 min +2.
- The guardian test moved to T22 so geared heroes still see every attack.

## 2026-11-25: Batch 4, runes by level and the passive tree (Samuel)
- **Runes unlock by character level.** The first rune comes when the skill unlocks, the last at level 30, and the rest are spread evenly between (`runeLevel`). Use counts no longer matter.
- **Passive tree** (data/passives.json, generated by tools/gen_passives.py): each class has 28 nodes. There are 3 branches (offence, defence, utility), each with small nodes, a notable, a side fork with a second notable, and a **keystone that changes a skill** (e.g. Ring of Fire: Cleave hits all around you; Arc Conduit: Chain Lightning +3 jumps; Twin Turrets: +1 turret). Crossroads nodes link neighbouring branches. Nodes must link to the start or to a node you have. A refund must keep the tree connected, and respec is free.
- **Points:** one per Paragon level, so the tree opens at level 30 once all skills and runes are unlocked. Samuel chose to keep Talents (from Trials) and Paragon stats alongside it.
