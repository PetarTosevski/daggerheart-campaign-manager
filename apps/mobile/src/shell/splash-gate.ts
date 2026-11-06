import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";

// Held from the first import, before the root layout renders, so the native splash covers the frames where the brand
// fonts are still loading instead of painting text in the system face and swapping it.
void SplashScreen.preventAutoHideAsync();

/**
 * Hides the native splash once `ready` turns true. The root layout passes "fonts loaded or failed": a failed font load
 * still shows the app (in the system face) rather than holding the splash forever.
 */
export function useSplashUntil(ready: boolean): void {
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
}
