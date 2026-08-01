import { resolveMediaSrc, isResolvableMediaUrl, guessChatMediaType } from '../utils/resolveMediaSrc';
import AuthenticatedMediaImage, {
  AuthenticatedMediaVideo,
  AuthenticatedMediaAudio,
} from './AuthenticatedMediaImage';

/**
 * Renders chat message content: text plus inline images/audio/videos.
 * Auth-protected /api/media paths load via Bearer → blob so they play inline (not 401 links).
 */

function toText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (p && (p.text ?? p.content ?? (typeof p === 'string' ? p : ''))) ?? '').join('');
  if (typeof content === 'object' && (content.text || content.content)) return content.text || content.content || '';
  return String(content);
}

/** If the API stored OpenAI-style content parts as JSON string, parse to plain text + image URLs. */
function parseContentParts(str) {
  if (typeof str !== 'string' || !str.trim()) return { text: str, imageUrls: [] };
  const trimmed = str.trim();
  if (trimmed[0] !== '[') return { text: str, imageUrls: [] };
  let parts;
  try {
    parts = JSON.parse(str);
  } catch (_) {
    return { text: str, imageUrls: [] };
  }
  if (!Array.isArray(parts)) return { text: str, imageUrls: [] };
  const textParts = [];
  const imageUrls = [];
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text' && p.text) textParts.push(p.text);
    if (p.type === 'image_url' && p.image_url?.url) imageUrls.push({ url: p.image_url.url, index: textParts.join('').length });
    if (p.type === 'image' && p.image_url) imageUrls.push({ url: typeof p.image_url === 'string' ? p.image_url : p.image_url.url, index: textParts.join('').length });
  }
  const text = textParts.join('');
  return { text, imageUrls };
}

function cleanMediaUrl(url) {
  return String(url || '').trim().replace(/[:;.,]+$/g, '');
}

const imageExt = /\.(png|jpe?g|gif|webp|bmp|svg)(\?[^\s"'<>]*)?$/i;
const videoExt = /\.(mp4|webm|ogv)(\?[^\s"'<>]*)?$/i;
const audioExt = /\.(wav|mp3|m4a|aac|opus|flac|ogg)(\?[^\s"'<>]*)?$/i;
const imageInPath = /\.(png|jpe?g|gif|webp|bmp|svg)([\?&]|$)/i;

export default function ChatMessageContent({ content }) {
  const text = toText(content);
  if (!text) return null;
  let contentStr = typeof text === 'string' ? text : String(text);

  const parsed = parseContentParts(contentStr);
  const extraImageMedia = parsed.imageUrls.map(({ url, index }) => ({
    index,
    length: 0,
    type: guessChatMediaType(url),
    src: url,
  }));

  const media = [...extraImageMedia];
  const overlaps = (start, len) => media.some((x) => start < x.index + x.length && start + len > x.index);

  if (parsed.text !== contentStr) contentStr = parsed.text;

  const reImgTag = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = reImgTag.exec(contentStr)) !== null) {
    const url = m[1].trim();
    if (!overlaps(m.index, m[0].length) && isResolvableMediaUrl(url)) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(url), src: url, alt: '' });
    }
  }
  const reJson = /\{\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
  while ((m = reJson.exec(contentStr)) !== null) {
    const url = m[1].replace(/\\"/g, '"');
    if (!overlaps(m.index, m[0].length)) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(url), src: url });
    }
  }
  const reDataImg = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi;
  while ((m = reDataImg.exec(contentStr)) !== null) {
    if (!overlaps(m.index, m[0].length)) media.push({ index: m.index, length: m[0].length, type: 'image', src: m[0] });
  }
  const reDataVid = /data:video\/[^;]+;base64,[A-Za-z0-9+/=]+/gi;
  while ((m = reDataVid.exec(contentStr)) !== null) {
    if (!overlaps(m.index, m[0].length)) media.push({ index: m.index, length: m[0].length, type: 'video', src: m[0] });
  }
  const reDataAud = /data:audio\/[^;]+;base64,[A-Za-z0-9+/=]+/gi;
  while ((m = reDataAud.exec(contentStr)) !== null) {
    if (!overlaps(m.index, m[0].length)) media.push({ index: m.index, length: m[0].length, type: 'audio', src: m[0] });
  }
  const reMdImg = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  while ((m = reMdImg.exec(contentStr)) !== null) {
    const url = cleanMediaUrl(m[2]);
    if (!overlaps(m.index, m[0].length) && isResolvableMediaUrl(url)) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(url), src: url, alt: m[1] });
    }
  }
  // Markdown links like [🔊](/api/media/...) or [Audio](MEDIA:/...) — play inline, not as external href
  const reMdLink = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  while ((m = reMdLink.exec(contentStr)) !== null) {
    if (m[0].startsWith('![')) continue;
    const url = cleanMediaUrl(m[2]);
    const isMedia =
      isResolvableMediaUrl(url) &&
      (audioExt.test(url) ||
        videoExt.test(url) ||
        imageExt.test(url) ||
        imageInPath.test(url) ||
        /\/api\/media\//i.test(url) ||
        /^MEDIA:/i.test(url) ||
        /\.openclaw\/media\//i.test(url));
    if (!overlaps(m.index, m[0].length) && isMedia) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(url), src: url, alt: m[1] });
    }
  }
  // HTML anchors agents sometimes paste: <a href="/api/media/...">🔊</a>
  const reHtmlA = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
  while ((m = reHtmlA.exec(contentStr)) !== null) {
    const url = cleanMediaUrl(m[1]);
    const isMedia =
      isResolvableMediaUrl(url) &&
      (audioExt.test(url) ||
        videoExt.test(url) ||
        imageExt.test(url) ||
        imageInPath.test(url) ||
        /\/api\/media\//i.test(url) ||
        /^MEDIA:/i.test(url) ||
        /\.openclaw\/media\//i.test(url));
    if (!overlaps(m.index, m[0].length) && isMedia) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(url), src: url });
    }
  }
  // MEDIA:sandbox:... or MEDIA:/root/.openclaw/media/... (WhatsApp channel form)
  const reMediaLine = /^MEDIA:((?:sandbox:)?(?:\/api\/media\/|\/media\/|\/[^\s]*\.openclaw\/media\/)[^\s]+)/gim;
  while ((m = reMediaLine.exec(contentStr)) !== null) {
    if (!overlaps(m.index, m[0].length)) {
      media.push({ index: m.index, length: m[0].length, type: guessChatMediaType(m[0]), src: m[0], alt: '' });
    }
  }
  // Bare relative /api/media/... paths (common in tool replies without markdown)
  const reApiMedia = /(?:^|[\s"'(\[])(\/api\/media\/[^\s<>"'\)\]]+)/g;
  while ((m = reApiMedia.exec(contentStr)) !== null) {
    const url = cleanMediaUrl(m[1]);
    const start = m.index + (m[0].length - url.length);
    if (!overlaps(start, url.length) && isResolvableMediaUrl(url)) {
      media.push({ index: start, length: url.length, type: guessChatMediaType(url), src: url });
    }
  }
  const reHttp = /https?:\/\/[^\s<>"']+/g;
  while ((m = reHttp.exec(contentStr)) !== null) {
    const url = m[0];
    if (!overlaps(m.index, url.length)) {
      if (audioExt.test(url) || videoExt.test(url) || imageExt.test(url) || imageInPath.test(url) || /\/api\/media\//i.test(url)) {
        media.push({ index: m.index, length: url.length, type: guessChatMediaType(url), src: url });
      }
    }
  }

  media.sort((a, b) => a.index - b.index);
  const segments = [];
  let pos = 0;
  for (const med of media) {
    if (med.index > pos) segments.push({ type: 'text', value: contentStr.slice(pos, med.index) });
    segments.push({ type: med.type, value: med.src, alt: med.alt });
    pos = med.index + med.length;
  }
  if (pos < contentStr.length) segments.push({ type: 'text', value: contentStr.slice(pos) });
  if (segments.length === 0) segments.push({ type: 'text', value: contentStr });

  return (
    <div className="chat-message-content" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.value}</span>;
        if (seg.type === 'audio') {
          return <AuthenticatedMediaAudio key={i} src={seg.value} />;
        }
        if (seg.type === 'video') {
          return <AuthenticatedMediaVideo key={i} src={seg.value} />;
        }
        if (seg.type === 'image') {
          return <AuthenticatedMediaImage key={i} src={seg.value} alt={seg.alt || 'Image'} />;
        }
        return null;
      })}
    </div>
  );
}
