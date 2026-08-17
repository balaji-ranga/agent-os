/**
 * WebRTC click-to-call against an owner-BYOK OpenAI Realtime ephemeral session.
 * Tools go through /api/voice/tools with the short-lived session token.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveFetchUrl } from '../api';

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}')) || {};
  } catch {
    return {};
  }
}

export default function AgentVoiceCall({
  mintSession,
  onClose,
  heading = 'Live call',
}) {
  const [status, setStatus] = useState('connecting');
  const [error, setError] = useState(null);
  const [muted, setMuted] = useState(false);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const localStreamRef = useRef(null);
  const audioElRef = useRef(null);
  const sessionRef = useRef(null);
  const transcriptRef = useRef([]);
  const endedRef = useRef(false);

  const hangup = useCallback(
    async (opts = {}) => {
      if (endedRef.current && !opts.force) return;
      endedRef.current = true;
      setStatus('ended');
      try {
        pcRef.current?.getSenders()?.forEach((s) => s.track?.stop());
        pcRef.current?.close();
      } catch {
        /* ignore */
      }
      localStreamRef.current?.getTracks()?.forEach((t) => t.stop());
      const token = sessionRef.current?.session_token;
      if (token && !opts.skipEnd) {
        try {
          await fetch(resolveFetchUrl('/voice/end'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_token: token,
              transcript: transcriptRef.current,
            }),
          });
        } catch {
          /* wrap-up is best-effort */
        }
      }
      onClose?.();
    },
    [onClose]
  );

  const hangupRef = useRef(null);
  hangupRef.current = hangup;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await mintSession();
        if (cancelled) return;
        sessionRef.current = session;
        const secret = session?.realtime?.client_secret;
        const webrtcUrl = session?.realtime?.webrtc_url;
        if (!secret || !webrtcUrl) {
          throw new Error(session?.error || 'Realtime session missing client secret');
        }

        const pc = new RTCPeerConnection();
        pcRef.current = pc;
        const audioEl = audioElRef.current;
        pc.ontrack = (e) => {
          if (audioEl) audioEl.srcObject = e.streams[0];
        };

        const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          ms.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = ms;
        ms.getTracks().forEach((t) => pc.addTrack(t, ms));

        const dc = pc.createDataChannel('oai-events');
        dcRef.current = dc;
        dc.addEventListener('message', async (ev) => {
          let msg;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          const type = String(msg?.type || '');
          if (type === 'conversation.item.input_audio_transcription.completed') {
            const text = String(msg.transcript || '').trim();
            if (text) transcriptRef.current.push({ role: 'user', text });
          }
          if (type === 'response.audio_transcript.done' || type === 'response.output_audio_transcript.done') {
            const text = String(msg.transcript || '').trim();
            if (text) transcriptRef.current.push({ role: 'assistant', text });
          }
          if (type === 'response.function_call_arguments.done') {
            const callId = msg.call_id;
            const name = msg.name;
            const args = parseArgs(msg.arguments);
            try {
              const res = await fetch(resolveFetchUrl('/voice/tools'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  session_token: sessionRef.current?.session_token,
                  tool_name: name,
                  arguments: args,
                }),
              });
              const data = await res.json().catch(() => ({}));
              const output = res.ok ? JSON.stringify(data.result ?? data) : JSON.stringify({ error: data.error || 'tool failed' });
              dc.send(
                JSON.stringify({
                  type: 'conversation.item.create',
                  item: { type: 'function_call_output', call_id: callId, output: output.slice(0, 8000) },
                })
              );
              dc.send(JSON.stringify({ type: 'response.create' }));
            } catch (err) {
              try {
                dc.send(
                  JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                      type: 'function_call_output',
                      call_id: callId,
                      output: JSON.stringify({ error: err?.message || 'tool failed' }),
                    },
                  })
                );
                dc.send(JSON.stringify({ type: 'response.create' }));
              } catch {
                /* ignore */
              }
            }
          }
        });

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(webrtcUrl, {
          method: 'POST',
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/sdp',
          },
        });
        if (!sdpRes.ok) {
          const errText = await sdpRes.text().catch(() => '');
          throw new Error(errText || `WebRTC connect failed (${sdpRes.status})`);
        }
        const answer = { type: 'answer', sdp: await sdpRes.text() };
        await pc.setRemoteDescription(answer);
        if (!cancelled) setStatus('live');
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not start call');
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      hangupRef.current?.({ skipEnd: false, force: true });
    };
  }, [mintSession]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks()?.forEach((t) => {
      t.enabled = !next;
    });
  };

  return (
    <div
      role="dialog"
      aria-label={heading}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '0.85rem 1rem',
        background: 'var(--surface)',
        marginBottom: '0.75rem',
      }}
    >
      <audio ref={audioElRef} autoPlay />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <strong>{heading}</strong>
        <span style={{ fontSize: '0.8rem', color: status === 'live' ? '#22c55e' : 'var(--muted)' }}>
          {status === 'connecting' ? 'Connecting…' : status === 'live' ? 'Live' : status === 'error' ? 'Failed' : 'Ended'}
        </span>
      </div>
      {error && (
        <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{error}</p>
      )}
      <p style={{ color: 'var(--muted)', fontSize: '0.8rem', margin: '0.5rem 0 0' }}>
        Browser microphone to this AI employee. Not a phone number. Hang up to trigger wrap-up.
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: '0.75rem' }}>
        <button type="button" onClick={toggleMute} disabled={status !== 'live'} className="btn-ghost">
          {muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" onClick={() => hangup()} className="btn-primary">
          Hang up
        </button>
      </div>
    </div>
  );
}
