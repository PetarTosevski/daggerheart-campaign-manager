"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/supabase/remember";

/**
 * Server Action that ends the current session and returns the user to sign-in.
 */
export async function signOutAction() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(REMEMBER_COOKIE);
  redirect("/login");
}
