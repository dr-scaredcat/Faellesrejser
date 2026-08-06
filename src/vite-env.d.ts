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

/**
 * 'beforeinstallprompt' er en Chromium-specifik udvidelse og findes derfor
 * ikke i TypeScripts standard-DOM-typer. Vi beskriver den selv.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface Window {
  /** Sat af det lille inline-script i index.html. */
  __installPromptEvent: BeforeInstallPromptEvent | null;
}

interface Navigator {
  /** Kun iOS Safari: true når siden kører fra hjemmeskærmen. */
  standalone?: boolean;
}
