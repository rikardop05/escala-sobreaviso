import { useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';

export function useApi() {
  const { getToken } = useAuth();

  return useCallback(async (url, opts = {}) => {
    const token = await getToken();
    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }, [getToken]);
}
