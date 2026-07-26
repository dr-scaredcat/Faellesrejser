import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Trip } from '../lib/types';

export default function TripsListPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('trips')
      .select('*')
      .eq('is_archived', false)
      .order('start_date', { ascending: true, nullsFirst: false });
    setTrips((data as Trip[]) ?? []);
    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-river-800">Jeres rejser</h1>
        <Link to="/rejser/ny" className="btn-primary">
          + Ny rejse
        </Link>
      </div>

      {loading && <p className="text-river-500">Indlæser…</p>}

      {!loading && trips.length === 0 && (
        <div className="card p-8 text-center text-river-500">
          I er ikke inviteret til nogen rejser endnu. Opret en ny rejse for at komme i gang.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {trips.map((trip) => (
          <Link
            key={trip.id}
            to={`/rejser/${trip.id}`}
            className="card block p-5 transition hover:border-river-300 hover:shadow-md"
          >
            <div className="mb-1 flex items-center gap-2">
              {trip.trip_type === 'gudenaa' && (
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-medium text-sand-500">
                  Gudenåen
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-river-800">{trip.name}</h2>
            <p className="text-sm text-river-500">{trip.destination}</p>
            {trip.start_date && (
              <p className="mt-2 text-xs text-river-400">
                {trip.start_date} {trip.end_date ? `– ${trip.end_date}` : ''}
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
