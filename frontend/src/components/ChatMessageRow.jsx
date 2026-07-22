import ChatMessageContent from './ChatMessageContent';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import MessageFeedback from './MessageFeedback';
import ChatToolCalls, { collectChartUrlsFromToolCalls } from './ChatToolCalls';
import AuthenticatedMediaImage from './AuthenticatedMediaImage';

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
  toolCalls = null,
}) {
  const label = roleLabel || role;
  const isUser = role === 'user';
  const chartUrls = !isUser ? collectChartUrlsFromToolCalls(toolCalls) : [];

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
      {chartUrls.length > 0 && (
        <div className="chat-message-chart-previews" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.75rem' }}>
          {chartUrls.map((src) => (
            <AuthenticatedMediaImage key={src} src={src} alt="Chart" />
          ))}
        </div>
      )}
      <ChatMessageContent content={content} />
      {!isUser && <ChatToolCalls toolCalls={toolCalls} showChartPreviews={false} />}
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
