import { useLocalSearchParams } from "expo-router";

import { joinCodeFromNext } from "../../src/features/auth/auth-error";
import { PasswordForm } from "../../src/features/auth/password-form";
import { firstParam } from "../../src/shell/campaign-provider";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/shell/route-error";

/** `?next=/join/<code>` (a signed-out join link) hands its code to sign-up, as on the website. */
export default function SignInScreen() {
  const params = useLocalSearchParams<{ next?: string | string[] }>();
  return <PasswordForm joinCode={joinCodeFromNext(firstParam(params.next))} />;
}
