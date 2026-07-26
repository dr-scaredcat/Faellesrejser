import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { applyThemeToDocument, DEFAULT_THEME_COLORS, type ThemeColors } from '../lib/color';

export interface ThemeRow {
  id: string;
  name: string;
  colors: ThemeColors;
  is_default: boolean;
}

interface ThemeContextValue {
  themes: ThemeRow[];
  activeThemeId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  activateTheme: (themeId: string) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyActive = useCallback((themeId: string | null, themeList: ThemeRow[]) => {
    const active = themeList.find((t) => t.id === themeId);
    applyThemeToDocument(active ? active.colors : DEFAULT_THEME_COLORS);
  }, []);

  const refresh = useCallback(async () => {
    const [{ data: themeData }, { data: settingData }] = await Promise.all([
      supabase.from('themes').select('*').order('created_at'),
      supabase.from('admin_settings').select('value').eq('key', 'active_theme_id').maybeSingle(),
    ]);

    const themeList = (themeData as ThemeRow[]) ?? [];
    const themeId = (settingData?.value as string | null) ?? null;

    setThemes(themeList);
    setActiveThemeId(themeId);
    applyActive(themeId, themeList);
    setLoading(false);
  }, [applyActive]);

  async function activateTheme(themeId: string) {
    await supabase.from('admin_settings').upsert({ key: 'active_theme_id', value: themeId });
    setActiveThemeId(themeId);
    applyActive(themeId, themes);
  }

  useEffect(() => {
    refresh();

    // Lyt efter at en anden admin skifter tema, så det slår igennem med det
    // samme for alle indlogget brugere uden en genindlæsning.
    const channel = supabase
      .channel('theme-changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'faellesrejser', table: 'admin_settings', filter: 'key=eq.active_theme_id' },
        (payload) => {
          const newThemeId = payload.new.value as string;
          setActiveThemeId(newThemeId);
          applyActive(newThemeId, themes);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  return (
    <ThemeContext.Provider value={{ themes, activeThemeId, loading, refresh, activateTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme skal bruges inden i ThemeProvider');
  return ctx;
}
