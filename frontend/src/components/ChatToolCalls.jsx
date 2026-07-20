/**
 * Expandable tool-call icons for agent chat (from content_tool_logs).
 */
export default function ChatToolCalls({ toolCalls }) {
  const list = Array.isArray(toolCalls) ? toolCalls : [];
  if (!list.length) return null;

  return (
    <div className="chat-tool-calls" style={{ marginTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginRight: 2 }} title="Agent OS tools used for this reply">
          Tools
        </span>
        {list.map((tc) => {
          const ok = String(tc.status || '').toLowerCase() === 'ok';
          const name = tc.tool_name || 'tool';
          return (
            <details
              key={tc.id || `${name}-${tc.created_at}`}
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                background: ok ? 'rgba(34,197,94,0.12)' : 'rgba(248,113,113,0.12)',
                border: `1px solid ${ok ? 'rgba(34,197,94,0.35)' : 'rgba(248,113,113,0.35)'}`,
                borderRadius: 999,
                padding: '0.15rem 0.55rem',
                fontSize: '0.72rem',
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  listStyle: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  color: 'var(--text)',
                  userSelect: 'none',
                }}
                title={`${name} · ${tc.status || ''}`}
              >
                <span aria-hidden="true" style={{ display: 'inline-flex', width: 12, height: 12 }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
                    <path d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
                  </svg>
                </span>
                <code style={{ fontSize: '0.72rem', background: 'transparent', padding: 0 }}>{name}</code>
                <span style={{ color: 'var(--muted)', fontSize: '0.65rem' }}>{ok ? 'ok' : tc.status || 'err'}</span>
              </summary>
              <div
                style={{
                  marginTop: '0.45rem',
                  marginBottom: '0.25rem',
                  padding: '0.5rem 0.6rem',
                  borderRadius: 8,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  maxWidth: 'min(520px, 92vw)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '0.68rem',
                  color: 'var(--muted)',
                }}
              >
                <div style={{ marginBottom: '0.35rem', color: 'var(--text)' }}>Request</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {typeof tc.request === 'string' ? tc.request : JSON.stringify(tc.request, null, 2)}
                </pre>
                <div style={{ margin: '0.5rem 0 0.35rem', color: 'var(--text)' }}>Response</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {typeof tc.response === 'string' ? tc.response : JSON.stringify(tc.response, null, 2)}
                </pre>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
