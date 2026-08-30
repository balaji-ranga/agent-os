import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export default function HumanIncomingCall() {
  const [call, setCall] = useState(null); const [status, setStatus] = useState(''); const [error, setError] = useState(''); const peer = useRef(null); const audio = useRef(null);
  useEffect(() => { let alive = true; const poll = () => api.humanIncomingCalls().then((r) => { if (alive && !call) setCall((r.calls || [])[0] || null); }).catch(() => {}); poll(); const timer = setInterval(poll, 2500); return () => { alive = false; clearInterval(timer); peer.current?.close(); }; }, [call]);
  if (!call) return null;
  const decline = async () => { try { await api.humanCallUpdate(call.id, { status: 'declined' }); } finally { setCall(null); setStatus(''); } };
  const answer = async () => { try { setStatus('Connecting…'); const current = (await api.humanCallGet(call.id)).call; const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }); peer.current = pc; stream.getTracks().forEach((t) => pc.addTrack(t, stream)); pc.ontrack = (e) => { audio.current.srcObject = e.streams[0]; }; await pc.setRemoteDescription(current.offer); await pc.setLocalDescription(await pc.createAnswer()); await new Promise((resolve) => { if (pc.iceGatheringState === 'complete') resolve(); else pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve(); }); await api.humanCallUpdate(call.id, { answer: pc.localDescription }); setStatus('Connected'); } catch (e) { setError(e.message); setStatus('Could not connect'); } };
  const end = async () => { try { await api.humanCallUpdate(call.id, { status: 'ended' }); } catch {} peer.current?.close(); setCall(null); };
  return <div className="human-incoming-call" role="dialog" aria-label="Incoming company voice call"><div className="call-avatar">{(call.caller_name || 'G')[0]}</div><div><strong>{status || `Incoming call from ${call.caller_name || 'Flolah guest'}`}</strong>{error && <small>{error}</small>}</div>{status === 'Connected' ? <button onClick={end}>End</button> : <><button className="btn-primary" onClick={answer}>Answer</button><button onClick={decline}>Decline</button></>}<audio ref={audio} autoPlay /></div>;
}
