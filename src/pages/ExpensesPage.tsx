import { FormEvent, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { DatePicker } from '../components/DatePicker';
import type { Expense, ExpenseCategory } from '../lib/types';
import {
  balancesFromIndividuals,
  computeNetBalances,
  groupBalancesByPair,
  simplifyDebts,
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

export default function ExpensesPage() {
  const { trip, members, pairs, namesById, isEditable } = useTrip();
  const { profile } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [participantsByExpense, setParticipantsByExpense] = useState<Record<string, string[]>>({});
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

  useEffect(() => {
    if (trip) load();
    loadCategories();
  }, [trip?.id]);

  useEffect(() => {
    if (profile) setPaidBy(profile.id);
    setSelectedParticipants(members.map((m) => m.user_id));
  }, [profile, members.length]);

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
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!trip || !amount || !paidBy || !category) return;

    const { data: expense, error } = await supabase
      .from('expenses')
      .insert({
        trip_id: trip.id,
        description,
        category,
        amount: Number(amount),
        paid_by: paidBy,
        expense_date: date,
      })
      .select()
      .single();

    if (error || !expense) return;

    await supabase.from('expense_participants').insert(
      selectedParticipants.map((uid) => ({ expense_id: expense.id, user_id: uid }))
    );

    setDescription('');
    setAmount('');
    setShowForm(false);
    load();
  }

  async function toggleSettled(expense: Expense) {
    await supabase.from('expenses').update({ is_settled: !expense.is_settled }).eq('id', expense.id);
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm('Slet denne post?')) return;
    await supabase.from('expenses').delete().eq('id', id);
    load();
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

  const balances = useMemo(() => computeNetBalances(enrichedExpenses, namesById), [enrichedExpenses, namesById]);
  const displayBalances = groupByPair
    ? groupBalancesByPair(balances, pairs, namesById)
    : balancesFromIndividuals(balances, namesById);
  const transfers = simplifyDebts(displayBalances);

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
              placeholder="Beløb (kr.)"
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
          </div>
          <div className="flex gap-2">
            <button className="btn-primary">Gem</button>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Annuller
            </button>
          </div>
        </form>
      )}

      <div className="card p-5">
        <h2 className="mb-3 font-semibold text-river-800">Samlet forbrug: {totalAll.toFixed(2)} kr.</h2>
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
                  <span className="w-20 shrink-0 text-right text-river-500">{sum.toFixed(0)} kr.</span>
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
                          {Number(exp.amount).toFixed(2)} kr. · {exp.expense_date}
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
        <ul className="space-y-1 text-sm">
          {transfers.map((t, i) => (
            <li key={i}>
              <span className="font-medium">{t.fromLabel}</span> skylder{' '}
              <span className="font-medium">{t.toLabel}</span> {t.amount.toFixed(2)} kr.
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-river-400">
          Baseret på ikke-afregnede poster. Afregnede poster tæller stadig med i det samlede forbrug ovenfor.
        </p>
      </div>

      <div className="space-y-3">
        {expenses.map((exp) => (
          <div key={exp.id} className={`card p-4 ${exp.is_settled ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-river-800">
                  {exp.description || exp.category}{' '}
                  <span className="text-xs font-normal text-river-400">({exp.category})</span>
                </p>
                <p className="text-sm text-river-500">
                  {exp.amount} kr. · lagt ud af {namesById[exp.paid_by] ?? '?'} · {exp.expense_date}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1 text-xs text-river-500">
                  <input type="checkbox" checked={exp.is_settled} onChange={() => toggleSettled(exp)} />
                  Afregnet
                </label>
                {isEditable && (
                  <button className="text-xs text-red-500 hover:underline" onClick={() => handleDelete(exp.id)}>
                    Slet
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
