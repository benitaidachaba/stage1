import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The one browser Supabase client. Both values are public by design: the anon
 * key identifies the project, Row Level Security does the actual guarding.
 * With no env configured this returns null, and every caller treats the app
 * as local-only — the current localStorage behaviour, unchanged.
 */
export function getSupabaseBrowser(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}
