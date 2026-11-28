import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { api } from '@/shared/api/client';

/**
 * Sign out, from anywhere. The page always forgets her data and goes to sign-in, even if the request fails (offline,
 * or a session that had already expired): staying on a page that looks signed in would be worse.
 */
export function useSignOut(): () => Promise<void> {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api.logout();
    } catch {
      /* the cookies expire on their own; the page below still forgets her */
    } finally {
      qc.clear();
      void navigate('/login');
    }
  };
}
