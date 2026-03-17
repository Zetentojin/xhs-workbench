import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

let browserClient: SupabaseClient | null = null;

export function getBrowserSupabaseClient() {
  const config = getSupabasePublicConfig();
  if (!config) {
    return null;
  }

  if (!browserClient) {
    browserClient = createBrowserClient(config.url, config.key);
  }

  return browserClient;
}
