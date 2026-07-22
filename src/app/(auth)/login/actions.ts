"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE_SECONDS,
} from "@/lib/supabase/remember";
import { signInSchema } from "@/lib/validation/auth";

export type SignInState = {
  error?: string;
  email?: string;
  remember?: boolean;
};

/**
 * Server Action that authenticates the single Game Master account with Supabase
 * email-and-password credentials. There is no public registration; the initial
 * user is created manually in Supabase.
 */
export async function signInAction(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  // An unchecked checkbox is omitted from the form data entirely.
  const remember = formData.get("remember") != null;

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
      email: raw.email,
      remember,
    };
  }

  // Record the preference before signing in so the auth cookies written during
  // sign-in pick it up: persistent when remembering, session-only otherwise.
  const cookieStore = await cookies();
  cookieStore.set(REMEMBER_COOKIE, remember ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    ...(remember ? { maxAge: REMEMBER_MAX_AGE_SECONDS } : {}),
  });

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      error: "Invalid email or password.",
      email: raw.email,
      remember,
    };
  }

  redirect("/dashboard");
}
