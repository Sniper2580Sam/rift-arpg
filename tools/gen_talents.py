# Generates data/talents.json: Ascendancy-style subclasses. Pick one subclass per character, then spend
# Trial points in its tree. Stat nodes rank up (max 5); notables and the capstone change skills.
import json
PER = {"dmgPct": 3, "critDmg": 8, "critChance": 1, "atkSpeed": 2, "moveSpeed": 2, "cdr": 2, "hpPct": 4, "armorPct": 6,
       "takenPct": 2, "regenPct": 0.2, "areaPct": 5, "eliteDmg": 5, "costRed": 3, "resMax": 6, "resRegen": 1, "lifeOnHit": 2,
       "barrierPct": 3, "blockChance": 2}
TEXT = {"dmgPct": "+{v}% damage", "critDmg": "+{v}% crit damage", "critChance": "+{v}% crit chance", "atkSpeed": "+{v}% attack speed",
        "moveSpeed": "+{v}% move speed", "cdr": "-{v}% cooldowns", "hpPct": "+{v}% life", "armorPct": "+{v}% armour", "takenPct": "-{v}% damage taken",
        "regenPct": "regenerate {v}% life per second", "areaPct": "+{v}% area of effect", "eliteDmg": "+{v}% damage to elites and bosses",
        "costRed": "-{v}% resource costs", "resMax": "+{v} max resource", "resRegen": "+{v} resource per second", "lifeOnHit": "+{v} life per hit",
        "barrierPct": "+{v}% life as barrier", "blockChance": "+{v}% block chance"}
TAGPER = 6
def stat(id, name, key, gate, mx=5):
    if key.startswith("tag:"):
        t = key[4:]
        return {"id": id, "name": name, "max": mx, "gate": gate, "stat": key, "per": TAGPER, "text": "+{v}% " + t + " damage"}
    return {"id": id, "name": name, "max": mx, "gate": gate, "stat": key, "per": PER[key], "text": TEXT[key]}
def notable(id, name, gate, text, mod, cap=False):
    return {"id": id, "name": name, "max": 1, "gate": gate, "notable": True, "capstone": cap, "text": text, "mod": mod}
def sub(cls, sid, name, color, desc, stats, n1, n2, capn):
    p = f"{cls[:2]}_{sid}"
    s = [stat(f"{p}_s{i+1}", nm, k, g) for i, (nm, k, g) in enumerate(zip([x[0] for x in stats], [x[1] for x in stats], [0, 0, 6, 12, 20]))]
    nodes = [s[0], s[1], notable(f"{p}_n1", n1[0], 6, n1[1], n1[2]), s[2], notable(f"{p}_n2", n2[0], 12, n2[1], n2[2]), s[3],
             notable(f"{p}_cap", capn[0], 20, capn[1], capn[2], True), s[4]]
    return {"id": sid, "name": name, "color": color, "desc": desc, "nodes": nodes}
C = {
 "ashknight": [
  sub("ashknight", "pyreblade", "Pyreblade", "#ff8a1f", "Fire and fury: burning hits and bigger blazes.",
      [("Kindled Blade", "tag:fire"), ("Brutal Edge", "critDmg"), ("Searing Heat", "dmgPct"), ("Inferno Heart", "areaPct"), ("Executioner", "eliteDmg")],
      ("Wildfire", "Fire skills set enemies burning.", {"tag": "fire", "set": {"igniteMult": 0.6}}),
      ("Flashpoint", "Fire skills are 30% larger.", {"tag": "fire", "mul": {"radius": 1.3}}),
      ("Living Pyre", "Fire skills deal 50% more damage.", {"tag": "fire", "mul": {"power": 1.5}})),
  sub("ashknight", "bastion", "Bastion", "#c9b8ff", "An immovable wall: block, barrier and a second life.",
      [("Ashen Hide", "armorPct"), ("Scarred", "hpPct"), ("Shield Arm", "blockChance"), ("Ember Ward", "barrierPct"), ("Unbowed", "takenPct")],
      ("Last Stand", "Take 30% less damage below half life.", {"player": True, "set": {"lowLifeDR": 0.3}}),
      ("Shield Wall", "Shield Bash hits all around you.", {"skill": "shield_bash", "set": {"arcCos": -1}}),
      ("Undying", "Once a minute, a killing blow leaves you at full life instead.", {"player": True, "set": {"cheatDeath": 60}})),
  sub("ashknight", "warlord", "Warlord", "#ffd23f", "Shouts and tempo: faster cooldowns, longer buffs.",
      [("Battle Rhythm", "atkSpeed"), ("Warlord's Pace", "cdr"), ("Momentum", "moveSpeed"), ("Stoked", "resMax"), ("Commander", "dmgPct")],
      ("Rallying Cry", "Shout cooldowns are 30% shorter.", {"tag": "shout", "mul": {"cooldown": 0.7}}),
      ("Battle Trance", "Take 15% less damage while a buff is active.", {"player": True, "set": {"buffDR": 0.15}}),
      ("Warmaster", "Shouts last 50% longer.", {"tag": "shout", "mul": {"duration": 1.5}})),
 ],
 "gloomstalker": [
  sub("gloomstalker", "deadeye", "Deadeye", "#ffe08a", "Projectiles: more arrows, piercing shots.",
      [("Steady Aim", "tag:projectile"), ("Keen Eye", "critChance"), ("Quick Draw", "atkSpeed"), ("Vital Shot", "critDmg"), ("Hunter", "eliteDmg")],
      ("Split Shot", "Projectile skills fire 1 more projectile.", {"tag": "projectile", "add": {"count": 1}}),
      ("Piercing Shots", "Projectiles pierce.", {"tag": "projectile", "set": {"pierce": 1}}),
      ("Far Shot", "Projectile skills deal 40% more damage and fly 20% further.", {"tag": "projectile", "mul": {"power": 1.4, "range": 1.2}})),
  sub("gloomstalker", "hexer", "Hexer", "#7dd8ff", "Curses and cold: slow them, then break them.",
      [("Rime", "tag:cold"), ("Spreading Hex", "areaPct"), ("Malice", "dmgPct"), ("Grim Focus", "eliteDmg"), ("Dark Pact", "costRed")],
      ("Frostbite", "Cold skills slow 20% more.", {"tag": "cold", "add": {"slowPct": 20}}),
      ("Vulnerable", "Your hits make enemies take 10% more damage.", {"tag": "any", "set": {"vulnOnHit": 10}}),
      ("Doom", "Area skills deal 40% more damage.", {"tag": "aoe", "mul": {"power": 1.4}})),
  sub("gloomstalker", "beastmaster", "Beastmaster", "#b8ff9a", "Ravens and beasts: a bigger, stronger pack.",
      [("Pack Bond", "tag:summon"), ("Wild Vigour", "hpPct"), ("Call of the Wild", "cdr"), ("Fleet Foot", "moveSpeed"), ("Shared Blood", "regenPct")],
      ("The Pack", "Summons get 1 more minion.", {"tag": "summon", "add": {"count": 1}}),
      ("Feral", "Summons last 50% longer.", {"tag": "summon", "mul": {"duration": 1.5}}),
      ("Alpha", "Summons deal 60% more damage.", {"tag": "summon", "mul": {"power": 1.6}})),
 ],
 "stormcaller": [
  sub("stormcaller", "tempest", "Tempest", "#5fb0ff", "Lightning: more jumps, harder strikes.",
      [("Charged", "tag:lightning"), ("Static Mind", "critChance"), ("Quickening", "atkSpeed"), ("Overcharge", "dmgPct"), ("Ion Edge", "critDmg")],
      ("Arc", "Lightning skills jump to 1 more enemy.", {"tag": "lightning", "add": {"chain": 1}}),
      ("Overload", "Lightning hits make enemies take 10% more damage.", {"tag": "lightning", "set": {"vulnOnHit": 10}}),
      ("Thunderlord", "Lightning skills deal 50% more damage.", {"tag": "lightning", "mul": {"power": 1.5}})),
  sub("stormcaller", "arcanist", "Arcanist", "#c06aff", "Arcane: cheaper, bigger, stronger spells.",
      [("Arcane Mind", "tag:arcane"), ("Thrift", "costRed"), ("Deep Well", "resMax"), ("Flow", "resRegen"), ("Spellblade", "dmgPct")],
      ("Focus", "Arcane skills cost 20% less.", {"tag": "arcane", "mul": {"cost": 0.8}}),
      ("Orbit", "Arcane skills are 25% larger.", {"tag": "arcane", "mul": {"radius": 1.25}}),
      ("Archmage", "Arcane skills deal 50% more damage.", {"tag": "arcane", "mul": {"power": 1.5}})),
  sub("stormcaller", "chronomancer", "Chronomancer", "#a8e4ff", "Time: faster cooldowns, shields and a rewind.",
      [("Haste", "cdr"), ("Swift Step", "moveSpeed"), ("Time Shell", "barrierPct"), ("Slow Time", "takenPct"), ("Echo", "atkSpeed")],
      ("Blink Again", "Dash skills get 1 more charge.", {"tag": "dash", "add": {"charges": 1}}),
      ("Stasis", "Take 20% less damage while a buff is active.", {"player": True, "set": {"buffDR": 0.2}}),
      ("Rewind", "Once every 90 seconds, a killing blow rewinds you to full life.", {"player": True, "set": {"cheatDeath": 90}})),
 ],
 "bonewright": [
  sub("bonewright", "artificer", "Artificer", "#d9d2b8", "Constructs: more turrets, sturdier builds.",
      [("Blueprints", "tag:construct"), ("Wide Reach", "areaPct"), ("Quick Build", "cdr"), ("Fine Tuning", "dmgPct"), ("Overclock", "atkSpeed")],
      ("Spare Parts", "You can keep 1 more of each construct.", {"tag": "construct", "add": {"count": 1}}),
      ("Reinforced", "Constructs last 50% longer.", {"tag": "construct", "mul": {"duration": 1.5}}),
      ("Masterwork", "Constructs deal 50% more damage.", {"tag": "construct", "mul": {"power": 1.5}})),
  sub("bonewright", "juggernaut", "Juggernaut", "#9aa4ad", "The Colossus and the mallet: big, tough, heavy.",
      [("Heavy Frame", "tag:melee"), ("Bone Mass", "hpPct"), ("Plating", "armorPct"), ("Stubborn", "takenPct"), ("Bulk", "blockChance")],
      ("Colossal", "The Colossus lasts 30% longer.", {"tag": "colossus", "mul": {"duration": 1.3}}),
      ("Heavy Hands", "Melee hits knock back 50% further and heal 0.5% of max life.", {"tag": "melee", "mul": {"knockback": 1.5}, "set": {"healPerHit": 0.005}}),
      ("Titan", "The Colossus deals 50% more damage.", {"tag": "colossus", "mul": {"power": 1.5}})),
  sub("bonewright", "scrapper", "Scrapper", "#e8a05a", "Shrapnel and salvage: physical hits that pay you back.",
      [("Jagged", "tag:physical"), ("Weak Points", "critChance"), ("Rapid Fire", "atkSpeed"), ("Salvage", "lifeOnHit"), ("Cruel Edges", "critDmg")],
      ("Shrapnel", "Area skills are 20% larger.", {"tag": "aoe", "mul": {"radius": 1.2}}),
      ("Recycler", "Kills refund 10% of your cooldowns.", {"tag": "any", "set": {"refundOnKill": 0.1}}),
      ("Scrap Storm", "Physical skills deal 40% more damage.", {"tag": "physical", "mul": {"power": 1.4}})),
 ],
}
out = {"note": "Pick a subclass, then spend Trial points in its tree (one per Trial level beaten). Respeccing clears the tree; beat your best Trial again to earn the points back.", "classes": C}
json.dump(out, open("data/talents.json", "w"), indent=1, ensure_ascii=False)
open("data/talents.json", "a").write("\n")
