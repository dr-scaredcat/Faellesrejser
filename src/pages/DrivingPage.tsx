import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import type { DrivingLog } from '../lib/types';

export default function DrivingPage() {
  const { trip, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const [logs, setLogs] = useState<DrivingLog[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [vehicleLabel, setVehicleLabel] = useState('');
  const [distance, setDistance] = useState('');
  const [energyType, setEnergyType] = useState<'benzin' | 'diesel' | 'el'>('benzin');
  const [energyAmount, setEnergyAmount] = useState('');
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (trip) load();
  }, [trip?.id]);

  async function load() {
    if (!trip) return;
    const { data } = await supabase
      .from('driving_logs')
      .select('*, profile:profiles(*)')
      .eq('trip_id', trip.id)
      .order('log_date', { ascending: false });
    setLogs((data as unknown as DrivingLog[]) ?? []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip || !profile) return;
    await supabase.from('driving_logs').insert({
      trip_id: trip.id,
      user_id: profile.id,
      vehicle_label: vehicleLabel || null,
      distance_km: Number(distance),
      energy_type: energyType,
      energy_amount: Number(energyAmount),
      log_date: logDate,
      notes: notes || null,
    });
    setVehicleLabel('');
    setDistance('');
    setEnergyAmount('');
    setNotes('');
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne kørsel?')) return;
    await supabase.from('driving_logs').delete().eq('id', id);
    load();
  }

  const totalKm = logs.reduce((s, l) => s + Number(l.distance_km), 0);
  const totalsByType: Record<string, { km: number; energy: number }> = {};
  for (const l of logs) {
    totalsByType[l.energy_type] = totalsByType[l.energy_type] ?? { km: 0, energy: 0 };
    totalsByType[l.energy_type].km += Number(l.distance_km);
    totalsByType[l.energy_type].energy += Number(l.energy_amount);
  }

  function efficiencyLabel(type: string, km: number, energy: number) {
    if (energy === 0) return '–';
    return type === 'el' ? `${(km / energy).toFixed(2)} km/kWh` : `${(km / energy).toFixed(2)} km/l`;
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-river-800">Samlet: {totalKm.toFixed(1)} km</h2>
        <div className="space-y-1 text-sm text-river-600">
          {Object.entries(totalsByType).map(([type, t]) => (
            <p key={type}>
              {type}: {t.km.toFixed(1)} km, {t.energy.toFixed(2)} {type === 'el' ? 'kWh' : 'liter'} —{' '}
              {efficiencyLabel(type, t.km, t.energy)}
            </p>
          ))}
          {logs.length === 0 && <p className="text-river-400">Ingen kørsel registreret endnu.</p>}
        </div>
      </div>

      <div className="space-y-3">
        {logs.map((log) => (
          <div key={log.id} className="card flex items-start justify-between p-4">
            <div>
              <p className="font-medium text-river-800">
                {log.vehicle_label || 'Køretøj'} · {log.distance_km} km
              </p>
              <p className="text-sm text-river-500">
                {log.energy_amount} {log.energy_type === 'el' ? 'kWh' : 'liter'} ({log.energy_type}) —{' '}
                {efficiencyLabel(log.energy_type, Number(log.distance_km), Number(log.energy_amount))}
              </p>
              <p className="text-xs text-river-400">
                {namesById[log.user_id] ?? '?'} · {log.log_date}
                {log.notes ? ` · ${log.notes}` : ''}
              </p>
            </div>
            {isEditable && (
              <button className="text-xs text-red-500 hover:underline" onClick={() => handleDelete(log.id)}>
                Slet
              </button>
            )}
          </div>
        ))}
      </div>

      {isEditable && !showForm && (
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Registrér kørsel
        </button>
      )}

      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3 p-5">
          <input
            className="input"
            placeholder="Køretøj (fx 'Sofies bil')"
            value={vehicleLabel}
            onChange={(e) => setVehicleLabel(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              step="0.1"
              className="input"
              placeholder="Distance (km)"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              required
            />
            <select
              className="input"
              value={energyType}
              onChange={(e) => setEnergyType(e.target.value as 'benzin' | 'diesel' | 'el')}
            >
              <option value="benzin">Benzin</option>
              <option value="diesel">Diesel</option>
              <option value="el">El</option>
            </select>
          </div>
          <input
            type="number"
            step="0.01"
            className="input"
            placeholder={energyType === 'el' ? 'Forbrug (kWh)' : 'Forbrug (liter)'}
            value={energyAmount}
            onChange={(e) => setEnergyAmount(e.target.value)}
            required
          />
          <DatePicker value={logDate} onChange={setLogDate} />
          <textarea className="input" placeholder="Noter" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-2">
            <button className="btn-primary">Gem</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
