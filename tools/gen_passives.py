import json, math
# Branch: (name, colour, small stat options, notable (name, stats), fork notable, keystone (name, text, mod))
def sm(name, stat, per, text): return {"name": name, "stats": {stat: per}, "text": text}
OFF = [sm("Might", "dmgPct", 3, "+3% damage"), sm("Precision", "critChance", 1, "+1% crit chance")]
DEF = [sm("Vigour", "hpPct", 3, "+3% life"), sm("Plating", "armorPct", 6, "+6% armour")]
UTL = [sm("Haste", "cdr", 1.5, "-1.5% cooldowns"), sm("Swiftness", "moveSpeed", 2, "+2% move speed")]
C = {
 "ashknight": [
  ("Pyre", "#ff8a1f", OFF, ("Searing Heat", {"tag:fire": 12}, "+12% fire damage"), ("Brutality", {"critDmg": 20}, "+20% crit damage"),
   ("Ring of Fire", "Cleave hits all around you, for 85% damage.", {"skill": "cleave", "set": {"arcCos": -1}, "mul": {"damage": 0.85}})),
  ("Bulwark", "#c9b8ff", DEF, ("Unbowed", {"takenPct": 5}, "-5% damage taken"), ("Ember Mend", {"lifeOnHit": 4}, "+4 life per hit"),
   ("Molten Core", "Flame Nova pulses 2 more times.", {"skill": "flame_nova", "add": {"pulses": 2}})),
  ("Warpath", "#ffd23f", UTL, ("Battle Trance", {"atkSpeed": 6}, "+6% attack speed"), ("Stoked", {"resMax": 20}, "+20 max Embers"),
   ("Ember Volley", "Ember Lance throws 2 extra lances in a fan.", {"skill": "ember_lance", "add": {"count": 2}})),
 ],
 "gloomstalker": [
  ("Marksman", "#7dff9a", OFF, ("Deadeye", {"critDmg": 20}, "+20% crit damage"), ("Apex Hunter", {"eliteDmg": 15}, "+15% damage to elites and bosses"),
   ("Hail of Arrows", "Volley fires 3 more arrows.", {"skill": "volley", "add": {"count": 3}})),
  ("Shadow", "#9fa8ff", DEF, ("Veiled", {"takenPct": 5}, "-5% damage taken"), ("Rime", {"tag:cold": 12}, "+12% cold damage"),
   ("Long Night", "Frost Snare lasts 50% longer and is 30% wider.", {"skill": "frost_snare", "mul": {"duration": 1.5, "radius": 1.3}})),
  ("Wild", "#ffd23f", UTL, ("Quick Draw", {"atkSpeed": 6}, "+6% attack speed"), ("Pack Leader", {"tag:summon": 15}, "+15% summon damage"),
   ("Phantom Shot", "Bone Shot pierces through every enemy.", {"skill": "bone_shot", "set": {"pierce": 1}})),
 ],
 "stormcaller": [
  ("Tempest", "#5fb0ff", OFF, ("High Voltage", {"tag:lightning": 12}, "+12% lightning damage"), ("Arc Surge", {"critDmg": 20}, "+20% crit damage"),
   ("Arc Conduit", "Chain Lightning jumps to 3 more enemies.", {"skill": "chain_lightning", "add": {"chain": 3}})),
  ("Ward", "#c9b8ff", DEF, ("Static Shell", {"takenPct": 5}, "-5% damage taken"), ("Arcane Lore", {"tag:arcane": 12}, "+12% arcane damage"),
   ("Forked Spark", "Spark jumps to 2 more enemies.", {"skill": "spark", "add": {"chain": 2}})),
  ("Flow", "#ffd23f", UTL, ("Deep Wells", {"resMax": 30}, "+30 max Mana"), ("Thrift", {"costRed": 6}, "-6% resource cost"),
   ("Eye of the Storm", "Thunderstorm covers 50% more ground.", {"skill": "thunderstorm", "mul": {"radius": 1.5}})),
 ],
 "bonewright": [
  ("Artifice", "#e8dcb0", OFF, ("Loyal Works", {"tag:summon": 15}, "+15% summon damage"), ("Weak Points", {"critChance": 4}, "+4% crit chance"),
   ("Twin Turrets", "One more Bone Turret can stand at once.", {"skill": "bone_turret", "add": {"maxCount": 1}})),
  ("Ossuary", "#c9b8ff", DEF, ("Braced", {"takenPct": 5}, "-5% damage taken"), ("Knit Bone", {"regenPct": 1}, "1% life regen per second"),
   ("Heavy Mallet", "Bone Mallet hits all around you, for 85% damage.", {"skill": "bone_mallet", "set": {"arcCos": -1}, "mul": {"damage": 0.85}})),
  ("Workshop", "#ffd23f", UTL, ("Oiled Gears", {"atkSpeed": 6}, "+6% attack speed"), ("Siegebreaker", {"eliteDmg": 15}, "+15% damage to elites and bosses"),
   ("Shrapnel", "Scrap Burst pulses 2 more times.", {"skill": "scrap_burst", "add": {"pulses": 2}})),
 ],
}
out = {"note": "One passive point per Paragon level (after the level cap). Start at the centre; each node needs a linked node already taken. Free to respec.", "classes": {}}
for cls, branches in C.items():
    nodes = [{"id": f"{cls}_start", "name": "Origin", "kind": "start", "x": 0, "y": 0, "text": "Your starting point."}]
    links = []
    mains = []
    for bi, (bn, col, smalls, nb, fork, key) in enumerate(branches):
        th = math.radians(-90 + bi * 120)
        ids = []
        def add(nid, r, a, kind, name, text, stats=None, mod=None):
            n = {"id": nid, "name": name, "kind": kind, "branch": bn, "color": col, "x": round(r * math.cos(a), 2), "y": round(r * math.sin(a), 2), "text": text}
            if stats: n["stats"] = stats
            if mod: n["mod"] = mod
            nodes.append(n); return nid
        prev = f"{cls}_start"
        for k in range(1, 7):
            nid = f"{cls}_{bi}_{k}"
            if k == 3: add(nid, k, th, "notable", nb[0], nb[2], nb[1])
            elif k == 6: add(nid, k, th, "key", key[0], key[1], None, key[2])
            else: s = smalls[(k - 1) % 2]; add(nid, k, th, "small", s["name"], s["text"], s["stats"])
            links.append([prev, nid]); prev = nid; ids.append(nid)
        # fork off the notable
        f1 = add(f"{cls}_{bi}_f1", 4, th + math.radians(24), "small", smalls[1]["name"], smalls[1]["text"], smalls[1]["stats"])
        f2 = add(f"{cls}_{bi}_f2", 5, th + math.radians(30), "notable", fork[0], fork[2], fork[1])
        links += [[ids[2], f1], [f1, f2]]
        mains.append(ids)
    # bridges between neighbouring branches at radius 2, with a utility small
    for bi in range(3):
        a = mains[bi][1]; b = mains[(bi + 1) % 3][1]
        th = math.radians(-90 + bi * 120 + 60)
        nid = f"{cls}_br{bi}"
        nodes.append({"id": nid, "name": "Crossroads", "kind": "small", "branch": "", "color": "#b8a8d0", "x": round(2.6 * math.cos(th), 2), "y": round(2.6 * math.sin(th), 2), "text": "+2% damage and +2% life", "stats": {"dmgPct": 2, "hpPct": 2}})
        links += [[a, nid], [nid, b]]
    out["classes"][cls] = {"nodes": nodes, "links": links}
json.dump(out, open("/home/claude/rift-arpg/data/passives.json", "w"), indent=1)
print({k: len(v["nodes"]) for k, v in out["classes"].items()})
