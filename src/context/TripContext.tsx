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

    const [{ data: tripData }, { data: memberData, error: memberError }, { data: pairData }] = await Promise.all([
      supabase.from('trips').select('*').eq('id', tripId).single(),
      // trip_members har to relationer til profiles (user_id og invited_by),
      // så vi skal eksplicit angive hvilken af dem "profile" skal hentes via
      // — ellers kan Supabase ikke afgøre det entydigt, og hele koblingen
      // fejler stille (profile ender som null for alle rækker).
      supabase
        .from('trip_members')
        .select('*, profile:profiles!trip_members_user_id_fkey(*)')
        .eq('trip_id', tripId),
      supabase.from('trip_pairs').select('*').eq('trip_id', tripId),
    ]);

    if (memberError) {
      // eslint-disable-next-line no-console
      console.error('[Fællesrejser] Kunne ikke hente medlemmer/profiler for rejsen', memberError);
    }

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
