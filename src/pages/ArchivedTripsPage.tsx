import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import type { Trip } from '../lib/types';

export default function ArchivedTripsPage() {
  const { profile } = useAuth();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('trips')
      .select('*')
      .eq('is_archived', true)
      .order('archived_at', { ascending: false });
    setTrips((data as Trip[]) ?? []);
    setLoading(false);
  }

  async function handlePermanentDelete(trip: Trip) {
    const confirmed = confirm(
      `Er du HELT sikker på at du vil slette "${trip.name}" permanent?\n\n` +
        'Alt data for rejsen fjernes for altid — medlemmer, pakkeliste, rejseplan, regnskab, kørsel, ' +
        'ruteplaner og sejltider. Sejltider vil ikke længere indgå i de historiske Gudenå-statistikker. ' +
        'Dette kan IKKE fortrydes.'
    );
    if (!confirmed) return;

    setDeletingId(trip.id);

    // gudenaa_sailing_times er bevidst IKKE sat op til at blive slettet
    // automatisk når en rejse slettes (trip_id sættes bare til NULL), for at
    // historikken normalt ikke skal forsvinde ved et uheld. Her ønsker vi
    // dog en fuldstændig sletning, så de fjernes eksplicit først.
    await supabase.from('gudenaa_sailing_times').delete().eq('trip_id', trip.id);

    // Selve rejsen slettes derefter — det får (via "on delete cascade" i
    // databasen) automatisk medlemmer, par, pakkeliste, rejseplan, regnskab,
    // kørsel og ruteplaner til at forsvinde med det samme.
    const { error } = await supabase.from('trips').delete().eq('id', trip.id);

    if (error) {
      alert(`Kunne ikke slette rejsen: ${error.message}`);
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    load();
  }

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
          <div key={trip.id} className="card p-5 opacity-80">
            <Link to={`/rejser/${trip.id}`} className="block">
              <h2 className="text-lg font-semibold text-river-800">{trip.name}</h2>
              <p className="text-sm text-river-500">{trip.destination}</p>
            </Link>
            {profile?.is_admin && (
              <button
                className="mt-3 text-xs text-red-500 hover:underline disabled:opacity-50"
                disabled={deletingId === trip.id}
                onClick={() => handlePermanentDelete(trip)}
              >
                {deletingId === trip.id ? 'Sletter…' : 'Slet permanent'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
