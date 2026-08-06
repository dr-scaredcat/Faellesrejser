import { useCallback } from 'react';
import { useToast } from '../components/Toast';

interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

export interface MutateOptions {
  /** Vises hvis kaldet lykkes. Undlad den for de mange små, tavse skrivninger. */
  success?: string;
  /** Erstatter den generiske fejltekst, hvis databasen ikke selv har en god. */
  fallback?: string;
  /** Sæt til false hvis kalderen selv vil vise fejlen. */
  toastOnError?: boolean;
}

export interface MutateResult<T> {
  data: T | null;
  error: DbError | null;
  ok: boolean;
}

/**
 * Oversætter databasefejl til noget, der giver mening for den der står med
 * telefonen i hånden. Vores egne triggers og RPC'er skriver allerede på dansk
 * (Postgres-kode P0001), så dem sender vi bare videre.
 */
export function describeDbError(error: DbError, fallback?: string): string {
  const code = error.code ?? '';
  const message = error.message ?? '';

  if (code === 'P0001') return message;

  if (code === '42501' || /row-level security/i.test(message)) {
    return 'Handlingen blev afvist. Rejsen er sandsynligvis arkiveret, eller du er ikke medlem af den.';
  }
  if (code === '23505') {
    return 'Posten findes allerede.';
  }
  if (code === '23503') {
    return 'Posten hænger sammen med andre data og kan ikke fjernes endnu.';
  }
  if (code === '23514') {
    return 'En af værdierne er ikke gyldig. Tjek beløb og datoer.';
  }
  if (code === 'PGRST116') {
    return 'Posten blev ikke fundet. Den er måske allerede slettet.';
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return 'Der er ingen forbindelse til serveren lige nu. Prøv igen om lidt.';
  }

  return fallback ?? message ?? 'Handlingen kunne ikke gennemføres.';
}

/**
 * Kør en Supabase-skrivning og få fejlen vist i stedet for slugt.
 *
 * Før dette blev `error` aldrig tjekket i de fleste sider: blev en skrivning
 * afvist af en policy, skete der bare ingenting, og brugeren troede appen
 * hang.
 *
 *   const mutate = useMutate();
 *
 *   const { ok } = await mutate(
 *     supabase.from('expenses').delete().eq('id', id),
 *     { success: 'Udgiften er slettet.' }
 *   );
 *   if (ok) load();
 */
export function useMutate() {
  const { showToast } = useToast();

  return useCallback(
    async function mutate<T>(
      query: PromiseLike<DbResult<T>>,
      options: MutateOptions = {}
    ): Promise<MutateResult<T>> {
      const { success, fallback, toastOnError = true } = options;

      let result: DbResult<T>;
      try {
        result = await query;
      } catch (thrown) {
        const error: DbError = {
          message: thrown instanceof Error ? thrown.message : String(thrown),
        };
        if (toastOnError) showToast(describeDbError(error, fallback), 'error');
        return { data: null, error, ok: false };
      }

      if (result.error) {
        // eslint-disable-next-line no-console
        console.error('[Fællesrejser] Databasefejl', result.error);
        if (toastOnError) showToast(describeDbError(result.error, fallback), 'error');
        return { data: null, error: result.error, ok: false };
      }

      if (success) showToast(success, 'success');
      return { data: result.data, error: null, ok: true };
    },
    [showToast]
  );
}
