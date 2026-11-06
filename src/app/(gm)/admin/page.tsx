import { Suspense } from "react";

import { AdminShell } from "@/components/admin/shell";

/**
 * App admin (plan config AD1, design reference/designs/config/Admin.dc.html): the app owner's page. The shell decides
 * owner / 'Not allowed' from `appAdmin.me`; the server checks the owner on every admin function (CF22). The Suspense
 * boundary is for the shell's `useSearchParams` (`?tab=`).
 */
export default function AdminPage() {
  return (
    <Suspense>
      <AdminShell />
    </Suspense>
  );
}
