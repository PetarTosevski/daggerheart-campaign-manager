import json,sys
out=sys.argv[1]
OVN="Share this with your players before they build characters."
INN="A suggested opening scene; adapt it or write your own."
MEN="Rules that apply only to this campaign frame."
castle={
"name":"Castle High",
"pages":{"overview":"p. 117","incident":"p. 126","mechanics":"p. 127"},
"overviewNote":OVN,
"overview":[
"The world has gone modern: cars, phones and pop culture have largely replaced swords and sorcery in everyday life, and most people live safe, comfortable lives. But ages ago, buried crystals called skyshards ripped huge chunks of land into the sky, carrying castles, forests and whole towns with them. Small shards can also be fixed to objects and vehicles to make them fly.",
"These floating landmasses are the skylands. Some hold ancient ruins that scholars believe were deliberately built around skyshards; some have been settled with homes, malls, hotels and drifting diners; others are wild, magic-soaked and full of beasts no one can tame.",
"On one skyland sits Castle High, an elite boarding school where teens learn magic, swordplay, flying and, unfortunately, algebra. New students are sorted into small teams that share a dorm in one of four towers, each run by a dean with their own teaching style, and teams earn joint \"tower grades\" for extracurricular projects.",
"Something is wrong, though. Eight students vanished on skyland expeditions last year, and the staff refuse to talk about it. Rumors blame a tower dean, a cult, a dragon, a bogeyman called the Night Snatcher, or former Headmaster Fellowes, who led the school for forty years and has now quietly vanished from her post.",
"Her replacement, Headmaster Dove, used to be the fun, energetic head of the Arcana Department but has turned stern and rule-bound, and won't discuss Fellowes. Then, during orientation week, right after the big dance, another student—Riley Averill—disappeared, leaving behind a backpack and a private journal but taking their broom. The adults act as if nothing happened; the students are scared."
],
"pullQuote":"Homework, hexes, and a missing friend somewhere above the clouds.",
"incidentNote":INN,
"incident":[
"Setup: On the final night of orientation week, students are hanging out in the courtyard when a figure on a broom drops out of the clouds and crash-lands among them. It's a badly injured boy in a Castle High sweater.",
"Mrs. Wickett, the headmaster's assistant, rushes over and orders everyone back. Before passing out again, the boy grabs the attention of a nearby student and gasps out a half-finished warning that someone is coming for someone.",
"An older student recognizes him as Oliver Fleming, one of the eight kids who disappeared last year. Mrs. Wickett sends everyone back to their towers and refuses to answer questions about the missing students until Oliver has recovered.",
"Open questions: Do the PCs sneak out of their tower to find Oliver and question him? Do they piece together where he's been by gathering gossip from classmates? And how much does Mrs. Wickett already know?"
],
"keyFigures":[
{"name":"Oliver Fleming","role":"Returned missing student","line":"Crash-lands injured after months missing, gasping a cryptic warning."},
{"name":"Mrs. Wickett","role":"Headmaster's assistant","line":"Shuts down questions; may be hiding what she knows."},
{"name":"Headmaster Dove","role":"New, strict headmaster","line":"Once fun-loving, now rigid and silent about Fellowes's absence."}
],
"start":"The school courtyard on the last night of orientation week",
"mechanicsNote":MEN,
"mechanicsSub":"Flight",
"mechanics":[
{"head":"Flight","t":"Every student must learn to fly. At character creation, each player designs a skyshard artifact (broom, board, weapon or similar) that lets their PC fly.\n\nWhile airborne, use normal movement: a PC can fly within Close range as part of an action roll, but moving farther than Close, or making flight their main action, requires an appropriate trait roll. Warn players that being Restrained or Vulnerable, losing their artifact, or taking Severe damage can ground them temporarily, at the GM's call."},
{"head":"Using Traits for Flight","t":"Any trait can drive a flying roll, depending on style:\n\nAgility: speed, momentum and acrobatic maneuvers.\nFinesse: precision moves and threading tight gaps.\nStrength: smashing through debris, holding steady in bad weather, ramming a rival.\nInstinct: reading winds, spotting shortcuts, sensing danger in the clouds.\nPresence: flashy flying that draws attention or creates a distraction.\nKnowledge: planning routes and calculating the timing of a foe's movements."},
{"head":"A Less Lethal Campaign","t":"Given the lighthearted tone, consider treating most or all damage as nonlethal so students can duel, prank and subdue rivals without real violence. Alternatively, keep damage nonlethal by default and let especially dramatic moments escalate, letting PCs choose whether their damage is lethal.\n\nTo take death off the table entirely, replace a fatal death move with an extended infirmary stay or being sent home for the semester: the character is out of play for a while but not dead."}
]}

wd={
"name":"Reign of the Weredragon",
"pages":{"overview":"pp. 129–130","incident":"p. 139","mechanics":"pp. 140–143"},
"overviewNote":OVN,
"overview":[
"Whelvia was once a war-torn land. The Elder Druids persuaded the great dragon Whelvarax to drive out invaders, promising that the people's worship would raise her to godhood. She expelled the armies, taught the people to farm, govern and defend themselves, and ruled for over two centuries. When she died, the druids' ritual lifted her into the sky as a constellation—the first Ascendant.",
"Seven dragon wardens followed, some kind and some cruel; only the mightiest joined the stars as Faint Divinities. Over time the druids faded away, and the Knights of Whelvia became the realm's sworn protectors, bound to each warden by a shared duty to the people.",
"For the last century the warden was Sazanthe, a scholarly purple dragon based at Vexstone Abbey who wanted a peaceful, curious, open Whelvia. He chose as companion Forlorne Lykona, an orphaned faun sorceress and cult leader who read in the stars that he would become the next Ascendant. During their bonding ritual she turned the magic on him and absorbed him. The blast destroyed the abbey and left most of the witnesses as ghosts trapped in its ruins.",
"Forlorne now rules as a weredragon tyrant from Nwarlyth, her mountaintop fortress, able to switch between her faun body and Sazanthe's dragon form. She wants to ascend through her subjects' fear rather than their love. The Knights now enforce her will, dissenters are jailed or devoured, and her breath turns enemies into feral weredrakes that fill her army.",
"Since taking Sazanthe's power, Forlorne gets no answers from the stars, so she rounds up sky seers—and kills the ones whose readings displease her. Real seers have gone into hiding, but they secretly whisper of unlikely heroes destined to bring her down. The PCs are those heroes."
],
"pullQuote":"The stars have gone quiet for the queen—but they still speak of you.",
"incidentNote":INN,
"incident":[
"Setup: The party is having breakfast at the Red Leaf Inn in the Whelvewood when a seagull pesters them, blinking in and out of existence in puffs of blue smoke, then drops a scroll.",
"The scroll is a map marking a route through the Whelvewood to a place called \"Heaven's Eye.\" The forest is contested ground: Knight militias are trying to occupy it while rebels and locals fight to drive them out, and both sides treat strangers as potential enemies.",
"On the back are a rabbit silhouette and a short rhyming note saying to find where the trees cross, show the drawing to the Foes of the Fox to pass safely through \"the warren,\" and expect to pay a price. The gull then steals some food and vanishes.",
"Behind the scenes, Schon—Forlorne's right hand and a gifted sky seer who is secretly plotting her downfall—sent the bird after the stars revealed that the party matters to her defeat. Schon doesn't know why Heaven's Eye is important, only how to get there, and the seagull can return to guide the party if they get lost.",
"Open questions: What dangers lie on the road to Heaven's Eye? Will the party trust the mysterious messenger? Will they side with the militias or the rebels to get through the forest? What waits in the warren, and what price will they accept?"
],
"keyFigures":[
{"name":"Forlorne Lykona","role":"Weredragon tyrant queen","line":"Faun sorceress who stole a dragon's power to become a god."},
{"name":"Schon","role":"Forlorne's secret betrayer","line":"Her right-hand seer, quietly steering the party toward her downfall."},
{"name":"The Astromancer","role":"Seer at Heaven's Eye","line":"Reads the night sky to reveal how Forlorne can be beaten."}
],
"start":"The Red Leaf Inn in the Whelvewood",
"mechanicsNote":MEN,
"mechanicsSub":"Curses",
"mechanics":[
{"head":"Curses","t":"A magical curse is a special condition (core rulebook p. 102). Two curses are central to this campaign: the Weredrake Curse, from Forlorne's \"Breath Weapon,\" and the Petrified Curse, from her \"Stone-Cold Gaze,\" which turns a creature and its gear to stone. Feel free to invent more.\n\nA curse can only be removed by magic: a spell, ritual, magic item, special location, supernatural event, higher power, or a mix of these. Working out the cure usually means research, which can launch a quest or a search for an NPC who can help. Two ready-made curse breakers are described under Keys to Victory."},
{"head":"The Astromancer's Revelations","t":"At the Heaven's Eye observatory, the Astromancer gives the party five revelations. The players roll 5d6 together; each die points to a row (1–6) of the Night Sky Reading table, and the GM assigns one die to each of the five columns (one die per column). Spread the results across different places so the party has to travel widely. You can swap in table entries the players invented at session zero.\n\n1. Secret's Location: where the PCs can learn a secret that helps defeat Forlorne. Each player privately writes down a secret they think Forlorne is hiding; between sessions, pick one to inspire that adventure.\n2. Powerful Ally: an NPC who brings a pool of 3 Hope to any scene with Forlorne. PCs within Far range can spend from it as if it were their own Hope. If the ally drops or dies, the pool is lost.\n3. Key to Victory 1: a defensive item and where to find it. A PC holding one gains 1d4 Hope when Forlorne appears.\n4. Key to Victory 2: a weapon that can hurt Forlorne. Its wielder gets +1 Proficiency on attacks against her.\n5. Showdown Location: where the final battle will most likely happen. If the PCs arrive with the secret, the ally and both items, Forlorne fights alone, and her \"Feed on Fear\" and \"Terrifying\" features don't work there."},
{"head":"Night Sky Reading (table)","t":"A six-row d6 table with columns for Roll, Secret's Location, Powerful Ally, Key to Victory 1, Key to Victory 2 and Showdown Location. Locations include Nightshade, Elevarne, Nwarlyth, Stillwater Lake, Vexstone Abbey and Witch's End. Each row's ally is a named NPC with a short hook, such as a dryad guarding a graveyard, a cave ogre, a bound demon, a petrified spymaster, or Forlorne's ghostly twin sister. Item entries point to core-rulebook loot or to the two items in this chapter. See the book, p. 141."},
{"head":"Keys to Victory","t":"Two items from the table can break curses. Lady Lavender's Longsword is a Tier 3 two-handed primary weapon owned by a retired knight in Knightstead; its \"Curse Breaker\" feature removes all magical curses from any creature it touches. The Zoetrope of the Bright Bacchanal is buried in the ruins of the Lykona cottage at Witch's End; when lit and wound up, it removes all magical curses from creatures within Close range while it spins. Full stat blocks are on p. 142."},
{"head":"Evening the Odds","t":"If the party has followed the reading and collected everything before reaching Tier 4, let them reach at least level 8 before they face Forlorne. Use complications or new story arcs to delay the confrontation so leveling feels natural."},
{"head":"Unique Adversaries: Forlorne Lykona","t":"Forlorne has three stat blocks: a shared Tier 4 Solo framework (HP 11, Stress 8; Relentless (4); a \"Transform\" action that costs a Stress; and a reaction that heals her when a nearby PC fails with Fear), plus separate Faun Form and Dragon Form blocks with their own Difficulty, thresholds, attacks and features. Use whichever form she's currently in.\n\nHer faun form is charming and civil, the shape she wears to run her realm, with teleporting, entangling vines and her petrifying gaze. Her dragon form is savage and terrifying, with flight, a fear aura, the curse-spreading breath weapon and a tail sweep. See pp. 142–143."},
{"head":"Weredrake","t":"A weredrake is someone transformed by Forlorne's breath: a wingless, four-legged dragon about the size of the person it used to be. It cannot speak and has none of that person's memories, though traces of their ancestry may show, such as a mechanical look on a former clank or a carapace on a former faerie. It can return to its old form while keeping its claws and teeth, often to lure in prey.\n\nThe book gives a Tier 1 Standard stat block with pack-hunting and climbing features. Scale it up as the party advances, using the core rulebook's improvising-adversaries guidance (core p. 208). See p. 143."}
]}
json.dump(castle,open(out+"/castlehigh.json","w"),ensure_ascii=False,indent=2)
json.dump(wd,open(out+"/weredragon.json","w"),ensure_ascii=False,indent=2)
