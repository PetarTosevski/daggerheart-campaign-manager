// The frame's starting characters (the board's SEED and SEED_AL), created once
// per campaign the first time its GM opens Characters & Locations. All start
// secret from the players. Pure module.

type SeedCharacter = { name: string; role: string; allegiance?: string };

const SEED: Record<string, SeedCharacter[]> = {
  witherwild: [
    { name: "Kreil Dirn", role: "Haven’s spymaster", allegiance: "Haven" },
    { name: "The Fanewraith", role: "Rebel leader", allegiance: "Fanewick" },
    { name: "Archmage Phylax", role: "High Magus of Haven", allegiance: "Haven" },
    { name: "Nikta, the Great Owl", role: "Shepherd of the Seasons", allegiance: "Neutral" },
  ],
  "dark-heart-of-andaluria": [
    { name: "Julio Cantafierro", role: "Sombral Spade leader" },
    { name: "Condesa Ysabela Delamoña IV", role: "Reclusive noble vintner" },
    { name: "Archbishop Mateo Veyra", role: "Zealous church leader" },
  ],
  "beast-feast": [
    { name: "Carat", role: "Elmore's alchemist" },
    { name: "Doug Dougle", role: "Halfling mayor of Elmore" },
    { name: "Hylaeus the Forest Mage", role: "Creator of the Lure" },
  ],
  "castle-high": [
    { name: "Oliver Fleming", role: "Returned missing student" },
    { name: "Mrs. Wickett", role: "Headmaster's assistant" },
    { name: "Headmaster Dove", role: "New, strict headmaster" },
  ],
  "colossus-of-the-drylands": [
    { name: "Mayor Logan Hartly", role: "Mayor of Wyllin's Gulch" },
    { name: "Baron Ryder Destry", role: "Essentia mining baron" },
    { name: "Preacher Rayos", role: "Doomsday prophet" },
  ],
  "five-banners-burning": [
    { name: "Clover of Towers", role: "Missing Jesthaen heir" },
    { name: "Kostren", role: "Seeker of Hilltop" },
    { name: "Goledraelle", role: "Armadan merchant-spy" },
  ],
  "journey-to-horizon": [
    { name: "Saraya Rinn", role: "Aurelian high priestess" },
    { name: "Tolren", role: "Traitorous apprentice, Fellsworn Templar" },
    { name: "Abbot Kensington", role: "Potential ally in Cinteri" },
  ],
  motherboard: [
    { name: "Priv Maelor Rhodek", role: "Leader of Argent" },
    { name: "Mac the Scrap Jack", role: "Illegal scrap dealer" },
  ],
  "age-of-umbra": [
    { name: "Huntmaster Evrados", role: "Okros's lost huntmaster" },
    { name: "Elder Akadona", role: "Leader of Okros" },
  ],
  "reign-of-the-weredragon": [
    { name: "Forlorne Lykona", role: "Weredragon tyrant queen" },
    { name: "Schon", role: "Forlorne's secret betrayer" },
    { name: "The Astromancer", role: "Seer at Heaven's Eye" },
  ],
};

/** The frame's starting characters (none for Custom). */
export function seedCharacters(frameId: string): readonly SeedCharacter[] {
  return SEED[frameId] ?? [];
}
