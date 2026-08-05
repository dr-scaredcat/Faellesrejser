import { useEffect, useState } from 'react';

interface DurationHoursMinutesInputProps {
  /** Varighed i timer som decimaltal, fx "1.5". Tom streng = intet indtastet. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** Deler decimaltimer op i hele timer og minutter til de to felter. */
function splitValue(value: string): { hours: string; minutes: string } {
  const n = Number(value);
  if (!value || !isFinite(n) || n < 0) return { hours: '', minutes: '' };

  let hours = Math.floor(n);
  let minutes = Math.round((n - hours) * 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }

  return {
    hours: hours > 0 ? String(hours) : '',
    // Nul minutter vises som tomt felt, ikke som "0" — ellers skal man
    // slette cifret, før man kan skrive sit eget, hver eneste gang.
    minutes: minutes > 0 ? String(minutes) : '',
  };
}

/**
 * Indtastning af en varighed som timer + minutter.
 *
 * Værdien udad er decimaltimer, fordi det er sådan sejltider gemmes i
 * databasen — men det er ikke sådan man tænker, når man har siddet i en kano
 * i halvanden time. Opdelingen findes derfor kun i selve feltet.
 *
 * Begge felter starter tomme. Er kun det ene udfyldt, tæller det andet som
 * nul, så "2 timer blank" bliver til 2,0 — man skal ikke skrive et nul for
 * at komme videre.
 */
export function DurationHoursMinutesInput({
  value,
  onChange,
  disabled,
}: DurationHoursMinutesInputProps) {
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');

  // Holder felterne i sync, når værdien ændres udefra — fx når formularen
  // nulstilles efter et gem.
  useEffect(() => {
    const næste = splitValue(value);
    setHours(næste.hours);
    setMinutes(næste.minutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nyeTimer: string, nyeMinutter: string) {
    // Begge tomme betyder "intet indtastet", ikke "nul timer" — ellers ville
    // et tomt felt tælle som en gyldig registrering på 0 timer.
    if (nyeTimer === '' && nyeMinutter === '') {
      onChange('');
      return;
    }
    const t = Number(nyeTimer) || 0;
    const m = Number(nyeMinutter) || 0;
    onChange(String(t + m / 60));
  }

  function handleHours(v: string) {
    const renset = v.replace(/[^0-9]/g, '');
    setHours(renset);
    emit(renset, minutes);
  }

  function handleMinutes(v: string) {
    const renset = v.replace(/[^0-9]/g, '');
    // Mere end 59 minutter hører til i timefeltet — vi afviser stille i
    // stedet for at gemme noget, der ser forkert ud bagefter.
    if (renset !== '' && Number(renset) > 59) return;
    setMinutes(renset);
    emit(hours, renset);
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        className="input min-w-0 flex-1"
        placeholder="Timer"
        value={hours}
        onChange={(e) => handleHours(e.target.value)}
        disabled={disabled}
        aria-label="Timer"
      />
      <input
        type="text"
        inputMode="numeric"
        className="input min-w-0 flex-1"
        placeholder="Min"
        value={minutes}
        onChange={(e) => handleMinutes(e.target.value)}
        disabled={disabled}
        aria-label="Minutter"
      />
    </div>
  );
}
