import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { TripType } from '../lib/types';

export default function TripCreatePage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tripType, setTripType] = useState<TripType>('standard');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setBusy(true);
    setError(null);

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .insert({
        name,
        destination,
        start_date: startDate || null,
        end_date: endDate || null,
        trip_type: tripType,
        created_by: profile.id,
      })
      .select()
      .single();

    if (tripError || !trip) {
      setError(tripError?.message ?? 'Noget gik galt.');
      setBusy(false);
      return;
    }

    // Opretter bliver automatisk medlem af rejsen.
    await supabase.from('trip_members').insert({
      trip_id: trip.id,
      user_id: profile.id,
      invited_by: profile.id,
    });

    // Opret standard pakke-kategorier, så listen ikke starter helt tom.
    await supabase.from('packing_categories').insert(
      ['Grej', 'Mad/Drikke', 'Toiletsager', 'Diverse'].map((cat, i) => ({
        trip_id: trip.id,
        name: cat,
        sort_order: i,
      }))
    );

    navigate(`/rejser/${trip.id}`);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-river-800">Ny rejse</h1>
      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Navn på rejsen</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Destination</label>
          <input
            className="input"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Startdato</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Slutdato</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label">Type af rejse</label>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={tripType === 'standard'}
                onChange={() => setTripType('standard')}
              />
              Almindelig rejse
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={tripType === 'gudenaa'}
                onChange={() => setTripType('gudenaa')}
              />
              Gudenåen (kanotur)
            </label>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button className="btn-primary w-full" disabled={busy}>
          Opret rejse
        </button>
      </form>
    </div>
  );
}
