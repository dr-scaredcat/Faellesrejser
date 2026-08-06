import { useCallback, useEffect, useMemo, useState } from 'react';

/** Samme navn som inline-scriptet i index.html sender. Skal matche præcist. */
const AVAILABILITY_EVENT = 'faellesrejser:install-availability';

/** Husker at brugeren har klikket banneret væk, så vi ikke plager. */
const DISMISS_KEY = 'faellesrejser.install-banner-dismissed';

/**
 * Kører appen allerede fra hjemmeskærmen? Så skal vi hverken vise banner
 * eller knap. display-mode dækker Android og desktop; navigator.standalone
 * er iOS Safaris egen, ældre variant.
 */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    navigator.standalone === true
  );
}

/**
 * iOS/iPadOS understøtter slet ikke beforeinstallprompt — der findes ingen
 * måde at åbne installationsdialogen fra kode. Vi kan kun vise en vejledning.
 */
export function isIosDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ udgiver sig for at være en Mac. En "Mac" med touch er i
  // praksis altid en iPad.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

export type InstallStatus =
  /** Kører allerede som installeret app. */
  | 'installed'
  /** Vi har et gemt prompt-event og kan åbne dialogen med det samme. */
  | 'ready'
  /** iOS: brugeren skal selv gøre det via delingsmenuen. */
  | 'ios-manual'
  /** Browseren understøtter det ikke, eller kriterierne er ikke opfyldt endnu. */
  | 'unavailable';

export function useInstallPrompt() {
  const [hasPrompt, setHasPrompt] = useState(() => Boolean(window.__installPromptEvent));
  const [installed, setInstalled] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      // Private mode e.l. — så viser vi bare banneret hver gang.
      return false;
    }
  });

  useEffect(() => {
    function sync() {
      setHasPrompt(Boolean(window.__installPromptEvent));
      setInstalled(isStandalone());
    }

    // Eventet kan være ankommet, mens komponenten var ved at mounte.
    sync();

    window.addEventListener(AVAILABILITY_EVENT, sync);
    const media = window.matchMedia?.('(display-mode: standalone)');
    media?.addEventListener('change', sync);

    return () => {
      window.removeEventListener(AVAILABILITY_EVENT, sync);
      media?.removeEventListener('change', sync);
    };
  }, []);

  const ios = useMemo(isIosDevice, []);

  const status: InstallStatus = installed
    ? 'installed'
    : hasPrompt
      ? 'ready'
      : ios
        ? 'ios-manual'
        : 'unavailable';

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const event = window.__installPromptEvent;
    if (!event) return 'unavailable';

    await event.prompt();
    const { outcome } = await event.userChoice;

    // Et beforeinstallprompt-event kan kun bruges én gang. Chrome sender et
    // nyt ved næste sideindlæsning, hvis brugeren afviste.
    window.__installPromptEvent = null;
    window.dispatchEvent(new Event(AVAILABILITY_EVENT));

    if (outcome === 'accepted') setInstalled(true);
    return outcome;
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignoreres bevidst */
    }
  }, []);

  return { status, install, dismissed, dismiss };
}
