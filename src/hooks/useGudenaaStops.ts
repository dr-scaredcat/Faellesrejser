import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { GudenaaStop } from '../lib/types';

export function useGudenaaStops() {
  const [stops, setStops] = useState<GudenaaStop[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: stopData } = await supabase.from('gudenaa_stops').select('*').order('sort_order');
    const { data: tagData } = await supabase.from('gudenaa_stop_tags').select('*');

    const tagsByStop: Record<string, string[]> = {};
    for (const t of tagData ?? []) {
      tagsByStop[t.stop_id] = tagsByStop[t.stop_id] ?? [];
      tagsByStop[t.stop_id].push(t.tag);
    }

    const stops = ((stopData as GudenaaStop[]) ?? []).map((s) => ({ ...s, tags: tagsByStop[s.id] ?? [] }));
    setStops(stops);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { stops, loading, reload: load };
}
