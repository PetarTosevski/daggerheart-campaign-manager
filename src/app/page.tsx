import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();

  let hasUser = false;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    hasUser = Boolean(user);
  } catch {
    hasUser = false;
  }

  redirect(hasUser ? "/dashboard" : "/login");
}
