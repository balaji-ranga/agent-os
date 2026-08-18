/**
 * Mic (Whisper STT), Speak (Piper), and live Call (WebRTC) for Agent Chat.
 * Used on Home `/` and `/agents/:id/chat` as well as embed panels.
 *
 * Mic stays clickable while recording. After 3s of silence (or click again),
 * audio is transcribed and the parent auto-sends it as a chat message.
 * Call is shown only when that employee has an enabled Voice channel (Realtime Caller).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, resolveFetchUrl } from '../api';
import AgentVoiceCall from './AgentVoiceCall.jsx';

const SILENCE_MS = 3000;
const MAX_RECORD_MS = 60000;
const SPEECH_RMS = 0.02;

function analyserRms(analyser, buf) {
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / buf.length);
}

export function useChatVoice({ agentId, sending, setError }) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakReply, setSpeakReply] = useState(false);
  const [calling, setCalling] = useState(false);
  const [liveCallEnabled, setLiveCallEnabled] = useState(false);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const speakAudioRef = useRef(null);
  const onTranscriptRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const maxTimerRef = useRef(null);
  const pollRef = useRef(null);
  const audioCtxRef = useRef(null);
  const streamRef = useRef(null);

  const clearWatchers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      audioCtxRef.current?.close();
    } catch {
      /* ignore */
    }
    audioCtxRef.current = null;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks()?.forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      try {
        mediaRecRef.current?.stop();
      } catch {
        /* ignore */
      }
      clearWatchers();
      stopStream();
      speakAudioRef.current?.pause();
    },
    [clearWatchers, stopStream]
  );

  useEffect(() => {
    setCalling(false);
    setLiveCallEnabled(false);
    try {
      mediaRecRef.current?.stop();
    } catch {
      /* ignore */
    }
    clearWatchers();
    stopStream();
    setRecording(false);
    if (!agentId) return undefined;
    let cancelled = false;
    api
      .agentVoiceStatus(agentId)
      .then((r) => {
        if (cancelled) return;
        setLiveCallEnabled(String(r?.channel?.status || '').toLowerCase() === 'enabled');
      })
      .catch(() => {
        if (!cancelled) setLiveCallEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, clearWatchers, stopStream]);

  const mintVoiceSession = useCallback(() => api.agentVoiceSession(agentId), [agentId]);

  const playAssistantSpeech = useCallback(
    async (text) => {
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
    },
    [setError]
  );

  const transcribeBlob = useCallback(
    async (blob) => {
      if (!blob || blob.size < 256) {
        console.info('[chat] mic skip empty blob bytes=%s', blob?.size || 0);
        return '';
      }
      setTranscribing(true);
      setError?.(null);
      try {
        const form = new FormData();
        form.append('file', blob, 'voice.webm');
        const r = await api.speechStt(form);
        const text = String(r.text || '').trim();
        console.info('[chat] mic transcribed chars=%s', text.length);
        return text;
      } catch (e) {
        setError?.(e.message || 'Transcription failed');
        return '';
      } finally {
        setTranscribing(false);
      }
    },
    [setError]
  );

  const finishRecording = useCallback(
    (reason) => {
      clearWatchers();
      const rec = mediaRecRef.current;
      if (rec && rec.state !== 'inactive') {
        console.info('[chat] mic stop reason=%s', reason);
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      setRecording(false);
    },
    [clearWatchers]
  );

  const startSilenceWatch = useCallback(
    (stream) => {
      let lastSpeechAt = 0;
      const startedAt = Date.now();
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) throw new Error('no-audio-context');
        const ctx = new Ctx();
        audioCtxRef.current = ctx;
        void ctx.resume?.();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        pollRef.current = setInterval(() => {
          const rms = analyserRms(analyser, buf);
          const now = Date.now();
          if (rms >= SPEECH_RMS) lastSpeechAt = now;
          const quietFor = lastSpeechAt ? now - lastSpeechAt : now - startedAt;
          if (quietFor >= SILENCE_MS) finishRecording(lastSpeechAt ? 'silence' : 'no-speech');
        }, 120);
      } catch {
        silenceTimerRef.current = setTimeout(() => finishRecording('fallback-3s'), SILENCE_MS);
      }
      maxTimerRef.current = setTimeout(() => finishRecording('max'), MAX_RECORD_MS);
    },
    [finishRecording]
  );

  const toggleRecord = useCallback(
    async (onTranscript) => {
      if (recording) {
        finishRecording('click');
        return;
      }
      if (transcribing || sending) return;
      onTranscriptRef.current = onTranscript;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (ev) => {
          if (ev.data?.size) chunksRef.current.push(ev.data);
        };
        rec.onstop = async () => {
          clearWatchers();
          stopStream();
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const text = await transcribeBlob(blob);
          if (text) onTranscriptRef.current?.(text);
          else setError?.('No speech detected — click the microphone and speak, then pause.');
        };
        mediaRecRef.current = rec;
        rec.start(250);
        setRecording(true);
        console.info('[chat] mic start');
        startSilenceWatch(stream);
      } catch (e) {
        stopStream();
        setError?.(e.message || 'Microphone unavailable');
      }
    },
    [
      recording,
      transcribing,
      sending,
      transcribeBlob,
      setError,
      finishRecording,
      startSilenceWatch,
      clearWatchers,
      stopStream,
    ]
  );

  return {
    recording,
    transcribing,
    speakReply,
    setSpeakReply,
    calling,
    setCalling,
    liveCallEnabled,
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

/** Mic / Call / Speak sit in the compose toolbar next to the paperclip. */
export function ChatVoiceBar({
  sending,
  recording,
  transcribing,
  calling,
  speakReply,
  setSpeakReply,
  onMic,
  onCall,
  showCall = false,
}) {
  const micDisabled = sending || transcribing;
  const micLabel = transcribing ? 'Transcribing' : recording ? 'Stop microphone' : 'Microphone';
  return (
    <>
      <button
        type="button"
        className={`chat-attach-icon-btn${recording ? ' is-recording' : ''}`}
        disabled={micDisabled}
        onClick={onMic}
        title={
          recording
            ? 'Stop now (or pause 3 seconds to auto-send)'
            : 'Microphone: speak, pause 3 seconds, message sends automatically'
        }
        aria-label={micLabel}
        aria-pressed={recording}
      >
        <MicIcon />
      </button>
      {showCall ? (
        <button
          type="button"
          className={`chat-attach-icon-btn${calling ? ' is-active-call' : ''}`}
          disabled={sending || recording || transcribing || calling}
          onClick={onCall}
          title="Live call (WebRTC). Realtime Caller with an enabled Voice channel."
          aria-label="Start live call"
        >
          <CallIcon />
        </button>
      ) : null}
      {recording ? <span className="chat-compose-listening">Listening — pause 3s to send</span> : null}
      {transcribing ? <span className="chat-compose-listening">Transcribing…</span> : null}
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
