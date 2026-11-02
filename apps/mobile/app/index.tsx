import { Text, View } from "react-native";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

export default function SignedOutScreen() {
  return (
    <View>
      <Text accessibilityRole="header">Signed out</Text>
    </View>
  );
}
