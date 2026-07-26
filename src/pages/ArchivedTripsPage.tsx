import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Trip } from '../lib/types';

export default function ArchivedTripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('trips')
      .select('*')
      .eq('is_archived', true)
      .order('archived_at', { ascending: false })
      .then(({ data }) => {
        setTrips((data as Trip[]) ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-river-800">Arkiverede rejser</h1>
      <p className="mb-6 text-sm text-river-500">
        Disse rejser er fjernet fra hovedlisten og kan ikke længere redigeres, men I kan stadig se dem.
      </p>

      {loading && <p className="text-river-500">Indlæser…</p>}
      {!loading && trips.length === 0 && (
        <div className="card p-8 text-center text-river-500">Ingen arkiverede rejser endnu.</div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/rejser/${trip.id}`} className="card block p-5 opacity-80">
            <h2 className="text-lg font-semibold text-river-800">{trip.name}</h2>
            <p className="text-sm text-river-500">{trip.destination}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
