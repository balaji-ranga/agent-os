import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

/**
 * Top-bar search: chats, tasks, agents, workflows, master tables, RAG documents.
 */

const TYPE_LABELS = {
  chat: 'Chat',
  task: 'Task',
  agent: 'Agent',
  workflow: 'Workflow',
  workflow_run: 'WF run',
  table: 'Table',
  table_row: 'Row',
  document: 'Doc',
};
export default function GlobalSearch({ compact = false }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const rootRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        rootRef.current?.querySelector('input')?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const term = q.trim();
    const isNumericId = /^\d+$/.test(term);
    // Pure numeric (task id / run id) may be 1+ digits; free text still needs 2 chars.
    if (!term || (term.length < 2 && !isNumericId)) {
      setResults([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      api
        .homeSearch(term)
        .then((r) => setResults(Array.isArray(r?.results) ? r.results : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q]);

  const pick = (item) => {
    setOpen(false);
    setQ('');
    if (item?.href) navigate(item.href);
  };

  const canSearch = (() => {
    const term = q.trim();
    if (!term) return false;
    if (/^\d+$/.test(term)) return true;
    return term.length >= 2;
  })();

  return (
    <div className={`global-search${compact ? ' global-search-compact' : ''}`} ref={rootRef}>
      <div className="global-search-field">
        <span className="global-search-icon" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={compact ? 'Search…' : 'Search (Ctrl + K)'}
          aria-label="Search chats, tasks by id, workflow runs by id, master tables, documents, and workflows"
          autoComplete="off"
        />
      </div>
      {open && (canSearch || loading) && (
        <div className="global-search-dropdown" role="listbox">
          {loading && <div className="global-search-empty">Searching…</div>}
          {!loading && results.length === 0 && canSearch && (
            <div className="global-search-empty">No matches for “{q.trim()}”</div>
          )}
          {results.map((r) => (
            <button
              key={`${r.type}-${r.id}`}
              type="button"
              className="global-search-item"
              role="option"
              onClick={() => pick(r)}
            >
              <span className="global-search-item-type">{TYPE_LABELS[r.type] || r.type}</span>
              <span className="global-search-item-title">{r.title}</span>
              {r.subtitle && <span className="global-search-item-sub">{r.subtitle}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
