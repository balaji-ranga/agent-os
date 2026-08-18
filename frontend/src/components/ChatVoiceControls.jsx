/**
 * Mic (Whisper STT), Speak reply (Piper), and live Call (WebRTC) for Agent Chat.
 * Used on Home `/` and `/agents/:id/chat` as well as embed panels.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, resolveFetchUrl } from '../api';
import AgentVoiceCall from './AgentVoiceCall.jsx';

const barBtn = {
  padding: '0.35rem 0.65rem',
  fontSize: '0.8rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text)',
};

export function useChatVoice({ agentId, sending, setError }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakReply, setSpeakReply] = useState(false);
  const [calling, setCalling] = useState(false);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const speakAudioRef = useRef(null);

  useEffect(
    () => () => {
      try {
        mediaRecRef.current?.stop();
      } catch {
        /* ignore */
      }
      speakAudioRef.current?.pause();
    },
    []
  );

  useEffect(() => {
    setCalling(false);
    try {
      mediaRecRef.current?.stop();
    } catch {
      /* ignore */
    }
    setRecording(false);
  }, [agentId]);

  const mintVoiceSession = useCallback(() => api.agentVoiceSession(agentId), [agentId]);

  const playAssistantSpeech = useCallback(async (text) => {
    const spoken = String(text || '').trim();
    if (!spoken) return;
    try {
      const r = await api.speechTts({ text: spoken });
      const url = resolveFetchUrl(r.url || r.audio?.url);
      if (!url) return;
      speakAudioRef.current?.pause();
      const audio = new Audio(url);
      speakAudioRef.current = audio;
      await audio.play();
    } catch (e) {
      console.warn('[chat] speak reply failed', e?.message || e);
      setError?.(e.message || 'Speak reply failed');
    }
  }, [setError]);

  const transcribeBlob = useCallback(
    async (blob) => {
      setTranscribing(true);
      setError?.(null);
      try {
        const form = new FormData();
        form.append('file', blob, 'voice.webm');
        const r = await api.speechStt(form);
        return String(r.text || '').trim();
      } catch (e) {
        setError?.(e.message || 'Transcription failed');
        return '';
      } finally {
        setTranscribing(false);
      }
    },
    [setError]
  );

  const toggleRecord = useCallback(
    async (onTranscript) => {
      if (recording) {
        mediaRecRef.current?.stop();
        setRecording(false);
        return;
      }
      if (transcribing || sending) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const rec = new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (ev) => {
          if (ev.data.size) chunksRef.current.push(ev.data);
        };
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const text = await transcribeBlob(blob);
          if (text) onTranscript?.(text);
        };
        mediaRecRef.current = rec;
        rec.start();
        setRecording(true);
      } catch (e) {
        setError?.(e.message || 'Microphone unavailable');
      }
    },
    [recording, transcribing, sending, transcribeBlob, setError]
  );

  return {
    recording,
    transcribing,
    speakReply,
    setSpeakReply,
    calling,
    setCalling,
    micBusy: recording || transcribing,
    mintVoiceSession,
    playAssistantSpeech,
    toggleRecord,
  };
}

export function ChatVoiceBar({
  sending,
  micBusy,
  recording,
  transcribing,
  calling,
  speakReply,
  setSpeakReply,
  onMic,
  onCall,
}) {
  const disabled = sending || micBusy;
  return (
    <div className="chat-voice-bar" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={onMic}
        title={recording ? 'Stop recording' : 'Record voice (local Whisper STT)'}
        aria-pressed={recording}
        style={{
          ...barBtn,
          border: recording ? '1px solid #f87171' : '1px solid var(--border)',
          background: recording ? 'rgba(248,113,113,0.15)' : 'var(--surface)',
          color: recording ? '#f87171' : 'var(--text)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        {transcribing ? 'Transcribing…' : recording ? 'Stop mic' : 'Mic'}
      </button>
      <button
        type="button"
        disabled={disabled || calling}
        onClick={onCall}
        title="Live WebRTC call. Needs an OpenAI Realtime-capable key (Realtime Caller)."
        style={{
          ...barBtn,
          background: calling ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'var(--surface)',
          cursor: disabled || calling ? 'not-allowed' : 'pointer',
        }}
      >
        Call
      </button>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--muted)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={speakReply}
          onChange={(e) => setSpeakReply(e.target.checked)}
          disabled={sending}
        />
        Speak reply (Piper)
      </label>
    </div>
  );
}

export function ChatVoiceCallOverlay({ calling, agentName, mintSession, onClose }) {
  if (!calling) return null;
  return (
    <AgentVoiceCall
      heading={`Call ${agentName || 'employee'}`}
      mintSession={mintSession}
      onClose={onClose}
    />
  );
}
