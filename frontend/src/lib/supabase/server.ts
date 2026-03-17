import type { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
};

export function createSupabaseServerClient(response: NextResponse, cookieStore: CookieStoreLike) {
  const config = getSupabasePublicConfig();
  if (!config) {
    return null;
  }

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}
