/**
 * Guest public Virtual Room — no auth; session-local chat only.
 * Plays TTS + lip/gesture animation on the routed avatar.
 */
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, resolveFetchUrl } from '../api';

async function ensureThree() {
  if (window.__THREE__) return window.__THREE__;
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  window.__THREE__ = { THREE, GLTFLoader, OrbitControls };
  return window.__THREE__;
}

function transcriptKey(slug) {
  return `ao-public-vr-chat:${slug}`;
}

function loadSessionTranscript(slug) {
  try {
    const raw = sessionStorage.getItem(transcriptKey(slug));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessionTranscript(slug, rows) {
  try {
    sessionStorage.setItem(transcriptKey(slug), JSON.stringify(rows.slice(-80)));
  } catch {
    /* ignore quota */
  }
}

function buildClipActions(mixer, gltfAnimations = []) {
  const actions = {};
  (Array.isArray(gltfAnimations) ? gltfAnimations : []).forEach((clip, i) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    const raw = String(clip.name || '').trim();
    const aliases = new Set([`Animation_${i}`, `animation_${i}`]);
    if (raw) aliases.add(raw);
    for (const key of aliases) {
      if (key === '' || !actions[key]) actions[key] = action;
    }
  });
  return actions;
}

function isMouthOrLipClipName(name) {
  return /mouth|lip|viseme|jaw|phoneme/i.test(String(name || ''));
}

function isIdleLikeClipName(name) {
  return /idle|blink|breathe|look[_ -]?around|stand|rest/i.test(String(name || ''));
}

function resolveClipAction(actions, name) {
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
  return null;
}

function pickIdleClipName(catalog = [], actions = {}) {
  const names = (Array.isArray(catalog) ? catalog : [])
    .map((c) => (typeof c === 'string' ? c : c?.name))
    .map((n) => String(n || '').trim())
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
      name: String(v.name || v.viseme || '').trim(),
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
    const open = /[aeiouAEIOU]/.test(cur.name) || /open|wide/i.test(cur.name);
    return open ? 0.85 : 0.1;
  }
  if (cur.weight != null && Number.isFinite(cur.weight)) return Math.max(0, Math.min(1, cur.weight));
  return isMouthOrLipClipName(cur.name) ? 0.8 : 0.15;
}

export default function PublicVirtualRoom() {
  const { slug } = useParams();
  const canvasHostRef = useRef(null);
  const membersRuntimeRef = useRef({});
  const mixersRef = useRef([]);
  const audioByAvatarRef = useRef({});
  const visemeRafByAvatarRef = useRef({});
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Loading…');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState(() => loadSessionTranscript(slug));

  useEffect(() => {
    setTranscript(loadSessionTranscript(slug));
  }, [slug]);

  useEffect(() => {
    saveSessionTranscript(slug, transcript);
  }, [slug, transcript]);

  useEffect(() => {
    let cancelled = false;
    let renderer;
    let animId;
    let resizeObs;

    (async () => {
      try {
        setStatus('Loading scene…');
        const { room: data } = await api.publicVrGet(slug);
        if (cancelled) return;
        setRoom(data);

        const host = canvasHostRef.current;
        if (!host) return;
        const { THREE, GLTFLoader, OrbitControls } = await ensureThree();
        const width = host.clientWidth || 640;
        const height = host.clientHeight || 420;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1e293b);
        const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
        camera.position.set(0, 1.6, 4.2);
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height);
        host.innerHTML = '';
        host.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 1, 0);
        controls.enablePan = false;
        controls.update();

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(2, 4, 3);
        scene.add(dir);

        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(6, 48),
          new THREE.MeshStandardMaterial({ color: 0x0e293b, roughness: 0.9 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        const loader = new GLTFLoader();
        async function loadGlb(url) {
          const modelRes = await fetch(resolveFetchUrl(url));
          if (!modelRes.ok) throw new Error(`Model download failed (${modelRes.status})`);
          const modelBuf = await modelRes.arrayBuffer();
          return new Promise((resolve, reject) => loader.parse(modelBuf, '', resolve, reject));
        }

        if (data.scene?.model_url) {
          try {
            const gltf = await loadGlb(data.scene.model_url);
            scene.add(gltf.scene);
            floor.visible = false;
          } catch (e) {
            console.warn('[PublicVR] scene load failed', e?.message || e);
          }
        }

        membersRuntimeRef.current = {};
        mixersRef.current = [];
        const members = data.members || [];
        for (let i = 0; i < members.length; i += 1) {
          const m = members[i];
          if (!m.model_url) continue;
          try {
            const gltf = await loadGlb(m.model_url);
            const root = gltf.scene;
            const box = new THREE.Box3().setFromObject(root);
            const size = box.getSize(new THREE.Vector3());
            const scale = 1.6 / Math.max(size.y, 0.001);
            root.scale.setScalar(scale);
            const pos = m.position || {
              x: i * 1.4 - (members.length - 1) * 0.7,
              y: 0,
              z: 0,
            };
            root.position.set(Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0);
            scene.add(root);

            const mixer = new THREE.AnimationMixer(root);
            const actions = buildClipActions(mixer, gltf.animations || []);
            mixersRef.current.push(mixer);
            const catalog = m.animation_catalog || [];
            const idleName = (m.idle_clip && !isMouthOrLipClipName(m.idle_clip) ? m.idle_clip : null) || pickIdleClipName(catalog, actions);
            const idleAction = idleName ? resolveClipAction(actions, idleName) : null;
            if (idleAction) {
              idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
            }
            membersRuntimeRef.current[m.avatar_id] = {
              avatarId: m.avatar_id,
              handle: m.handle,
              root,
              mixer,
              actions,
              idleClip: idleName,
              catalog,
            };
          } catch (e) {
            console.warn('[PublicVR] avatar load failed', m.handle, e?.message || e);
          }
        }

        const clock = new THREE.Clock();
        const tick = () => {
          animId = requestAnimationFrame(tick);
          const dt = clock.getDelta();
          mixersRef.current.forEach((mx) => mx.update(dt));
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        const onResize = () => {
          if (!host || !renderer) return;
          const w = host.clientWidth || 640;
          const h = host.clientHeight || 420;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        };
        resizeObs = new ResizeObserver(onResize);
        resizeObs.observe(host);
        setStatus('Ready — say hi or @mention a member');
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Failed to load room');
          setStatus('');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (animId) cancelAnimationFrame(animId);
      Object.values(visemeRafByAvatarRef.current || {}).forEach((id) => {
        try {
          cancelAnimationFrame(id);
        } catch (_) {}
      });
      Object.values(audioByAvatarRef.current || {}).forEach((a) => {
        try {
          a.pause();
        } catch (_) {}
      });
      try {
        resizeObs?.disconnect();
      } catch (_) {}
      try {
        renderer?.dispose?.();
      } catch (_) {}
    };
  }, [slug]);

  async function playPlayback(playback, avatarId) {
    if (!playback) return;
    const { THREE } = await ensureThree();
    const runtime =
      membersRuntimeRef.current[avatarId] ||
      membersRuntimeRef.current[playback.avatarId] ||
      Object.values(membersRuntimeRef.current)[0];
    if (!runtime) {
      // Fallback: audio only
      if (playback.audioUrl) {
        try {
          const abs = resolveFetchUrl(playback.audioUrl);
          const audio = new Audio(abs);
          await audio.play();
        } catch (e) {
          console.warn('[PublicVR] audio play failed', e?.message || e);
        }
      }
      return;
    }

    const avatarKey = runtime.avatarId;
    if (visemeRafByAvatarRef.current[avatarKey]) {
      cancelAnimationFrame(visemeRafByAvatarRef.current[avatarKey]);
      delete visemeRafByAvatarRef.current[avatarKey];
    }
    if (audioByAvatarRef.current[avatarKey]) {
      try {
        audioByAvatarRef.current[avatarKey].pause();
      } catch (_) {}
      delete audioByAvatarRef.current[avatarKey];
    }

    const actions = runtime.actions || {};
    const uniqueActions = [...new Set(Object.values(actions).filter(Boolean))];
    uniqueActions.forEach((a) => {
      try {
        a.fadeOut(0.2);
      } catch (_) {}
    });

    const catalog = playback.animationCatalog || runtime.catalog || [];
    const mouthName =
      playback.mouthClip ||
      (playback.visemes || []).map((v) => v?.name).find((n) => isMouthOrLipClipName(n)) ||
      (Array.isArray(catalog) ? catalog : [])
        .map((c) => (typeof c === 'string' ? c : c?.name))
        .find((n) => isMouthOrLipClipName(n));
    const mouthAction = mouthName ? resolveClipAction(actions, mouthName) : null;
    if (mouthAction) {
      mouthAction.reset();
      mouthAction.setLoop(THREE.LoopRepeat, Infinity);
      mouthAction.setEffectiveWeight(0);
      mouthAction.play();
    }

    const gestureClips = (Array.isArray(playback.animations) ? playback.animations : []).filter(
      (c) => c?.name && !isMouthOrLipClipName(c.name)
    );
    for (const clip of gestureClips) {
      const action = resolveClipAction(actions, clip?.name);
      if (!action || action === mouthAction) continue;
      action.reset();
      action.setEffectiveWeight(clip.weight != null ? clip.weight : 1);
      action.setEffectiveTimeScale(clip.timeScale != null ? clip.timeScale : 1);
      action.setLoop(clip.loop ? THREE.LoopRepeat : THREE.LoopOnce, clip.loop ? Infinity : 1);
      action.clampWhenFinished = !clip.loop;
      action.fadeIn(0.15).play();
    }

    const preferredIdle =
      (runtime.idleClip && !isMouthOrLipClipName(runtime.idleClip) ? runtime.idleClip : null) ||
      (playback.idle && !isMouthOrLipClipName(playback.idle) ? playback.idle : null) ||
      pickIdleClipName(catalog, actions);
    const idleAction = preferredIdle ? resolveClipAction(actions, preferredIdle) : null;
    if (idleAction && idleAction !== mouthAction) {
      idleAction.reset().setEffectiveWeight(0.15).setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.15).play();
    }

    const restoreIdle = () => {
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
        const abs = resolveFetchUrl(playback.audioUrl);
        const res = await fetch(abs);
        if (!res.ok) throw new Error(`audio fetch ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioByAvatarRef.current[avatarKey] = audio;
        const visemes = playback.visemes || [];
        const tickVisemes = () => {
          const a = audioByAvatarRef.current[avatarKey];
          if (!a) return;
          const t = a.currentTime || 0;
          if (mouthAction) {
            const w = visemes.length
              ? visemeWeightAt(visemes, t, mouthName)
              : Math.max(0, Math.sin(t * 12) * 0.5 + 0.45);
            mouthAction.setEffectiveWeight(w);
          }
          if (!a.paused && !a.ended) {
            visemeRafByAvatarRef.current[avatarKey] = requestAnimationFrame(tickVisemes);
          }
        };
        audio.onplay = () => {
          visemeRafByAvatarRef.current[avatarKey] = requestAnimationFrame(tickVisemes);
        };
        audio.onended = () => {
          if (visemeRafByAvatarRef.current[avatarKey]) {
            cancelAnimationFrame(visemeRafByAvatarRef.current[avatarKey]);
            delete visemeRafByAvatarRef.current[avatarKey];
          }
          restoreIdle();
        };
        await audio.play().catch(() => restoreIdle());
      } catch (e) {
        console.warn('[PublicVR] audio play failed', e?.message || e);
        restoreIdle();
      }
    } else if (idleAction) {
      idleAction.setEffectiveWeight(1).play();
    }
  }

  async function onSend(e) {
    e?.preventDefault?.();
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    setInput('');
    setTranscript((t) => [...t, { role: 'user', text, at: Date.now() }]);
    setStatus('Thinking…');
    try {
      const reply = await api.publicVrChat(slug, { text });
      setTranscript((t) => [
        ...t,
        {
          role: 'avatar',
          text: reply.transcript || reply.text || reply.spoken || '(no reply)',
          handle: reply.handle,
          at: Date.now(),
        },
      ]);
      if (reply.source) {
        setStatus(`Routed (${reply.source}): @${reply.handle || 'member'}`);
      }
      if (reply.playback) {
        await playPlayback(reply.playback, reply.avatar_id);
      }
      setStatus('Ready');
    } catch (err) {
      setError(err.message || String(err));
      setStatus('Error');
    } finally {
      setBusy(false);
    }
  }

  const handles = (room?.members || []).map((m) => m.handle).filter(Boolean);

  return (
    <div className="public-vr">
      <header className="public-vr-header">
        <div>
          <div className="public-vr-brand">Flolah</div>
          <h1 className="public-vr-title">{room?.name || 'Published Scene'}</h1>
        </div>
        {handles.length > 0 && (
          <div className="public-vr-handles">
            {handles.map((h) => (
              <button
                key={h}
                type="button"
                className="public-vr-handle"
                onClick={() => setInput((v) => (v.startsWith('@') ? v : `@${h} `))}
              >
                @{h}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="public-vr-body">
        <div className="public-vr-canvas" ref={canvasHostRef} />
        <aside className="public-vr-chat">
          {status && <div className="public-vr-status">{status}</div>}
          {error && <div className="public-vr-error">{error}</div>}
          <div className="public-vr-transcript">
            {transcript.map((m, i) => (
              <div key={i} className={`public-vr-msg public-vr-msg--${m.role}`}>
                <b>{m.role === 'user' ? 'You' : `@${m.handle || 'avatar'}`}:</b> {m.text}
              </div>
            ))}
            {!transcript.length && (
              <div className="public-vr-mute">
                Chat stays in this browser tab only — nothing is saved to the host account.
              </div>
            )}
          </div>
          <form className="public-vr-compose" onSubmit={onSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                handles.length > 1
                  ? 'Type @ to pick, or send to auto-route…'
                  : 'Say something…'
              }
              disabled={busy || !room}
              aria-label="Message"
            />
            <button type="submit" disabled={busy || !input.trim() || !room}>
              Send
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}