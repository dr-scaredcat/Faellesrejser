import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

// Supabase kalder denne nøgle "Publishable key" i nyere projekter (tidligere
// "anon public key"). Vi understøtter begge variabelnavne, så det er lige
// meget hvilket navn du har brugt i Cloudflares miljøvariabler.
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY) as string;

if (!supabaseUrl || !supabaseKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Mangler VITE_SUPABASE_URL eller VITE_SUPABASE_PUBLISHABLE_KEY (evt. VITE_SUPABASE_ANON_KEY). Se .env.example.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'faellesrejser' },
});
