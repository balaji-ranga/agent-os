import { useState, useEffect, useRef } from 'react';
import { api, resolveFetchUrl } from '../api';
import ChatMessageRow from './ChatMessageRow';
import ChatComposeInput from './ChatComposeInput';
import { useAuth } from '../context/AuthContext';
import { buildMessageWithAttachments, uploadChatAttachments, buildDisplayAttachmentsFromFiles, revokeAttachmentPreviews } from '../utils/chatAttachments.js';

/**
 * Embeddable chat panel for an OpenClaw agent.
 */
export default function AgentChatPanel({
  agentId,
  profileId = null,
  placeholder = 'Message…',
  minHeight = 280,
  quickActions = [],
}) {
  const { dataCeoUserId } = useAuth();
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speakReply, setSpeakReply] = useState(false);
  const scrollRef = useRef(null);
  const abortControllerRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const speakAudioRef = useRef(null);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
      mediaRecRef.current?.stop();
      speakAudioRef.current?.pause();
    },
    []
  );

  useEffect(() => {
    if (!agentId) return;
    api
      .agentChatHistory(agentId)
      .then((r) => setTurns(Array.isArray(r) ? r : r.turns || []))
      .catch(() => setTurns([]));
  }, [agentId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, sending]);

  const playAssistantSpeech = async (text) => {
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
      setError(e.message || 'Speak reply failed');
    }
  };

  const sendMessage = async (msg, files = []) => {
    const userText = String(msg || '').trim();
    if ((!userText && !files.length) || sending) return;
    const displayAttachments = buildDisplayAttachmentsFromFiles(files);
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSending(true);
    setError(null);
    setTurns((prev) => [
      ...prev,
      {
        id: tempId,
        role: 'user',
        content: userText,
        attachments: displayAttachments,
        created_at: new Date().toISOString(),
      },
    ]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      const uploaded = files.length ? await uploadChatAttachments(files) : [];
      const outbound = buildMessageWithAttachments(userText, uploaded);
      if (uploaded.length) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === tempId
              ? {
                  ...t,
                  attachments: displayAttachments.map((a, i) => ({
                    ...a,
                    relative_path: uploaded[i]?.relative_path || a.relative_path,
                    document_id: uploaded[i]?.document_id || a.document_id,
                    mime_type: uploaded[i]?.mime_type || a.mime_type,
                  })),
                }
              : t
          )
        );
      }
      const r = await api.agentChatSend(agentId, outbound, dataCeoUserId || 'default', profileId, {
        signal: controller.signal,
      });
      const reply = r.reply;
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply,
          created_at: new Date().toISOString(),
          tool_calls: r.tool_calls || [],
        },
      ]);
      if (speakReply && reply) {
        playAssistantSpeech(reply);
      }
    } catch (e) {
      const cancelled = controller.signal.aborted || e?.name === 'AbortError';
      setError(cancelled ? 'Cancelled' : e.message);
      setTurns((prev) => prev.filter((t) => t.id !== tempId));
      revokeAttachmentPreviews(displayAttachments);
      if (!cancelled) throw e;
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        setSending(false);
      }
    }
  };

  const transcribeBlob = async (blob) => {
    setTranscribing(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', blob, 'voice.webm');
      const r = await api.speechStt(form);
      const text = String(r.text || '').trim();
      if (text) {
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
      }
    } catch (e) {
      setError(e.message || 'Transcription failed');
    } finally {
      setTranscribing(false);
    }
  };

  const toggleRecord = async () => {
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
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        transcribeBlob(blob);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(e.message || 'Microphone unavailable');
    }
  };

  const cancelSend = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    setSending(false);
    setError('Cancelled');
  };

  const send = async (e) => {
    e.preventDefault();
    if ((!input.trim() && !attachments.length) || sending) return;
    const text = input.trim();
    const files = [...attachments];
    setInput('');
    setAttachments([]);
    try {
      await sendMessage(text, files);
    } catch (_) {
      setInput(text);
      setAttachments(files);
    }
  };

  const micBusy = recording || transcribing;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight }}>
      {error && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.15)', borderRadius: 6, marginBottom: '0.5rem', color: '#f87171', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight,
          maxHeight: 420,
          overflowY: 'auto',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '0.75rem',
          marginBottom: '0.5rem',
        }}
      >
        {turns.length === 0 && !sending && (
          <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
            Chat with the agent. Attach images/docs to upload into Master Data for RAG.
          </div>
        )}
        {turns.map((t, i) => (
          <ChatMessageRow
            key={t.id || i}
            role={t.role}
            content={t.content}
            createdAt={t.created_at}
            agentId={agentId}
            messageId={t.id}
            feedbackSource="chat"
            feedbackContext={profileId ? { profile_id: profileId } : {}}
            toolCalls={t.tool_calls}
            attachments={t.attachments}
          />
        ))}
        {sending && <div style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>…</div>}
      </div>
      {quickActions.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.5rem' }}>
          {quickActions.map((qa) => (
            <button
              key={qa.label}
              type="button"
              disabled={sending}
              onClick={() => sendMessage(qa.message)}
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.8rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: sending ? 'not-allowed' : 'pointer',
              }}
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={sending || micBusy}
          onClick={toggleRecord}
          title={recording ? 'Stop recording' : 'Record voice (local Whisper STT)'}
          aria-pressed={recording}
          style={{
            padding: '0.35rem 0.65rem',
            fontSize: '0.8rem',
            borderRadius: 6,
            border: recording ? '1px solid #f87171' : '1px solid var(--border)',
            background: recording ? 'rgba(248,113,113,0.15)' : 'var(--surface)',
            color: recording ? '#f87171' : 'var(--text)',
            cursor: sending || micBusy ? 'not-allowed' : 'pointer',
          }}
        >
          {transcribing ? 'Transcribing…' : recording ? 'Stop mic' : 'Mic'}
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
      <form onSubmit={send} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <ChatComposeInput
          placeholder={`${placeholder} (Shift+Enter for new line)`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onSend={send}
          disabled={sending || micBusy}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          rows={3}
          style={{
            flex: 1,
            padding: '0.6rem 0.75rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text)',
            resize: 'vertical',
            minHeight: 56,
            font: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={sending || micBusy || (!input.trim() && !attachments.length)}
          style={{
            padding: '0.6rem 1rem',
            background: sending || micBusy || (!input.trim() && !attachments.length) ? 'var(--border)' : 'var(--accent)',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
          }}
        >
          Send
        </button>
        {sending && (
          <button
            type="button"
            onClick={cancelSend}
            style={{
              padding: '0.6rem 1rem',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text)',
            }}
          >
            Cancel
          </button>
        )}
      </form>
    </div>
  );
}
