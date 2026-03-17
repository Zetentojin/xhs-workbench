export type SupabasePublicConfig = {
  url: string;
  key: string;
};

export type PublicRuntimeConfig = {
  publicAccess: boolean;
  supabaseUrl: string;
  supabaseKey: string;
};

declare global {
  interface Window {
    __XHS_RUNTIME_CONFIG__?: Partial<PublicRuntimeConfig>;
  }
}

function isTruthyFlag(value: string | undefined) {
  return Boolean(value && ["1", "true", "yes", "on"].includes(value.toLowerCase()));
}

function normalizeRuntimeConfig(config: Partial<PublicRuntimeConfig>): PublicRuntimeConfig {
  return {
    publicAccess: Boolean(config.publicAccess),
    supabaseUrl: (config.supabaseUrl || "").trim(),
    supabaseKey: (config.supabaseKey || "").trim(),
  };
}

function getProcessRuntimeConfig(): PublicRuntimeConfig {
  return normalizeRuntimeConfig({
    publicAccess: isTruthyFlag(process.env.NEXT_PUBLIC_PUBLIC_ACCESS) || isTruthyFlag(process.env.NEXT_PUBLIC_AUTH_BYPASS),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

function getBrowserRuntimeConfig(): Partial<PublicRuntimeConfig> {
  if (typeof window === "undefined") {
    return {};
  }
  return window.__XHS_RUNTIME_CONFIG__ ?? {};
}

function getPublicRuntimeConfig(): PublicRuntimeConfig {
  return normalizeRuntimeConfig({
    ...getProcessRuntimeConfig(),
    ...getBrowserRuntimeConfig(),
  });
}

export function getServerPublicRuntimeConfig(): PublicRuntimeConfig {
  return getProcessRuntimeConfig();
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const { supabaseUrl: url, supabaseKey: key } = getPublicRuntimeConfig();

  if (!url || !key) {
    return null;
  }

  return { url, key };
}

export function hasSupabasePublicConfig() {
  return Boolean(getSupabasePublicConfig());
}

export function isPublicAccessEnabled() {
  return getPublicRuntimeConfig().publicAccess;
}

export function isAuthBypassEnabled() {
  return isPublicAccessEnabled();
}
