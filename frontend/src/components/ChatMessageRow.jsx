import ChatMessageContent from './ChatMessageContent';
import ChatMessageAttachments from './ChatMessageAttachments';
import { formatChatTimestamp } from '../utils/formatDateTime.js';
import MessageFeedback from './MessageFeedback';
import ChatToolCalls, { collectChartUrlsFromToolCalls, collectGeneratedMediaUrlsFromToolCalls } from './ChatToolCalls';
import GoalPlanPanel, { collectGoalRunIds } from './GoalPlanPanel';
import RobotAvatar from './RobotAvatar.jsx';
import AuthenticatedMediaImage, {
  AuthenticatedMediaAudio,
  AuthenticatedMediaVideo,
} from './AuthenticatedMediaImage';
import { guessChatMediaType, resolveMediaSrc, extractMediaUrlsFromText, isChatAudioAttachment } from '../utils/resolveMediaSrc';
import { splitChatAttachmentContent } from '../utils/chatAttachments.js';

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
  onReply = null,
  feedbackSource = 'chat',
  feedbackContext = {},
  showFeedback = true,
  toolCalls = null,
  attachments: attachmentsProp = null,
  agentName = null,
  agentAvatar = null,
  hideAudioAttachments = false,
}) {
  const isUser = role === 'user';
  const label = roleLabel || (!isUser && agentName) || role;
  const chartUrls = !isUser ? collectChartUrlsFromToolCalls(toolCalls) : [];
  const parsed =
    Array.isArray(attachmentsProp) && attachmentsProp.length
      ? { text: content, attachments: attachmentsProp }
      : splitChatAttachmentContent(content);
  const displayText = parsed.text;
  const attachments = (parsed.attachments || []).filter((a) => {
    if (!hideAudioAttachments) return true;
    return !isChatAudioAttachment(a.url || a.relative_path || a.filename, a.mime_type || a.mime);
  });
  const textMediaKeys = new Set(
    extractMediaUrlsFromText(displayText || '').map((u) => resolveMediaSrc(u) || u)
  );
  const mediaUrls = !isUser
    ? collectGeneratedMediaUrlsFromToolCalls(toolCalls).filter((src) => {
        const key = resolveMediaSrc(src) || src;
        if (textMediaKeys.has(key)) return false;
        if (hideAudioAttachments && isChatAudioAttachment(src)) return false;
        return true;
      })
    : [];
  const goalRunIds = !isUser
    ? collectGoalRunIds({ text: displayText || content || '', toolCalls })
    : [];
  // Live plan when create/status tools used, or assistant mentions agr- id (scheduled plan text)
  const liveIds = goalRunIds.slice(0, 2);
  const hasFeedback = !isUser && showFeedback && agentId;
  const replyAction = onReply && Number.isSafeInteger(Number(messageId)) && Number(messageId) > 0 ? (
    <button
      type="button"
      onClick={() => onReply(messageId, content)}
      title="Reply to this message"
      aria-label="Reply to this message"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', borderRadius: 4, padding: '2px 4px', cursor: 'pointer' }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m9 5-6 6 6 6" />
        <path d="M3 11h10a8 8 0 0 1 8 8" />
      </svg>
    </button>
  ) : null;

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        {!isUser && <RobotAvatar src={agentAvatar} name={label} size={22} />}
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: isUser ? 'var(--text)' : 'var(--accent)' }}>
          {label}
        </span>
        {createdAt && (
          <time dateTime={createdAt} style={{ fontSize: '0.7rem', color: 'var(--muted)' }} title={createdAt}>
            {formatChatTimestamp(createdAt)}
          </time>
        )}
      </div>
      {attachments.length > 0 && <ChatMessageAttachments attachments={attachments} />}
      {chartUrls.length > 0 && (
        <div
          className="chat-message-chart-previews"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.75rem' }}
        >
          {chartUrls.map((src) => (
            <AuthenticatedMediaImage key={src} src={src} alt="Chart" />
          ))}
        </div>
      )}
      {mediaUrls.length > 0 && (
        <div
          className="chat-message-media-previews"
          style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.75rem' }}
        >
          {mediaUrls.map((src) => {
            const kind = guessChatMediaType(src);
            if (kind === 'audio') return <AuthenticatedMediaAudio key={src} src={src} />;
            if (kind === 'video') return <AuthenticatedMediaVideo key={src} src={src} />;
            return <AuthenticatedMediaImage key={src} src={src} alt="Generated image" />;
          })}
        </div>
      )}
      {(displayText || (!attachments.length && content)) && (
        <ChatMessageContent content={displayText || content} hideAudio={hideAudioAttachments} />
      )}
      {!isUser &&
        liveIds.map((id) => (
          <GoalPlanPanel key={id} goalRunId={id} compact pollMs={liveIds.length === 1 ? 12000 : 0} />
        ))}
      {!isUser && <ChatToolCalls toolCalls={toolCalls} showChartPreviews={false} showMediaPreviews={false} />}
      {hasFeedback && (
        <MessageFeedback
          agentId={agentId}
          source={feedbackSource}
          messageId={messageId}
          messageContent={content}
          context={feedbackContext}
          compact
          trailingAction={replyAction}
        />
      )}
      {!hasFeedback && replyAction && <div style={{ display: 'flex', marginTop: 4 }}>{replyAction}</div>}
    </div>
  );
}
