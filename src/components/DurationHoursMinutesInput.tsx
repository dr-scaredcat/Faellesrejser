interface DurationHoursMinutesInputProps {
  value: string; // decimaltimer som streng, fx '2.50', eller '' hvis tomt
  onChange: (decimalHours: string) => void;
}

// Lader brugeren taste en varighed som timer + minutter, og omregner det
// automatisk til decimaltimer (fx 2 t 30 min -> '2.50'), som er det format
// resten af appen (og databasen) allerede regner videre med.
export function DurationHoursMinutesInput({ value, onChange }: DurationHoursMinutesInputProps) {
  const numeric = value === '' ? 0 : Number(value);
  const hours = Math.floor(numeric);
  const minutes = Math.round((numeric - hours) * 60);

  function update(newHours: number, newMinutes: number) {
    const decimal = newHours + newMinutes / 60;
    onChange(decimal === 0 ? '' : decimal.toFixed(2));
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        className="input w-20"
        value={value === '' ? '' : hours}
        onChange={(e) => update(Number(e.target.value) || 0, minutes)}
        placeholder="Timer"
      />
      <span className="text-sm text-river-500">t</span>
      <input
        type="number"
        min={0}
        max={59}
        className="input w-20"
        value={value === '' ? '' : minutes}
        onChange={(e) => update(hours, Math.min(59, Math.max(0, Number(e.target.value) || 0)))}
        placeholder="Min"
      />
      <span className="text-sm text-river-500">min</span>
    </div>
  );
}
