import type { ReactNode } from "react";

import { LegacyImport } from "@/components/config/legacy-import";

import { AccentSync } from "./accent-sync";
import { PrefsSync } from "./prefs-sync";

/**
 * The display cache script (plan config U6b): it runs while the server HTML is parsed, before the page under it
 * paints, so a hard load starts at the saved text size and calm. Same rules as `readCachedDisplayPrefs` /
 * `applyDisplayPrefs` in src/lib/use-reduced-motion.ts (key `dcm:display-prefs`, JSON `{ r, t }`; it only adds
 * attributes). Written out here because a Server Component can't import that hook module;
 * tests/unit/prefs-sync.test.tsx renders this layout and runs the script against the module's constants.
 *
 * It sits in a hidden span's HTML rather than a React `<script>`: React never creates a script element on the client
 * then (no "script tag" warning on a client navigation into the app; the script just doesn't run there, and PrefsSync
 * applies the same values).
 */
const DISPLAY_PREFS_SCRIPT =
  '(function(){try{var p=JSON.parse(localStorage.getItem("dcm:display-prefs")||"null");' +
  'if(!p||typeof p.r!=="boolean"||["small","medium","large"].indexOf(p.t)<0)return;var d=document.documentElement;' +
  'if(p.r)d.setAttribute("data-reduce-motion","");d.setAttribute("data-text-size",p.t)}catch(e){}})()';

const PREFS_SCRIPT_HTML = `<script>${DISPLAY_PREFS_SCRIPT}</script>`;

export default function GmLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <span hidden dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT_HTML }} />
      <AccentSync />
      <PrefsSync />
      <LegacyImport />
      {children}
    </>
  );
}
