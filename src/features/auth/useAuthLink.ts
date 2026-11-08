import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from './authContext';
import { clearAuthLinkFromAddress, exchangeAuthLink, type LinkResult } from './pkceCallback';

/**
 * Completes the email link in the address bar (once) and reports the outcome. `null` means "still working".
 * It waits for the client, so it never races the provider's start-up.
 */
export function useAuthLink(): LinkResult | null {
  const { client } = useAuth();
  const { search, hash } = useLocation();
  const [result, setResult] = useState<LinkResult | null>(null);

  useEffect(() => {
    if (!client) return;
    let current = true;
    exchangeAuthLink(client, search, hash).then((outcome) => {
      if (!current) return;
      // The one-time code has done its job (or failed): do not leave it in the visible address, history or a bookmark.
      if (outcome.kind !== 'no-link') clearAuthLinkFromAddress();
      setResult(outcome);
    });
    return () => {
      current = false;
    };
  }, [client, search, hash]);

  return result;
}
