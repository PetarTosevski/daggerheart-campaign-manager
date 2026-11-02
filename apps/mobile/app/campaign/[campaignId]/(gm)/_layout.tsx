import { Stack } from "expo-router";

export { RouteErrorBoundary as ErrorBoundary } from "../../../../src/shell/route-error";

/** GM-only routes. The parent stack's `Stack.Protected` keeps a player off this navigator. */
export default function GmLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="adversaries" options={{ title: "Adversaries" }} />
      <Stack.Screen name="adversaries/[encounterId]" options={{ title: "Encounter" }} />
      <Stack.Screen name="packs" options={{ title: "Packs" }} />
    </Stack>
  );
}
