/** True only when the store build turned social sign-in on. Email and password stay available either way. */
export function socialSignInEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SOCIAL_SIGN_IN === "true";
}
