import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useTrip } from '../../context/TripContext';
import { useGudenaaStops } from '../../hooks/useGudenaaStops';
import { segmentBetween, sortStops } from '../../lib/gudenaa';
import { computeDedupedTotals } from '../../lib/gudenaaStats';
import { confidenceInterval95, formatHours, formatKmT } from '../../lib/stats';
import type { SailingTime, Trip } from '../../lib/types';

export default function StatisticsPage() {
  const { trip } = useTrip();
  const { stops, loading: stopsLoading } = useGudenaaStops();
  const [sailingTimes, setSailingTimes] = useState<SailingTime[]>([]);
  const [gudenaaTrips, setGudenaaTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: sailData }, { data: tripData }] = await Promise.all([
      supabase.from('gudenaa_sailing_times').select('*, profile:profiles(*)'),
      supabase.from('trips').select('*').eq('trip_type', 'gudenaa'),
    ]);
    setSailingTimes((sailData as unknown as SailingTime[]) ?? []);
    setGudenaaTrips((tripData as Trip[]) ?? []);
    setLoading(false);
  }

  const sorted = sortStops(stops);

  // Rå per-registrering-data. Bruges til gennemsnitsfart og highlights — her
  // skal HVER registrering tælle for sig, uanset om flere har logget samme
  // (eller overlappende) stræk.
  const withDistance = useMemo(
    () =>
      sailingTimes.map((st) => ({
        ...st,
        km: segmentBetween(sorted, st.start_stop_id, st.end_stop_id).km,
      })),
    [sailingTimes, stops]
  );

  const currentTripSailingTimes = useMemo(
    () => sailingTimes.filter((st) => st.trip_id === trip?.id),
    [sailingTimes, trip?.id]
  );
  const currentTripWithDistance = useMemo(
    () => withDistance.filter((st) => st.trip_id === trip?.id),
    [withDistance, trip?.id]
  );
