import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { describeDbError, useMutate } from '../hooks/useMutate';
import type { Profile } from '../lib/types';

export default function TripOverviewPage() {
  const { trip, members, pairs, namesById, isCreatorOrAdmin, isEditable, refresh } = useTrip();
  const { profile } = useAuth();
  const { showToast } = useToast();
  const mutate = useMutate();
  const navigate = useNavigate();

  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [selectedInviteId, setSelectedInviteId] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [member1, setMember1] = useState('');
  const [member2, setMember2] = useState('');
  const [pairError, setPairError] = useState<string | null>(null);
  const [checkingRemoval, setCheckingRemoval] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('*').order('name');
    setAllProfiles((data as Profile[]) ?? []);
  }

  const availableProfiles = allProfiles.filter((p) => !members.some((m) => m.user_id === p.id));

  // En person kan kun indgå i ét par pr. rejse (håndhævet af databasen), så
  // dem der allerede er i et par, skal ikke kunne vælges igen.
  const pairedUserIds = new Set(
    pairs.flatMap((p) => [p.member1_id, p.member2_id].filter((id): id is string => !!id))
  );
  const unpairedMembers = members.filter((m) => !pairedUserIds.has(m.user_id));

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError(null);
    if (!trip || !selectedInviteId) return;

    const { ok, error } = await mutate(
      supabase
        .from('trip_members')
        .insert({ trip_id: trip.id, user_id: selectedInviteId, invited_by: profile?.id }),
      { toastOnError: false }
    );

    if (!ok) {
      setInviteError(
        error?.code === '23505' ? 'Personen er allerede medlem.' : describeDbError(error!)
      );
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

    const { ok, error } = await mutate(
      supabase.from('trip_pairs').insert({
        trip_id: trip.id,
        member1_id: member1,
        member2_id: member2 || null,
      }),
      { toastOnError: false }
    );

    if (!ok) {
      setPairError(describeDbError(error!));
      return;
    }

    setMember1('');
    setMember2('');
    refresh();
  }

  async function handleDeletePair(pairId: string) {
    if (!confirm('Fjern dette par? Regnskabet vil derefter vise de to personer hver for sig.')) return;
    const { ok } = await mutate(supabase.from('trip_pairs').delete().eq('id', pairId));
    if (ok) refresh();
  }

  async function handleArchive() {
    if (!trip) return;
    if (!confirm('Rejsen fjernes fra listen og kan ikke længere redigeres. Fortsæt?')) return;
    // archived_at sættes automatisk af en trigger i databasen.
    const { ok } = await mutate(supabase.from('trips').update({ is_archived: true }).eq('id', trip.id));
    if (ok) navigate('/');
  }

  /**
   * Fjernes et medlem, der optræder i regnskabet, bliver deres udgifter og
   * andele stående — men navnet forsvinder fra listen, og saldiene kommer til
   * at pege på en person, der ikke er der længere. Derfor tjekker vi først.
   */
  async function findRemovalBlockers(userId: string): Promise<string[]> {
    if (!trip) return [];

    const [paid, sharing, settled, paired, driving] = await Promise.all([
      supabase
        .from('expenses')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .eq('paid_by', userId),
      supabase
        .from('expense_participants')
        .select('expense_id, expenses!inner(trip_id)', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('expenses.trip_id', trip.id),
      supabase
        .from('settlements')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`),
      supabase
        .from('trip_pairs')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .or(`member1_id.eq.${userId},member2_id.eq.${userId}`),
      supabase
        .from('driving_logs')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', trip.id)
        .eq('user_id', userId),
    ]);

    const blockers: string[] = [];
    if ((paid.count ?? 0) > 0) blockers.push(`har lagt ud for ${paid.count} udgift(er)`);
    if ((sharing.count ?? 0) > 0) blockers.push(`deltager i ${sharing.count} udgift(er)`);
    if ((settled.count ?? 0) > 0) blockers.push(`indgår i ${settled.count} registreret betaling(er)`);
    if ((paired.count ?? 0) > 0) blockers.push('indgår i et par');
    if ((driving.count ?? 0) > 0) blockers.push(`har ${driving.count} kørselsregistrering(er)`);
    return blockers;
  }

  async function handleRemoveMember(userId: string) {
    if (!trip) return;

    setCheckingRemoval(userId);
    const blockers = await findRemovalBlockers(userId);
    setCheckingRemoval(null);

    const name = namesById[userId] ?? 'Personen';

    if (blockers.length > 0) {
      showToast(
        `${name} kan ikke fjernes endnu: ${blockers.join(', ')}. Slet eller flyt posterne først.`,
        'error'
      );
      return;
    }

    if (!confirm(`Fjern ${name} fra rejsen?`)) return;

    const { ok } = await mutate(
      supabase.from('trip_members').delete().eq('trip_id', trip.id).eq('user_id', userId),
      { success: `${name} er fjernet fra rejsen.` }
    );
    if (ok) refresh();
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
                  className="text-xs text-red-500 hover:underline disabled:opacity-50"
                  disabled={checkingRemoval === m.user_id}
                  onClick={() => handleRemoveMember(m.user_id)}
                >
                  {checkingRemoval === m.user_id ? 'Tjekker…' : 'Fjern'}
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
          Bruges bl.a. i regnskabet til at samle overførsler pr. par i stedet for pr. person. Hver person kan
          kun indgå i ét par.
        </p>
        <ul className="mb-4 divide-y divide-river-100 text-sm">
          {pairs.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>
                {p.label ||
                  `${namesById[p.member1_id] ?? '?'} & ${p.member2_id ? namesById[p.member2_id] ?? '?' : '—'}`}
              </span>
              {isEditable && (
                <button className="text-xs text-red-500 hover:underline" onClick={() => handleDeletePair(p.id)}>
                  Fjern
                </button>
              )}
            </li>
          ))}
          {pairs.length === 0 && <li className="py-2 text-river-400">Ingen par oprettet endnu.</li>}
        </ul>

        {isEditable && unpairedMembers.length > 0 && (
          <form onSubmit={handleAddPair} className="flex flex-wrap items-center gap-2">
            <select
              className="input w-auto"
              value={member1}
              onChange={(e) => setMember1(e.target.value)}
              required
            >
              <option value="">Vælg person</option>
              {unpairedMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {namesById[m.user_id]}
                </option>
              ))}
            </select>
            <span className="text-river-400">danner par med</span>
            <select className="input w-auto" value={member2} onChange={(e) => setMember2(e.target.value)}>
              <option value="">(ingen / rejser alene)</option>
              {unpairedMembers
                .filter((m) => m.user_id !== member1)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {namesById[m.user_id]}
                  </option>
                ))}
            </select>
            <button className="btn-secondary">Tilføj</button>
          </form>
        )}
        {isEditable && unpairedMembers.length === 0 && members.length > 0 && (
          <p className="text-xs text-river-400">Alle medlemmer indgår allerede i et par.</p>
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
