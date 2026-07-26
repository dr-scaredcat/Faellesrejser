import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import type { Trip, TripMember, TripPair, Profile } from '../lib/types';

interface TripContextValue {
  trip: Trip | null;
  members: TripMember[];
  pairs: TripPair[];
  namesById: Record<string, string>;
  loading: boolean;
  isCreatorOrAdmin: boolean;
  isEditable: boolean;
  refresh: () => Promise<void>;
}

const TripContext = createContext<TripContextValue | undefined>(undefined);

export function TripProvider({ children }: { children: ReactNode }) {
  const { tripId } = useParams();
  const { profile } = useAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [pairs, setPairs] = useState<TripPair[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!tripId) return;
    setLoading(true);

    const [{ data: tripData }, { data: memberData }, { data: pairData }] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).single(),
      supabase.from('trip_members').select('*, profile:profiles(*)').eq('trip_id', tripId),
      supabase.from('trip_pairs').select('*').eq('trip_id', tripId),
    ]);

    setTrip(tripData as Trip | null);
    setMembers((memberData as unknown as TripMember[]) ?? []);
    setPairs((pairData as TripPair[]) ?? []);
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const namesById: Record<string, string> = {};
  for (const m of members) {
    if (m.profile) namesById[m.user_id] = (m.profile as Profile).name;
  }

  const isCreatorOrAdmin = !!profile && !!trip && (trip.created_by === profile.id || profile.is_admin);
  const isEditable = !!trip && !trip.is_archived;

  return (
    <TripContext.Provider
      value={{ trip, members, pairs, namesById, loading, isCreatorOrAdmin, isEditable, refresh }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTrip() {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error('useTrip skal bruges inden i TripProvider');
  return ctx;
}
