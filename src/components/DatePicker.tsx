import { useEffect, useRef, useState, type ChangeEvent } from 'react';

const MONTHS_DA = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
];
const WEEKDAYS_DA = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(y, m, 0).getDate();
  return d <= daysInMonth;
}

function displayToIso(text: string): string | null {
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const d = Number(match[1]);
  const m = Number(match[2]);
  const y = Number(match[3]);
  if (!isValidDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Formaterer løbende input til dd/mm/yyyy mens man taster, ved automatisk
// at indsætte skråstreger efter dag og måned.
function autoFormatTyping(raw: string, previous: string): string {
  const isDeleting = raw.length < previous.length;
  if (isDeleting) return raw;

  const digitsOnly = raw.replace(/[^\d]/g, '').slice(0, 8);
  let out = digitsOnly.slice(0, 2);
  if (digitsOnly.length > 2) out += '/' + digitsOnly.slice(2, 4);
  if (digitsOnly.length > 4) out += '/' + digitsOnly.slice(4, 8);
  return out;
}

interface DatePickerProps {
  value: string; // ISO yyyy-mm-dd, eller '' hvis tom
  onChange: (iso: string) => void;
  min?: string; // ISO yyyy-mm-dd — datoer før denne er deaktiveret i kalenderen
  placeholder?: string;
}

export function DatePicker({ value, onChange, min, placeholder }: DatePickerProps) {
  const [text, setText] = useState(() => isoToDisplay(value));
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    const parts = value ? value.split('-') : null;
    return parts ? Number(parts[0]) : new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const parts = value ? value.split('-') : null;
    return parts ? Number(parts[1]) - 1 : new Date().getMonth();
  });
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Hold tekstfeltet synkroniseret hvis value ændres udefra (fx når
  // slutdato auto-justeres til at følge startdato).
  useEffect(() => {
    setText(isoToDisplay(value));
    if (value) {
      const [y, m] = value.split('-');
      setViewYear(Number(y));
      setViewMonth(Number(m) - 1);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function handleTextChange(e: ChangeEvent<HTMLInputElement>) {
    const formatted = autoFormatTyping(e.target.value, text);
    setText(formatted);
    const iso = displayToIso(formatted);
    if (iso) onChange(iso);
  }

  function handleBlur() {
    // Hvis det der står ikke er en gyldig, fuld dato, ryd tilbage til sidst
    // gyldige værdi i stedet for at efterlade en halvfærdig tekst.
    const iso = displayToIso(text);
    if (!iso && text !== '') {
      setText(isoToDisplay(value));
    }
  }

  function selectDay(day: number) {
    const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    if (min && iso < min) return;
    onChange(iso);
    setText(isoToDisplay(iso));
    setOpen(false);
  }

  function goToPreviousMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // 0 = mandag

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          className="input pr-9"
          placeholder={placeholder ?? 'dd/mm/åååå'}
          value={text}
          onChange={handleTextChange}
          onBlur={handleBlur}
          onFocus={() => setOpen(true)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-river-400 hover:text-river-600"
          onClick={() => setOpen((o) => !o)}
          aria-label="Åbn kalender"
        >
          📅
        </button>
      </div>

      {open && (
        <div className="absolute z-20 mt-1 w-64 rounded-lg border border-river-100 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              className="rounded px-2 py-1 text-river-500 hover:bg-river-50"
              onClick={goToPreviousMonth}
            >
              ‹
            </button>
            <span className="text-sm font-medium text-river-800">
              {MONTHS_DA[viewMonth]} {viewYear}
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-river-500 hover:bg-river-50"
              onClick={goToNextMonth}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs text-river-400">
            {WEEKDAYS_DA.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <span key={`empty-${i}`} />;
              const iso = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
              const isDisabled = !!min && iso < min;
              const isSelected = iso === value;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => selectDay(day)}
                  className={`rounded-md py-1 text-sm ${
                    isSelected
                      ? 'bg-river-600 text-white'
                      : isDisabled
                        ? 'cursor-not-allowed text-river-200'
                        : 'text-river-700 hover:bg-river-50'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
