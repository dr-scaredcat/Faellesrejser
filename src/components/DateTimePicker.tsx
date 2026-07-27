import type { ChangeEvent } from 'react';
import { DatePicker } from './DatePicker';

interface DateTimePickerProps {
  value: string; // '' eller 'YYYY-MM-DDTHH:mm'
  onChange: (value: string) => void;
}

// Kombinerer den danske DatePicker (dd/mm/åååå) med et separat
// klokkeslæt-felt, og sætter dem sammen til samme 'YYYY-MM-DDTHH:mm'-format
// som et natívt <input type="datetime-local"> bruger, så resten af koden
// (database-kald m.m.) ikke behøver at ændres.
export function DateTimePicker({ value, onChange }: DateTimePickerProps) {
  const [datePart, timePart] = value ? value.split('T') : ['', ''];

  function handleDateChange(iso: string) {
    onChange(`${iso}T${timePart || '12:00'}`);
  }

  function handleTimeChange(e: ChangeEvent<HTMLInputElement>) {
    if (!datePart) return;
    onChange(`${datePart}T${e.target.value}`);
  }

  return (
    <div className="flex gap-2">
      <div className="flex-1">
        <DatePicker value={datePart} onChange={handleDateChange} />
      </div>
      <input
        type="time"
        className="input w-28"
        value={timePart}
        onChange={handleTimeChange}
        disabled={!datePart}
      />
    </div>
  );
}
