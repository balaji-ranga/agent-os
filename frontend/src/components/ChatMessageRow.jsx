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
import { guessChatMediaType } from '../utils/resolveMediaSrc';
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
  feedbackSource = 'chat',
  feedbackContext = {},
  showFeedback = true,
  toolCalls = null,
  attachments: attachmentsProp = null,
  agentName = null,
  agentAvatar = null,
}) {
  const isUser = role === 'user';
  const label = roleLabel || (!isUser && agentName) || role;
  const chartUrls = !isUser ? collectChartUrlsFromToolCalls(toolCalls) : [];
  const mediaUrls = !isUser ? collectGeneratedMediaUrlsFromToolCalls(toolCalls) : [];
  const parsed =
    Array.isArray(attachmentsProp) && attachmentsProp.length
      ? { text: content, attachments: attachmentsProp }
      : splitChatAttachmentContent(content);
  const displayText = parsed.text;
  const attachments = parsed.attachments || [];
  const goalRunIds = !isUser
    ? collectGoalRunIds({ text: displayText || content || '', toolCalls })
    : [];
  // Live plan when create/status tools used, or assistant mentions agr- id (scheduled plan text)
  const liveIds = goalRunIds.slice(0, 2);

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
        <ChatMessageContent content={displayText || content} />
      )}
      {!isUser &&
        liveIds.map((id) => (
          <GoalPlanPanel key={id} goalRunId={id} compact pollMs={liveIds.length === 1 ? 12000 : 0} />
        ))}
      {!isUser && <ChatToolCalls toolCalls={toolCalls} showChartPreviews={false} showMediaPreviews={false} />}
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
