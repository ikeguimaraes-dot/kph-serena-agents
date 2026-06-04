import { createClient } from "@supabase/supabase-js";

if (!process.env.KPH_SUPABASE_URL) {
  throw new Error("KPH_SUPABASE_URL is required");
}
if (!process.env.KPH_SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("KPH_SUPABASE_SERVICE_ROLE_KEY is required");
}

export const kphSupabase = createClient(
  process.env.KPH_SUPABASE_URL!,
  process.env.KPH_SUPABASE_SERVICE_ROLE_KEY!
);
