// Lore-book ("tome") text and dashboard key figures for the published campaign
// frames, ported from the Claude Design boards (reference/designs/project/Tome*.dc.html
// and Hub*.dc.html). Pure data: bundled into Convex, so no framework imports.

import type { PublishedFrameId } from "./index";

export type TomeRule = { n: number; head: string; text: string };
export type TomeChapterId = "overview" | "incident" | "mechanics";
export type KeyFigure = { name: string; role: string; line?: string; asset?: string };

export type Tome = {
  overview: { paragraphs: string[]; quote?: { text: string; cite?: string }; note?: string };
  incident: { paragraphs: string[]; start?: string; note?: string; figures: KeyFigure[] };
  mechanics: { sub?: string; intro?: string[]; rules: TomeRule[]; note?: string };
};

export const TOME_CHAPTERS: { id: TomeChapterId; numeral: string; title: string }[] = [
  { id: "overview", numeral: "I", title: "Overview" },
  { id: "incident", numeral: "II", title: "The Inciting Incident" },
  { id: "mechanics", numeral: "III", title: "Campaign Mechanics" }
];

export const TOMES: Record<PublishedFrameId, Tome> = {
  "witherwild": {
    overview: {
      paragraphs: [
        "Fanewick is a wild and untamed land, long avoided by outside forces. The woods are dark and twisting, filled with Faint Divinities who perform small miracles and services for its inhabitants, but are just as likely to lure travelers off narrow paths to their ruin. Seemingly harmless expanses of field hide bogs that engulf entire armies, consuming heavy artillery as quickly as it can cross the border. This wilderness fosters hardy people who are bold enough to raise families where others have not and strictly follow the unique rules that keep them safe. These Wicklings remained insulated from their neighbors’ wars until plague forced the people of Haven to desperate acts.",
        "Haven was once the most powerful force in the region; for centuries, the high stone walls into the capital bore the phrase “The Godless Gate.” While the original meaning has been lost to common knowledge, some dusty tomes and ancient records state that the founders of Haven wished to be free of the influence of the Faint Divinities that dominated the surrounding regions. They hatched a plan to kill one of the mightiest of these deities, known as Shun’Aush the Granite Ophid. While their exact method of deicide is forgotten, their victory ensured Haven’s dominance in the region for centuries to come. They made their home behind his remains, which became the mighty walls that Haven is known for.",
        "But Shun’Aush would have his revenge. As the Havenites carved through his stone body, the fine dust left behind settled into the surrounding earth. There was a time of prosperity over many centuries while the scales of the god remained undisturbed. But progress is its own pressure. The growing population demanded increased productivity, and as farmers tilled deeper soil and miners hacked into hidden stone, the ancient stone dust rose to the surface. The same walls that brought the city security became the crucible that incubated a virulent plague.",
        "Over the last two years, over half of Haven’s populace fell to a disease known as the Serpent’s Sickness. First, victims cough up dust. Soon after, their skin breaks out in a scaling rash. Finally, their body hardens—first the flesh, bones, and soft tissue, spreading until, finally, their organs ossify. Once within the organs, “the serpent” moves so quickly that sufferers petrify where they stand, filling Haven with statues of victims in their last moments of agony.",
        "The High Magus of Haven, Archmage Phylax, discovered a rare red flower called the crimson lady’s veil that could cure the Serpent’s Sickness. These buds grow prolifically across Fanewick in the spring—but for every ten thousand of the common white-petaled blossoms, only one red flower blooms.",
        "Desperate to save their people from the plague, Haven invaded Fanewick to amass the scarce red buds. Their forces plunged into the deep wood and, under the guidance of Archmage Phylax, plucked out the Reaping Eye from the most powerful Faint Divinity that protected the land: The Great Owl Nikta, the Shepherd of the Seasons. The Shepherd kept Fanewick in balance by turning her eyes upon the land, first for ripening, then ruination. Thus Nikta maintained the cycle of seasons—of growth and decay, of death and rebirth. With her Reaping Eye removed, Nikta can only watch over Fanewick with the Sowing Eye, forcing the land into everlasting spring.",
        "In the year since, Haven has conquered the bogs, turning them into fields to harvest red flowers. The endless growth that once seemed like a gift quickly evolved into a scourge known as the Witherwild—Fanewick’s flora and fauna flourished, unchecked and uncontrolled. Animals swell to massive size; trees warp, twist, and begin to hunt people; and vines creep along the forest floor, strangling all they touch. This explosive growth is unconquerable and unrelenting, with no force able to stop the burgeoning verdance for long.",
        "Prior to the Serpent’s Sickness and the Shepherd’s endless growth, your party lived a peaceful life in Fanewick or a life of toil and conquest in Haven. But when the danger demands a response, even the unprepared—and unwilling—must make a stand."
      ],
      quote: { text: "The same walls that brought the city security became the crucible that incubated a virulent plague." },
      note: "If your group decides to play this campaign, give your players the following information before character creation."
    },
    incident: {
      paragraphs: [
        "The Reaping Eye is stowed in a secure vault beneath the central tower of Haven’s wizarding school, seemingly impossible to recover. A secretive and dangerous rebel group, led by a mysterious figure known only as the Fanewraith, has hatched a plan to end the curse of the Witherwild: find the Great Owl, Nikta, and pluck out the Sowing Eye. While this may solve the immediate problem, the long-term consequences are not being considered, just as they weren’t when Haven invaded.",
        "Haven’s beleaguered spymaster, Kreil Dirn, is not a popular person in Haven. He is responsible for rooting out insurgents, stopping schemes before they have a chance to start, and keeping a close watch on Haven’s internal activities. Kreil has never agreed—at least not openly—with Archmage Phylax’s decision to steal the Reaping Eye, and the consequences they’ve all paid for that decision have been grimly vindicating.",
        "Recently, Kreil uncovered the Fanewraith’s plot and is horrified by the possibility of her success. Knowing he can’t send a troop of Haven soldiers deep into the woods to hunt down and stop the Fanewraith from stealing the Sowing Eye, Kreil uses his vast network of informants and spies to find a group of adventurers who can bring the Fanewraith to swift justice.",
        "The party is sent an invitation from Haven to meet with Kreil. But is his information correct? Does he have his own motivation or secret ambition? Whether they come from Fanewick or Haven, the party must extend some trust to a person who is equally as dangerous and mercurial as the “enemy” they pursue. And what will they do when they find the Fanewraith? Bring her to justice? Side with her? Attempt to recover the Reaping Eye?",
        "Kreil advises the party to start their hunt for the Fanewraith in the treetop village of Alula, where he suspects she runs her operation."
      ],
      note: "You can use the prompt below to start your campaign, or create your own.",
      figures: [
        {
          name: "Kreil Dirn",
          role: "Haven’s spymaster"
        },
        {
          name: "The Fanewraith",
          role: "Rebel leader"
        },
        {
          name: "Archmage Phylax",
          role: "High Magus of Haven"
        },
        {
          name: "Nikta, the Great Owl",
          role: "Shepherd of the Seasons"
        }
      ]
    },
    mechanics: {
      sub: "Corruption from the Witherwild",
      rules: [
        {
          n: 1,
          head: "Withered",
          text: "Adversaries and environments in this campaign can gain an additional type called Withered. When an adversary is Withered, describe how the Witherwild changed or impacted how they would normally appear or operate."
        },
        {
          n: 2,
          head: "Gaining Wither",
          text: "Any time a PC takes Severe damage from a Withered adversary or environment, gain a Wither token and place it on that PC’s character sheet. When you do, the PC must roll their Fear Die. If they roll equal to or below the number of Wither tokens on their sheet, they immediately gain a scar and clear all tokens, describing how the Witherwild changes them permanently."
        },
        {
          n: 3,
          head: "End of Session",
          text: "At the end of each session, clear all Wither tokens from the PCs’ sheets and gain an equal amount of Fear."
        },
        {
          n: 4,
          head: "Death",
          text: "If a character ever dies with Wither tokens on their sheet, their body is permanently taken over by the Witherwild."
        }
      ],
      note: "The following mechanics are unique to this campaign."
    }
  },
  "five-banners-burning": {
    overview: {
      paragraphs: [
        "Althas is split among five nations. Armada is a seafaring federation of city-states built by former pirates who now trade, and it measures its power in ships. Hilltop is a wealthy theocracy that controls access to the gods and keeps temples in every other nation. Jesthaen is a young republic that broke away from Voldaen in a short, brutal war and is eager to show off its military. Polaris is a magocracy in the early stages of a magical industrial boom. Voldaen is an old, rich monarchy still reeling from losing Jesthaen.",
        "The current alignments: Armada and Jesthaen are allies, and Polaris backs Jesthaen mostly out of convenience. Voldaen and Hilltop are long-standing partners. Polaris and Voldaen are ideological rivals, and both Voldaen and Hilltop regard Armada with distaste.",
        "All five nations were once one. After the gods defeated the primordial forces of chaos, the mortals crowned the dwarven seraph Arvold as the first queen of Voldaen, and the gods made their home in what became Hilltop before leaving centuries later to fight threats from beyond. With the gods gone, Hilltop's priests claimed to rule in their name, a breakaway group of mages founded Polaris, and pirate fleets settled down into the trading cities of Armada.",
        "Fifteen years ago, workers and anti-monarchists declared Jesthaen independent, and the whole continent was dragged into the fighting: Hilltop backed Voldaen while Polaris and Armada backed the rebels. An armistice stopped open combat five years ago, but border skirmishes and trade disputes keep piling up, and most people assume the next war is only a matter of time.",
        "Play is intense and morally gray, with a large cast and a continental scope. The heroes sit where the fate of nations gets decided, duty often pulls against conscience, and the antagonists usually act out of love or loyalty as much as greed or revenge."
      ],
      quote: {
        text: "Five flags, one fraying peace, and every spark finds tinder."
      },
      note: "Share this background with your players before they make characters. Summarized here; full text in the Core Rulebook, p. 263."
    },
    incident: {
      paragraphs: [
        "Clover of Towers, the firbolg child of the Jesthaen revolutionary hero Adamant Towers, disappears on the way to a political marriage with Enchanter Kalashae, a rising mage of Polaris's High Circle. Polaris doubts the kidnapping story and insists the wedding go ahead. Voldaen denies any involvement and sends investigators to Lightning Valley, a border town protected from magical storms by huge lightning rods and best known as the place where the war's armistice was negotiated. Soon afterward, word arrives of a 'disaster' at the first meeting between Voldaen's and Jesthaen's envoys.",
        "The party is sent to Lightning Valley to find out what happened, and investigators from every other nation turn up as well. Sheriff Oziver of Storms is out of his depth and wants help, but he needs to trust outsiders before he gives it. He knows a town guard was the last person seen with Clover, and he refuses to believe that guard is guilty; the guard is still missing. Clover was last seen drinking with guards at the Three Poles tavern.",
        "Clover wants to make their mother proud and find a life they can be happy with far from home, and they're ashamed that they were too young to fight for Jesthaen's freedom. Cerulean Prism, a clank apprentice of Polaris who handled Clover's correspondence during the marriage negotiations, has fallen for them and will act recklessly to find them. Kostren, Hilltop's seeker, takes over the local temple to run a divination ritual. She is overstating a vision that blames Polaris's mages because she wants war to win Hilltop more farmland.",
        "Zeshthon, an elderly judge of Voldaen, says they've come to visit a grandniece. Their passion for collecting art could lead them to expose Goledraelle, a seemingly bumbling Armadan textiles merchant who is really a spy sent to make sure the marriage happens.",
        "Open questions to seed: the first investigators headed into the eastern hills and haven't reported back for over a week. Who in town helped the kidnappers? Which rival nation, or which faction inside Jesthaen, wanted the marriage to fail? Did Clover run away on purpose? And when someone among the investigators finally turns violent, whose version of the story spreads?"
      ],
      start: "Lightning Valley, a storm-guarded border town",
      note: "Use this opening hook as written, or swap in one of your own. Summarized here; full text in the Core Rulebook, p. 267.",
      figures: [
        {
          name: "Clover of Towers",
          role: "Missing Jesthaen heir",
          line: "Vanished before an arranged marriage; may have fled by choice."
        },
        {
          name: "Kostren",
          role: "Seeker of Hilltop",
          line: "Twists a divine vision to blame Polaris and stoke war."
        },
        {
          name: "Goledraelle",
          role: "Armadan merchant-spy",
          line: "Plays the fool while making sure the wedding happens."
        }
      ]
    },
    mechanics: {
      sub: "Faction Relationships",
      rules: [
        {
          n: 1,
          head: "Faction Relationships",
          text: "Keep a campaign sheet with each nation's standing toward every other nation, plus its assets and problems. Standings run from Nemeses (−3) through Enemies (−2), Unfriendly (−1), Friendly (+1) and Allies (+2) up to Close Allies (+3). The further from zero a standing is, the more risk a nation will accept to help or harm the other: a Friendly nation helps when it costs little, while a Nemesis will go out of its way to hurt its rival.\n\nThe book gives a short profile for each nation listing its starting relationships, assets, problems, one major objective and minor objectives (p. 268). The entries below summarize them."
        },
        {
          n: 2,
          head: "Armada",
          text: "Allies with Jesthaen, Friendly with Polaris, Unfriendly with Voldaen, Enemies with Hilltop. Strengths: a dominant navy, the best charts of currents and winds, and sea monsters as allies. Weaknesses: very little land, poor overland access, and a lingering reputation as pirates. Major goal: build trade ports in Voldaen and Polaris. Minor goals: obtain airships and send privateers against rivals."
        },
        {
          n: 3,
          head: "Hilltop",
          text: "Allies with Voldaen, Enemies with Armada and Jesthaen, Nemeses with Polaris. Strengths: tithe wealth, a devout army with priests and seraphs, divine authority, and a spy network running through its temples. Weaknesses: hostile neighbors on every side, almost no navy, and not enough food of its own. Major goal: bring Armada back under its spiritual authority. Minor goals: secure a blessed harvest and pin a Fallen cult on Polaris."
        },
        {
          n: 4,
          head: "Jesthaen",
          text: "Allies with Armada, Friendly with Polaris, Enemies with Hilltop, Nemeses with Voldaen. Strengths: a strong army, plenty of natural resources and farmland. Weaknesses: an unstable young government and holdouts still loyal to Voldaen. Major goal: get revenge on Voldaen for centuries of injustice. Minor goals: lock in trade with Armada and Polaris and take its temples back from Hilltop."
        },
        {
          n: 5,
          head: "Polaris",
          text: "Friendly with Armada and Jesthaen, Enemies with Voldaen, Nemeses with Hilltop. Strengths: skilled mages, magitech, airships and magical creatures. Weaknesses: a shortage of workers and poor, scarce raw materials. Major goal: perfect enchanted servitors. Minor goals: open new mines and quarries and draw in immigrant workers."
        },
        {
          n: 6,
          head: "Voldaen",
          text: "Allies with Hilltop, Unfriendly with Armada, Enemies with Polaris, Nemeses with Jesthaen. Strengths: traditional prestige and apparently endless wealth. Weaknesses: major cities sitting close to long hostile borders, plus turmoil after the secession. Major goal: take key resources back from Jesthaen without restarting the war. Minor goals: turn Armada against its allies and poach Polaris's mages and technology."
        },
        {
          n: 7,
          head: "Objective Countdowns",
          text: "Track each nation's long-term projects (exploiting an asset, fixing a problem, chasing an objective) as countdowns. Each nation runs one major objective countdown (10 steps) and up to two minor ones (4–6 steps, depending on scope) at a time.\n\nEvery in-game week, advance one countdown per nation by one tick. Story events can also push a countdown forward or back. When a countdown finishes, the nation gains something significant (an asset, a solved problem, new technology, a political shift); pick a new objective that fits the fiction and start another countdown.\n\nStagger the countdowns so only one or two nations complete something in any given week. If all five finish at once, the following weeks go quiet and the tension drains away. Send the party out to advance or sabotage objectives, and use completed countdowns as major story turns for them to react to.\n\nThe book includes a worked example of one week of airship travel in which each nation's clock moves, one completes, and another had earlier been pushed back by the PCs' choices (p. 269)."
        }
      ],
      note: "These rules apply only to this campaign frame. Summarized here; full text in the Core Rulebook, pp. 268–269."
    }
  },
  "beast-feast": {
    overview: {
      paragraphs: [
        "Centuries ago, Hylaeus the Forest Mage cast a spell deep inside the Plover Caves that created the Lure, a magic that pulls dangerous creatures from the surrounding countryside down into the caverns. It has kept the village of Elmore safe ever since. The caves are now crammed with strange beasts and the remains of outsiders who went in, and no one from Elmore would dream of going down there.",
        "Elmore is a quiet farming village of bakers, weavers, cobblers and farmers, and nobody there owns a sword. Its biggest worry has always been not embarrassing itself at the annual Stewpot Festival. That changes when the halfling mayor, Doug Dougle, is attacked by a monster on his daily walk in Plover Woods. The Lure is weakening, beasts are pushing out into the woods, and the villagers are calling for anyone willing to pick up a blade to go down and restart the spell.",
        "Food is scarce because nobody dares to hunt or forage anymore, so anyone who goes into the caves has to catch and cook their own meals along the way.",
        "To find the caves, take the western road out of Elmore and follow the calls of the piping plovers; according to local stories, they are the only creatures that can come and go without getting lost. The tunnels aren't literally endless, but they run for hundreds of miles. A long, steep descent opens into many branches that lead to different underground biomes, each with its own creatures, plants and treasure left by earlier adventurers. The deeper you go, the deadlier the beasts, the tastier the meat and the better the loot, and the Lure lies deepest of all.",
        "The caves are full of people, too. Residents live in camps or in cabins cut into the rock, the culture is communal, and traders set up shop along the tunnels. Most large caverns have a Berry's, a chain of small restaurants that serve the day's catch for gold and double as the place to hear gossip and warnings about nearby monsters."
      ],
      quote: {
        text: "Down in the dark, every monster is also a menu."
      },
      note: "Share this background with your players before they make characters. Summarized here; full text in the Core Rulebook, p. 271."
    },
    incident: {
      paragraphs: [
        "After the mayor is attacked, Carat, Elmore's alchemist, asks the party for help. Carat needs twelve drops of ghost scorpion venom, which they can turn into a spicy paste. Spread around the edge of the village, the paste will hold dangerous creatures off for a while, buying time until someone can fix the Lure.",
        "Carat explains that ghost scorpions nest in the Overgrowth, where they flatten the tall grass into odd circular patterns. To get there, the party should follow the scent of jasmine through the northernmost chamber of the Shallows. Carat adds one firm warning: if they ever smell lavender, they should run.",
        "Questions to explore early: what do the characters run into that convinces them the failing Lure really is their problem? What win shows them they can handle going deeper? What about the cave communities keeps drawing them back, and what rivalry gets them fired up? Above all, what meal changes how they think about eating monsters?"
      ],
      start: "Elmore, a sleepy village above the Plover Caves",
      note: "Use this opening hook as written, or swap in one of your own. Summarized here; full text in the Core Rulebook, p. 275.",
      figures: [
        {
          name: "Carat",
          role: "Elmore's alchemist",
          line: "Sends the party after ghost scorpion venom to protect the village."
        },
        {
          name: "Doug Dougle",
          role: "Halfling mayor of Elmore",
          line: "His attack in Plover Woods shows the Lure is failing."
        },
        {
          name: "Hylaeus the Forest Mage",
          role: "Creator of the Lure",
          line: "Her centuries-old spell has protected Elmore until now."
        }
      ]
    },
    mechanics: {
      sub: "Beast Feast Starting Equipment",
      rules: [
        {
          n: 1,
          head: "Beast Feast Starting Equipment",
          text: "The PCs are ordinary folk without real weapons, so at Tier 1 they choose equipment from this frame's tables instead of the ones in chapter 2. The tables (pp. 275–276) cover:\n\n• Primary physical weapons made from tools and kitchenware (cleavers, skillets, pitchforks, rakes, fishing rods, slingshots and the like). They use standard trait, range, damage and burden values, and a few have features such as Reliable, Heavy, Massive, Quick or Cumbersome.\n• Primary magic weapons, all requiring Spellcast, built from enchanted household items such as mops, brooms, scissors, kites and a whisk wand.\n• Secondary weapons such as a large fork, a barrel-lid shield, a table shield, a paring knife, a festival whip, a towline hook and a flare launcher.\n• Four armors ranging from quilted clothing up to a baking-tray breastplate, with matching thresholds and Evasion penalties."
        },
        {
          n: 2,
          head: "A Big Book of Recipes!",
          text: "The players share a real notebook as the party's cookbook, and decorating it is encouraged. Every time they cook during downtime, they write down the dish's name, ingredients, method and how it came out, and everyone should get a turn adding to it. Recorded flavor profiles pay off later (see Making a Feast!)."
        },
        {
          n: 3,
          head: "The Beast Feast! (Flavor Profiles)",
          text: "Each ingredient has one to three flavors, each at a strength from 1 to 3. Every flavor has a die: Sweet d4, Salty d6, Bitter d8, Sour d10, Savory d12, Weird d20. The strength is how many of that die the ingredient adds when cooked; an ingredient with Bitter 1 and Savory 2, for example, adds 1d8 + 2d12. A PC can carry as many ingredients as their highest trait value. The book lists sample ingredients and their profiles (p. 277)."
        },
        {
          n: 4,
          head: "Hunting Beasts for Ingredients!",
          text: "Every beast the party defeats can be harvested, and its maximum HP sets the yield: 4 or less gives 1 ingredient, 5–7 gives 2, 8–10 gives 3, and 12 or more gives 4. The GM decides the flavor profile and strength based on what the creature is. Weaker beasts usually lean toward small dice (Sweet, Salty, Bitter) and tougher ones toward big dice (Sour, Savory, Weird)."
        },
        {
          n: 5,
          head: "Gathering Blooms for Ingredients!",
          text: "Blooms are ingredients foraged from the environment. Once per rest, each PC can spend a Hope to forage. The GM either tells them what they find or has them roll their Hope Die to get one bloom with a single strength-1 flavor, using a d12 table where each pair of results maps to one of the six flavors (p. 277)."
        },
        {
          n: 6,
          head: "Making a Feast!",
          text: "In this frame, the usual downtime moves for clearing Stress, clearing HP or gaining Hope are replaced by a single move, Make a Feast. The PCs taking it decide together which ingredients to use, remove them from their inventories, name and describe the dish, and record it in the cookbook.\n\nTo cook, put all the ingredients' flavor dice into one pool and roll it. Set aside any dice that show matching numbers, then keep rolling the rest. If a roll has no matches, discard one die of your choice and roll again. Cooking ends when only one die is left.\n\nThe Meal Rating is the total of one value per matched set (two d-whatevers both showing 4 count as 4). Everyone who eats can spend up to the full Meal Rating, split however they like among clearing HP, clearing Stress and gaining Hope.\n\nWhen a new dish has the same flavor profile as one already in the cookbook, add tokens equal to the party's tier to the pool. A token can be discarded in place of a die. The book walks through a full cooking example (p. 278)."
        },
        {
          n: 7,
          head: "Quick Ingredient Generator!",
          text: "When the party harvests something, roll a d20 on the relevant tables for inspiration: one table for the beast part (feet, marrow, scales, secretions and so on), one for the bloom part (roots, sap, fungi, moss and so on), and one for an odd detail that applies to any ingredient (still wriggling, glowing gas, poisonous raw). If a result doesn't fit, choose another. The tables are on p. 278."
        },
        {
          n: 8,
          head: "Next Level Feast!",
          text: "Once the table is comfortable with the basics, let the PCs hunt down specific ingredients using what they've learned about the caves, and add rare ingredients with special features that drop only from Leader or Solo adversaries. The book's four examples (p. 279) include an Agility-boosting marrow, a milk that turns the last remaining die into bonus Meal Rating, a spicy venom that can block clearing Stress on high matches, and a high-risk deathflower that either fully restores the PCs or forces a death move."
        },
        {
          n: 9,
          head: "Berry's Restaurant",
          text: "When the PCs are near an open Berry's during downtime, each can pay a handful of gold to eat there and take one of the normal clear-Stress, clear-HP or gain-Hope downtime moves. Each PC can spend at most 2 handfuls this way per downtime."
        }
      ],
      note: "These rules apply only to this campaign frame. Summarized here; full text in the Core Rulebook, pp. 275–279."
    }
  },
  "age-of-umbra": {
    overview: {
      paragraphs: [
        "The Halcyon Domain is decaying. God-King Othedias, chosen by the Veiled Gods as the bridge to divinity, secretly plotted with his Grand Ordinants and Aetherlords to shift the balance of heavenly power. The furious gods destroyed the Old World in answer and then abandoned the realm entirely, an event called the Apostasy. Since then, the cities and cathedrals have been crumbling and the clouded sky gets a little darker with every generation.",
        "The cycle of souls is broken. Every mortal carries the soul blight, which means anyone who dies comes back as a revenant set on destroying whatever it loved in life. If the risen body is destroyed, the soul slips into the Umbra, a shadowy mass of twisted spirits that merges with wild creatures and turns them into evolving nightmares. In dreams, people sense vast alien minds peering in through the unguarded veil.",
        "Almost a century into this age, the survivors, who call themselves the Enduring, live in fortified settlements built around Sacred Pyres. Everyone learns to fight young, and many grow into hardened warriors or Aetherweavers. Hunting bands go out each day to forage, salvage, and trade with other enclaves.",
        "In the swampy Idol Hollows, the fort village of Okros has held out for more than fifty years behind walls of melted shields and stone, its Pyre burning high enough to be seen across the region. A recent earthquake opened the Shalk Chasm, exposing structures older than the Old World, and Okros's scouts are looking for help from the Celsians of Amber Reach.",
        "Amber Reach, once a grand capital at the foot of the Griefcleft Mountains, is now a haunted ruin. The Celsians hold its Ashcall Quarter from inside the Celsian Athenaeum, a library turned fortress, and are slowly fighting to reclaim the streets. A ruthless gang of pleasure-seeking raiders called the Damask Queens is spreading out from the Cinnabar Quarter and clashing with them more violently each time.",
        "Hope hasn't gone out. There are rumors of shrines that still hold divine power able to push back the blight, heroes winning back relics, zealots trying to atone for Othedias, visions of untouched sanctuaries, and secret societies that keep prophecies of salvation."
      ],
      quote: {
        text: "The gods walked out; the Enduring kept the fire burning."
      },
      note: "Share this background with your players before they make characters. Summarized here; full text in the Core Rulebook, p. 281."
    },
    incident: {
      paragraphs: [
        "A hunting band from Okros, led by the giant Huntmaster Evrados, goes into the Shalk Chasm looking for supplies and finds a worn-down temple to a little-known Veiled God. A monster drags Evrados deeper into the temple. His three hunters try to follow, but a horrible stench drives them back.",
        "While Elder Akadona and the village speakers argue about what to do, Evrados's voice rings out from the swamp beyond the walls, begging for help. The hunters charge out past the Pyre's light to save him. The screaming stops for a while, then starts again, and now the hunters are screaming too. The cries never change or fade, and Okros is close to panic.",
        "Akadona calls the party together and sends them out into the misty, willow-choked wetlands to find out what happened, rescue the hunters if they can, and give them peace if they can't.",
        "Open questions: what is the creature, and how does it steal its victims' voices? What links it to the newly uncovered temple, and what waits in its lair if it retreats there? Can Evrados's band still be saved? And what grim discoveries might force Okros to reach out to another settlement?"
      ],
      start: "Okros, a fortified swamp village in the Idol Hollows",
      note: "Use this opening hook as written, or swap in one of your own. Summarized here; full text in the Core Rulebook, p. 288.",
      figures: [
        {
          name: "Huntmaster Evrados",
          role: "Okros's lost huntmaster",
          line: "Taken by a monster, his voice now cries from the swamp."
        },
        {
          name: "Elder Akadona",
          role: "Leader of Okros",
          line: "Sends the party to rescue the hunters or end their suffering."
        }
      ]
    },
    mechanics: {
      sub: "The Strength of Hate",
      rules: [
        {
          n: 1,
          head: "The Strength of Hate",
          text: "Adversaries and environments can have the extra type Umbra-Touched. Describe how the Umbra has twisted them. Umbra-Touched adversaries score a critical success against PCs on a 19–20.\n\nPCs are slowly corrupted too: when a PC deals damage, they add extra damage equal to their number of scars. When a scar fills a PC's last Hope slot, the character doesn't retire. Instead they give in to the Umbra and run off into the dark, never to return."
        },
        {
          n: 2,
          head: "Fiery Beacons",
          text: "Every settlement is built around a Sacred Pyre, lit with a Blessed Branch and kept burning by appointed Pyrekeepers. Blessed Branches are rare relics carried by people who want to found new settlements. With one, the party can relight a dead Pyre or start a new one.\n\nBlessed Branch: lighting it gives every Enduring present 3 Hope. Its fire drives off all but the strongest monsters nearby for as long as it burns, and it needs only a little kindling each day."
        },
        {
          n: 3,
          head: "Lurking Darkness",
          text: "Whenever the party finishes a short or long rest away from a Sacred Pyre, the GM rolls a d12. On 1–2, an adversary of the GM's choice attacks. On 3–5, something stalks nearby and the GM gains 2 Fear. On 6–9, the dark presses closer and the GM gains 1 Fear. On 10–11, the rest passes quietly. On 12, the party finds a hopeful sign and each PC gains a Hope.\n\nNew downtime move, Keep Watch: when the GM makes the Lurking Darkness roll, each PC on watch rolls their Hope Die and may use it in place of the GM's roll. If several PCs keep watch, use the best result."
        },
        {
          n: 4,
          head: "Soul Blight",
          text: "When a PC or humanoid NPC dies, the GM can spend 1 Fear to raise them right away as a Shambling Zombie, or 2 Fear for a Brawny Zombie. The zombie hunts the people the victim cared about. Once it's destroyed, the soul joins the Umbra, and its features may turn up on later Umbra-Touched adversaries."
        }
      ],
      note: "These rules apply only to this campaign frame. Summarized here; full text in the Core Rulebook, pp. 288–289."
    }
  },
  "motherboard": {
    overview: {
      paragraphs: [
        "The people of the Echo Vale live among the ruins, the 'echoes,' of a civilization that vanished centuries ago. Nature has overrun its roads and towers, and today's inhabitants patch together a living from powerful machines and programs they only half understand. Walled cities such as Argent stay put behind barriers that keep threats out and workers in, while wandering cities such as Carrowcroft Walkaway ride across the valley on top of huge machines.",
        "Strung across the sky is the Network, a web of metal wires that carries data and messages between cities. People still use it every day, but the language for building or changing it was lost. Access comes through data wells, tall towers with ports at their base. Many wells sit inside walled cities; the free ones out in the Wastes turn violent because wild machines gather at them like a watering hole. The Pilgrims of the Spire guard the free wells as sacred.",
        "Remnants are self-running machines left over from the old world. Some are built like animals, others for jobs such as guarding, building or housework. Tame remnants live in cities and draw power from the Network; wild ones roam the Wastes and get energy however they can, from sunlight, from other remnants or from people, and rumor says some can pull memories out of their prey. They range in size from tiny scrap-critters to giants carrying whole cities.",
        "At the heart of the valley rises the Motherboard, the tower where every Network line begins. Nobody has ever gotten inside. Most people worship her as a god, some think she's just a fallible master program, and a few technomancers and pilgrims claim to talk with her in kohd, the machine language. Technomancers run old technology, and sometimes study kohd, but can only patch remnants temporarily. Machinists handle the hardware, and they can assemble new remnants only around salvaged ancient cores.",
        "Then came the Remnant's Fury: a virus spread through the Network, and in one night hundreds of household and workplace remnants turned on the people around them while wild packs in the Wastes grew unusually savage. The violence keeps getting worse, and with an outbreak this widespread, many suspect the Motherboard is behind it."
      ],
      quote: {
        text: "The wires overhead still hum, but something new is speaking through them."
      },
      note: "Share this background with your players before they make characters. Summarized here; full text in the Core Rulebook, pp. 291–292."
    },
    incident: {
      paragraphs: [
        "After the Remnant's Fury, Argent's guard can't keep up with the infected machines, and the city's leaders want to head off a panic. Priv Maelor Rhodek, Argent's charismatic elf leader, puts together a team experienced with remnants and sends them undercover as civilians into the machinists' Build Sector to find out what's driving the attacks.",
        "Her terms: the party can keep any scrap they gather while protecting the city, but she wants as many remnant cores as they can bring back so her technomancers can study them. She also points them to an unexpected contact before they go into the scrap factory where many of the attacks have happened.",
        "That contact is Mac the Scrap Jack, a wanderborne faun who runs an illegal scrapping operation, which puts him on oddly friendly terms with the leader whose laws he breaks. He gives the party a Hotspot, a backpack device that briefly freezes nearby remnants. He also offers to pay a little quantum for one core delivered to him instead of to Rhodek, along with a chance to look at its data together.",
        "GM note: as the party destroys infected remnants in the factory, give each PC one remnant core along with their normal scrap. The Hotspot is a consumable that Restrains every remnant within Very Close range. The book lists the scrap needed to build another one (p. 300).",
        "Open questions: do the PCs pity the once-tame machines or scrap them without a second thought? Do they talk to the factory workers or just clear the floor and collect the loot? Will they hold back a core for Mac and risk trouble with the guard? And if they impress Rhodek, how much will she reveal about the Fury and the Motherboard?"
      ],
      start: "The Build Sector scrap factory in Argent, a walled city",
      note: "Use this opening hook as written, or swap in one of your own. Summarized here; full text in the Core Rulebook, p. 300.",
      figures: [
        {
          name: "Priv Maelor Rhodek",
          role: "Leader of Argent",
          line: "Hires the party undercover and wants every remnant core."
        },
        {
          name: "Mac the Scrap Jack",
          role: "Illegal scrap dealer",
          line: "Supplies a Hotspot and quietly bids for one core."
        }
      ]
    },
    mechanics: {
      sub: "Tech Damage",
      rules: [
        {
          n: 1,
          head: "Tech Damage",
          text: "In this frame, magic damage is renamed tech damage. Describe it as some kind of advanced technology at work: sonic shrieks, concussive blasts, blinding flashes, swarms of nanobots, drone beams and so on."
        },
        {
          n: 2,
          head: "Ikonis",
          text: "PCs don't use the standard primary and secondary weapons. Each character instead carries an Ikonis, a personal weapon given out at coming of age that starts as a plain metal rod and gets reshaped over time into a staff, bow, hammer, spear or anything else that fits the owner.\n\nPlayers build their Ikonis on the Motherboard module sheet, which tucks under the right side of the character sheet (see the appendix or daggerheart.com/downloads): choose trait, range and damage, give it a name and description, and write it in the Primary Weapon slot. An Ikonis always counts as two-handed and has the Bonded feature, which adds the character's level to damage rolls."
        },
        {
          n: 3,
          head: "Augments",
          text: "An Ikonis has 2 Augment slots at Tier 1 and gains another slot at each later tier. It starts with nothing installed. PCs craft augments from scrap as a downtime move and can build as many as they want, but only as many as they have slots can be installed at once. Installed augments work as extra weapon features, and PCs can swap crafted augments freely during downtime. The module sheet includes a set of base augments, and the GM is encouraged to design more on the same pattern."
        },
        {
          n: 4,
          head: "Armor",
          text: "Armor uses the normal Daggerheart options, described to fit the setting."
        },
        {
          n: 5,
          head: "Network Tether",
          text: "Every PC begins with a Network tether, a hook on a data cable that can be thrown over an overhead wire to recharge gear and connect to the Network in the Wastes. A PC needs Network access, through a tether or some other way, to take downtime moves."
        },
        {
          n: 6,
          head: "Crafting & Trading: The Quantum Economy",
          text: "Gold isn't used in this frame. The currency is quantum, earned by trading scrap. Every PC starts with 5 quantum. Price ordinary goods at 10 quantum per handful of gold, 100 per bag and 1,000 per chest. Scrap and quantum are tracked on the module sheet."
        },
        {
          n: 7,
          head: "Gathering Scrap",
          text: "After defeating remnants, the GM decides which kinds of scrap are available and how many dice of each the players roll: Shards (d6), Metals (d8) or Components (d10). Each player rolls separately and gets one piece per die from that category's table. The tables treat their numbers as thresholds, so a roll between two entries gives the lower one. Each category has six items, from cheap ones (gear, aluminum, fuse) to valuable ones (crystal, gold, battery). The tables and a worked example are on p. 302."
        },
        {
          n: 8,
          head: "Scrap Reward Table",
          text: "A guideline grid (p. 303) cross-references how many of the enemies were remnants (a few, mostly, all) with how hard the fight was (Easy through Very Difficult). Rewards run from about 2 Shards at the low end to roughly 4 Shards, 3 Metals and 3 Components at the top. The numbers assume a campaign of around 50 sessions with 1–2 fights per session, so adjust them for longer or shorter games. Also give PCs ways to hunt for specific scrap: contracts, particular adversaries, certain locations, scrap shacks."
        },
        {
          n: 9,
          head: "Relics",
          text: "Relics are a special scrap type that drops only from important or powerful remnants, with one going to each PC alongside normal scrap. Tailor each relic to the creature it came from, such as a stag's horn or a falcon's lens. Relics are worth 20 quantum and are mostly used to build powerful augments."
        },
        {
          n: 10,
          head: "Crafting with Scrap",
          text: "Crafting an augment or other item costs a downtime move plus the listed scrap. If a recipe calls for a generic Relic, any Relic will do. Some augments have prerequisites called precompiles; the base augments require a certain tier, but a precompile could be anything, such as a trait or Evasion score, a domain or a class. Augments can always be taken apart again for their scrap. Scrap also works well as a hook for side tasks, like building a specific machine or collecting parts for an NPC."
        },
        {
          n: 11,
          head: "Selling Scrap for Quantum",
          text: "Each city's scrap shacks buy and sell scrap at the item's value from the roll tables, in either direction. Daily stock is 1d10 of each Shard, 1d8 of each Metal and 1d6 of each Component; roll it when a PC wants to buy something. The GM can adjust any of this. A worked buy-and-sell example is on p. 303."
        },
        {
          n: 12,
          head: "Writing in Kohd",
          text: "This is an optional constructed language (designed by Chris Willett) that players can gradually learn to read and write over the campaign. A word is drawn as a circuit on a grid of nine nodes, with three letters per node and YZ sharing the last one. Each word begins at a charge node and ends at a ground. Dots called subnodes along the traces show a letter's position within its node, rings mark a return to a node already used, and a null modifier fixes the orientation of very short glyphs.\n\nSentences start with a coupler, put the built word-glyphs in order, place articles on the charge node, slot in shorthand lexicon glyphs (pronouns, logic words like if-then, and from-to), add punctuation at the final ground, and wire everything into one circuit. The book gives step-by-step diagrams and a full lexicon (pp. 304–307)."
        }
      ],
      note: "These rules apply only to this campaign frame. Summarized here; full text in the Core Rulebook, pp. 301–307."
    }
  },
  "colossus-of-the-drylands": {
    overview: {
      paragraphs: [
        "An old Drylands prophecy says that the Forgotten God Kudamat, the First Doom, is imprisoned beneath a mountain at the center of the world, and that his nine colossi, the Children of Godfell, will one day free him. He will then tear open the sky, kill the New Gods, drown the Mortal Realm in their blood and fill it with his own monstrous creations. For years, most people treated it as just another tall tale.",
        "According to myth, the Forgotten Gods made the Mortal Realm and were later overthrown by the New Gods, who imprisoned many of them in the earth. Their divine essence leaks up through the ground in crystal veins called essentia, the source of all magic. Mining it is enormously profitable, and the powerful treat miners' lives as an acceptable price.",
        "Godfell Mountain rises among dry mesas and holds the continent's richest essentia. Kudamat is trapped inside it. To weaken him, the New Gods cut nine shards from his soul and gave them to nine mortal riders to hide, but the riders didn't take them far enough. Over the centuries, Kudamat stretched his essentia veins out like roots until he found the first shard. Its awakening split the main street of Wyllin's Gulch with an earthquake, and he raised a colossus and a swarm of aberrations to guard it while he draws its power back and hunts for the other eight.",
        "Preacher Rayos was the first, or at least the loudest, to call this the start of the prophecy. He has brought his congregation from Left Luck Outpost to Wyllin's Gulch, where he warns about charged essentia and urges people to find the shards, and his following grows by the day.",
        "Wyllin's Gulch cares about money more than any god. Founded about forty years ago at the start of the Essentia Rush, it is now the fortified gateway to Godfell on the western rail line. Factories climb the twin mesas called the Twin Turtles, turning crystal into the batteries that run homes, guns and magic items. The sheriffs work for the mine owners, outlaws steal or sabotage essentia, and every outpost, from a cluster of tents to a real town, is there because of a vein, which makes each one a likely place for the next colossus to rise."
      ],
      quote: {
        text: "Every vein of crystal leads back to a god who wants out."
      },
      note: "Share this background with your players before they make characters. Summarized here; full text in the Core Rulebook, pp. 309–310."
    },
    incident: {
      paragraphs: [
        "When the first colossus appears outside Wyllin's Gulch, nothing the town tries works. The sheriff's makeshift army, the miners' barricades and the factories' lockdowns all fail. After most of her deputies die in a single blow, Mayor Logan Hartly posts a bounty: a chest of processed essentia to whoever kills the colossus and its aberrations.",
        "Baron Ryder Destry ('Baron' is his first name, not a title) has learned that Kudamat's siphoning has made the essentia veins connected to the shard ten times as valuable. He's offering a huge essentia payout to anyone who will help the colossus guard the shard until Kudamat is done, and he claims his factory guards can keep the town safe while his crews mine around the clock.",
        "The party answered the mayor's bounty, but Destry's offer means rival groups are already heading out to defend the colossus, and more aberrations keep climbing out of the veins. Getting through all of that only gets them to the real problem: bringing down a colossus, which no one in the Drylands has ever done.",
        "Open questions: will the party honor the mayor's contract or switch to Destry's side? Can they work both? Will Hartly actually pay? Can they stop the colossus before it flattens the Gulch or the smaller outposts nearby? And after it falls, does the prophecy keep unfolding?"
      ],
      start: "Wyllin's Gulch, a mining boomtown on the western rail line",
      note: "Use this opening hook as written, or swap in one of your own. Summarized here; full text in the Core Rulebook, p. 316.",
      figures: [
        {
          name: "Mayor Logan Hartly",
          role: "Mayor of Wyllin's Gulch",
          line: "Offers a chest of essentia for killing the colossus."
        },
        {
          name: "Baron Ryder Destry",
          role: "Essentia mining baron",
          line: "Pays mercenaries to protect the colossus so he can mine."
        },
        {
          name: "Preacher Rayos",
          role: "Doomsday prophet",
          line: "Preaches that the shards must be found to stop Kudamat."
        }
      ]
    },
    mechanics: {
      sub: "Hunts and Interludes",
      rules: [
        {
          n: 1,
          head: "Tools of the Trade",
          text: "Thanks to essentia, the Drylands have firearms and explosives. Encourage players to reskin standard gear to fit a frontier western, and also offer the frame's extra options (stats on p. 317):\n\n• Primary weapons: a Revolver (Finesse, Far) with a 6-token Ammo mechanic, where marking a Stress reloads; a Rifle (Agility, Very Far) that can spend 2 Hope for advantage; and a Shotgun (Strength, Very Close) that hits everything in front of the wielder. Damage rises with each tier.\n• Secondary weapons: a Lasso that can Rope a target (Restrained and Vulnerable while the user stays close) instead of dealing damage, and a Small Revolver that can spend 2 Hope for +4 damage.\n• Consumable: Dynamite, thrown within Close range. Everything within Very Close of where it lands makes a Reaction Roll (14): failure means 1d20+5 physical damage, success means marking a Stress. It deals double damage to objects and structures."
        },
        {
          n: 2,
          head: "Hunts and Interludes",
          text: "Play alternates between two phases. A hunt starts when a new colossus appears: the party rides to the threatened outpost, gathers information, rescues people from aberrations, tracks the colossus down and fights it. A hunt runs from a few days to a week, and the colossus and Kudamat's siphoning should keep the pressure on throughout.\n\nOnce the colossus is dead, an interlude follows, lasting from a few days to several weeks, with smaller personal jobs such as saloon bandits, a missing train or a mystery predator killing livestock."
        },
        {
          n: 3,
          head: "Colossus Stat Blocks",
          text: "Colossus is a new adversary type. Each colossus has an overall framework stat block (size, segment list, thresholds, Stress, Experiences and whole-body features) plus a separate stat block for every body segment, each with its own Difficulty, HP, attack and features, and a list of adjacent segments.\n\nA segment can be Broken, which stops it from taking actions or reactions until the condition clears. A segment that marks its last HP is Destroyed and loses all its features, though it stays attached. The colossus is beaten when every segment is Destroyed, and most also have a quicker win condition.\n\nThe Tier 1 example is Ikeri, Injuries Untold, a stone ape with a bird's head and a mesa on its back, split into head, torso, two arms and two legs (p. 319). It also works as a template for building your own."
        },
        {
          n: 4,
          head: "Example Colossus Features",
          text: "A menu of features made for colossi (p. 320):\n\n• Passives: Fatal (destroying this segment defeats the colossus), Chain (destroying every segment in the chain defeats it), Strike (Range) (immune to damage from attacks outside that range), Armored (marks 1 fewer HP), Climbing (±X) (changes the Difficulty to climb), Not Climbable, and Weak Point (marks an extra HP from Melee hits; feel free to invent other effects).\n• Actions: Shake Off (spend a Fear; everyone on the colossus makes a Strength Reaction Roll or falls and marks HP, and marks Stress even on a success) and Kudamat's Rage (spend 2 Fear; PCs within Very Far who fail a Presence roll become Shaken and lose their next Hope gain).\n• Reactions: Swatting Pests (counterattacks fliers and knocks them down), Collapsed (once every Leg segment has marked HP, high segments can be climbed from the ground), and Colossal Power (the GM gains a Fear whenever the colossus misses).\n\nA feature that names a segment affects only that segment, while one that names the colossus applies to all of it. Always record which segments are adjacent."
        },
        {
          n: 5,
          head: "Building Colossi as a Puzzle",
          text: "Design each colossus as a puzzle, not just a big pile of HP. Some segments might only be vulnerable once others are Destroyed, segments might have their own thresholds, the colossus might only take Major damage, or only a special weapon the party must find might hurt it. Begin simple and add complexity as the table gets comfortable."
        },
        {
          n: 6,
          head: "Running Colossus Fights",
          text: "Scale: describe the colossus in feet (or another real unit) so players can picture it, while still using normal range bands for actions.\n\nMovement: PCs can climb any segment unless its stat block says otherwise, and move freely around a segment once on it. Jumping to an adjacent segment takes an action roll, usually Agility or Strength.\n\nTeamwork: PCs can make as many Tag Team Rolls as they like during a colossus fight.\n\nSpotlight: treat each segment as a separate adversary. Spotlight one as your GM move and spend Fear to spotlight more. The framework can be spotlighted for its own actions, too.\n\nWhile a PC is on a segment, they have advantage against it and it can't use its standard attack on them unless a feature (such as Shake Off) says so. Push and pull effects move the PC, not the colossus. Use the targeted segment's Difficulty, or the highest Difficulty when an effect targets the whole colossus. Effects that hit multiple targets can hit multiple segments.\n\nKeep other adversaries to a minimum and give them a reason to be there. During the hunt, give out clues about weak points through rumors and sensory detail (lights, colors, textures, smells, sounds) so the fight plays out like a puzzle the players can solve (p. 321)."
        },
        {
          n: 7,
          head: "Example Colossi (Tiers 2–4)",
          text: "The book provides complete multi-segment stat blocks for one colossus per higher tier, with segment maps (pp. 322–327): Daktadae, the Cleaver (Tier 2), a steel rhinoceros made from a steam train with a cleaver for a horn; Poy, Sky Skimmer of the Dust Sea (Tier 3), a shoebill stork made of desert dust that traps foes in its beak; and Kelir, the Virulent Hate & Her Hundred, Hundred Children (Tier 4), a mountain-sized crab whose offspring swarm around her. Kelir has Hope-draining claws, a Stress-inflicting gaze, and legs that make her collapse once three are Destroyed."
        },
        {
          n: 8,
          head: "Leveling Up",
          text: "When a colossus dies, the soul shard it guarded shatters and every PC immediately gains a level. After all nine colossi are dead, the party is level 10 and ready for the final hunt against Kudamat."
        },
        {
          n: 9,
          head: "Emergence of Kudamat",
          text: "Track two things: a Siphoning Track, which starts with 1 slot marked, and Kudamat's Power, which starts at 0. During a hunt, mark the track once for each short rest and twice for each long rest. When a colossus is defeated or the track fills up, roll one d12 per marked slot, add the highest result to Kudamat's Power, and reset the track to 1.\n\nKudamat breaks out of Godfell Mountain when all nine colossi are dead or his Power reaches 100. Build him as a Colossus adversary whose Severe threshold equals his Power and whose Major threshold is half that, rounded up."
        }
      ],
      note: "These rules apply only to this campaign frame. Summarized here; full text in the Core Rulebook, pp. 317–327."
    }
  },
  "castle-high": {
    overview: {
      paragraphs: [
        "The world has gone modern: cars, phones and pop culture have largely replaced swords and sorcery in everyday life, and most people live safe, comfortable lives. But ages ago, buried crystals called skyshards ripped huge chunks of land into the sky, carrying castles, forests and whole towns with them. Small shards can also be fixed to objects and vehicles to make them fly.",
        "These floating landmasses are the skylands. Some hold ancient ruins that scholars believe were deliberately built around skyshards; some have been settled with homes, malls, hotels and drifting diners; others are wild, magic-soaked and full of beasts no one can tame.",
        "On one skyland sits Castle High, an elite boarding school where teens learn magic, swordplay, flying and, unfortunately, algebra. New students are sorted into small teams that share a dorm in one of four towers, each run by a dean with their own teaching style, and teams earn joint \"tower grades\" for extracurricular projects.",
        "Something is wrong, though. Eight students vanished on skyland expeditions last year, and the staff refuse to talk about it. Rumors blame a tower dean, a cult, a dragon, a bogeyman called the Night Snatcher, or former Headmaster Fellowes, who led the school for forty years and has now quietly vanished from her post.",
        "Her replacement, Headmaster Dove, used to be the fun, energetic head of the Arcana Department but has turned stern and rule-bound, and won't discuss Fellowes. Then, during orientation week, right after the big dance, another student—Riley Averill—disappeared, leaving behind a backpack and a private journal but taking their broom. The adults act as if nothing happened; the students are scared."
      ],
      quote: {
        text: "Homework, hexes, and a missing friend somewhere above the clouds."
      },
      note: "Share this with your players before they build characters. Summarized here; full text in the Hope & Fear, p. 117."
    },
    incident: {
      paragraphs: [
        "Setup: On the final night of orientation week, students are hanging out in the courtyard when a figure on a broom drops out of the clouds and crash-lands among them. It's a badly injured boy in a Castle High sweater.",
        "Mrs. Wickett, the headmaster's assistant, rushes over and orders everyone back. Before passing out again, the boy grabs the attention of a nearby student and gasps out a half-finished warning that someone is coming for someone.",
        "An older student recognizes him as Oliver Fleming, one of the eight kids who disappeared last year. Mrs. Wickett sends everyone back to their towers and refuses to answer questions about the missing students until Oliver has recovered.",
        "Open questions: Do the PCs sneak out of their tower to find Oliver and question him? Do they piece together where he's been by gathering gossip from classmates? And how much does Mrs. Wickett already know?"
      ],
      start: "The school courtyard on the last night of orientation week",
      note: "A suggested opening scene; adapt it or write your own. Summarized here; full text in the Hope & Fear, p. 126.",
      figures: [
        {
          name: "Oliver Fleming",
          role: "Returned missing student",
          line: "Crash-lands injured after months missing, gasping a cryptic warning."
        },
        {
          name: "Mrs. Wickett",
          role: "Headmaster's assistant",
          line: "Shuts down questions; may be hiding what she knows."
        },
        {
          name: "Headmaster Dove",
          role: "New, strict headmaster",
          line: "Once fun-loving, now rigid and silent about Fellowes's absence."
        }
      ]
    },
    mechanics: {
      sub: "Flight",
      rules: [
        {
          n: 1,
          head: "Flight",
          text: "Every student must learn to fly. At character creation, each player designs a skyshard artifact (broom, board, weapon or similar) that lets their PC fly.\n\nWhile airborne, use normal movement: a PC can fly within Close range as part of an action roll, but moving farther than Close, or making flight their main action, requires an appropriate trait roll. Warn players that being Restrained or Vulnerable, losing their artifact, or taking Severe damage can ground them temporarily, at the GM's call."
        },
        {
          n: 2,
          head: "Using Traits for Flight",
          text: "Any trait can drive a flying roll, depending on style:\n\nAgility: speed, momentum and acrobatic maneuvers.\nFinesse: precision moves and threading tight gaps.\nStrength: smashing through debris, holding steady in bad weather, ramming a rival.\nInstinct: reading winds, spotting shortcuts, sensing danger in the clouds.\nPresence: flashy flying that draws attention or creates a distraction.\nKnowledge: planning routes and calculating the timing of a foe's movements."
        },
        {
          n: 3,
          head: "A Less Lethal Campaign",
          text: "Given the lighthearted tone, consider treating most or all damage as nonlethal so students can duel, prank and subdue rivals without real violence. Alternatively, keep damage nonlethal by default and let especially dramatic moments escalate, letting PCs choose whether their damage is lethal.\n\nTo take death off the table entirely, replace a fatal death move with an extended infirmary stay or being sent home for the semester: the character is out of play for a while but not dead."
        }
      ],
      note: "Rules that apply only to this campaign frame. Summarized here; full text in the Hope & Fear, p. 127."
    }
  },
  "reign-of-the-weredragon": {
    overview: {
      paragraphs: [
        "Whelvia was once a war-torn land. The Elder Druids persuaded the great dragon Whelvarax to drive out invaders, promising that the people's worship would raise her to godhood. She expelled the armies, taught the people to farm, govern and defend themselves, and ruled for over two centuries. When she died, the druids' ritual lifted her into the sky as a constellation—the first Ascendant.",
        "Seven dragon wardens followed, some kind and some cruel; only the mightiest joined the stars as Faint Divinities. Over time the druids faded away, and the Knights of Whelvia became the realm's sworn protectors, bound to each warden by a shared duty to the people.",
        "For the last century the warden was Sazanthe, a scholarly purple dragon based at Vexstone Abbey who wanted a peaceful, curious, open Whelvia. He chose as companion Forlorne Lykona, an orphaned faun sorceress and cult leader who read in the stars that he would become the next Ascendant. During their bonding ritual she turned the magic on him and absorbed him. The blast destroyed the abbey and left most of the witnesses as ghosts trapped in its ruins.",
        "Forlorne now rules as a weredragon tyrant from Nwarlyth, her mountaintop fortress, able to switch between her faun body and Sazanthe's dragon form. She wants to ascend through her subjects' fear rather than their love. The Knights now enforce her will, dissenters are jailed or devoured, and her breath turns enemies into feral weredrakes that fill her army.",
        "Since taking Sazanthe's power, Forlorne gets no answers from the stars, so she rounds up sky seers—and kills the ones whose readings displease her. Real seers have gone into hiding, but they secretly whisper of unlikely heroes destined to bring her down. The PCs are those heroes."
      ],
      quote: {
        text: "The stars have gone quiet for the queen—but they still speak of you."
      },
      note: "Share this with your players before they build characters. Summarized here; full text in the Hope & Fear, pp. 129–130."
    },
    incident: {
      paragraphs: [
        "Setup: The party is having breakfast at the Red Leaf Inn in the Whelvewood when a seagull pesters them, blinking in and out of existence in puffs of blue smoke, then drops a scroll.",
        "The scroll is a map marking a route through the Whelvewood to a place called \"Heaven's Eye.\" The forest is contested ground: Knight militias are trying to occupy it while rebels and locals fight to drive them out, and both sides treat strangers as potential enemies.",
        "On the back are a rabbit silhouette and a short rhyming note saying to find where the trees cross, show the drawing to the Foes of the Fox to pass safely through \"the warren,\" and expect to pay a price. The gull then steals some food and vanishes.",
        "Behind the scenes, Schon—Forlorne's right hand and a gifted sky seer who is secretly plotting her downfall—sent the bird after the stars revealed that the party matters to her defeat. Schon doesn't know why Heaven's Eye is important, only how to get there, and the seagull can return to guide the party if they get lost.",
        "Open questions: What dangers lie on the road to Heaven's Eye? Will the party trust the mysterious messenger? Will they side with the militias or the rebels to get through the forest? What waits in the warren, and what price will they accept?"
      ],
      start: "The Red Leaf Inn in the Whelvewood",
      note: "A suggested opening scene; adapt it or write your own. Summarized here; full text in the Hope & Fear, p. 139.",
      figures: [
        {
          name: "Forlorne Lykona",
          role: "Weredragon tyrant queen",
          line: "Faun sorceress who stole a dragon's power to become a god."
        },
        {
          name: "Schon",
          role: "Forlorne's secret betrayer",
          line: "Her right-hand seer, quietly steering the party toward her downfall."
        },
        {
          name: "The Astromancer",
          role: "Seer at Heaven's Eye",
          line: "Reads the night sky to reveal how Forlorne can be beaten."
        }
      ]
    },
    mechanics: {
      sub: "Curses",
      rules: [
        {
          n: 1,
          head: "Curses",
          text: "A magical curse is a special condition (core rulebook p. 102). Two curses are central to this campaign: the Weredrake Curse, from Forlorne's \"Breath Weapon,\" and the Petrified Curse, from her \"Stone-Cold Gaze,\" which turns a creature and its gear to stone. Feel free to invent more.\n\nA curse can only be removed by magic: a spell, ritual, magic item, special location, supernatural event, higher power, or a mix of these. Working out the cure usually means research, which can launch a quest or a search for an NPC who can help. Two ready-made curse breakers are described under Keys to Victory."
        },
        {
          n: 2,
          head: "The Astromancer's Revelations",
          text: "At the Heaven's Eye observatory, the Astromancer gives the party five revelations. The players roll 5d6 together; each die points to a row (1–6) of the Night Sky Reading table, and the GM assigns one die to each of the five columns (one die per column). Spread the results across different places so the party has to travel widely. You can swap in table entries the players invented at session zero.\n\n1. Secret's Location: where the PCs can learn a secret that helps defeat Forlorne. Each player privately writes down a secret they think Forlorne is hiding; between sessions, pick one to inspire that adventure.\n2. Powerful Ally: an NPC who brings a pool of 3 Hope to any scene with Forlorne. PCs within Far range can spend from it as if it were their own Hope. If the ally drops or dies, the pool is lost.\n3. Key to Victory 1: a defensive item and where to find it. A PC holding one gains 1d4 Hope when Forlorne appears.\n4. Key to Victory 2: a weapon that can hurt Forlorne. Its wielder gets +1 Proficiency on attacks against her.\n5. Showdown Location: where the final battle will most likely happen. If the PCs arrive with the secret, the ally and both items, Forlorne fights alone, and her \"Feed on Fear\" and \"Terrifying\" features don't work there."
        },
        {
          n: 3,
          head: "Night Sky Reading (table)",
          text: "A six-row d6 table with columns for Roll, Secret's Location, Powerful Ally, Key to Victory 1, Key to Victory 2 and Showdown Location. Locations include Nightshade, Elevarne, Nwarlyth, Stillwater Lake, Vexstone Abbey and Witch's End. Each row's ally is a named NPC with a short hook, such as a dryad guarding a graveyard, a cave ogre, a bound demon, a petrified spymaster, or Forlorne's ghostly twin sister. Item entries point to core-rulebook loot or to the two items in this chapter. See the book, p. 141."
        },
        {
          n: 4,
          head: "Keys to Victory",
          text: "Two items from the table can break curses. Lady Lavender's Longsword is a Tier 3 two-handed primary weapon owned by a retired knight in Knightstead; its \"Curse Breaker\" feature removes all magical curses from any creature it touches. The Zoetrope of the Bright Bacchanal is buried in the ruins of the Lykona cottage at Witch's End; when lit and wound up, it removes all magical curses from creatures within Close range while it spins. Full stat blocks are on p. 142."
        },
        {
          n: 5,
          head: "Evening the Odds",
          text: "If the party has followed the reading and collected everything before reaching Tier 4, let them reach at least level 8 before they face Forlorne. Use complications or new story arcs to delay the confrontation so leveling feels natural."
        },
        {
          n: 6,
          head: "Unique Adversaries: Forlorne Lykona",
          text: "Forlorne has three stat blocks: a shared Tier 4 Solo framework (HP 11, Stress 8; Relentless (4); a \"Transform\" action that costs a Stress; and a reaction that heals her when a nearby PC fails with Fear), plus separate Faun Form and Dragon Form blocks with their own Difficulty, thresholds, attacks and features. Use whichever form she's currently in.\n\nHer faun form is charming and civil, the shape she wears to run her realm, with teleporting, entangling vines and her petrifying gaze. Her dragon form is savage and terrifying, with flight, a fear aura, the curse-spreading breath weapon and a tail sweep. See pp. 142–143."
        },
        {
          n: 7,
          head: "Weredrake",
          text: "A weredrake is someone transformed by Forlorne's breath: a wingless, four-legged dragon about the size of the person it used to be. It cannot speak and has none of that person's memories, though traces of their ancestry may show, such as a mechanical look on a former clank or a carapace on a former faerie. It can return to its old form while keeping its claws and teeth, often to lure in prey.\n\nThe book gives a Tier 1 Standard stat block with pack-hunting and climbing features. Scale it up as the party advances, using the core rulebook's improvising-adversaries guidance (core p. 208). See p. 143."
        }
      ],
      note: "Rules that apply only to this campaign frame. Summarized here; full text in the Hope & Fear, pp. 140–143."
    }
  },
  "dark-heart-of-andaluria": {
    overview: {
      paragraphs: [
        "Andaluria is a hot, volcanic wine country that won independence from Emperor Arcedrio in a revolt a hundred years ago. It is now run by the Council of Five and grows rich on vineyards and harbor trade, but old rituals, secret deals and hungry monsters still shape life there.",
        "The dormant Serracorte volcanoes in the north shelter vineyards and shepherd country. The Valmorria River runs south through the valleys to the coastal capital, Jesaña, famous for its summer music, dancing and drinking.",
        "Monsters such as ghosts and ghouls have always preyed on Andalurians. For generations, people kept them at bay with the Church of the Golden Eminence's rites and the folk magic of the nomadic Caio. Those protections are now failing.",
        "This year, each night stretches longer and grows deadlier as the solstice approaches. The moon hangs in the sky too long, monsters roam the fields, and the rich hide at masked balls in the hilltop castillo of Condesa Ysabela Delamoña IV. People fear the coming Midsummer Festival will end in bloodshed. Meanwhile, Archbishop Veyra wins followers by preaching a purified faith that condemns Caio \"heresy.\"",
        "Ordinary Andalurians have started hunting monsters themselves, and secret cells of the Sombral Spade, led by the mysterious Julio Cantafierro, fight back with steel, fire and forbidden lore. The common people cheer them, the church calls them heretics, and the powerful put up with them because they need them. The PCs are one such band of hunters, and they risk becoming monsters themselves."
      ],
      quote: {
        text: "When the festival wine runs red, someone has to hunt what crawled out of the cask."
      },
      note: "Share this with your players before they build characters. Summarized here; full text in the Hope & Fear, p. 145."
    },
    incident: {
      paragraphs: [
        "Setup: At Santavio's wine festival, the first barrels of Condesa Delamoña's prized vintage are opened and give off a foul reek. Monsters made of vine, claw and bloody pulp burst out and drag villagers off into the vineyards.",
        "The Council of Five sends the Nightwatch under Andrea Nocta. Their real orders are to protect the remaining casks, not the villagers, and they are not trained to fight monsters if the creatures come back.",
        "The villagers barricade themselves indoors and argue over the cause. Some say the Condesa waters her vines with innocent blood and the vengeful dead now live in the grapes. Archbishop Mateo Veyra blames Caio heretics and calls the frightened villagers into his church.",
        "Julio Cantafierro of the Sombral Spade asks the party to track the creatures, rescue anyone still alive, and destroy whatever is corrupting the vineyard so this can't happen again.",
        "Open questions: What ties the party to Cantafierro and the Spade, and what drives them: pay, honor or something else? Will they go after the people who were taken or protect the ones left behind? What detail in witness accounts frightens them most, and what trail did the monsters leave?"
      ],
      start: "The village of Santavio, the night of its wine festival",
      note: "A suggested opening scene; adapt it or write your own. Summarized here; full text in the Hope & Fear, p. 151.",
      figures: [
        {
          name: "Julio Cantafierro",
          role: "Sombral Spade leader",
          line: "Hires the party to hunt the vineyard horrors."
        },
        {
          name: "Condesa Ysabela Delamoña IV",
          role: "Reclusive noble vintner",
          line: "Her cursed wine unleashed the monsters; rumors swirl about her."
        },
        {
          name: "Archbishop Mateo Veyra",
          role: "Zealous church leader",
          line: "Blames the Caio and exploits the panic to gain followers."
        }
      ]
    },
    mechanics: {
      sub: "Monster-Hunting Equipment",
      rules: [
        {
          n: 1,
          head: "Monster-Hunting Equipment",
          text: "Encourage players to reskin standard gear to fit the gothic monster-hunter style. The frame also adds new options that can be picked at character creation or handed out as loot:\n\nPrimary weapons: Blessed Brass Knuckles, Holy Shotgun, Repeating Crossbow.\nSecondary weapons: Wooden Stake, Hallowed Shield, Chain Whip.\nArmor: Coffinwood Armor, Leather Longcoat, Silverweave Armor.\n\nEach weapon's damage scales by tier, and each armor's thresholds and score scale by tier. They carry features such as hitting everything in front of you, adding a quick extra target, bonus damage when paired, extra Hope on a crit, pulling targets into Melee, bonus thresholds from unmarked Armor Slots, quieter movement, and reduced magic damage. Full tables are on pp. 152–153."
        },
        {
          n: 2,
          head: "Transformations: Reanimated",
          text: "If a PC dies, ask the player whether they'd like the character to come back reanimated. If so, decide together between sessions where they wake up (a hidden lab, workshop or place of power). They gain the Reanimated transformation and their maximum loadout drops to one. Each rest, they can spend a downtime move to raise it by one, back up to the usual five."
        },
        {
          n: 3,
          head: "Transformations: Vampire",
          text: "Give a major vampire adversary the Vampire's Curse action. On a successful Melee attack, the GM can spend a Fear to bite the target, dealing physical damage of a number of d8s equal to the vampire's tier, and then rolls a d6. If the d6 matches any of the damage dice, the target marks all their Stress and becomes a Vampire. If a player wants their PC turned, the attack simply succeeds."
        },
        {
          n: 4,
          head: "Transformations: Werewolf",
          text: "Give a major werewolf adversary the Wolf's Curse action. On a successful Melee attack, the GM can spend a Fear to bite, dealing physical damage of a number of d20s equal to the werewolf's tier. If the bite deals Major damage or more, the target starts a long-term Lycanthropy Countdown (6). It ticks down at each rest where the PC doesn't spend a downtime move to slow the curse, and when it triggers the PC becomes a Werewolf. A willing player's PC is hit automatically and starts the countdown no matter how much damage they took."
        },
        {
          n: 5,
          head: "Implementing & Removing Transformations",
          text: "Check with the group before using transformations at all. If you leave them out, explain in the fiction why the PCs are immune, for example through charms, tattoos, tonics brewed in downtime, or an inherited resistance. If you use them, plan ways a PC could undo the change, such as a faction's ritual, a rare remedy in a distant village, or a known healer of the cursed. Player consent and agency come first."
        },
        {
          n: 6,
          head: "The Hunt",
          text: "An optional framework for building a monster session or short arc, and it works for any major villain. It has five beats:\n\n• Arrival: a strange event pulls the PCs in.\n• Investigation: they follow leads and collect clues.\n• Escalation: they pull their findings together and make a plan.\n• Confrontation: they banish, bind or kill the monster.\n• Epilogue: loose ends are tied up.\n\nUse whatever parts help your table."
        },
        {
          n: 7,
          head: "Making a Monster",
          text: "Monsters in this frame are tainted by the hellgate beneath the Serracorte and want to destroy, devour or corrupt Andalurians. Build one by answering four questions:\n\n• What is it? A folklore creature, an unusual cryptid, a corrupted human, or something new. Give it a twist.\n• What does it want? Pick a drive such as wrath, lust, power, sorrow, revenge, greed, hunger, envy or fear.\n• Where can you find it? A lair or hunting ground that makes a good set piece.\n• How can you defeat it? Every monster has a weakness: a material, a ritual, a circumstance, or a combination. Killed any other way, it escapes or comes back stronger.\n\nOptionally, add complications such as minions, vulnerable bystanders, and key events or places that show off the monster."
        },
        {
          n: 8,
          head: "Preparing Liminal Clues",
          text: "Before play, answer the four monster questions, then write 4–6 Liminal Clues: pieces of evidence that each point toward an answer. Keep them on cards. They aren't tied to any location; one appears whenever the PCs investigate or take a risk somewhere it would fit. Once a clue is revealed, it becomes fixed fact. Mix broad clues that could turn up almost anywhere with specific ones that suit particular scenes.\n\nIt takes practice. Players may need to see the same information several ways before acting on it, and it's fine to repeat or reword a clue. When every clue has been found, the PCs should be ready to confront the monster."
        },
        {
          n: 9,
          head: "Structure of a Hunt",
          text: "Guidance for each beat:\n\nArrival: an opening scene that hooks the PCs with something uncanny.\nInvestigation: the PCs follow leads, and clues come out through evidence, witnesses, experts, rumors, research or magic.\nEscalation: the PCs connect what they know and plan. If they stall, have the monster or its allies come after them or someone they care about.\nConfrontation: the PCs use the monster's weakness against it, usually in a fight.\nEpilogue: tie up threads, push long-term projects forward, and hint at the next mystery."
        },
        {
          n: 10,
          head: "Example of Play",
          text: "A worked example (pp. 156–157) follows a GM building a ghost story: a drowned girl's spirit draining villagers in their sleep, with an old well as the setting, a list of Liminal Clues, and a planned outline for each beat. It then shows the session as played, including how the players' conclusions changed both the monster's lair and its weakness from the GM's plan, and why the GM went along with them."
        }
      ],
      note: "Rules that apply only to this campaign frame. Summarized here; full text in the Hope & Fear, pp. 152–157."
    }
  },
  "journey-to-horizon": {
    overview: {
      paragraphs: [
        "The goddess Aurelia raised the continent of Valloren from the sea and shaped wondrous landscapes using terrana, a renewable magical essence. She chose thirteen magi to watch over it, and an Age of Wonder followed.",
        "Two of the magi, the Lovers Yrska and Drago, used terrana recklessly to build ever-grander cities and rebelled when Aurelia told them to stop. They won the other magi over one by one. With terrana nearly exhausted and her side cornered on the eastern coast, Aurelia sacrificed herself: she sealed her shrines behind barriers and brought down the stars, wiping out all thirteen traitors. As she died, she promised to return.",
        "That catastrophe, the Starfall, devastated the land. For a thousand years—the Long Sorrow—survivors lived sealed inside isolated sanctuaries. When the barriers finally opened, they found New Valloren: wild, transformed by surging terrana, and poisoned by shadowblight seeping from the craters where stars fell, which spawns monsters.",
        "High Priestess Saraya of the Marrogate sanctuary found a Soul Echo, a fragment of Aurelia's essence. She learned that collecting the Echoes scattered across Valloren and carrying them to the place Aurelia died could bring her back, and she made a Vessel of Light to hold them.",
        "Enemies are moving. The Cult of the Two-Headed Coin, which worships the Lovers, has planted Fellsworn Templars inside Saraya's order, and shadowy Seekers-in-Shadow are appearing everywhere. When the Templars strike, Saraya hands the Vessel to the PCs and gives her life to cover their escape. Now they must cross a hostile continent, resting only in sanctuaries, to revive the goddess."
      ],
      quote: {
        text: "Carry the goddess home, one hex at a time."
      },
      note: "Share this with your players before they build characters. Summarized here; full text in the Hope & Fear, p. 159."
    },
    incident: {
      paragraphs: [
        "Setup: Soon after the sanctuary walls fell, Saraya Rinn, a high priestess of the Aurelian Order, found Aurelia's Soul Echo at Marrogate's central shrine. She spent weeks making the Vessel of Light, then planned the trip to the Cliffs of Horizon with her apprentice Tolren and chose local citizens to guard it.",
        "On departure day, armed priests surround her and Tolren reveals he is a Fellsworn Templar loyal to the Lovers. None of her messages went out and no allies are waiting; he only tipped off the cult so they could take the Vessel.",
        "Saraya calls on terrana to make plants erupt through the shrine floor, tangling the attackers and bringing the building down. In the confusion, she gives the Vessel to the party, makes them swear to bring it to Horizon, and tells them to find Abbot Kensington in nearby Cinteri.",
        "Open questions: How will the party slip past the Templars searching the sanctuary? Who can they trust to help them escape? Once outside, will they go straight to Cinteri or take a riskier route to throw off pursuit?"
      ],
      start: "The shrine of Marrogate sanctuary, at Valloren's southwestern tip",
      note: "A suggested opening scene; adapt it or write your own. Adjust the Soul Echo and Vessel to match your table's descriptions. Summarized here; full text in the Hope & Fear, p. 168.",
      figures: [
        {
          name: "Saraya Rinn",
          role: "Aurelian high priestess",
          line: "Discovered the Echo and sacrifices herself to save the Vessel."
        },
        {
          name: "Tolren",
          role: "Traitorous apprentice, Fellsworn Templar",
          line: "Betrays Saraya to the Lovers' cult."
        },
        {
          name: "Abbot Kensington",
          role: "Potential ally in Cinteri",
          line: "The contact Saraya sends the party to find."
        }
      ]
    },
    mechanics: {
      sub: "The Hex Crawl",
      rules: [
        {
          n: 1,
          head: "The Hex Crawl",
          text: "Travel across New Valloren uses a hex map, with each hex roughly 24 miles across (adjust as the story needs). The party moves between sanctuaries one hex at a time and deals with encounters along the way. In the wilderness they can take up to three short rests but no long rests, so they need to manage resources carefully.\n\nThe procedure exists to support the story, not replace it: long stretches of travel go by in montage, with a few scenes played out in detail. Bring players in by asking about rumors, strange sounds in the night, people they know nearby, or old legends of the region. Change or drop rules whenever the story calls for it."
        },
        {
          n: 2,
          head: "Journeys in Valloren",
          text: "The goal is to find nine shrines holding Aurelia's remaining Soul Echoes, add each to the Vessel, and bring the Vessel to the Cliffs of Horizon. Use two copies of the map. The GM's key map records each hex's habitat, terrain, and points of interest or encounters. The players' map shows only sanctuaries and pre-Sorrow geography, and the players fill it in as they explore."
        },
        {
          n: 3,
          head: "Preparing the GM's Key Map",
          text: "Fill in hexes by choosing, rolling, or a mix of both. You only need to prepare the areas the party will probably reach in the next session or two.\n\nPlacing Soul Echoes: before play, choose nine sanctuaries to hold Echoes. Spread them across the continent without an obvious pattern, and roughly from west to east, so early Echoes come quickly and the last one is near Horizon.\n\nFilling wilderness hexes, one region at a time: roll d20 for habitat, d12 for size in contiguous hexes (don't enclose empty hexes), d8+d6 for a signature encounter, d4 for terrain, which sets the days needed to enter each hex, and d100 for a rumor whose truth you decide."
        },
        {
          n: 4,
          head: "Example Region Generation",
          text: "A worked example (p. 170): a GM rolls a small forest region with extreme terrain, a Cult of the Two-Headed Coin encounter, and a rumor about a half-buried clockwork machine. He places the region across the party's most direct route, makes the machine an Age of Wonder relic the cult is after, and plans the fight with the Battle Point system."
        },
        {
          n: 5,
          head: "Habitat (d20)",
          text: "This table sets a region's main habitat: 1 Shadowblighted (roll again for the corrupted habitat; a second 1 means it's almost impassable), 2 Underground, 3–4 Aquatic, 5–6 Wetland, 7–8 Grassland, 9–10 Tropical, 11–12 Forest, 13–14 Drylands, 15–16 Rolling, 17–18 Mountain, 19 Frozen, 20 Badlands. Each entry lists example biomes. Because of terrana, very different biomes can sit side by side, and ordinary lakes and rivers don't need to be tracked. See p. 170."
        },
        {
          n: 6,
          head: "Encounter (d8 + d6)",
          text: "This table gives a 2–14 bell curve of encounter types meant to keep the wilderness dangerous. Results include rolling twice and combining, other travelers, setbacks (optionally the GM gains a Fear per PC), Seekers-in-Shadow, extreme weather, hostile people, a beast's territory, environmental hazards, the Cult, a remarkable site, good luck (optionally each PC gains a Hope), a settlement, and hidden loot. Use them as starting points. See p. 171."
        },
        {
          n: 7,
          head: "Terrain (d4)",
          text: "Terrain sets how many days it takes to enter a hex and is usually the same across a region: 1 Optimal (roads; about 1 day; more fellow travelers), 2 Fair (trails; 2 days), 3 Rough (game tracks and undergrowth; 3 days), 4 Extreme (cliffs, bogs, trackless wilds; 4 days, and may need gear or magic). See p. 171."
        },
        {
          n: 8,
          head: "Rumors (d100)",
          text: "A table of 100 short, strange region hooks. You decide whether each is true, false or partly true, whether the party has heard it, and how they heard it, such as at a sanctuary, from a merchant, or from signs on the road. Full table on pp. 172–173."
        },
        {
          n: 9,
          head: "Dice Tables for Creating Sanctuaries",
          text: "Generate a sanctuary by rolling d20 Trade & Exports, d12 Quirk (customs, art, taboos and the like), d10 Crisis, d10 Drive, d8 Political System, d6 Size (isolated dwelling up to city), and d4 Population (sparse to crowded). Then weave the results into one story. The worked example turns the rolls into a declining port town known for terrana liquors and painted murals, run by a corrupt merchant guild and trying to rebuild its reputation. Build each sanctuary before the session where the party will arrive. Tables on p. 174."
        },
        {
          n: 10,
          head: "Settlement Name (d100×2)",
          text: "Roll d100 twice on a table of name parts and combine one element from each roll to name a settlement, sanctuary or landmark. Table on p. 175."
        },
        {
          n: 11,
          head: "Tracking the Party's Location",
          text: "The players mark their progress on their own map. The PCs are skilled pathfinders, so they know what's in their current hex and the adjacent ones, including any visible landmarks there. The GM decides how much else to tell them."
        },
        {
          n: 12,
          head: "Travel Days",
          text: "A normal travel day is: break camp before dawn, travel about 6–8 hours, stop at midday, travel another 6–8 hours until dusk, then make camp and set a watch. Scouting, foraging, repairs and keeping watch happen in the background. Play them out only if the table enjoys it."
        },
        {
          n: 13,
          head: "Resting",
          text: "There is no ration tracking; rests stand in for supplies. In the wilderness, a short rest means spending a whole day in one place. A long rest takes several days and is only possible inside a sanctuary. Sleeping at night is fiction only and gives no mechanical rest. After three short rests in a row, the next rest must be a long rest (core p. 105), so the party has to head back to civilization to recover fully.\n\nSpecial downtime move, Locate Soul Echoes: a PC communes with the Vessel and learns the general compass direction of the nearest sanctuary holding an Echo. At the GM's discretion, this can also alert nearby Seekers-in-Shadow to the Vessel's general direction."
        },
        {
          n: 14,
          head: "Encounter Rolls",
          text: "When the party enters a hex, roll d6s equal to its terrain rating. Any 1 triggers the region's prepared encounter; otherwise the GM can spend a Fear to trigger one anyway. Use d4s for more dangerous areas or d8s for safer ones. If a region triggers more than once, roll a new encounter or borrow and reskin one from a region the party is skipping. A worked example is on p. 176.\n\nOptional Endurance Countdowns: after a rest, each PC starts an Endurance Countdown (6). On entering a wilderness hex, each player rolls their Hope Die: a result at or below the countdown's current value means they mark a Stress; otherwise the countdown ticks down. When it triggers, the PC is Vulnerable until their next rest. All countdowns end when a rest begins.\n\nWhen disaster looms: if the party is stranded with no short rests and every HP and Stress marked, the GM chooses the outcome. Options include the quest failing, a new party taking up the Vessel (possibly years later), or a rescue or capture that costs them the Vessel and sets up a mission to get it back."
        },
        {
          n: 15,
          head: "Traveling over Water",
          text: "Water travel uses the overland rules with a few changes. Rivers: with a boat and a navigable waterway, going downstream lowers a hex's terrain rating by 1, and going upstream adds a day. Ocean: with a ship, roll a d4 for weather on entering each hex, and the result is the number of days it takes (1 tailwind, 2 fair, 3 rough water, 4 extreme weather). Describe how hard the crew work wears the PCs down."
        },
        {
          n: 16,
          head: "Character Advancement",
          text: "The party levels up each time they add a Soul Echo to the Vessel. They start with one Echo and collect nine more, which takes them from level 1 to level 10."
        },
        {
          n: 17,
          head: "Doom Track",
          text: "The Doom Track (in the appendix, or downloadable) tracks disasters spreading across New Valloren. At the end of each session, mark one box at or below the party's tier; a nested box can only be marked after the box it hangs from. Work each marked event into play when it makes sense, at least once and possibly more. Skip a mark when the heroes push back the darkness, or add extra marks when they dawdle or let evil spread, such as a sanctuary falling to the Cult. It's paced for about 30–40 sessions, so adjust for a shorter or longer campaign."
        },
        {
          n: 18,
          head: "Campaign Adversaries",
          text: "There are two features you can add to any adversary. Shadowblighted (Passive): the creature is visibly corrupted, and in or near shadowblight it crits on 18–20. Terranamancer (Passive): the adversary marks a Stress to use a spell tied to the local habitat. Options include Heat, Overgrowth, Wind, Ice (inflicts Frostbitten, −1 Proficiency), Poison (inflicts Nauseated, no Hope gain), Stone (threshold bonus) and Water. Damage dice scale with the adversary's tier. Details on p. 178."
        },
        {
          n: 19,
          head: "Full Gameplay Example",
          text: "A detailed two-page walkthrough (pp. 178–179) follows a party leaving one sanctuary for another 10 hexes away that may hold an Echo. It shows route choices between terrain types, encounter rolls, rests and Endurance Countdowns in action, with map illustrations that use fog of war."
        }
      ],
      note: "Rules that apply only to this campaign frame. Summarized here; full text in the Hope & Fear, pp. 169–179."
    }
  }
};

/** Figures shown on each campaign dashboard. */
export const KEY_FIGURES: Record<PublishedFrameId, KeyFigure[]> = {
  "witherwild": [
    {
      name: "Kreil Dirn",
      role: "Haven’s spymaster"
    },
    {
      name: "The Fanewraith",
      role: "Rebel leader"
    },
    {
      name: "Archmage Phylax",
      role: "High Magus of Haven"
    },
    {
      name: "Nikta, the Great Owl",
      role: "Shepherd of the Seasons"
    }
  ],
  "five-banners-burning": [
    {
      name: "Clover of Towers",
      role: "Missing Jesthaen heir"
    },
    {
      name: "Kostren",
      role: "Seeker of Hilltop"
    },
    {
      name: "Goledraelle",
      role: "Armadan merchant-spy"
    }
  ],
  "beast-feast": [
    {
      name: "Carat",
      role: "Elmore's alchemist"
    },
    {
      name: "Doug Dougle",
      role: "Halfling mayor of Elmore"
    },
    {
      name: "Hylaeus the Forest Mage",
      role: "Creator of the Lure"
    }
  ],
  "age-of-umbra": [
    {
      name: "Huntmaster Evrados",
      role: "Okros's lost huntmaster"
    },
    {
      name: "Elder Akadona",
      role: "Leader of Okros"
    }
  ],
  "motherboard": [
    {
      name: "Priv Maelor Rhodek",
      role: "Leader of Argent"
    },
    {
      name: "Mac the Scrap Jack",
      role: "Illegal scrap dealer"
    }
  ],
  "colossus-of-the-drylands": [
    {
      name: "Mayor Logan Hartly",
      role: "Mayor of Wyllin's Gulch"
    },
    {
      name: "Baron Ryder Destry",
      role: "Essentia mining baron"
    },
    {
      name: "Preacher Rayos",
      role: "Doomsday prophet"
    }
  ],
  "castle-high": [
    {
      name: "Oliver Fleming",
      role: "Returned missing student"
    },
    {
      name: "Mrs. Wickett",
      role: "Headmaster's assistant"
    },
    {
      name: "Headmaster Dove",
      role: "New, strict headmaster"
    }
  ],
  "reign-of-the-weredragon": [
    {
      name: "Forlorne Lykona",
      role: "Weredragon tyrant queen"
    },
    {
      name: "Schon",
      role: "Forlorne's secret betrayer"
    },
    {
      name: "The Astromancer",
      role: "Seer at Heaven's Eye"
    }
  ],
  "dark-heart-of-andaluria": [
    {
      name: "Julio Cantafierro",
      role: "Sombral Spade leader"
    },
    {
      name: "Condesa Ysabela Delamoña IV",
      role: "Reclusive noble vintner"
    },
    {
      name: "Archbishop Mateo Veyra",
      role: "Zealous church leader"
    }
  ],
  "journey-to-horizon": [
    {
      name: "Saraya Rinn",
      role: "Aurelian high priestess"
    },
    {
      name: "Tolren",
      role: "Traitorous apprentice, Fellsworn Templar"
    },
    {
      name: "Abbot Kensington",
      role: "Potential ally in Cinteri"
    }
  ]
};
