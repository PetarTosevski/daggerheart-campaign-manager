import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

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
import { copyToClipboard, joinLinkForCode } from "./join-link";
import { formatJoinCode } from "./format-code";
import { readAccess, readRoster } from "./roster-data";

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
  const removePlayer = useMutation(api.members.removePlayer);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [email, setEmail] = useState("");
  const seeded = useRef(false);

  const table = readRoster(roster);
  const invites = isGm ? readAccess(access) : null;

  useEffect(() => {
    if (!isGm || invites === undefined || invites === null || invites.joinCode || seeded.current) return;
    seeded.current = true;
    void Promise.resolve(rotate({ campaignId: campaign._id })).catch((e) => setError(errorMessage(e)));
  }, [campaign._id, invites, isGm, rotate]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

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
                <WriteButton
                  accessibilityLabel="Copy join link"
                  onPress={() =>
                    run(
                      copyToClipboard(link).then(() => {
                        setCopied(true);
                      }),
                    )
                  }
                  variant="outline"
                >
                  {copied ? "Link copied" : "Copy join link"}
                </WriteButton>
              ) : (
                <Button accessibilityLabel="Copy join link" disabled onPress={() => undefined} variant="outline">
                  Copy join link
                </Button>
              )}
              <WriteButton
                accessibilityLabel="New code"
                onPress={() => run(rotate({ campaignId: campaign._id, replace: true }))}
                variant="outline"
              >
                New code
              </WriteButton>
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
                    Promise.resolve(invite({ campaignId: campaign._id, email: trimmed })).then(() => {
                      setEmail("");
                    }),
                  );
                }}
                variant="solid"
              >
                Invite
              </WriteButton>
            </View>
            <Text style={styles.hint}>
              Email invites work for accounts that sign in with Google. Players who use a password should join with the
              code above.
            </Text>
            {invites && invites.invites.length > 0 ? (
              <View accessibilityRole="list" style={styles.list}>
                {invites.invites.map((row) => (
                  <View key={row._id} style={styles.listRow}>
                    <Text style={styles.body}>
                      {row.email} <Text style={styles.subtle}>· invited</Text>
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
            {table.gm.name} <Text style={styles.brand}>· Game Master</Text>
          </Text>
          {table.players.map((player) => (
            <View key={player.userId} style={styles.listRow}>
              <Text style={styles.body}>
                {player.name}
                {"email" in player && player.email ? (
                  <Text style={styles.subtle}> · {player.email}</Text>
                ) : null}
              </Text>
              {isGm ? (
                <WriteButton
                  accessibilityLabel={`Remove ${player.name}`}
                  onPress={() =>
                    run(removePlayer({ campaignId: campaign._id, userId: player.userId as Id<"users"> }))
                  }
                  variant="danger"
                >
                  Remove
                </WriteButton>
              ) : null}
            </View>
          ))}
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
