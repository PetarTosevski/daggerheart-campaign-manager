import { PasswordForm } from "../../src/features/auth/password-form";

export { RouteErrorBoundary as ErrorBoundary } from "../../src/shell/route-error";

export default function SignInScreen() {
  return <PasswordForm />;
}
