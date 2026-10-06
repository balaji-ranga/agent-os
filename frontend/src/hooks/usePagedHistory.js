import { useEffect, useState } from 'react';

// Independent page state/polling; old requests cannot paint a new page or mode.
export function usePagedHistory(fetchPage, environment) {
  const [selection, setSelection] = useState({ environment: '', page: 1 });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const page = selection.environment === environment ? selection.page : 1;
  const key = `${environment}:${page}`;
  useEffect(() => { setSelection({ environment, page: 1 }); }, [environment]);
  useEffect(() => {
    if (!environment) return;
    let cancelled = false;
    let running = false;
    setError('');
    const load = async () => {
      if (running) return;
      running = true;
      setBusy(true);
      try {
        const value = await fetchPage({ page, pageSize: 20, environment });
        if (!cancelled && value.environment === environment) {
          setResult({ key, value });
          setError('');
          if (value.pagination.page !== page) setSelection({ environment, page: value.pagination.page });
        }
      } catch (e) { if (!cancelled) setError(e.message); }
      finally { running = false; if (!cancelled) setBusy(false); }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [fetchPage, environment, page, key]);
  return { data: result?.key === key ? result.value : null, busy, error, page, setPage: (next) => setSelection({ environment, page: Math.max(1, next) }) };
}
