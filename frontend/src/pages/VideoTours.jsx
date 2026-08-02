import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, getAuthToken, resolveFetchUrl } from '../api';

const btnPrimary = {
  padding: '0.5rem 1rem',
  background: 'var(--accent)',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
};

const btnSecondary = {
  padding: '0.5rem 1rem',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: '0.9rem',
};

function parseVttTime(ts) {
  const m = String(ts || '').trim().match(/(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})/);
  if (!m) return 0;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  const ms = Number(m[4] || 0);
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function parseVttCues(vtt) {
  if (!vtt) return [];
  const blocks = String(vtt)
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    if (block.startsWith('WEBVTT')) continue;
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const timing = lines[timeIdx];
    const [startRaw, endRaw] = timing.split('-->').map((s) => s.trim());
    const text = lines.slice(timeIdx + 1).join(' ').trim();
    if (!text) continue;
    cues.push({
      timing,
      text,
      start: parseVttTime(startRaw),
      end: parseVttTime(endRaw.split(/\s+/)[0]),
    });
  }
  return cues;
}

async function playAuthAudio(urlPath) {
  const resolved = resolveFetchUrl(urlPath);
  const token = getAuthToken();
  // Prefer direct play (signed/public media). Fall back to authenticated blob.
  try {
    const audio = new Audio(resolved);
    if (token) {
      // If URL is same-origin /api/media, fetch with bearer for reliability
      const needsAuth = String(resolved).includes('/api/media') || String(resolved).startsWith('/api/');
      if (needsAuth) {
        const res = await fetch(resolved, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`Audio ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = new Audio(objectUrl);
        a.addEventListener('ended', () => URL.revokeObjectURL(objectUrl), { once: true });
        return a;
      }
    }
    return audio;
  } catch {
    const res = await fetch(resolved, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Audio ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = new Audio(objectUrl);
    a.addEventListener('ended', () => URL.revokeObjectURL(objectUrl), { once: true });
    return a;
  }
}

function TourNarrationPlayer({ tour, cues }) {
  const [status, setStatus] = useState('idle'); // idle | loading | playing | paused | ended | error
  const [activeCue, setActiveCue] = useState(-1);
  const [err, setErr] = useState('');
  const audioRef = useRef(null);
  const rafRef = useRef(0);

  const narrationText = useMemo(() => {
    if (tour?.voice_script) return String(tour.voice_script).trim();
    if (cues?.length) return cues.map((c) => c.text).join(' ');
    return '';
  }, [tour?.voice_script, cues]);

  const stopRaf = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  const syncCues = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !cues.length) return;
    const t = audio.currentTime || 0;
    let idx = cues.findIndex((c) => t >= c.start && t < c.end);
    if (idx < 0) {
      // nearest previous
      idx = -1;
      for (let i = 0; i < cues.length; i += 1) {
        if (t >= cues[i].start) idx = i;
      }
    }
    setActiveCue(idx);
    if (!audio.paused && !audio.ended) {
      rafRef.current = requestAnimationFrame(syncCues);
    }
  }, [cues]);

  const cleanupAudio = useCallback(() => {
    stopRaf();
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onended = null;
      a.onerror = null;
      audioRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanupAudio(), [cleanupAudio]);

  // Reset when tour changes
  useEffect(() => {
    cleanupAudio();
    setStatus('idle');
    setActiveCue(-1);
    setErr('');
  }, [tour?.stem, cleanupAudio]);

  async function handlePlay() {
    if (!narrationText) {
      setErr('No script available for this tour.');
      setStatus('error');
      return;
    }
    setErr('');
    try {
      if (audioRef.current && status === 'paused') {
        await audioRef.current.play();
        setStatus('playing');
        stopRaf();
        rafRef.current = requestAnimationFrame(syncCues);
        return;
      }
      cleanupAudio();
      setStatus('loading');
      const r = await api.speechTts({ text: narrationText.slice(0, 2500) });
      const url = r.url || r.audio?.url;
      if (!url) throw new Error('TTS returned no audio URL');
      const audio = await playAuthAudio(url);
      audioRef.current = audio;
      audio.onended = () => {
        stopRaf();
        setStatus('ended');
        setActiveCue(cues.length ? cues.length - 1 : -1);
      };
      audio.onerror = () => {
        setErr('Audio playback failed');
        setStatus('error');
      };
      await audio.play();
      setStatus('playing');
      rafRef.current = requestAnimationFrame(syncCues);
    } catch (e) {
      console.warn('[video-tours] play failed', e?.message || e);
      setErr(e?.message || 'Could not play narration');
      setStatus('error');
    }
  }

  function handlePause() {
    audioRef.current?.pause();
    stopRaf();
    setStatus('paused');
  }

  function handleStop() {
    cleanupAudio();
    setStatus('idle');
    setActiveCue(-1);
  }

  const currentCaption = activeCue >= 0 ? cues[activeCue]?.text : '';

  return (
    <div
      style={{
        marginBottom: '1rem',
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'linear-gradient(160deg, color-mix(in srgb, var(--accent) 14%, var(--bg)), var(--bg))',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '1.5rem 1.25rem',
          textAlign: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ fontSize: '0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted, #888)' }}>
          {tour.has_video ? 'Exported video' : 'Narrated tour (TTS)'}
        </div>
        <div style={{ fontSize: '1.35rem', fontWeight: 650, maxWidth: 520 }}>{tour.title}</div>
        <div
          style={{
            minHeight: '3.2em',
            maxWidth: 560,
            fontSize: '1.05rem',
            lineHeight: 1.45,
            color: 'var(--text)',
          }}
          aria-live="polite"
        >
          {currentCaption || (status === 'loading' ? 'Preparing voice…' : 'Press Play to hear this tour with captions.')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', justifyContent: 'center' }}>
          {(status === 'idle' || status === 'ended' || status === 'error' || status === 'paused') && (
            <button type="button" style={btnPrimary} onClick={handlePlay} disabled={status === 'loading'}>
              {status === 'paused' ? 'Resume' : status === 'loading' ? 'Loading…' : 'Play tour'}
            </button>
          )}
          {status === 'playing' && (
            <button type="button" style={btnPrimary} onClick={handlePause}>
              Pause
            </button>
          )}
          {(status === 'playing' || status === 'paused') && (
            <button type="button" style={btnSecondary} onClick={handleStop}>
              Stop
            </button>
          )}
          {status === 'loading' && (
            <button type="button" style={btnSecondary} disabled>
              Loading voice…
            </button>
          )}
        </div>
        {err && (
          <div role="alert" style={{ color: 'var(--danger, #c44)', fontSize: '0.9rem' }}>
            {err}
          </div>
        )}
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted, #888)', maxWidth: 480 }}>
          Uses FloLah speech (Piper). When an mp4 is added under assets/, the full video player appears here instead.
        </p>
      </div>
      {cues.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1rem', background: 'var(--surface)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted, #888)', marginBottom: '0.35rem' }}>Captions</div>
          <ol style={{ margin: 0, paddingLeft: '1.1rem', maxHeight: 160, overflowY: 'auto' }}>
            {cues.map((c, i) => (
              <li
                key={i}
                style={{
                  marginBottom: '0.35rem',
                  fontWeight: i === activeCue ? 650 : 400,
                  color: i === activeCue ? 'var(--text)' : 'var(--muted, #888)',
                }}
              >
                {c.text}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export default function VideoTours() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [playlist, setPlaylist] = useState(null);
  const [tour, setTour] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = searchParams.get('v') || '';

  const loadList = useCallback(async () => {
    setError('');
    const data = await api.videoToursList();
    setPlaylist(data);
    return data;
  }, []);

  const loadTour = useCallback(async (stem) => {
    if (!stem) {
      setTour(null);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await api.videoToursGet(stem);
      setTour(data);
    } catch (e) {
      setError(e?.message || 'Failed to load tour');
      setTour(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadList()
      .then((data) => {
        const first = data?.items?.[0]?.stem;
        const stem = selected || first;
        if (stem && !selected) setSearchParams({ v: stem }, { replace: true });
        else if (stem) return loadTour(stem);
      })
      .catch((e) => setError(e?.message || 'Failed to load playlist'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selected) loadTour(selected);
  }, [selected, loadTour]);

  const cues = useMemo(() => parseVttCues(tour?.captions_vtt), [tour?.captions_vtt]);

  function selectStem(stem) {
    setSearchParams({ v: stem });
  }

  const [videoObjectUrl, setVideoObjectUrl] = useState(null);
  useEffect(() => {
    let revoked = null;
    let cancelled = false;
    async function loadVideo() {
      setVideoObjectUrl(null);
      if (!tour?.has_video) return;
      try {
        const token = getAuthToken();
        const res = await fetch(api.videoToursVideoUrl(tour.stem), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoked = url;
        setVideoObjectUrl(url);
      } catch {
        /* keep null */
      }
    }
    loadVideo();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [tour?.stem, tour?.has_video]);

  return (
    <div style={{ padding: '1rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ margin: 0 }}>Video Tours</h1>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--muted, #888)' }}>
          CEO help playlist ({playlist?.items?.length || 12} clips, ≤ {playlist?.max_seconds || 60}s each).
          Each clip walks through FloLah UI frames with nav highlights and pointer callouts, plus narration.
        </p>
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
          Prefer chat help?{' '}
          <Link to="/agents/platformhelp/chat">Ask Platform Help</Link>
          {' · '}
          <Link to="/onboarding">Onboarding</Link>
        </p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '0.75rem',
            borderRadius: 8,
            border: '1px solid var(--danger, #c44)',
            color: 'var(--danger, #c44)',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        <aside
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            padding: '0.75rem',
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          <h2 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Playlist</h2>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {(playlist?.items || []).map((item) => {
              const active = item.stem === selected;
              return (
                <li key={item.stem} style={{ marginBottom: '0.35rem' }}>
                  <button
                    type="button"
                    onClick={() => selectStem(item.stem)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.55rem 0.65rem',
                      borderRadius: 8,
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active
                        ? 'color-mix(in srgb, var(--accent) 12%, var(--surface))'
                        : 'var(--bg)',
                      color: 'var(--text)',
                      cursor: 'pointer',
                      font: 'inherit',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ fontWeight: active ? 600 : 500 }}>
                      {String(item.number).padStart(2, '0')}. {item.title}
                    </div>
                    <div style={{ color: 'var(--muted, #888)', marginTop: 2, fontSize: '0.78rem' }}>
                      {item.has_video ? 'UI walkthrough' : 'Narration only'}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <section
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--surface)',
            padding: '1rem',
            minHeight: 360,
          }}
        >
          {busy && !tour && <p style={{ color: 'var(--muted, #888)' }}>Loading…</p>}
          {tour && (
            <>
              <h2 style={{ margin: '0 0 0.35rem', fontSize: '1.25rem' }}>
                {String(tour.number).padStart(2, '0')} — {tour.title}
              </h2>
              <p style={{ margin: '0 0 1rem', color: 'var(--muted, #888)' }}>{tour.goal}</p>

              {tour.has_video && videoObjectUrl ? (
                <video
                  key={tour.stem}
                  controls
                  playsInline
                  style={{ width: '100%', maxHeight: 420, borderRadius: 8, background: '#000', marginBottom: '1rem' }}
                >
                  <source src={videoObjectUrl} type="video/mp4" />
                </video>
              ) : (
                <TourNarrationPlayer tour={tour} cues={cues} />
              )}

              {tour.voice_script && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Voice script</h3>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{tour.voice_script}</p>
                </div>
              )}

              {tour.shot_list && (
                <div>
                  <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem' }}>Shot list</h3>
                  <pre
                    style={{
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      fontSize: '0.9rem',
                      color: 'var(--muted, #888)',
                    }}
                  >
                    {tour.shot_list}
                  </pre>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}