import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useMutate } from '../hooks/useMutate';
import { DatePicker } from '../components/DatePicker';
import { formatCurrency, formatDate } from '../lib/format';
import type { Expense, ExpenseCategory, Settlement } from '../lib/types';
import {
  balancesFromIndividuals,
  computeNetBalances,
  defaultSettlementParties,
  groupBalancesByPair,
  partyMembers,
  simplifyDebts,
  totalSettled,
  type Transfer,
} from '../lib/settlement';

const CATEGORY_COLORS: Record<string, string> = {
  'Mad/Drikke': '#4d968f',
  Transport: '#b6862f',
  Overnatning: '#79b2ac',
  Grej: '#c99e4a',
  Sjov: '#d7b671',
  Diverse: '#a7cdca',
};
const FALLBACK_PALETTE = ['#4d968f', '#b6862f', '#79b2ac', '#c99e4a', '#d7b671', '#a7cdca'];

// Standarddato for en ny udgift: rejsens første dag, medmindre dags dato er
// senere (så man under selve rejsen ikke behøver ændre datoen for hver ny
// udgift man lægger ind løbende).
function defaultExpenseDate(tripStartDate: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!tripStartDate) return today;
  return tripStartDate > today ? tripStartDate : today;
}

export default function ExpensesPage() {
  const { trip, members, pairs, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const mutate = useMutate();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [participantsByExpense, setParticipantsByExpense] = useState<Record<string, string[]>>({});
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [groupByPair, setGroupByPair] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);

  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPaidBy, setEditPaidBy] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editParticipants, setEditParticipants] = useState<string[]>([]);

  // Registrering af en betaling ud fra en linje under "hvem skylder hvem".
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [settleFrom, setSettleFrom] = useState('');
  const [settleTo, setSettleTo] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [settleDate, setSettleDate] = useState(new Date().toISOString().slice(0, 10));
  const [settleNote, setSettleNote] = useState('');

  useEffect(() => {
    if (trip) load();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  useEffect(() => {
    if (profile) setPaidBy(profile.id);
    setSelectedParticipants(members.map((m) => m.user_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, members.length]);

  // Standarddato for en ny udgift: rejsens første dag, eller dags dato hvis
  // den er senere (dvs. man er allerede i gang med rejsen).
  useEffect(() => {
    setDate(defaultExpenseDate(trip?.start_date ?? null));
  }, [trip?.start_date]);

  async function loadCategories() {
    const { data } = await supabase.from('expense_categories').select('*').order('sort_order');
    const list = (data as ExpenseCategory[]) ?? [];
    setCategories(list);
    setCategory((prev) => prev || list[0]?.name || '');
  }

  async function load() {
    if (!trip) return;

    const { data } = await supabase
      .from('expenses')
      .select('*, paid_by_profile:profiles!expenses_paid_by_fkey(*)')
      .eq('trip_id', trip.id)
      .order('expense_date', { ascending: false });
    const expenseList = (data as unknown as Expense[]) ?? [];
    setExpenses(expenseList);

    const { data: partData } = await supabase
      .from('expense_participants')
      .select('*')
      .in(
        'expense_id',
        expenseList.map((e) => e.id)
      );
    const map: Record<string, string[]> = {};
    for (const p of partData ?? []) {
      map[p.expense_id] = map[p.expense_id] ?? [];
      map[p.expense_id].push(p.user_id);
    }
    setParticipantsByExpense(map);

    const { data: settleData } = await supabase
      .from('settlements')
      .select('*')
      .eq('trip_id', trip.id)
      .order('settled_on', { ascending: false });
    setSettlements((settleData as Settlement[]) ?? []);
  }

  // Udgift og deltagere gemmes i ét kald (save_expense), så en udgift aldrig
  // kan ende uden deltagere hvis det andet kald fejler undervejs.
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip || !amount || !paidBy || !category) return;

    const { ok } = await mutate(
      supabase.rpc('save_expense', {
        _expense_id: null,
        _trip_id: trip.id,
        _description: description,
        _category: category,
        _amount: Number(amount),
        _paid_by: paidBy,
        _expense_date: date,
        _participants: selectedParticipants,
      })
    );
    if (!ok) return;

    setDescription('');
    setAmount('');
    setDate(defaultExpenseDate(trip?.start_date ?? null));
    setShowForm(false);
    load();
  }

  function startEditing(exp: Expense) {
    setEditingExpenseId(exp.id);
    setEditDescription(exp.description);
    setEditCategory(exp.category);
    setEditAmount(String(exp.amount));
    setEditPaidBy(exp.paid_by);
    setEditDate(exp.expense_date);
    setEditParticipants(participantsByExpense[exp.id] ?? []);
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!trip || !editingExpenseId || !editAmount || !editPaidBy || !editCategory) return;

    const { ok } = await mutate(
      supabase.rpc('save_expense', {
        _expense_id: editingExpenseId,
        _trip_id: trip.id,
        _description: editDescription,
        _category: editCategory,
        _amount: Number(editAmount),
        _paid_by: editPaidBy,
        _expense_date: editDate,
        _participants: editParticipants,
      })
    );
    if (!ok) return;

    setEditingExpenseId(null);
    load();
  }

  async function toggleSettled(expense: Expense) {
    const { ok } = await mutate(
      supabase.from('expenses').update({ is_settled: !expense.is_settled }).eq('id', expense.id)
    );
    if (ok) load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne post?')) return;
    const { ok } = await mutate(supabase.from('expenses').delete().eq('id', id));
    if (ok) load();
  }

  const enrichedExpenses = useMemo(
    () => expenses.map((e) => ({ ...e, participant_ids: participantsByExpense[e.id] ?? [] })),
    [expenses, participantsByExpense]
  );

  const totalAll = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const e of expenses) map[e.category] = (map[e.category] ?? 0) + Number(e.amount);
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const expensesByCategory = useMemo(() => {
    const map: Record<string, Expense[]> = {};
    for (const e of expenses) {
      map[e.category] = map[e.category] ?? [];
      map[e.category].push(e);
    }
    return map;
  }, [expenses]);

  function colorForCategory(cat: string, index: number) {
    return CATEGORY_COLORS[cat] ?? FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
  }

  // Hvor mange personer hvert medlem betaler for. Er kun den ene halvdel af
  // et par tilmeldt appen, står vedkommende med vægt 2, og udgifterne deles
  // efter hoveder frem for efter brugerkonti.
  const shareWeights = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of members) map[m.user_id] = m.share_weight ?? 1;
    return map;
  }, [members]);

  const balances = useMemo(
    () => computeNetBalances(enrichedExpenses, settlements, namesById, shareWeights),
    [enrichedExpenses, settlements, namesById, shareWeights]
  );
  const displayBalances = groupByPair
    ? groupBalancesByPair(balances, pairs, namesById)
    : balancesFromIndividuals(balances, namesById);
  const transfers = simplifyDebts(displayBalances);

  // ---- Registrering af betalinger ------------------------------------------

  function transferKey(t: Transfer) {
    return `${t.fromId}->${t.toId}`;
  }

  function startSettling(t: Transfer) {
    const { fromUserId, toUserId } = defaultSettlementParties(t, pairs);
    setSettlingKey(transferKey(t));
    setSettleFrom(fromUserId ?? '');
    setSettleTo(toUserId ?? '');
    setSettleAmount(String(t.amount));
    setSettleDate(new Date().toISOString().slice(0, 10));
    setSettleNote('');
  }

  async function handleSettle(e: FormEvent) {
    e.preventDefault();
    if (!trip || !profile || !settleFrom || !settleTo) return;

    const { ok } = await mutate(
      supabase.from('settlements').insert({
        trip_id: trip.id,
        from_user_id: settleFrom,
        to_user_id: settleTo,
        amount: Number(settleAmount),
        settled_on: settleDate,
        note: settleNote || null,
        created_by: profile.id,
      }),
      { success: 'Betalingen er registreret.' }
    );
    if (!ok) return;

    setSettlingKey(null);
    load();
  }

  async function handleDeleteSettlement(id: string) {
    if (!confirm('Fortryd denne betaling? Beløbet lægges tilbage i regnskabet.')) return;
    const { ok } = await mutate(supabase.from('settlements').delete().eq('id', id));
    if (ok) load();
  }

  const settledTotal = totalSettled(settlements);

  return (
    <div className="space-y-6">
      {isEditable && !showForm && (
        <button className="btn-primary" onClick={() => setShowForm(true)}>
          + Tilføj udgift
        </button>
      )}

      {isEditable && showForm && (
        <form onSubmit={handleSubmit} className="card space-y-3 p-5">
          <input
            className="input"
            placeholder="Beskrivelse"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              className="input"
              placeholder="Beløb"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {namesById[m.user_id]}
                </option>
              ))}
            </select>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div>
            <label className="label">Deles mellem</label>
            <div className="flex flex-wrap gap-3 text-sm">
              {members.map((m) => (
                <label key={m.user_id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.includes(m.user_id)}
                    onChange={(e) =>
                      setSelectedParticipants((prev) =>
                        e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id)
                      )
                    }
                  />
                  {namesById[m.user_id]}
                </label>
              ))}
            </div>
            {selectedParticipants.length === 0 && (
              <p className="mt-1 text-xs text-red-600">Vælg mindst én person at dele udgiften med.</p>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={selectedParticipants.length === 0}>
              Gem
            </button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-river-800">Samlet forbrug: {formatCurrency(totalAll)}</h2>
        <div className="space-y-1">
          {byCategory.map(([cat, sum], i) => {
            const isOpen = expandedCategory === cat;
            return (
              <div key={cat}>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-1.5 text-left text-sm"
                  onClick={() => setExpandedCategory(isOpen ? null : cat)}
                >
                  <span className="w-24 shrink-0 text-river-600">{cat}</span>
                  <div className="h-3 flex-1 rounded-full bg-river-50">
                    <div
                      className="h-3 rounded-full"
                      style={{
                        width: totalAll ? `${(sum / totalAll) * 100}%` : '0%',
                        backgroundColor: colorForCategory(cat, i),
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-river-500">{formatCurrency(sum)}</span>
                  <span className="w-3 shrink-0 text-center text-xs text-river-400">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <ul className="mb-2 ml-2 space-y-1 border-l border-river-100 py-1 pl-4 text-xs text-river-500">
                    {(expensesByCategory[cat] ?? []).map((exp) => (
                      <li key={exp.id} className="flex items-center justify-between gap-3">
                        <span>
                          {exp.description || cat} · {namesById[exp.paid_by] ?? '?'}
                        </span>
                        <span className="shrink-0">
                          {formatCurrency(exp.amount)} · {formatDate(exp.expense_date)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {byCategory.length === 0 && <p className="text-sm text-river-400">Ingen udgifter registreret endnu.</p>}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-river-800">Hvem skylder hvem</h2>
          <div className="flex gap-1 text-xs">
            <button
              className={`tab ${!groupByPair ? 'tab-active' : 'tab-inactive'}`}
              onClick={() => setGroupByPair(false)}
            >
              Personer
            </button>
            <button
              className={`tab ${groupByPair ? 'tab-active' : 'tab-inactive'}`}
              onClick={() => setGroupByPair(true)}
            >
              Par
            </button>
          </div>
        </div>

        {transfers.length === 0 && <p className="text-sm text-river-400">Alt er gjort op — ingen skylder noget.</p>}

        <ul className="space-y-2 text-sm">
          {transfers.map((t) => {
            const key = transferKey(t);
            const fromOptions = partyMembers(t.fromId, pairs);
            const toOptions = partyMembers(t.toId, pairs);
            const isSettling = settlingKey === key;

            return (
              <li key={key} className="rounded-lg border border-river-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-medium">{t.fromLabel}</span> skylder{' '}
                    <span className="font-medium">{t.toLabel}</span> {formatCurrency(t.amount)}
                  </span>
                  {isEditable && !isSettling && (
                    <button
                      type="button"
                      className="text-xs text-river-600 hover:underline"
                      onClick={() => startSettling(t)}
                    >
                      Marker som betalt
                    </button>
                  )}
                </div>

                {isSettling && (
                  <form onSubmit={handleSettle} className="mt-3 space-y-2 border-t border-river-100 pt-3">
                    {/* Ved par er det stadig to konkrete personer der sender penge til
                        hinanden. Vi registrerer dem, så person- og parvisningen
                        bliver ved med at stemme overens. */}
                    {(fromOptions.length > 1 || toOptions.length > 1) && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs">Betaler</label>
                          <select
                            className="input"
                            value={settleFrom}
                            onChange={(e) => setSettleFrom(e.target.value)}
                          >
                            {fromOptions.map((id) => (
                              <option key={id} value={id}>
                                {namesById[id] ?? id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label text-xs">Modtager</label>
                          <select className="input" value={settleTo} onChange={(e) => setSettleTo(e.target.value)}>
                            {toOptions.map((id) => (
                              <option key={id} value={id}>
                                {namesById[id] ?? id}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="label text-xs">Beløb</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          className="input"
                          value={settleAmount}
                          onChange={(e) => setSettleAmount(e.target.value)}
                          required
                        />
                      </div>
                      <div>
                        <label className="label text-xs">Dato</label>
                        <DatePicker value={settleDate} onChange={setSettleDate} />
                      </div>
                    </div>

                    <input
                      className="input"
                      placeholder="Note (fx MobilePay)"
                      value={settleNote}
                      onChange={(e) => setSettleNote(e.target.value)}
                    />

                    <p className="text-xs text-river-400">
                      Betal du kun en del af beløbet, så ret det her — resten bliver stående som gæld.
                    </p>

                    <div className="flex gap-2">
                      <button className="btn-primary">Registrer betaling</button>
                      <button type="button" className="btn-secondary" onClick={() => setSettlingKey(null)}>
                        Annuller
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-xs text-river-400">
          Poster markeret som "afregnet separat" indgår ikke her, men tæller stadig med i det samlede forbrug ovenfor.
        </p>
      </div>

      {settlements.length > 0 && (
        <div className="card p-5">
          <h2 className="mb-1 font-semibold text-river-800">Registrerede betalinger</h2>
          <p className="mb-3 text-sm text-river-500">
            I alt {formatCurrency(settledTotal)} overført mellem deltagerne.
          </p>
          <ul className="divide-y divide-river-100 text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium">{namesById[s.from_user_id] ?? '?'}</span> betalte{' '}
                  <span className="font-medium">{namesById[s.to_user_id] ?? '?'}</span> {formatCurrency(s.amount)}
                  <span className="text-river-400"> · {formatDate(s.settled_on)}</span>
                  {s.note && <span className="block text-xs text-river-400">{s.note}</span>}
                </span>
                {isEditable && (
                  <button
                    className="shrink-0 text-xs text-red-500 hover:underline"
                    onClick={() => handleDeleteSettlement(s.id)}
                  >
                    Fortryd
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {expenses.map((exp) => (
          <div key={exp.id} className={`card p-4 ${exp.is_settled ? 'opacity-60' : ''}`}>
            {editingExpenseId === exp.id ? (
              <form onSubmit={handleUpdate} className="space-y-3">
                <input
                  className="input"
                  placeholder="Beskrivelse"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="input"
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="Beløb"
                    value={editAmount}
                    onChange={(e) => setEditAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="input"
                    value={editPaidBy}
                    onChange={(e) => setEditPaidBy(e.target.value)}
                  >
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {namesById[m.user_id]}
                      </option>
                    ))}
                  </select>
                  <DatePicker value={editDate} onChange={setEditDate} />
                </div>
                <div>
                  <label className="label">Deles mellem</label>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {members.map((m) => (
                      <label key={m.user_id} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={editParticipants.includes(m.user_id)}
                          onChange={(e) =>
                            setEditParticipants((prev) =>
                              e.target.checked ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id)
                            )
                          }
                        />
                        {namesById[m.user_id]}
                      </label>
                    ))}
                  </div>
                  {editParticipants.length === 0 && (
                    <p className="mt-1 text-xs text-red-600">Vælg mindst én person at dele udgiften med.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={editParticipants.length === 0}>
                    Gem
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setEditingExpenseId(null)}
                  >
                    Annuller
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-river-800">
                    {exp.description || exp.category}{' '}
                    <span className="text-xs font-normal text-river-400">({exp.category})</span>
                  </p>
                  <p className="text-sm text-river-500">
                    {formatCurrency(exp.amount)} · lagt ud af {namesById[exp.paid_by] ?? '?'} ·{' '}
                    {formatDate(exp.expense_date)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label
                    className="flex items-center gap-1 text-xs text-river-500"
                    title="Hele posten er betalt uden om det løbende regnskab — fx rejsen, hvor alle har overført deres andel inden afrejse. Beløbet tæller stadig med i det samlede forbrug."
                  >
                    <input
                      type="checkbox"
                      checked={exp.is_settled}
                      disabled={!isEditable}
                      onChange={() => toggleSettled(exp)}
                    />
                    Afregnet separat
                  </label>
                  {isEditable && (
                    <>
                      <button
                        className="text-xs text-river-500 hover:underline"
                        onClick={() => startEditing(exp)}
                      >
                        Rediger
                      </button>
                      <button
                        className="text-xs text-red-500 hover:underline"
                        onClick={() => handleDelete(exp.id)}
                      >
                        Slet
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
