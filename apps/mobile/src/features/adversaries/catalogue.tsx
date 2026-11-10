import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import {
  countLine,
  filterAdversaries,
  groupByTier,
  moreLabel,
  NO_FILTERS,
  openCount,
  PAGE_FIRST,
  PAGE_MORE,
  sortAdversaries,
  toggleChip,
  typeLabel,
  type CatalogueFilters,
  type CatalogueSort,
  type CatalogueTier,
} from "../../../../../src/lib/adversaries/catalogue";
import { adversariesFor } from "../../../../../src/lib/domain/adversaries";
import { ADVERSARIES } from "../../../../../src/lib/srd/adversaries";
import { ADVERSARY_TYPES, type AdversaryDef } from "../../../../../src/lib/srd/types";
import { Button } from "../../ui/button";

import { Chip } from "./controls";
import { StatBlock } from "./stat-block";
import { advStyles } from "./styles";

const TIERS: readonly CatalogueTier[] = [1, 2, 3, 4];
const NO_COLLAPSED: ReadonlySet<number> = new Set();

/** The adversaries this campaign can use (Core, Hope & Fear with the switch on, frame-exclusive blocks in their frame). */
export function useVisibleAdversaries(hopeAndFear: boolean, frameId: string): AdversaryDef[] {
  return useMemo(() => adversariesFor(ADVERSARIES, { hopeAndFear, frameId }), [hopeAndFear, frameId]);
}

/**
 * The SRD catalogue (D8 A2): search, tier, type and book chips, tier groups paged 40 then +60, and the stat block of
 * the tapped entry with `renderActions` (Add to encounter, Duplicate & edit).
 */
export function Catalogue({
  hopeAndFear,
  frameId,
  renderActions,
}: {
  hopeAndFear: boolean;
  frameId: string;
  renderActions: (def: AdversaryDef) => ReactNode;
}) {
  const visible = useVisibleAdversaries(hopeAndFear, frameId);
  const [filters, setFilters] = useState<CatalogueFilters>(NO_FILTERS);
  const [sort, setSort] = useState<CatalogueSort>("name");
  const [limit, setLimit] = useState(PAGE_FIRST);
  const [openId, setOpenId] = useState<string | null>(null);

  const sorted = useMemo(() => sortAdversaries(visible, sort), [visible, sort]);
  const shown = useMemo(() => filterAdversaries(sorted, filters), [sorted, filters]);
  const groups = groupByTier(shown, limit);
  const more = moreLabel(openCount(shown, NO_COLLAPSED), limit);

  function setFilter(next: Partial<CatalogueFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setLimit(PAGE_FIRST);
  }

  return (
    <View style={advStyles.section}>
      <TextInput
        accessibilityLabel="Search adversaries"
        autoCorrect={false}
        onChangeText={(query) => setFilter({ query })}
        placeholder="Search adversaries, features, motives"
        style={advStyles.input}
        value={filters.query}
      />
      <Text style={advStyles.muted}>{countLine(visible, shown.length)}</Text>
      <View accessibilityLabel="Tier" style={advStyles.row}>
        {TIERS.map((tier) => (
          <Chip key={tier} label={`Tier ${tier}`} on={filters.tier === tier} onPress={() => setFilter({ tier: toggleChip(filters.tier, tier) })} />
        ))}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View accessibilityLabel="Type" style={advStyles.row}>
          {ADVERSARY_TYPES.map((type) => (
            <Chip key={type} label={type} on={filters.type === type} onPress={() => setFilter({ type: toggleChip(filters.type, type) })} />
          ))}
        </View>
      </ScrollView>
      <View style={advStyles.row}>
        {hopeAndFear ? (
          <>
            <Chip label="Core" on={filters.book === "core"} onPress={() => setFilter({ book: toggleChip(filters.book, "core") })} />
            <Chip
              label="Hope & Fear"
              on={filters.book === "hope-and-fear"}
              onPress={() => setFilter({ book: toggleChip(filters.book, "hope-and-fear") })}
            />
          </>
        ) : null}
        <Chip label="A–Z" on={sort === "name"} onPress={() => setSort("name")} />
        <Chip label="Book order" on={sort === "book"} onPress={() => setSort("book")} />
      </View>

      {shown.length === 0 ? <Text style={advStyles.muted}>No adversary matches. Clear a filter or search for something else.</Text> : null}
      {groups.map((group) => (
        <View key={group.tier} style={advStyles.section}>
          <View>
            <Text accessibilityRole="header" style={advStyles.h3}>
              {group.title}
            </Text>
            <Text style={advStyles.muted}>{group.sub}</Text>
          </View>
          {group.entries.map((def) => {
            const open = openId === def.id;
            return (
              <View key={def.id} style={advStyles.section}>
                <Pressable
                  accessibilityLabel={def.name}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  onPress={() => setOpenId(open ? null : def.id)}
                  style={[advStyles.listRow, open ? advStyles.listRowOn : null]}
                >
                  <View style={advStyles.grow}>
                    <Text style={advStyles.rowName}>{def.name}</Text>
                    <Text style={advStyles.muted}>
                      {typeLabel(def)} · Difficulty {def.difficulty} · HP {def.hp}
                      {def.source === "hope-and-fear" ? " · H&F" : ""}
                    </Text>
                  </View>
                </Pressable>
                {open ? <StatBlock actions={renderActions(def)} block={def} /> : null}
              </View>
            );
          })}
        </View>
      ))}
      {more ? (
        <Button onPress={() => setLimit((n) => n + PAGE_MORE)} variant="outline">
          {more}
        </Button>
      ) : null}
    </View>
  );
}
