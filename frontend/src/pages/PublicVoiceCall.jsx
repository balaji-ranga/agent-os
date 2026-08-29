/**
 * Public Voice widget — no login. Session mint is slug-scoped; tools run as the CEO owner.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import AgentVoiceCall from '../components/AgentVoiceCall.jsx';

export default function PublicVoiceCall({ invite = false }) {
  const { slug, token } = useParams();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    setError(null);
    api
      [invite ? 'voiceInviteGet' : 'publicVoiceGet'](invite ? token : slug)
      .then(setMeta)
      .catch((e) => setError(e.message || 'Not found'));
  }, [invite, slug, token]);

  const mintSession = useCallback(() => invite ? api.voiceInviteSession(token) : api.publicVoiceSession(slug), [invite, slug, token]);

  return (
    <div style={{ maxWidth: 480, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginTop: 0 }}>{meta?.agent?.name || 'Voice'}</h1>
      <p style={{ color: 'var(--muted)' }}>
        {meta?.agent?.role || 'Live voice with this company AI employee. Your browser microphone is used. This is not a phone call.'}
      </p>
      {error && <p style={{ color: '#f87171' }}>{error}</p>}
      {!calling && !error && (
        <button type="button" className="btn-primary" onClick={() => setCalling(true)}>
          Start call
        </button>
      )}
      {calling && (
        <AgentVoiceCall
          heading={`Call ${meta?.agent?.name || 'employee'}`}
          mintSession={mintSession}
          onClose={() => setCalling(false)}
        />
      )}
    </div>
  );
}
