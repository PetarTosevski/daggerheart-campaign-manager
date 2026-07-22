import { createClient } from "@supabase/supabase-js";

export default async function globalSetup() {
  if (process.env.RUN_SUPABASE_E2E !== "1") {
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!url || !serviceRoleKey || !email || !password) {
    throw new Error(
      "Live e2e requires Supabase URL, service-role key, test email, and test password.",
    );
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }

  const existing = data.users.find((user) => user.email === email);
  if (existing) {
    const { error: updateError } = await admin.auth.admin.updateUserById(
      existing.id,
      { password, email_confirm: true },
    );
    if (updateError) {
      throw updateError;
    }
    return;
  }

  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw createError;
  }
}
