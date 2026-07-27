/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  /**
   * Supabase kalder nøglen "Publishable key" i nyere projekter og
   * "anon public key" i ældre. supabase.ts understøtter begge navne, så
   * begge er valgfri her.
   */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
