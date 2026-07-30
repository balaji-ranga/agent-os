import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, getAuthToken } from '../api';
import { extractSpokenAvatarReply } from '../utils/avatarSpeakText.js';

async function ensureThree() {
  if (window.__THREE__) return window.__THREE__;
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  window.__THREE__ = { THREE, GLTFLoader, OrbitControls };
  return window.__THREE__;
}

function authFetchUrl(path) {
  const base = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  return url;
}

/**
 * Map GLTF clips to lookup keys. Unnamed clips (common in sample GLBs) become
 * Animation_0 in our catalog, while Three.js keeps name "" — register both.
 */
function buildClipActions(mixer, gltfAnimations = []) {
  const actions = {};
  const list = Array.isArray(gltfAnimations) ? gltfAnimations : [];
  list.forEach((clip, i) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    const raw = String(clip.name || '').trim();
    const aliases = new Set([`Animation_${i}`, `animation_${i}`]);
    if (raw) aliases.add(raw);
    else aliases.add('');
    for (const key of aliases) {
      if (key === '' || !actions[key]) actions[key] = action;
    }
  });
  return actions;
}


function isMouthOrLipClipName(name) {
  return /mouth|lip|viseme|jaw|phoneme/i.test(String(name || ""));
}

function isIdleLikeClipName(name) {
  return /idle|blink|breathe|look[_ -]?around|stand|rest/i.test(String(name || ""));
}

function pickIdleClipName(catalog = [], actions = {}) {
  const names = (Array.isArray(catalog) ? catalog : [])
    .map((c) => (typeof c === "string" ? c : c?.name))
    .map((n) => String(n || "").trim())
    .filter(Boolean);
  const preferred =
    names.find((n) => isIdleLikeClipName(n) && !isMouthOrLipClipName(n)) ||
    names.find((n) => !isMouthOrLipClipName(n)) ||
    null;
  if (preferred && resolveClipAction(actions, preferred)) return preferred;
  const keys = Object.keys(actions || {}).filter((k) => k && !isMouthOrLipClipName(k));
  return keys[0] || null;
}

function visemeWeightAt(visemes, t, mouthClip) {
  const list = (Array.isArray(visemes) ? visemes : [])
    .map((v) => ({
      t: Number(v.t ?? v.time ?? 0),
      name: String(v.name || v.viseme || "").trim(),
      weight: v.weight != null ? Number(v.weight) : undefined,
    }))
    .filter((v) => v.name)
    .sort((a, b) => a.t - b.t);
  if (!list.length) return 0;
  let cur = list[0];
  for (const v of list) {
    if (v.t <= t) cur = v;
    else break;
  }
  if (mouthClip && cur.name && cur.name !== mouthClip && !isMouthOrLipClipName(cur.name)) {
    // letter visemes A/E/O → open mouth
    const open = /[aeiouAEIOU]/.test(cur.name) || /open|wide/i.test(cur.name);
    return open ? 0.85 : 0.1;
  }
  if (cur.weight != null && Number.isFinite(cur.weight)) return Math.max(0, Math.min(1, cur.weight));
  return isMouthOrLipClipName(cur.name) ? 0.8 : 0.15;
}

function resolveClipAction(actions, name, { fallback = false } = {}) {
  if (!actions || typeof actions !== 'object') return null;
  const keys = Object.keys(actions);
  if (!keys.length) return null;
  const want = String(name || '').trim();
  if (want && actions[want]) return actions[want];
  if (want) {
    const lower = want.toLowerCase();
    const hit = keys.find((k) => k.toLowerCase() === lower);
    if (hit) return actions[hit];
  }
  const idx = want.match(/^animation[_\s-]?(\d+)$/i);
  if (idx) {
    const alias = `Animation_${idx[1]}`;
    if (actions[alias]) return actions[alias];
    if (actions[`${idx[1]}`]) return actions[`${idx[1]}`];
  }
  if (!fallback) return null;
  const named = keys.find((k) => k && !isMouthOrLipClipName(k));
  return actions[named != null ? named : keys[0]] || null;
}

export default function VirtualRoom() {
  const { agentId, avatarId: avatarIdParam } = useParams();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const [avatar, setAvatar] = useState(null);
  const [transcript, setTranscript] = useState([]);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const mixersRef = useRef([]);
  const actionsRef = useRef({});
  const clockRef = useRef(null);
  const visemeRafRef = useRef(0);
  const audioRef = useRef(null);
  const mouthActionRef = useRef(null);

  const playPlayback = useCallback(async (playback) => {
    const scene = sceneRef.current;
    if (!scene || !playback) return;
    const { THREE } = await ensureThree();

    if (visemeRafRef.current) {
      cancelAnimationFrame(visemeRafRef.current);
      visemeRafRef.current = 0;
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (_) {}
      audioRef.current = null;
    }

    const actions = actionsRef.current;
    const uniqueActions = [...new Set(Object.values(actions).filter(Boolean))];
    uniqueActions.forEach((a) => {
      try {
        a.fadeOut(0.2);
      } catch (_) {}
    });

    const catalog = playback.animationCatalog || avatar?.animation_catalog || [];
    const mouthName =
      playback.mouthClip ||
      (playback.visemes || []).map((v) => v?.name).find((n) => isMouthOrLipClipName(n)) ||
      (Array.isArray(catalog) ? catalog : []).map((c) => (typeof c === "string" ? c : c?.name)).find((n) => isMouthOrLipClipName(n));

    const mouthAction = mouthName ? resolveClipAction(actions, mouthName) : null;
    mouthActionRef.current = mouthAction;
    if (mouthAction) {
      mouthAction.reset();
      mouthAction.setLoop(THREE.LoopRepeat, Infinity);
      mouthAction.setEffectiveWeight(0);
      mouthAction.play();
    }

    const gestureClips = (Array.isArray(playback.animations) ? playback.animations : []).filter(
      (c) => c?.name && !isMouthOrLipClipName(c.name)
    );
    let started = 0;
    for (const clip of gestureClips) {
      const action = resolveClipAction(actions, clip?.name);
      if (!action || action === mouthAction) continue;
      action.reset();
      action.setEffectiveWeight(clip.weight != null ? clip.weight : 1);
      action.setEffectiveTimeScale(clip.timeScale != null ? clip.timeScale : 1);
      action.setLoop(clip.loop ? THREE.LoopRepeat : THREE.LoopOnce, clip.loop ? Infinity : 1);
      action.clampWhenFinished = !clip.loop;
      action.fadeIn(0.15).play();
      started += 1;
    }

    const preferredIdle =
      (avatar?.idle_clip && !isMouthOrLipClipName(avatar.idle_clip) ? avatar.idle_clip : null) ||
      (playback.idle && !isMouthOrLipClipName(playback.idle) ? playback.idle : null) ||
      pickIdleClipName(catalog, actions);
    const idleAction = preferredIdle ? resolveClipAction(actions, preferredIdle) : null;
    // Keep idle quiet during speech; gestures/mouth carry the response.
    if (idleAction && idleAction !== mouthAction) {
      idleAction.reset().setEffectiveWeight(0.15).setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
    }

    const restoreIdle = () => {
      // Always return to configured room idle — stop gestures/mouth first.
      uniqueActions.forEach((a) => {
        if (!a || a === idleAction) return;
        try {
          a.fadeOut(0.25);
          a.setEffectiveWeight(0);
        } catch (_) {}
      });
      if (mouthAction) {
        try {
          mouthAction.setEffectiveWeight(0);
          mouthAction.stop();
        } catch (_) {}
      }
      if (idleAction) {
        idleAction.reset().setEffectiveWeight(1).setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.3).play();
      }
    };

    if (playback.audioUrl) {
      try {
        const token = getAuthToken();
        const res = await fetch(authFetchUrl(playback.audioUrl), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        const visemes = playback.visemes || [];
        const tickVisemes = () => {
          if (!audioRef.current) return;
          const t = audioRef.current.currentTime || 0;
          if (mouthAction) {
            const w = visemes.length
              ? visemeWeightAt(visemes, t, mouthName)
              : Math.max(0, Math.sin(t * 12) * 0.5 + 0.45);
            mouthAction.setEffectiveWeight(w);
          }
          if (!audioRef.current.paused && !audioRef.current.ended) {
            visemeRafRef.current = requestAnimationFrame(tickVisemes);
          }
        };
        audio.onplay = () => {
          visemeRafRef.current = requestAnimationFrame(tickVisemes);
        };
        audio.onended = () => {
          if (visemeRafRef.current) cancelAnimationFrame(visemeRafRef.current);
          visemeRafRef.current = 0;
          restoreIdle();
        };
        audio.play().catch(() => {
          restoreIdle();
        });
        setTranscript((prev) => [...prev, { role: "avatar", text: "(speaking)", at: Date.now() }]);
      } catch (e) {
        console.warn("audio play failed", e);
        restoreIdle();
      }
    } else if (!started && idleAction) {
      idleAction.setEffectiveWeight(1).play();
    }

    if (!started && !idleAction && !mouthAction) {
      console.warn("[VirtualRoom] no clip actions matched", {
        requested: gestureClips.map((c) => c?.name),
        available: Object.keys(actions),
      });
    }
  }, [avatar]);

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    (async () => {
      try {
        let av;
        if (agentId) {
          const r = await api.avatarsByAgent(agentId);
          av = r.avatar;
        } else if (avatarIdParam) {
          const r = await api.avatarsGet(avatarIdParam);
          av = r.avatar;
        }
        if (!av) throw new Error('No avatar for this agent — assign one on Avatars page');
        if (cancelled) return;
        setAvatar(av);
        setStatus('Loading model…');

        const { THREE, GLTFLoader, OrbitControls } = await ensureThree();
        const el = mountRef.current;
        if (!el) return;
        const w = el.clientWidth || window.innerWidth;
        const h = el.clientHeight || window.innerHeight;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        el.innerHTML = '';
        el.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f1419);
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        camera.position.set(0, 1.4, 2.8);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 1, 0);
        controls.update();

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(2, 4, 3);
        scene.add(dir);

        const token = getAuthToken();
        const modelUrl = authFetchUrl(av.model_url);
        const modelRes = await fetch(modelUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!modelRes.ok) throw new Error(`Model download failed (${modelRes.status})`);
        const modelBuf = await modelRes.arrayBuffer();
        const loader = new GLTFLoader();
        const gltf = await new Promise((resolve, reject) => {
          loader.parse(modelBuf, '', resolve, reject);
        });
        scene.add(gltf.scene);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const scale = 1.6 / Math.max(size.y, 0.001);
        gltf.scene.scale.setScalar(scale);

        const mixer = new THREE.AnimationMixer(gltf.scene);
        mixersRef.current = [mixer];
        const actions = buildClipActions(mixer, gltf.animations || []);
        actionsRef.current = actions;
        const catalog = av.animation_catalog || [];
        const idleKey =
          (av.idle_clip && !isMouthOrLipClipName(av.idle_clip) ? av.idle_clip : null) ||
          pickIdleClipName(catalog, actions);
        const idleAction = idleKey ? resolveClipAction(actions, idleKey) : null;
        if (idleAction) {
          idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        } else if ((gltf.animations || []).length) {
          console.warn('[VirtualRoom] GLB has clips but none mapped for idle', {
            gltfNames: (gltf.animations || []).map((c) => c.name),
            catalog,
          });
        }

        sceneRef.current = { scene, camera, renderer, controls };
        clockRef.current = new THREE.Clock();
        setStatus('Ready');

        const tick = () => {
          raf = requestAnimationFrame(tick);
          const dt = clockRef.current?.getDelta() || 0.016;
          mixersRef.current.forEach((m) => m.update(dt));
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        const onResize = () => {
          const nw = el.clientWidth || window.innerWidth;
          const nh = el.clientHeight || window.innerHeight;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        };
        window.addEventListener('resize', onResize);
        sceneRef.current._cleanup = () => {
          window.removeEventListener('resize', onResize);
          cancelAnimationFrame(raf);
          renderer.dispose();
        };
      } catch (e) {
        if (!cancelled) {
          setError(e.message || String(e));
          setStatus('Error');
        }
      }
    })();
    return () => {
      cancelled = true;
      sceneRef.current?._cleanup?.();
    };
  }, [agentId, avatarIdParam]);

  async function startOutbound(text) {
    if (!avatar?.outbound_workflow_id) {
      setError('No outbound workflow — assign an agent on Avatars page');
      return;
    }
    setStatus('Running outbound…');
    setTranscript((t) => [...t, { role: 'user', text, at: Date.now() }]);
    try {
      const run = await api.agentWorkflowRun(avatar.outbound_workflow_id, { trigger: 'manual', input: text });
      const runId = run.id || run.run_id;
      let final = run;
      let played = false;
      let transcriptAdded = false;
      // Poll fast; start audio as soon as model3d completes (don't wait for run end).
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 400));
        final = await api.agentWorkflowRunGet(runId);
        const agentStep = (final.steps || []).find((s) => s.node_type === 'agent' && s.status === 'completed');
        if (agentStep?.output?.text && !transcriptAdded) {
          transcriptAdded = true;
          const spoken = extractSpokenAvatarReply(agentStep.output.text) || agentStep.output.text;
          setTranscript((t) => [...t, { role: 'avatar', text: spoken, at: Date.now() }]);
          setStatus('Speaking…');
        }
        const step = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
        const playback = step?.output?.playback || step?.output?.result;
        if (playback?.audioUrl && !played) {
          played = true;
          await playPlayback(playback);
        }
        if (final.status === 'completed' || final.status === 'failed') break;
      }
      if (final.status === 'failed') throw new Error(final.error_message || 'Outbound run failed');
      if (!played) {
        const step = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
        const playback = step?.output?.playback || step?.output?.result;
        if (playback) await playPlayback(playback);
      }
      setStatus('Ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('Error');
    }
  }

  async function runInboundFromBlob(blob) {
    if (!avatar?.inbound_workflow_id) {
      setError('No inbound workflow — assign an agent first');
      return;
    }
    setStatus('Uploading voice…');
    try {
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const art = await api.mediaArtifactsUpload({
        filename: 'voice.webm',
        mimeType: blob.type || 'audio/webm',
        kind: 'audio',
        contentBase64: btoa(binary),
      });
      const media = art.artifact;
      setTranscript((t) => [...t, { role: 'user', text: '(voice message)', at: Date.now() }]);
      setStatus('Running inbound…');
      const run = await api.agentWorkflowRun(avatar.inbound_workflow_id, {
        trigger: 'event',
        input: media,
      });
      const runId = run.id || run.run_id;
      let final = run;
      let played = false;
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 400));
        final = await api.agentWorkflowRunGet(runId);
        const agentStep = (final.steps || []).find((s) => s.node_type === 'agent' && s.status === 'completed');
        if (agentStep?.output?.text) {
          const spoken = extractSpokenAvatarReply(agentStep.output.text) || agentStep.output.text;
          setTranscript((t) => {
            if (t.some((x) => x.role === 'avatar' && x.text === spoken)) return t;
            return [...t, { role: 'avatar', text: spoken, at: Date.now() }];
          });
          setStatus('Speaking…');
        }
        let playback = null;
        for (const s of final.steps || []) {
          if (s.node_type === 'model3d' && s.status === 'completed') {
            const p = s.output?.playback || s.output?.result;
            if (p?.audioUrl || p?.modelUrl) playback = p;
          }
        }
        if (playback?.audioUrl && !played) {
          played = true;
          await playPlayback(playback);
        }
        if (final.status === 'completed' || final.status === 'failed') break;
      }
      if (final.status === 'failed') throw new Error(final.error_message || 'Inbound run failed');
      if (!played) {
        let playback = null;
        for (const s of final.steps || []) {
          const p = s.output?.playback || s.output?.result?.playback || s.output?.result;
          if (p?.modelUrl || p?.audioUrl) playback = p;
        }
        if (!playback && avatar.outbound_workflow_id) {
          const runs = await api.agentWorkflowRunsForDef(avatar.outbound_workflow_id, 1);
          const last = (runs.runs || runs || [])[0];
          if (last?.id) {
            const detail = await api.agentWorkflowRunGet(last.id);
            const step = (detail.steps || []).find((s) => s.node_type === 'model3d');
            playback = step?.output?.playback || step?.output?.result;
          }
        }
        if (playback) await playPlayback(playback);
      }
      setStatus('Ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('Error');
    }
  }

  async function toggleRecord() {
    if (recording) {
      mediaRecRef.current?.stop();
      setRecording(false);
      return;
    }
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
        runInboundFromBlob(blob);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
    } catch (e) {
      setError(e.message || 'Microphone unavailable');
    }
  }

  const [typed, setTyped] = useState('');

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#0f1419', color: '#e8eaed', zIndex: 50 }}>
      <div ref={mountRef} style={{ flex: 1, minWidth: 0, position: 'relative' }} />
      <aside
        style={{
          width: 340,
          maxWidth: '40vw',
          borderLeft: '1px solid #2a3139',
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          gap: 8,
          background: '#151b22',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Virtual Room</strong>
          <Link to="/avatars" style={{ color: '#93c5fd' }}>
            Exit
          </Link>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {avatar?.name || '…'} · {status}
        </div>
        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
        <div style={{ flex: 1, overflow: 'auto', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {transcript.map((m, i) => (
            <div key={i} style={{ opacity: m.role === 'user' ? 0.9 : 1 }}>
              <b>{m.role === 'user' ? 'You' : 'Avatar'}:</b> {m.text}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type a message…"
            style={{ flex: 1, padding: 8, borderRadius: 6, border: '1px solid #333', background: '#0f1419', color: 'inherit' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && typed.trim()) {
                startOutbound(typed.trim());
                setTyped('');
              }
            }}
          />
          <button type="button" onClick={() => typed.trim() && (startOutbound(typed.trim()), setTyped(''))}>
            Send
          </button>
        </div>
        <button type="button" onClick={toggleRecord} style={{ padding: 10, background: recording ? '#b91c1c' : '#2563eb', color: '#fff', border: 0, borderRadius: 8 }}>
          {recording ? 'Stop & send voice' : 'Hold mic (click to record)'}
        </button>
      </aside>
    </div>
  );
}
