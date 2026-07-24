/**
 * Dropdown or literal for vault-backed secrets.
 */
export default function VaultOrLiteralSecret({
  label,
  literalValue = '',
  keyRef = '',
  onLiteralChange,
  onKeyRefChange,
  vaultKeys = [],
  placeholder = '',
  MaskedInput,
}) {
  const mode = keyRef ? 'vault' : 'literal';
  const Input = MaskedInput || 'input';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label ? <label style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{label}</label> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={mode}
          onChange={(e) => {
            if (e.target.value === 'literal') onKeyRefChange?.('');
            else if (!keyRef && vaultKeys[0]) onKeyRefChange?.(vaultKeys[0].key_name || vaultKeys[0]);
            else onKeyRefChange?.(keyRef || '');
          }}
          style={{ minWidth: 110 }}
        >
          <option value="literal">Literal</option>
          <option value="vault">Vault key</option>
        </select>
        {mode === 'vault' ? (
          <select
            value={keyRef || ''}
            onChange={(e) => onKeyRefChange?.(e.target.value)}
            style={{ flex: 1, minWidth: 160 }}
          >
            <option value="">Select key…</option>
            {vaultKeys.map((k) => (
              <option key={k.key_name || k} value={k.key_name || k}>
                {k.key_name || k}
                {k.key_hint ? ` (${k.key_hint})` : ''}
              </option>
            ))}
          </select>
        ) : typeof Input === 'string' ? (
          <input
            type="password"
            value={literalValue}
            onChange={(e) => onLiteralChange?.(e.target.value)}
            placeholder={placeholder}
            style={{ flex: 1, minWidth: 160 }}
            autoComplete="off"
          />
        ) : (
          <Input
            value={literalValue}
            onChange={(e) => onLiteralChange?.(e.target.value)}
            placeholder={placeholder}
            style={{ flex: 1, minWidth: 160 }}
          />
        )}
      </div>
    </div>
  );
}
