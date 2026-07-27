import { FormEvent, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function UserPage() {
  const { profile, refreshProfile } = useAuth();
  const [name, setName] = useState(profile?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!profile || !name.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ name: name.trim() })
      .eq('id', profile.id);

    if (updateError) {
      setError(updateError.message);
      setSaving(false);
      return;
    }

    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!profile) {
    return (
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-river-500">Indlæser…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold text-river-800">Min bruger</h1>

      <form onSubmit={handleSubmit} className="card space-y-4 p-6">
        <div>
          <label className="label">Navn som vises i appen</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          <p className="mt-1 text-xs text-river-400">
            Det er dette navn, dine medrejsende ser — fx ved "Pakket af" på pakkelisten og "Lagt ud af" i
            regnskabet.
          </p>
        </div>

        <div>
          <label className="label">Email</label>
          <input className="input bg-river-50" value={profile.email} disabled />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-river-600">Gemt!</p>}

        <button className="btn-primary" disabled={saving || !name.trim()}>
          Gem
        </button>
      </form>

      <p className="mt-6 text-xs text-river-400">Flere personlige indstillinger kommer her i fremtiden.</p>
    </div>
  );
}
