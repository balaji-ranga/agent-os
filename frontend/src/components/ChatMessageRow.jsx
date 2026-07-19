import ChatMessageContent from './ChatMessageContent';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import MessageFeedback from './MessageFeedback';

/**
 * Single chat bubble with role label and local timestamp.
 */
export default function ChatMessageRow({
  role,
  content,
  createdAt,
  roleLabel,
  className = '',
  style = {},
  agentId = null,
  messageId = null,
  feedbackSource = 'chat',
  feedbackContext = {},
  showFeedback = true,
}) {
  const label = roleLabel || role;
  const isUser = role === 'user';
  return (
    <div
      className={className}
      style={{
        marginBottom: '0.75rem',
        padding: '0.75rem 1rem',
        background: isUser ? 'var(--border)' : 'transparent',
        borderRadius: 8,
        borderLeft: !isUser ? '3px solid var(--accent)' : 'none',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isUser ? 'var(--text)' : 'var(--accent)' }}>
          {label}
        </span>
        {createdAt && (
          <time dateTime={createdAt} style={{ fontSize: '0.7rem', color: 'var(--muted)' }} title={createdAt}>
            {formatChatTimestamp(createdAt)}
          </time>
        )}
      </div>
      <ChatMessageContent content={content} />
      {!isUser && showFeedback && agentId && (
        <MessageFeedback
          agentId={agentId}
          source={feedbackSource}
          messageId={messageId}
          messageContent={content}
          context={feedbackContext}
          compact
        />
      )}
    </div>
  );
}
