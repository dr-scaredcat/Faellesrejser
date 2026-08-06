import { useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

/** Vejledning til iOS, hvor installation kun kan ske manuelt via delingsmenuen. */
function IosInstructions() {
  return (
    <p className="text-sm text-river-600">
      Tryk på <strong>Del</strong>-ikonet nederst i Safari, rul ned og vælg{' '}
      <strong>Føj til hjemmeskærm</strong>.
    </p>
  );
}

/**
 * Afviseligt bånd under navigationen. Vises kun når appen faktisk kan
 * installeres, og forsvinder for altid (pr. enhed), når man klikker × .
 */
export function InstallBanner() {
  const { status, install, dismissed, dismiss } = useInstallPrompt();
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (dismissed || status === 'installed' || status === 'unavailable') return null;

  return (
    <div className="bg-sand-100">
      <div className="mx-auto max-w-5xl px-4 py-2.5">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-sm text-river-800">
            Læg Fællesrejser på hjemmeskærmen — så åbner den som en app uden adresselinje.
          </p>

          {status === 'ready' ? (
            <button
              type="button"
              className="shrink-0 rounded-lg bg-river-600 px-3 py-1.5 text-sm font-medium text-buttontext hover:bg-river-700"
              onClick={() => void install()}
            >
              Installer
            </button>
          ) : (
            <button
              type="button"
              className="shrink-0 rounded-lg bg-river-600 px-3 py-1.5 text-sm font-medium text-buttontext hover:bg-river-700"
              onClick={() => setShowIosHelp((v) => !v)}
              aria-expanded={showIosHelp}
            >
              Sådan gør du
            </button>
          )}

          <button
            type="button"
            className="shrink-0 text-lg leading-none text-river-500 hover:text-river-800"
            onClick={dismiss}
            aria-label="Skjul installationsbeskeden"
          >
            ×
          </button>
        </div>

        {showIosHelp && status === 'ios-manual' && (
          <div className="pt-2">
            <IosInstructions />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Permanent knap til fx profilsiden — til dem der klikkede banneret væk og
 * fortrød, eller som skifter telefon.
 */
export function InstallButton() {
  const { status, install } = useInstallPrompt();

  if (status === 'installed') {
    return <p className="text-sm text-river-500">Appen er installeret på denne enhed.</p>;
  }

  if (status === 'ios-manual') {
    return <IosInstructions />;
  }

  if (status === 'unavailable') {
    return (
      <p className="text-sm text-river-500">
        Din browser tilbyder ikke installation her. Prøv Chrome på Android eller Safari på iPhone.
      </p>
    );
  }

  return (
    <button type="button" className="btn-primary" onClick={() => void install()}>
      Installer app
    </button>
  );
}
