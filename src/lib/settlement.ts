import type { Expense, TripPair } from './types';

export interface Balance {
  id: string; // user_id eller "pair:<pairId>"
  label: string;
  amount: number; // positiv = skal have penge, negativ = skylder penge
}

export interface Transfer {
  fromId: string;
  fromLabel: string;
  toId: string;
  toLabel: string;
  amount: number;
}

/**
 * Beregner nettosaldo pr. person ud fra ikke-afregnede udgifter.
 * Udgiften deles ligeligt mellem deltagerne (participant_ids).
 */
export function computeNetBalances(
  expenses: Expense[],
  namesById: Record<string, string>
): Record<string, number> {
  const balances: Record<string, number> = {};

  for (const exp of expenses) {
    if (exp.is_settled) continue;
    const participants = exp.participant_ids && exp.participant_ids.length > 0
      ? exp.participant_ids
      : [exp.paid_by];
    const share = exp.amount / participants.length;

    balances[exp.paid_by] = (balances[exp.paid_by] ?? 0) + exp.amount;
    for (const uid of participants) {
      balances[uid] = (balances[uid] ?? 0) - share;
    }
  }

  // Sørg for at alle kendte navne indgår, selv med saldo 0.
  for (const id of Object.keys(namesById)) {
    if (!(id in balances)) balances[id] = 0;
  }

  return balances;
}

/** Slår individuelle saldi sammen til par, ud fra en liste af trip_pairs. */
export function groupBalancesByPair(
  balances: Record<string, number>,
  pairs: TripPair[],
  namesById: Record<string, string>
): Balance[] {
  const userToPair: Record<string, string> = {};
  const pairLabel: Record<string, string> = {};

  for (const p of pairs) {
    const key = `pair:${p.id}`;
    userToPair[p.member1_id] = key;
    if (p.member2_id) userToPair[p.member2_id] = key;
    const names = [p.member1_id, p.member2_id]
      .filter(Boolean)
      .map((id) => namesById[id as string] ?? '?');
    pairLabel[key] = p.label ?? names.join(' & ');
  }

  const grouped: Record<string, number> = {};
  for (const [userId, amount] of Object.entries(balances)) {
    const key = userToPair[userId] ?? userId;
    grouped[key] = (grouped[key] ?? 0) + amount;
  }

  return Object.entries(grouped).map(([id, amount]) => ({
    id,
    label: id.startsWith('pair:') ? pairLabel[id] : namesById[id] ?? id,
    amount,
  }));
}

export function balancesFromIndividuals(
  balances: Record<string, number>,
  namesById: Record<string, string>
): Balance[] {
  return Object.entries(balances).map(([id, amount]) => ({
    id,
    label: namesById[id] ?? id,
    amount,
  }));
}

/**
 * Greedy-algoritme: matcher den der skylder mest med den der skal have mest,
 * indtil alle saldi er ~0. Giver et minimalt sæt overførsler.
 */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const EPSILON = 0.01;
  const debtors = balances
    .filter((b) => b.amount < -EPSILON)
    .map((b) => ({ ...b }))
    .sort((a, b) => a.amount - b.amount);
  const creditors = balances
    .filter((b) => b.amount > EPSILON)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(-debtor.amount, creditor.amount);

    if (amount > EPSILON) {
      transfers.push({
        fromId: debtor.id,
        fromLabel: debtor.label,
        toId: creditor.id,
        toLabel: creditor.label,
        amount: Math.round(amount * 100) / 100,
      });
    }

    debtor.amount += amount;
    creditor.amount -= amount;

    if (Math.abs(debtor.amount) <= EPSILON) i++;
    if (Math.abs(creditor.amount) <= EPSILON) j++;
  }

  return transfers;
}
