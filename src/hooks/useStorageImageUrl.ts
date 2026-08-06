import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Henter et billede fra en PRIVAT Storage-bucket og returnerer en lokal
 * "blob"-adresse, browseren kan vise det fra.
 *
 * getPublicUrl() virker kun på buckets, der er sat til offentlige — på en
 * privat bucket ignorerer den adgangsreglerne og giver et knækket billede,
 * uanset om man er logget ind. download() går derimod gennem de samme
 * RLS-regler som alt andet i appen, og virker derfor korrekt her.
 */
export function useStorageImageUrl(bucket: string, path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }

    let annulleret = false;
    let objectUrl: string | null = null;

    supabase
      .storage
      .from(bucket)
      .download(path)
      .then(({ data, error }) => {
        if (annulleret) return;
        if (error || !data) {
          setUrl(null);
          return;
        }
        objectUrl = URL.createObjectURL(data);
        setUrl(objectUrl);
      });

    return () => {
      annulleret = true;
      // Ryd op efter os selv, så browseren ikke ophober blob-adresser i
      // hukommelsen, hver gang man skifter mellem kortudsnit.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [bucket, path]);

  return url;
}
