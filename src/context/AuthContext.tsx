import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();

    if (data) {
      setProfile(data as Profile);
      return;
    }

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[Fællesrejser] Kunne ikke hente profil for bruger', userId, error);
    }

    // Brugeren findes i auth.users, men mangler en profil-række i
    // faellesrejser.profiles (fx fordi kontoen oprindeligt blev oprettet
    // gennem en anden app der deler samme Supabase-projekt). Vi opretter
    // derfor profilen her i stedet. Nye profiler oprettet på denne måde er
    // IKKE admin som udgangspunkt — det skal sættes manuelt i databasen.
    if (error && error.code === 'PGRST116') {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        setProfile(null);
        return;
      }

      const { data: created, error: insertError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email ?? '',
          name: (user.user_metadata?.name as string | undefined) ?? user.email?.split('@')[0] ?? 'Bruger',
          is_admin: false,
        })
        .select()
        .single();

      if (insertError) {
        // eslint-disable-next-line no-console
        console.error('[Fællesrejser] Kunne ikke oprette manglende profil automatisk', insertError);
      }

      setProfile((created as Profile | null) ?? null);
      return;
    }

    setProfile(null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) {
        loadProfile(data.session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) {
        loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? oversætFejl(error.message) : null };
  }

  async function signUp(email: string, password: string, name: string) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    return { error: error ? oversætFejl(error.message) : null };
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function refreshProfile() {
    if (session) await loadProfile(session.user.id);
  }

  return (
    <AuthContext.Provider
      value={{ session, profile, loading, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

function oversætFejl(msg: string): string {
  if (msg.includes('Invalid login credentials')) return 'Forkert email eller adgangskode.';
  if (msg.includes('User already registered')) return 'Der findes allerede en bruger med denne email.';
  if (msg.includes('Password should be at least')) return 'Adgangskoden skal være mindst 6 tegn.';
  return msg;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth skal bruges inden i AuthProvider');
  return ctx;
}
