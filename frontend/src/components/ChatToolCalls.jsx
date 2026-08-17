import AuthenticatedMediaImage, {
  AuthenticatedMediaAudio,
  AuthenticatedMediaVideo,
} from './AuthenticatedMediaImage';
import { guessChatMediaType, resolveMediaSrc } from '../utils/resolveMediaSrc';

/**
 * Expandable tool-call icons for agent chat (content_tool_logs + native OpenClaw session tools).
 * Also surfaces chart SVG URLs from successful vedic_compute_chart / generate_chart responses
 * so visuals appear even when the model forgets to paste them into the reply text.
 */

function parseJsonMaybe(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function collectChartUrlsFromToolCalls(toolCalls) {
  const urls = [];
  const seen = new Set();
  for (const tc of toolCalls || []) {
    const name = String(tc.tool_name || '');
    if (name !== 'vedic_compute_chart' && name !== 'generate_chart') continue;
    if (String(tc.status || '').toLowerCase() !== 'ok') continue;
    const resp = parseJsonMaybe(tc.response);
    if (!resp || typeof resp !== 'object') continue;
    const candidates = [];
    if (resp.visuals_markdown) {
      const m = String(resp.visuals_markdown).match(/\/api\/media\/[^\s)]+/g);
      if (m) candidates.push(...m);
    }
    if (resp.chart_urls && typeof resp.chart_urls === 'object') {
      candidates.push(...Object.values(resp.chart_urls).filter(Boolean));
    }
    for (const key of [
      'north_chart_url',
      'south_chart_url',
      'navamsa_north_chart_url',
      'navamsa_south_chart_url',
    ]) {
      if (resp[key]) candidates.push(resp[key]);
    }
    if (Array.isArray(resp.charts)) {
      for (const c of resp.charts) {
        if (c?.url) candidates.push(c.url);
      }
    }
    for (const u of candidates) {
      const url = String(u || '').trim();
      if (!url || seen.has(url)) continue;
      if (!/\/api\/media\//i.test(url) && !/\.svg(\?|$)/i.test(url)) continue;
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

function isGeneratedMediaUrl(url) {
  const u = String(url || '').trim();
  if (!u) return false;
  return (
    /^MEDIA:/i.test(u) ||
    /\/api\/media\//i.test(u) ||
    /^https?:\/\//i.test(u) ||
    /\.openclaw\/media\//i.test(u)
  );
}

/** Inline generated images/audio/videos from tool responses when the model forgets to paste URLs. */
export function collectGeneratedMediaUrlsFromToolCalls(toolCalls) {
  const urls = [];
  const seen = new Set();
  const push = (raw) => {
    const url = String(raw || '').trim();
    if (!isGeneratedMediaUrl(url)) return;
    const dedupeKey = resolveMediaSrc(url) || url;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    urls.push(url);
  };
  for (const tc of toolCalls || []) {
    const name = String(tc.tool_name || '');
    if (name !== 'generate_image' && name !== 'generate_video' && name !== 'speech_tts') continue;
    if (String(tc.status || '').toLowerCase() !== 'ok') continue;
    const resp = parseJsonMaybe(tc.response);
    if (!resp || typeof resp !== 'object') continue;
    if (name === 'speech_tts') {
      // Dual-write: WAV artifact + OGG channel file. Play the channel file once (same as MEDIA: paste).
      push(
        resp.relative_url ||
          resp.audio?.relative_url ||
          resp.paste_exactly ||
          resp.media_uri ||
          resp.audio?.media_uri ||
          resp.url
      );
      continue;
    }
    push(resp.relative_url || resp.paste_exactly || resp.media_uri || resp.url || resp.image_url || resp.video_url);
    if (Array.isArray(resp.urls)) resp.urls.forEach(push);
  }
  return urls;
}

export default function ChatToolCalls({ toolCalls, showChartPreviews = true, showMediaPreviews = true }) {
  const list = Array.isArray(toolCalls) ? toolCalls : [];
  if (!list.length) return null;
  const chartUrls = showChartPreviews ? collectChartUrlsFromToolCalls(list) : [];
  const mediaUrls = showMediaPreviews ? collectGeneratedMediaUrlsFromToolCalls(list) : [];

  const labelFor = (name) => {
    if (name === 'agent_goal_create') return 'Goal plan create';
    if (name === 'agent_goal_status') return 'Goal plan status';
    if (name === 'agent_goal_list') return 'Goal plan list';
    if (name === 'agent_goal_complete_step') return 'Goal step complete';
    return name;
  };

  return (
    <div className="chat-tool-calls" style={{ marginTop: '0.55rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      {chartUrls.length > 0 && (
        <div className="chat-tool-chart-previews" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.35rem' }}>
          {chartUrls.map((src) => (
            <AuthenticatedMediaImage key={src} src={src} alt="Chart" />
          ))}
        </div>
      )}
      {mediaUrls.length > 0 && (
        <div className="chat-tool-media-previews" style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.35rem' }}>
          {mediaUrls.map((src) => {
            const kind = guessChatMediaType(src);
            if (kind === 'audio') return <AuthenticatedMediaAudio key={src} src={src} />;
            if (kind === 'video') return <AuthenticatedMediaVideo key={src} src={src} />;
            return <AuthenticatedMediaImage key={src} src={src} alt="Generated media" />;
          })}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--muted)', marginRight: 2 }} title="Tools used for this reply">
          Tools
        </span>
        {list.map((tc) => {
          const ok = String(tc.status || '').toLowerCase() === 'ok';
          const name = tc.tool_name || 'tool';
          const isGoal = String(name).startsWith('agent_goal_');
          return (
            <details
              key={tc.id || `${name}-${tc.created_at}`}
              style={{
                display: 'inline-block',
                maxWidth: '100%',
                background: isGoal
                  ? 'rgba(37,99,235,0.1)'
                  : ok
                    ? 'rgba(34,197,94,0.12)'
                    : 'rgba(248,113,113,0.12)',
                border: `1px solid ${
                  isGoal
                    ? 'rgba(37,99,235,0.35)'
                    : ok
                      ? 'rgba(34,197,94,0.35)'
                      : 'rgba(248,113,113,0.35)'
                }`,
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
                <code style={{ fontSize: '0.72rem', background: 'transparent', padding: 0 }}>{labelFor(name)}</code>
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
