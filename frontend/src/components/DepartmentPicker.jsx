import { useCallback, useEffect, useState } from 'react';
import {
  addDepartment,
  ensureDepartmentName,
  loadDepartments,
  removeDepartment,
} from '../utils/departmentsMasterData.js';

const controlStyle = {
  padding: '0.5rem 0.75rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
};

/**
 * Dynamic department select backed by master-data table "departments".
 * Supports select, add, and remove.
 */
export default function DepartmentPicker({
  value = '',
  onChange,
  allowEmpty = false,
  emptyLabel = 'Unassigned',
  disabled = false,
  ariaLabel = 'Department',
  selectStyle,
  compact = false,
}) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    const { departments: list, table, duplicates } = await loadDepartments();
    setDepartments(list);
    if (duplicates?.length) {
      setError(
        `Multiple "departments" tables exist. Dropdown uses id ${table?.id} (most rows). Delete the other copies under Master Data.`
      );
    } else {
      setError(null);
    }
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        let list = await refresh();
        const current = String(value || '').trim();
        if (current && !list.some((d) => d.name.toLowerCase() === current.toLowerCase())) {
          await ensureDepartmentName(current);
          if (!cancelled) list = await refresh();
        }
        if (!cancelled) setDepartments(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load departments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only bootstrap once; value sync for orphans runs when value changes below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    const current = String(value || '').trim();
    if (!current || loading) return;
    if (departments.some((d) => d.name.toLowerCase() === current.toLowerCase())) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureDepartmentName(current);
        if (!cancelled) await refresh();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, loading, departments, refresh]);

  const selectedRow = departments.find((d) => d.name === value) || null;

  const handleAdd = async () => {
    const label = newName.trim();
    if (!label) return;
    setBusy(true);
    setError(null);
    try {
      const res = await addDepartment(label);
      await refresh();
      setNewName('');
      onChange?.(res.department.name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!selectedRow) return;
    if (!window.confirm(`Remove department "${selectedRow.name}" from the list?`)) return;
    setBusy(true);
    setError(null);
    try {
      await removeDepartment(selectedRow.id);
      const list = await refresh();
      if (value === selectedRow.name) {
        const next = allowEmpty ? '' : list[0]?.name || '';
        onChange?.(next);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const wrapStyle = compact
    ? { display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }
    : { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 };

  return (
    <div style={wrapStyle}>
      <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <select
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          aria-label={ariaLabel}
          disabled={disabled || loading || busy}
          style={{ ...controlStyle, minWidth: 140, ...(selectStyle || {}) }}
        >
          {allowEmpty && <option value="">{emptyLabel}</option>}
          {departments.map((d) => (
            <option key={d.id} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled || busy || loading || !selectedRow}
          title="Remove selected department from master data"
          style={{
            ...controlStyle,
            cursor: selectedRow && !busy ? 'pointer' : 'default',
            opacity: selectedRow ? 1 : 0.5,
            fontSize: '0.8rem',
          }}
        >
          Remove
        </button>
      </div>
      <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Add department…"
          disabled={disabled || busy || loading}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          style={{ ...controlStyle, minWidth: 140 }}
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled || busy || loading || !newName.trim()}
          style={{
            ...controlStyle,
            background: 'var(--accent)',
            border: 'none',
            color: '#fff',
            cursor: newName.trim() && !busy ? 'pointer' : 'default',
            opacity: newName.trim() ? 1 : 0.5,
            fontSize: '0.8rem',
          }}
        >
          Add
        </button>
      </div>
      {loading && <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Loading departments…</span>}
      {error && <span style={{ fontSize: '0.75rem', color: '#f87171' }}>{error}</span>}
    </div>
  );
}
