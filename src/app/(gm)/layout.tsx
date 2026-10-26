import type { ReactNode } from "react";

import { AccentSync } from "./accent-sync";

export default function GmLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AccentSync />
      {children}
    </>
  );
}
