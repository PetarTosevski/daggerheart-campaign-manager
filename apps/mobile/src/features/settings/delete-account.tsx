import { useState } from "react";
import { Text, View } from "react-native";

import { errorMessage } from "../../../../../src/lib/convex-errors";
import { useWritesEnabled } from "../../shell/offline";
import { Button } from "../../ui/button";
import { controlStyles } from "./controls";

/**
 * Delete account, the phone side (App Store 5.1.1(v), bead dcm-gdzi.8): a button, a confirm step, then `request`, the
 * server call. Not mounted yet: rebuild has no self-service deletion (only the app owner's
 * `adminAccountActions.scheduleDelete`), and how it should work (the 30-day wait and undo, Apple token revocation) is
 * the user's decision. Once that server function exists, the Account section mounts this with it.
 */
export function DeleteAccount({
  request,
  onDeleted,
  notice,
}: {
  /** The server call that deletes (or schedules the deletion of) the caller's own account. */
  request: () => Promise<unknown>;
  /** After the call succeeded: sign out and leave. */
  onDeleted: () => void;
  /** What happens to the account and its campaigns, as the server decides it. */
  notice: string;
}) {
  const writes = useWritesEnabled();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    if (!writes || busy) return;
    setBusy(true);
    setError(null);
    request()
      .then(() => {
        setConfirming(false);
        onDeleted();
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false));
  };

  return (
    <View style={controlStyles.block}>
      {confirming ? (
        <View accessibilityLabel="Confirm account deletion" accessibilityRole="alert" style={controlStyles.block}>
          <Text style={controlStyles.label}>{notice}</Text>
          <Button disabled={busy} onPress={() => setConfirming(false)} variant="outline">
            Cancel
          </Button>
          <Button disabled={!writes || busy} onPress={confirm} variant="dangerSolid">
            {busy ? "Deleting…" : "Delete my account"}
          </Button>
        </View>
      ) : (
        <Button disabled={!writes} onPress={() => setConfirming(true)} variant="danger">
          Delete account…
        </Button>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={controlStyles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
