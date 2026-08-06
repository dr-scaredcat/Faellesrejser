import type { Expense, Settlement, TripPair } from './types';

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

const EPSILON = 0.01;

/**
 * Beregner nettosaldo pr. person.
 *
 * VÆGTE
 *
 * Hvert medlem har en vægt: hvor mange personer de betaler for. Er kun den
 * ene halvdel af et par tilmeldt appen, står vedkommende med vægt 2, og
 * udgiften deles så efter hoveder frem for efter brugerkonti. Uden det ville
 * to par med tre tilmeldte give en tredjedel til den, der er alene på appen,
 * i stedet for halvdelen.
 *
 * Vægt 1 for alle giver præcis samme resultat som en ligelig deling, så
 * eksisterende rejser er upåvirkede.
 *
 * AFREGNING
 *
 * Der er to måder at gøre en post op på, og de gør hver sit:
 *
 *  - `expense.is_settled` betyder, at hele posten er afregnet uden om det
 *    løbende regnskab — fx rejsen selv, som én betaler, og som alle overfører
 *    deres andel af inden afrejse. Posten springes helt over her, men tæller
 *    stadig med i det samlede forbrug ude i UI'et.
 *
 *  - `settlements` er faktiske overførsler mellem to personer, typisk fordi
 *    nogen har krydset en linje af under "hvem skylder hvem". De trækkes fra
 *    saldiene, så kun restgælden står tilbage.
 */
export function computeNetBalances(
  expenses: Expense[],
  settlements: Settlement[],
  namesById: Record<string, string>,
  weights: Record<string, number> = {}
): Record<string, number> {
  const balances: Record<string, number> = {};
  const weightOf = (userId: string) => {
    const w = Number(weights[userId]);
    return isFinite(w) && w > 0 ? w : 1;
  };

  for (const exp of expenses) {
    if (exp.is_settled) continue;
    const participants =
      exp.participant_ids && exp.participant_ids.length > 0 ? exp.participant_ids : [exp.paid_by];

    const totalWeight = participants.reduce((sum, uid) => sum + weightOf(uid), 0);
    if (totalWeight <= 0) continue;

    balances[exp.paid_by] = (balances[exp.paid_by] ?? 0) + Number(exp.amount);
    for (const uid of participants) {
      const share = (Number(exp.amount) * weightOf(uid)) / totalWeight;
      balances[uid] = (balances[uid] ?? 0) - share;
    }
  }

  // En overførsel fra A til B bringer A's gæld op mod nul og B's tilgodehavende
  // ned mod nul.
  for (const s of settlements) {
    const amount = Number(s.amount);
    balances[s.from_user_id] = (balances[s.from_user_id] ?? 0) + amount;
    balances[s.to_user_id] = (balances[s.to_user_id] ?? 0) - amount;
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

/**
 * En saldo-id kan enten være en person eller et par. Denne oversætter den til
 * de personer, den dækker over.
 *
 * Bruges når en linje under "hvem skylder hvem" krydses af: selv i par-visning
 * er det to konkrete personer, der sender penge til hinanden, og det er dem,
 * afregningen skal registreres på. Ellers ville person-visningen og
 * par-visningen ikke stemme overens bagefter.
 */
export function partyMembers(balanceId: string, pairs: TripPair[]): string[] {
  if (!balanceId.startsWith('pair:')) return [balanceId];
  const pair = pairs.find((p) => `pair:${p.id}` === balanceId);
  if (!pair) return [];
  return [pair.member1_id, pair.member2_id].filter((id): id is string => !!id);
}

/**
 * Foreslår hvilke to personer en overførsel skal registreres på. Ved par
 * vælges det første medlem som standard — brugeren kan ændre det i UI'et.
 */
export function defaultSettlementParties(
  transfer: Transfer,
  pairs: TripPair[]
): { fromUserId: string | null; toUserId: string | null } {
  return {
    fromUserId: partyMembers(transfer.fromId, pairs)[0] ?? null,
    toUserId: partyMembers(transfer.toId, pairs)[0] ?? null,
  };
}

/** Samlet beløb der er overført mellem deltagerne på rejsen. */
export function totalSettled(settlements: Settlement[]): number {
  return settlements.reduce((sum, s) => sum + Number(s.amount), 0);
}
