/**
 * The phone combat map's flag (plan phone PX14, "behind a flag"): on in development builds and Jest, off in a
 * release build unless `EXPO_PUBLIC_PHONE_COMBAT_MAP=1`; `=0` turns it off in development too. Raise it to on by
 * default once the device checks in docs/phone-client.md pass.
 */
export function combatMapEnabled(env: string | undefined = process.env.EXPO_PUBLIC_PHONE_COMBAT_MAP, dev: boolean = __DEV__): boolean {
  if (env === "1") return true;
  if (env === "0") return false;
  return dev;
}
