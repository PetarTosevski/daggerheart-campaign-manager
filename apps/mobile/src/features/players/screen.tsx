import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, useQuery, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { api, type Id } from "../../convex";
import { useCampaign } from "../../shell/campaign-provider";
import { WriteButton } from "../../shell/offline";
import { sectionLabel } from "../../shell/sections";
import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { hit, radius, space } from "../../theme/spacing";
import { Button } from "../../ui/button";
import { Loading } from "../../ui/loading";
import { joinLinkForCode, shareJoinLink } from "./join-link";
import { formatJoinCode } from "./format-code";
import { readAccess, readRoster, type RosterMember } from "./roster-data";

function withOptimistic<M extends FunctionReference<"mutation">>(
  mutation: ReactMutation<M>,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

/** Patches the live roster's members in place (rule 12), as the website's Campaign settings > Players does. */
function patchRoster(
  store: OptimisticLocalStore,
  campaignId: Id<"campaigns">,
  edit: <T extends { userId: string; coGm: boolean }>(rows: T[]) => T[],
) {
  const roster = store.getQuery(api.members.roster, { campaignId });
  if (!roster) return;
  if (roster.viewer === "gm") store.setQuery(api.members.roster, { campaignId }, { ...roster, players: edit(roster.players) });
  else store.setQuery(api.members.roster, { campaignId }, { ...roster, players: edit(roster.players) });
}

/**
 * What the viewer may do to a member's row (the website's `rowActions`, src/components/config/sections/players/lib.ts,
 * Q7 a): the creator makes and unmakes co-GMs and removes anyone; a co-GM removes players only.
 */
function rowActions(viewerIsCreator: boolean, member: { coGm: boolean }): { toggleCoGm: boolean; remove: boolean } {
  return { toggleCoGm: viewerIsCreator, remove: viewerIsCreator || !member.coGm };
}

/** Co-GMs first, then players; each group in join order (as the website's roster). */
function membersInOrder<T extends RosterMember>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Number(b.coGm) - Number(a.coGm) || a.joinedAt - b.joinedAt);
}

function SectionTitle({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionTitle}>
      {children}
    </Text>
  );
}

export function PlayersBody() {
  const campaign = useCampaign();
  const isGm = campaign.role === "gm";
  const roster = useQuery(api.members.roster, { campaignId: campaign._id });
  const access = useQuery(api.members.access, isGm ? { campaignId: campaign._id } : "skip");
  const rotate = useMutation(api.members.rotateJoinCode);
  const invite = useMutation(api.members.invite);
  const revoke = useMutation(api.members.revokeInvite);
  const removePlayer = withOptimistic(useMutation(api.members.removePlayer), (store, args) =>
    patchRoster(store, args.campaignId, (rows) => rows.filter((r) => r.userId !== args.userId)),
  );
  const setCoGm = withOptimistic(useMutation(api.members.setCoGm), (store, args) =>
    patchRoster(store, args.campaignId, (rows) => rows.map((r) => (r.userId === args.userId ? { ...r, coGm: args.coGm } : r))),
  );
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);
  const [email, setEmail] = useState("");
  // Invite as Player / Co-GM (Q8 b): the creator's choice; the server refuses a co-GM invite from anyone else.
  const [asCoGm, setAsCoGm] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const viewerIsCreator = campaign.isCreator;

  const table = readRoster(roster);
  const invites = isGm ? readAccess(access) : null;

  useEffect(() => {
    if (!shared) return;
    const timer = setTimeout(() => setShared(false), 2000);
    return () => clearTimeout(timer);
  }, [shared]);

  if (table === undefined || (isGm && invites === undefined)) {
    return <Loading label="Loading players" />;
  }
  if (table === null || (isGm && invites === null)) {
    return (
      <View style={styles.stack}>
        <Text accessibilityRole="header" style={styles.title}>
          {sectionLabel("players")}
        </Text>
        <Text style={styles.body}>The roster could not be read.</Text>
      </View>
    );
  }

  const run = (work: Promise<unknown> | unknown) => {
    setError(null);
    void Promise.resolve(work).catch((e) => setError(errorMessage(e)));
  };

  const joinCode = isGm ? invites?.joinCode : null;
  const link = joinCode ? joinLinkForCode(joinCode) : "";

  return (
    <ScrollView contentContainerStyle={styles.stack} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>
        {sectionLabel("players")}
      </Text>

      {isGm ? (
        <>
          <View style={styles.section}>
            <SectionTitle>Join code</SectionTitle>
            <View style={styles.codeRow}>
              <Text accessibilityLabel="Join code" style={styles.code} testID="join-code">
                {joinCode ? formatJoinCode(joinCode) : "…"}
              </Text>
              {link ? (
                <Button
                  accessibilityLabel="Share join link"
                  onPress={() =>
                    run(
                      shareJoinLink(link).then((done) => {
                        setShared(done);
                      }),
                    )
                  }
                  variant="outline"
                >
                  {shared ? "Link shared" : "Share join link"}
                </Button>
              ) : null}
              {joinCode ? (
                <WriteButton
                  accessibilityLabel="New code"
                  onPress={() => run(rotate({ campaignId: campaign._id, replace: true }))}
                  variant="outline"
                >
                  New code
                </WriteButton>
              ) : (
                // No code yet: a tap makes one (rule 13: a click, never an effect), as the website's 'Make a link'.
                <WriteButton
                  accessibilityLabel="Make a join code"
                  onPress={() => run(rotate({ campaignId: campaign._id }))}
                  variant="outline"
                >
                  Make a join code
                </WriteButton>
              )}
            </View>
            <Text style={styles.hint}>
              A new code stops the old one from working. Players who joined stay in.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionTitle>Invite by email</SectionTitle>
            <View style={styles.inviteRow}>
              <TextInput
                accessibilityLabel="Player email"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                keyboardType="email-address"
                onChangeText={setEmail}
                placeholder="player@example.com"
                placeholderTextColor={colors.faint}
                style={styles.input}
                value={email}
              />
              <WriteButton
                accessibilityLabel="Invite player"
                onPress={() => {
                  const trimmed = email.trim();
                  if (!trimmed) return;
                  run(
                    Promise.resolve(
                      invite({ campaignId: campaign._id, email: trimmed, ...(viewerIsCreator && asCoGm ? { asCoGm: true } : {}) }),
                    ).then(() => {
                      setEmail("");
                    }),
                  );
                }}
                variant="solid"
              >
                Invite
              </WriteButton>
            </View>
            {viewerIsCreator ? (
              <View accessibilityLabel="Invite as" accessibilityRole="radiogroup" style={styles.segment}>
                {([false, true] as const).map((coGm) => (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: asCoGm === coGm }}
                    key={coGm ? "co-gm" : "player"}
                    onPress={() => setAsCoGm(coGm)}
                    style={[styles.segmentItem, asCoGm === coGm && styles.segmentOn]}
                  >
                    <Text style={[styles.segmentText, asCoGm === coGm && styles.segmentTextOn]}>{coGm ? "Co-GM" : "Player"}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Text style={styles.hint}>
              The player gets an email with a sign-in link. The campaign appears once they sign in or sign up with that
              address, with Google or a verified password account.
            </Text>
            {invites && invites.invites.length > 0 ? (
              <View accessibilityRole="list" style={styles.list}>
                {invites.invites.map((row) => (
                  <View key={row._id} style={styles.listRow}>
                    <Text style={styles.body}>
                      {row.email} <Text style={styles.subtle}>· invited</Text>
                      {row.asCoGm ? <Text style={styles.brand}> · Co-GM</Text> : null}
                    </Text>
                    <WriteButton
                      accessibilityLabel={`Revoke invite for ${row.email}`}
                      onPress={() => run(revoke({ inviteId: row._id as Id<"campaignInvites"> }))}
                      variant="outline"
                    >
                      Revoke
                    </WriteButton>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      <View style={styles.section}>
        <SectionTitle>At the table</SectionTitle>
        <View accessibilityLabel="Players in this campaign" accessibilityRole="list" style={styles.list}>
          <Text style={styles.body}>
            {isGm && viewerIsCreator ? "You" : table.gm.name} <Text style={styles.brand}>· Game Master</Text>
          </Text>
          {membersInOrder<RosterMember & { email?: string | null }>(table.players).map((player) => {
            const actions = isGm ? rowActions(viewerIsCreator, player) : { toggleCoGm: false, remove: false };
            const userId = player.userId as Id<"users">;
            return (
              <View key={player.userId} style={styles.member}>
                <View style={styles.listRow}>
                  <Text style={styles.body}>
                    {player.name}
                    {player.coGm ? <Text style={styles.brand}> · Co-GM</Text> : null}
                    {player.email ? <Text style={styles.subtle}> · {player.email}</Text> : null}
                  </Text>
                  <View style={styles.rowActions}>
                    {actions.toggleCoGm ? (
                      <WriteButton
                        accessibilityLabel={`${player.coGm ? "Remove co-GM" : "Make co-GM"}: ${player.name}`}
                        onPress={() => run(setCoGm({ campaignId: campaign._id, userId, coGm: !player.coGm }))}
                        variant="outline"
                      >
                        {player.coGm ? "Remove co-GM" : "Make co-GM"}
                      </WriteButton>
                    ) : null}
                    {actions.remove ? (
                      <WriteButton accessibilityLabel={`Remove ${player.name}`} onPress={() => setRemoving(player.userId)} variant="danger">
                        Remove
                      </WriteButton>
                    ) : null}
                  </View>
                </View>
                {removing === player.userId ? (
                  <View accessibilityLabel={`Remove ${player.name}?`} style={styles.listRow}>
                    <Text style={styles.body}>Remove {player.name}?</Text>
                    <View style={styles.rowActions}>
                      <WriteButton
                        accessibilityLabel={`Confirm remove ${player.name}`}
                        onPress={() => {
                          setRemoving(null);
                          run(removePlayer({ campaignId: campaign._id, userId }));
                        }}
                        variant="danger"
                      >
                        Remove
                      </WriteButton>
                      <Button onPress={() => setRemoving(null)} variant="outline">
                        Cancel
                      </Button>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          {table.players.length === 0 ? <Text style={styles.subtle}>No players yet.</Text> : null}
        </View>
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[4],
    paddingBottom: space[8],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 32,
    fontWeight: type.displayBold.fontWeight,
  },
  section: {
    gap: space[2],
  },
  sectionTitle: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 12,
    fontWeight: type.sans.fontWeight,
    letterSpacing: 2.2,
    textTransform: "uppercase",
  },
  codeRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  code: {
    color: colors.brand,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
    letterSpacing: 3.2,
  },
  inviteRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  input: {
    backgroundColor: colors.ink,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.parchment,
    flexGrow: 1,
    flexShrink: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    minHeight: hit.minHeight,
    minWidth: 220,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  list: {
    gap: space[2],
  },
  member: {
    gap: space[1],
  },
  rowActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
  },
  segment: {
    alignSelf: "flex-start",
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  segmentItem: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: hit.minHeight,
    paddingHorizontal: space[4],
  },
  segmentOn: {
    backgroundColor: colors.raised,
  },
  segmentText: {
    color: colors.subtle,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 14,
    fontWeight: type.sansMedium.fontWeight,
  },
  segmentTextOn: {
    color: colors.parchment,
  },
  listRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space[2],
    justifyContent: "space-between",
  },
  body: {
    color: colors.body,
    flexShrink: 1,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    fontWeight: type.sans.fontWeight,
  },
  subtle: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 15,
    fontWeight: type.sans.fontWeight,
  },
  brand: {
    color: colors.brand,
  },
  hint: {
    color: colors.subtle,
    fontFamily: type.sans.fontFamily,
    fontSize: 13,
    fontWeight: type.sans.fontWeight,
  },
  error: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    color: "#ffd9d6",
    fontFamily: type.sans.fontFamily,
    fontSize: 14,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
});
