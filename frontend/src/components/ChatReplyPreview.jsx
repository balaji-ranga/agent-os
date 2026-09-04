export default function ChatReplyPreview({ reply, onClear }) {
  if (!reply) return null;
  return <div role="note" style={{ borderLeft: '3px solid var(--accent, #6384ff)', padding: '0.5rem', marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', minWidth: 0 }}>
    <div style={{ flex: 1, minWidth: 0 }}><small>Replying to message #{reply.id}</small><div style={{ overflowWrap: 'anywhere', maxHeight: '4.5em', overflow: 'auto' }}>{reply.content.slice(0, 350)}</div></div>
    <button type="button" aria-label="Cancel reply" onClick={onClear}>×</button>
  </div>;
}
