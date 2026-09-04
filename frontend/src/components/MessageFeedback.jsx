/**
 * Thumbs up/down feedback on an agent response.
 * Thumbs-down requires a short comment so learnings_summary can apply CEO guidance.
 */
import { useState } from 'react';
import { api } from '../api';

export default function MessageFeedback({
  agentId,
  source = 'chat',
  messageId = null,
  messageContent = '',
  context = {},
  compact = false,
  trailingAction = null,
}) {
  const [rating, setRating] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');

  if (!agentId || rating) {
    return rating ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: compact ? 4 : 8 }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Thanks for the feedback ({rating === 'up' ? '👍' : '👎'})</span>
        {trailingAction}
      </div>
    ) : null;
  }

  const submit = async (nextRating, withComment = '') => {
    setBusy(true);
    setError(null);
    try {
      await api.submitFeedback({
        agent_id: agentId,
        source,
        message_id: messageId,
        message_content: String(messageContent || '').slice(0, 4000),
        rating: nextRating,
        comment: withComment,
        context,
      });
      setRating(nextRating);
      setCommentOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const btn = {
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--muted)',
    borderRadius: 4,
    padding: compact ? '0 4px' : '2px 6px',
    cursor: busy ? 'wait' : 'pointer',
    fontSize: '0.75rem',
    lineHeight: 1.4,
  };

  const commentTrimmed = comment.trim();
  const canSubmitDown = commentTrimmed.length >= 3;

  return (
    <div style={{ marginTop: compact ? 4 : 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>Was this helpful?</span>
        <button type="button" style={btn} disabled={busy} onClick={() => submit('up')} title="Thumbs up">
          👍
        </button>
        <button
          type="button"
          style={btn}
          disabled={busy}
          onClick={() => setCommentOpen((o) => !o)}
          title="Thumbs down — comment required for learnings"
        >
          👎
        </button>
        {trailingAction}
      </div>
      {commentOpen && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Required: what should the agent do differently next time?"
            rows={2}
            style={{
              width: '100%',
              fontSize: '0.8rem',
              padding: '0.4rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={busy || !canSubmitDown}
              onClick={() => submit('down', commentTrimmed)}
              style={{
                alignSelf: 'flex-start',
                padding: '0.3rem 0.6rem',
                borderRadius: 6,
                border: 'none',
                background: canSubmitDown ? 'var(--accent)' : 'var(--muted)',
                color: '#fff',
                fontSize: '0.75rem',
                cursor: busy || !canSubmitDown ? 'not-allowed' : 'pointer',
              }}
            >
              Submit feedback
            </button>
            {!canSubmitDown && (
              <span style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                Add at least 3 characters so this feeds learnings.
              </span>
            )}
          </div>
        </div>
      )}
      {error && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
