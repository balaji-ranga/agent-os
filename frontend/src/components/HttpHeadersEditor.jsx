import { useEffect, useMemo, useState } from 'react';
import MaskedSecretInput from './MaskedSecretInput';
import {
  defaultHeaderRows,
  headersObjectToRows,
  headersRowsToObject,
  isSecretHeaderName,
  parseHeadersJson,
  serializeHeadersJson,
} from '../utils/httpHeadersUtils.js';

/**
 * Postman-style HTTP headers editor (key / value rows).
 * Value mode: literal | vault ($keyRef).
 * Persists as JSON object string via onChange.
 */
export default function HttpHeadersEditor({
  value,
  onChange,
  className = '',
  vaultKeys = [],
}) {
  const parsed = useMemo(() => parseHeadersJson(value), [value]);
  const [rows, setRows] = useState(() => {
    const r = headersObjectToRows(parsed);
    return r.length ? r : defaultHeaderRows();
  });
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    const r = headersObjectToRows(parseHeadersJson(value));
    setRows(r.length ? r : defaultHeaderRows());
  }, [value]);

  const emit = (nextRows) => {
    setRows(nextRows);
    const obj = headersRowsToObject(nextRows.filter((r) => r.key?.trim() || r.value || r.valueRef));
    onChange?.(serializeHeadersJson(obj));
  };

  const updateRow = (idx, patch) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    emit(next);
  };

  const addRow = () =>
    emit([...rows, { id: `hdr-${Date.now()}`, key: '', value: '', valueRef: '', mode: 'literal' }]);

  const removeRow = (idx) => {
    const next = rows.filter((_, i) => i !== idx);
    emit(next.length ? next : defaultHeaderRows());
  };

  return (
    <div className={`http-headers-editor ${className}`.trim()}>
      <div className="http-headers-toolbar">
        <span className="http-headers-title">HTTP Headers</span>
        <button type="button" className="http-headers-link" onClick={() => setShowJson((v) => !v)}>
          {showJson ? 'Key / value' : 'JSON'}
        </button>
        <button type="button" className="http-headers-link" onClick={addRow}>
          + Add header
        </button>
      </div>

      {showJson ? (
        <textarea
          className="http-headers-json"
          rows={5}
          value={typeof value === 'string' ? value : serializeHeadersJson(parsed)}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder='{"Authorization":"Bearer …","X-Api-Key":{"$keyRef":"my-key"}}'
        />
      ) : (
        <div className="http-headers-table">
          <div className="http-headers-row http-headers-head">
            <span>Key</span>
            <span>Mode</span>
            <span>Value</span>
            <span />
          </div>
          {rows.map((row, idx) => (
            <div key={row.id || idx} className="http-headers-row" style={{ gridTemplateColumns: '1fr 110px 1.4fr auto' }}>
              <input
                value={row.key}
                onChange={(e) => updateRow(idx, { key: e.target.value })}
                placeholder="Authorization"
              />
              <select
                value={row.mode === 'vault' ? 'vault' : 'literal'}
                onChange={(e) =>
                  updateRow(idx, {
                    mode: e.target.value,
                    value: e.target.value === 'vault' ? '' : row.value,
                    valueRef: e.target.value === 'literal' ? '' : row.valueRef,
                  })
                }
              >
                <option value="literal">Literal</option>
                <option value="vault">Vault key</option>
              </select>
              {row.mode === 'vault' ? (
                <select
                  value={row.valueRef || ''}
                  onChange={(e) => updateRow(idx, { valueRef: e.target.value, mode: 'vault' })}
                >
                  <option value="">Select key…</option>
                  {vaultKeys.map((k) => (
                    <option key={k.key_name || k} value={k.key_name || k}>
                      {k.key_name || k}
                      {k.key_hint ? ` (${k.key_hint})` : ''}
                    </option>
                  ))}
                </select>
              ) : isSecretHeaderName(row.key) ? (
                <MaskedSecretInput
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value, mode: 'literal' })}
                  placeholder="value"
                />
              ) : (
                <input
                  value={row.value}
                  onChange={(e) => updateRow(idx, { value: e.target.value, mode: 'literal' })}
                  placeholder="value"
                />
              )}
              <button type="button" className="http-headers-link" onClick={() => removeRow(idx)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
