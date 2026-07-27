import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import type { Profile } from '../lib/types';

export default function TripOverviewPage() {
  const { trip, members, pairs, namesById, isCreatorOrAdmin, isEditable, refresh } = useTrip();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedInviteId, setSelectedInviteId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [member1, setMember1] = useState('');
  const [member2, setMember2] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('name');
    setAllProfiles((data as Profile[]) ?? []);
  }

  const availableProfiles = allProfiles.filter((p) => !members.some((m) => m.user_id === p.id));

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (!trip || !selectedInviteId) return;

    const { error } = await supabase
      .from('trip_members')
      .insert({ trip_id: trip.id, user_id: selectedInviteId, invited_by: profile?.id });

    if (error) {
      setInviteError(error.code === '23505' ? 'Personen er allerede medlem.' : error.message);
      return;
    }

    setSelectedInviteId('');
    setShowInviteForm(false);
    refresh();
  }

  async function handleAddPair(e: FormEvent) {
    e.preventDefault();
    setPairError(null);
    if (!trip || !member1) return;
    const { error } = await supabase.from('trip_pairs').insert({
      trip_id: trip.id,
      member1_id: member1,
      member2_id: member2 || null,
    });
    if (error) setPairError(error.message);
    else {
      setMember1('');
      setMember2('');
      refresh();
    }
  }

  async function handleArchive() {
    if (!trip) return;
    if (!confirm('Rejsen fjernes fra listen og kan ikke længere redigeres. Fortsæt?')) return;
    await supabase
      .from('trips')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', trip.id);
    navigate('/');
  }

  async function handleRemoveMember(userId: string) {
    if (!trip) return;
    if (!confirm('Fjern dette medlem fra rejsen?')) return;
    await supabase.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', userId);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-river-800">Medlemmer</h2>
        <ul className="mb-4 divide-y divide-river-100">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {namesById[m.user_id] ?? '—'}
                {trip?.created_by === m.user_id && (
                  <span className="ml-2 text-xs text-sand-500">Opretter</span>
                )}
              </span>
              {isCreatorOrAdmin && isEditable && trip?.created_by !== m.user_id && (
                <button
                  className="text-xs text-red-500 hover:underline"
                  onClick={() => handleRemoveMember(m.user_id)}
                >
                  Fjern
                </button>
              )}
            </li>
          ))}
        </ul>

        {isEditable && !showInviteForm && (
          <button className="btn-secondary" onClick={() => setShowInviteForm(true)}>
            + Tilføj deltager
          </button>
        )}

        {isEditable && showInviteForm && (
          <>
            <form onSubmit={handleInvite} className="flex flex-wrap gap-2">
              <select
                className="input"
                value={selectedInviteId}
                onChange={(e) => setSelectedInviteId(e.target.value)}
                required
              >
                <option value="">Vælg person</option>
                {availableProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.email})
                  </option>
                ))}
              </select>
              <button className="btn-primary shrink-0" disabled={!selectedInviteId}>
                Tilføj
              </button>
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => {
                  setShowInviteForm(false);
                  setSelectedInviteId('');
                  setInviteError(null);
                }}
              >
                Annuller
              </button>
            </form>
            {availableProfiles.length === 0 && (
              <p className="mt-2 text-xs text-river-400">
                Alle med en bruger i appen er allerede medlem af rejsen.
              </p>
            )}
          </>
        )}
        {inviteError && <p className="mt-2 text-sm text-red-600">{inviteError}</p>}
      </div>

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-river-800">Par</h2>
        <p className="mb-3 text-sm text-river-500">
          Bruges bl.a. i regnskabet til at samle overførsler pr. par i stedet for pr. person.
        </p>
        <ul className="mb-4 space-y-1 text-sm">
          {pairs.map((p) => (
            <li key={p.id}>
              {p.label || `${namesById[p.member1_id]} & ${p.member2_id ? namesById[p.member2_id] : '—'}`}
            </li>
          ))}
        </ul>

        {isEditable && (
          <form onSubmit={handleAddPair} className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={member1} onChange={(e) => setMember1(e.target.value)} required>
              <option value="">Vælg person</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {namesById[m.user_id]}
                </option>
              ))}
            </select>
            <span className="text-river-400">danner par med</span>
            <select className="input w-auto" value={member2} onChange={(e) => setMember2(e.target.value)}>
              <option value="">(ingen / rejser alene)</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {namesById[m.user_id]}
                </option>
              ))}
            </select>
            <button className="btn-secondary">Tilføj</button>
          </form>
        )}
        {pairError && <p className="mt-2 text-sm text-red-600">{pairError}</p>}
      </div>

      {isCreatorOrAdmin && isEditable && (
        <div className="card border-red-100 p-5">
          <h2 className="mb-2 font-semibold text-river-800">Fjern rejse</h2>
          <p className="mb-3 text-sm text-river-500">
            Rejsen flyttes til arkivet og kan ikke længere redigeres, men forbliver synlig for gennemsyn.
          </p>
          <button className="btn-danger" onClick={handleArchive}>
            Fjern rejse fra listen
          </button>
        </div>
      )}
    </div>
  );
}
