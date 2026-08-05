import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { ZoomableImage } from '../../components/ZoomableImage';
import { useStorageImageUrl } from '../../hooks/useStorageImageUrl';
import type { GudenaaMapSection } from '../../lib/types';

const BUCKET = 'gudenaa-maps';

export default function MapPage() {
  const [overviewPath, setOverviewPath] = useState<string | null>(null);
  const [sections, setSections] = useState<GudenaaMapSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [openSection, setOpenSection] = useState<GudenaaMapSection | null>(null);

  // Bucketten er privat, så billedet skal hentes via download() (som
  // respekterer login og adgangsregler) i stedet for getPublicUrl() (som
  // kun virker på offentlige buckets) — se hooket for forklaringen.
  const overviewUrl = useStorageImageUrl(BUCKET, overviewPath);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: setting }, { data: sectionData }] = await Promise.all([
      supabase
        .from('admin_settings')
        .select('value')
        .eq('key', 'gudenaa_map_overview_path')
        .maybeSingle(),
      supabase.from('gudenaa_map_sections').select('*').order('sort_order'),
    ]);

    setOverviewPath((setting?.value as string | undefined) ?? null);
    setSections((sectionData as GudenaaMapSection[]) ?? []);
    setLoading(false);
  }

  if (loading) return <p className="text-river-500">Indlæser…</p>;

  if (!overviewPath) {
    return (
      <div className="card p-8 text-center text-river-400">
        Der er endnu ikke uploadet et kort. Det gøres under Admin → Gudenåen.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-5">
        <h2 className="font-semibold text-river-800">Kort over Gudenåen</h2>
        <p className="text-sm text-river-500">
          Tryk på et markeret område for at se det udsnit i højere opløsning. Klem sammen eller brug
          musehjulet for at zoome, dobbelttryk for at zoome ind eller nulstille.
        </p>
      </div>

      <div className="card overflow-hidden p-0">
        {overviewUrl ? (
          <ZoomableImage src={overviewUrl} alt="Oversigtskort over Gudenåen" className="w-full">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setOpenSection(s)}
                title={s.label}
                className="absolute rounded-md border-2 border-sand-400/0 bg-sand-300/0 transition-colors hover:border-sand-500 hover:bg-sand-300/25 focus:border-sand-500 focus:bg-sand-300/25 focus:outline-none"
                style={{
                  left: `${s.x_percent}%`,
                  top: `${s.y_percent}%`,
                  width: `${s.width_percent}%`,
                  height: `${s.height_percent}%`,
                }}
              >
                <span className="sr-only">{s.label}</span>
              </button>
            ))}
          </ZoomableImage>
        ) : (
          <p className="p-8 text-center text-river-400">Henter kort…</p>
        )}
      </div>

      {sections.length === 0 && (
        <p className="text-xs text-river-400">
          Der er ingen detaljerede udsnit markeret på kortet endnu. Det gøres under Admin → Gudenåen.
        </p>
      )}

      {openSection && <SectionViewer section={openSection} onClose={() => setOpenSection(null)} />}
    </div>
  );
}

function SectionViewer({ section, onClose }: { section: GudenaaMapSection; onClose: () => void }) {
  const url = useStorageImageUrl(BUCKET, section.storage_path);

  // Luk med Escape, som man forventer af en fuldskærmsvisning.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-river-900">
      <div className="flex items-center justify-between bg-river-800 px-4 py-3">
        <h3 className="font-medium text-white">{section.label}</h3>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20"
        >
          Luk
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {url ? (
          <ZoomableImage src={url} alt={section.label} className="h-full w-full" maxScale={6} />
        ) : (
          <p className="p-8 text-center text-river-300">Henter billede…</p>
        )}
      </div>
    </div>
  );
}
