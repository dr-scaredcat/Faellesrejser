import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import type { Profile } from '../../lib/types';

export default function AdminGeneralPage() {
  return (
    <div className="space-y-8">
      <AdminSettingsSection />
      <UsersSection />
    </div>
  );
}

function AdminSettingsSection() {
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from('admin_settings')
      .select('*')
      .then(({ data }) => {
        const map: Record<string, any> = {};
        for (const row of data ?? []) map[row.key] = row.value;
        setSettings(map);
        setLoading(false);
      });
  }, []);

  async function updateSetting(key: string, value: any) {
    setSettings((prev) => ({ ...prev, [key]: value }));
    await supabase.from('admin_settings').upsert({ key, value });
  }

  if (loading) return null;

  return (
    <section className="card space-y-4 p-5">
      <h2 className="font-semibold text-river-800">Indstillinger</h2>

      <div>
        <label className="label">Sidens navn</label>
        <input
          className="input max-w-sm"
          value={settings.site_name ?? ''}
          onChange={(e) => updateSetting('site_name', e.target.value)}
        />
      </div>

      <div>
        <label className="label">Standardvaluta</label>
        <input
          className="input max-w-xs"
          value={settings.default_currency ?? ''}
          onChange={(e) => updateSetting('default_currency', e.target.value)}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!settings.allow_self_registration}
          onChange={(e) => updateSetting('allow_self_registration', e.target.checked)}
        />
        Tillad at nye brugere selv kan oprette en konto
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!settings.require_admin_approval_for_new_trips}
          onChange={(e) => updateSetting('require_admin_approval_for_new_trips', e.target.checked)}
        />
        Kræv admin-godkendelse før nye rejser bliver synlige (fremtidig funktion — slås til/fra her)
      </label>
    </section>
  );
}

function UsersSection() {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('name');
    setUsers((data as Profile[]) ?? []);
  }

  async function toggleAdmin(user: Profile) {
    if (user.id === me?.id && user.is_admin) {
      if (!confirm('Du er ved at fjerne din egen admin-adgang. Fortsæt?')) return;
    }
    await supabase.from('profiles').update({ is_admin: !user.is_admin }).eq('id', user.id);
    load();
  }

  return (
    <section className="card p-5">
      <h2 className="mb-3 font-semibold text-river-800">Brugere</h2>
      <ul className="divide-y divide-river-100">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2 text-sm">
            <span>
              {u.name} <span className="text-river-400">({u.email})</span>
            </span>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={u.is_admin} onChange={() => toggleAdmin(u)} />
              Admin
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
