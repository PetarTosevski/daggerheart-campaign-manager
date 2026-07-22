import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import {
  applyRemember,
  REMEMBER_COOKIE,
  shouldRemember,
} from "@/lib/supabase/remember";

/**
 * Server-side Supabase client bound to the request cookie store. Use this in
 * Server Components, Server Actions, and route handlers to read the
 * authenticated user and perform authenticated operations.
 *
 * Authorization decisions must always be made on the server using this client;
 * client-side checks are not a security boundary.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            const remember = shouldRemember(
              cookieStore.get(REMEMBER_COOKIE)?.value,
            );
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, applyRemember(options, remember)),
            );
          } catch {
            // `setAll` was called from a Server Component. This can be ignored
            // because middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
