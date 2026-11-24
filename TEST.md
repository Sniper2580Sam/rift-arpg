# What to test

## 1. Putting it on your iPhone (do this before boarding, with Wi-Fi)
1. Open the game link in **Safari**: https://claude.ai/artifact/VZbc4H92TPWELhAPDR1qvH
2. Tap **Enter the Sunken Ossuary** and play about 10 seconds, so everything is loaded.
3. Leave the tab open. Turn on airplane mode. Don't close or reload the tab while you're offline.
4. Backup: the attached `rift-arpg-offline.html` is the same game in one file (157 KB, makes no network requests). Save it with Files → On My iPhone. iOS can't run a local HTML file directly from Files, so the open Safari tab is the reliable way to play offline.

Saves are stored in Safari for that page. Clearing Safari website data wipes them.

## 2. Phone (solo, offline)
- [ ] The left thumb anywhere on the left half moves you. The 6 buttons sit in two arcs around Cleave/Bolt and are easy to hit without looking.
- [ ] Auto-aim picks the boss or elites first. Does it ever aim at the wrong thing?
- [ ] Holding the primary attack keeps swinging. Dash goes the way you're moving.
- [ ] Rotate the phone: the layout fits both ways, and the notch and home bar don't cover buttons.
- [ ] Frame rate stays smooth with 40+ enemies and fire everywhere (Volatile modifier, Nova spam).
- [ ] Bag: equip, compare (green ▲ / red ▼), scrap, "scrap all below". Text is readable without zooming.
- [ ] A legendary drop is unmissable: sound, flash, banner.
- [ ] Boon picker at 25/50/75% (the game pauses in solo).
- [ ] Switching away from Safari and back opens the bag (paused), and nothing is lost.
- [ ] Gear tab: reroll an affix at the Mystic. After the first reroll, only that affix can be rerolled.
- [ ] Skills tab: runes unlock after using a skill enough. Picking one changes how the skill plays.
- [ ] Settings: loot filter hides and auto-scraps junk, pets pick up from further away, sound toggle, screen shake toggle.
- [ ] Battery: how much does a 15-minute session use?

## 3. Progression path (plays well on a long flight)
1. Tier 1 with a fresh Ashknight. Clear it in time, which unlocks Tier 2.
2. Level to 9 so all 6 skills unlock. Try both classes (they level separately).
3. Push tiers. Ancestral items can drop from T5, primals from T10. The pity counter is on the Play tab.
4. Find a Bone Sigil (guardians at T3+) and fight the Ossuary King (3 phases, break the pylons).
5. Build toward a 6-piece set and see whether the bonus feels build-defining.
6. Try the weekly rift and the rift code box: the same code should give the same layout.

## 4. Desktop
- WASD moves. LMB is the primary attack, RMB or E the secondary, Space/Q/R utilities, F the ultimate. I opens the bag, M mutes.
- Resize the window mid-run.
- Co-op (needs Node 20+ on one machine):
  `npm install && npm run server`, then open http://localhost:8787 in two browser windows or on two devices on the same Wi-Fi (use the computer's IP). Sign in with two different names, host a room, then join with the 4-letter code. Try:
  - [ ] Both players move, fight and see the same enemies. Loot is per player and invisible to the other.
  - [ ] Join mid-run and leave mid-run. If the host leaves, everyone gets their results.
  - [ ] Items survive a reload. Server data lives in `server-data/`.
  - [ ] Guest input delay feels OK on Wi-Fi.

## 5. Not tuned yet (feedback wanted)
- **Fresh level-1 difficulty.** I eased Tier 1 after my test bot died 28 times. It now clears in about 7 minutes with 11 deaths, but the bot doesn't dodge.
- **Gloomstalker is fragile.** The bot can't kite, so it can't beat the T1 guardian. Real hands will tell.
- **Ossuary King:** HP, phase timings and the pylon damage check haven't been played by a human.
- **Set balance:** the 6-piece bonuses multiply damage ×5 to ×9 and haven't been compared against each other.
- **Drop rates and pity numbers** (12 rifts for ancestral, 80 for primal).
- Party scaling with 3–4 players.

## 6. What I couldn't verify
- Real Safari/WebKit and a real iPhone. I tested in Chromium with iPhone 13 emulation (touch, safe areas, saves surviving a reload).
- iOS audio unlock quirks, and memory limits on older phones.
- WebRTC across different networks. There's no TURN server (local-only rule), so co-op over mobile data or between homes will often fail.
- Co-op with 3–4 players. I tested 2 players in two headless browsers on one machine, including mid-run join and leave.
- Server load and data safety beyond one machine. Accounts and items are JSON files, not a database.
