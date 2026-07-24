const SECRET_HEADER_RE = /authorization|api[-_]?key|token|secret|password/i;

export function isSecretHeaderName(key) {
  return SECRET_HEADER_RE.test(String(key || '').trim());
}

export function parseHeadersJson(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return { ...raw };
  try {
    const parsed = JSON.parse(String(raw));
    if (Array.isArray(parsed)) {
      const out = {};
      for (const row of parsed) {
        const k = String(row?.key || row?.name || '').trim();
        if (!k) continue;
        if (row?.valueRef || row?.value_ref) {
          out[k] = { $keyRef: String(row.valueRef || row.value_ref) };
        } else {
          out[k] = row?.value != null ? row.value : '';
        }
      }
      return out;
    }
    if (parsed && typeof parsed === 'object') return parsed;
  } catch (_) {}
  return {};
}

export function headersObjectToRows(obj = {}) {
  return Object.entries(obj).map(([key, value], i) => {
    if (value != null && typeof value === 'object' && !Array.isArray(value) && value.$keyRef) {
      return {
        id: `hdr-${i}-${key}`,
        key,
        value: '',
        valueRef: String(value.$keyRef),
        mode: 'vault',
      };
    }
    return {
      id: `hdr-${i}-${key}`,
      key,
      value: value != null ? String(value) : '',
      valueRef: '',
      mode: 'literal',
    };
  });
}

export function headersRowsToObject(rows = []) {
  const out = {};
  for (const row of rows) {
    const k = String(row?.key || '').trim();
    if (!k) continue;
    if (row.mode === 'vault' || row.valueRef) {
      const ref = String(row.valueRef || '').trim();
      if (ref) out[k] = { $keyRef: ref };
    } else {
      out[k] = row?.value != null ? String(row.value) : '';
    }
  }
  return out;
}

export function serializeHeadersJson(obj) {
  return JSON.stringify(obj || {}, null, 0);
}

export function defaultHeaderRows() {
  return [{ id: `hdr-${Date.now()}`, key: '', value: '', valueRef: '', mode: 'literal' }];
}
