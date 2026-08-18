/**
 * Mic (Whisper STT), Speak reply (Piper), and live Call (WebRTC) for Agent Chat.
 * Used on Home `/` and `/agents/:id/chat` as well as embed panels.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, resolveFetchUrl } from '../api';
import AgentVoiceCall from './AgentVoiceCall.jsx';

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

function MicIcon() {
  return (
    <svg className="chat-attach-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg className="chat-attach-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.35a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.73-1.73a2 2 0 0 1 2.11-.45c.75.32 1.54.55 2.35.68A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

/** Mic / Call / Speak sit in the compose toolbar next to the paperclip (Home and employee chat). */
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
  const micLabel = transcribing ? 'Transcribing' : recording ? 'Stop microphone' : 'Microphone';
  return (
    <>
      <button
        type="button"
        className={`chat-attach-icon-btn${recording ? ' is-recording' : ''}`}
        disabled={disabled}
        onClick={onMic}
        title={recording ? 'Stop recording' : 'Record voice into the message box (Whisper)'}
        aria-label={micLabel}
        aria-pressed={recording}
      >
        <MicIcon />
      </button>
      <button
        type="button"
        className={`chat-attach-icon-btn${calling ? ' is-active-call' : ''}`}
        disabled={disabled || calling}
        onClick={onCall}
        title="Live WebRTC call. Needs an OpenAI Realtime-capable key (Realtime Caller)."
        aria-label="Start live call"
      >
        <CallIcon />
      </button>
      <label className="chat-compose-speak" title="Play assistant replies with Piper TTS">
        <input
          type="checkbox"
          checked={speakReply}
          onChange={(e) => setSpeakReply(e.target.checked)}
          disabled={sending}
        />
        Speak
      </label>
    </>
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
