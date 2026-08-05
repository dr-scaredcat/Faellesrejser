import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Toast';
import { useMutate } from '../../hooks/useMutate';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { sortStops } from '../../lib/gudenaa';
import { formatHours } from '../../lib/stats';
import { formatDate } from '../../lib/format';
import { DatePicker } from '../../components/DatePicker';
import { DurationHoursMinutesInput } from '../../components/DurationHoursMinutesInput';
import type { SailingTime } from '../../lib/types';

export default function SailingTimesPage() {
  const { trip, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const { stops } = useGudenaaStops();
  const { showToast } = useToast();
  const mutate = useMutate();

  const [times, setTimes] = useState<SailingTime[]>([]);
  const [showForm, setShowForm] = useState(false);

  const [startStopId, setStartStopId] = useState('');
  const [endStopId, setEndStopId] = useState('');
  const [totalTime, setTotalTime] = useState('');
  const [sailingTime, setSailingTime] = useState('');
  const [sailDate, setSailDate] = useState(new Date().toISOString().slice(0, 10));

  const sorted = sortStops(stops);

  useEffect(() => {
    if (trip) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  // Standarddato for en ny registrering er rejsens første dag, ikke dags
  // dato — man logger typisk sejltid efter turen, ikke live undervejs.
  useEffect(() => {
    setSailDate(trip?.start_date ?? new Date().toISOString().slice(0, 10));
  }, [trip?.start_date]);

  async function load() {
    if (!trip) return;
    const { data } = await supabase
      .from('gudenaa_sailing_times')
      .select('*, profile:profiles(*)')
      .eq('trip_id', trip.id)
      .order('sail_date', { ascending: false });
    setTimes((data as unknown as SailingTime[]) ?? []);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip || !profile || !startStopId || !endStopId || !totalTime || !sailingTime) return;

    // Slutstedet skal ligge nedstrøms for startstedet. Ellers giver
    // strækningen nul kilometer, og registreringen ville forsvinde ud af
    // statistikken uden at nogen opdagede det.
    const startIdx = sorted.findIndex((s) => s.id === startStopId);
    const endIdx = sorted.findIndex((s) => s.id === endStopId);
    if (endIdx <= startIdx) {
      showToast('Slutstedet skal ligge længere nede ad åen end startstedet.', 'error');
      return;
    }

    if (Number(sailingTime) > Number(totalTime)) {
      showToast('Den rene sejltid kan ikke være længere end den samlede tid inkl. pauser.', 'error');
      return;
    }

    const { ok } = await mutate(
      supabase.from('gudenaa_sailing_times').insert({
        trip_id: trip.id,
        user_id: profile.id,
        start_stop_id: startStopId,
        end_stop_id: endStopId,
        total_time_hours: Number(totalTime),
        sailing_time_hours: Number(sailingTime),
        sail_date: sailDate,
      }),
      { success: 'Sejltiden er gemt.' }
    );
    if (!ok) return;

    setStartStopId('');
    setEndStopId('');
    setTotalTime('');
    setSailingTime('');
    setShowForm(false);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne registrering?')) return;
    const { ok } = await mutate(supabase.from('gudenaa_sailing_times').delete().eq('id', id));
    if (ok) load();
  }

  const stopName = (id: string) => stops.find((s) => s.id === id)?.name ?? '?';

  return (
    <div className="space-y-6">
      <p className="text-sm text-river-500">
        Data herfra indgår automatisk i de historiske gennemsnitsberegninger på Ruteplanlægger- og
        Statistik-siderne — også for fremtidige Gudenå-ture.
      </p>

      <div className="space-y-3">
        {times.map((t) => (
          <div key={t.id} className="card flex items-start justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-medium text-river-800">
                {stopName(t.start_stop_id)} → {stopName(t.end_stop_id)}
              </p>
              <p className="text-sm text-river-500">
                Sejltid: {formatHours(t.sailing_time_hours)} · Inkl. pauser:{' '}
                {formatHours(t.total_time_hours)}
              </p>
              <p className="text-xs text-river-400">
                {namesById[t.user_id] ?? t.profile?.name ?? '?'} · {formatDate(t.sail_date)}
              </p>
            </div>
            {(t.user_id === profile?.id || isEditable) && (
              <button
                className="shrink-0 text-xs text-red-500 hover:underline"
                onClick={() => handleDelete(t.id)}
              >
                Slet
              </button>
            )}
          </div>
        ))}
        {times.length === 0 && (
          <div className="card p-8 text-center text-river-400">Ingen sejltider endnu.</div>
        )}
      </div>

      {isEditable && !showForm && (
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Log sejltid
        </button>
      )}

      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3 p-5">
          <div className="grid grid-cols-2 gap-3">
            <select
              className="input"
              value={startStopId}
              onChange={(e) => setStartStopId(e.target.value)}
              required
            >
              <option value="">Startsted</option>
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={endStopId}
              onChange={(e) => setEndStopId(e.target.value)}
              required
            >
              <option value="">Slutsted</option>
              {sorted.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Ren sejltid</label>
              <DurationHoursMinutesInput value={sailingTime} onChange={setSailingTime} />
            </div>
            <div>
              <label className="label">Total tid, inkl. pauser</label>
              <DurationHoursMinutesInput value={totalTime} onChange={setTotalTime} />
            </div>
          </div>

          <DatePicker value={sailDate} onChange={setSailDate} />
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
