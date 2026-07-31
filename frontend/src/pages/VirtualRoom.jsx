import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, getAuthToken, resolveFetchUrl } from '../api';
import { extractSpokenAvatarReply, extractAvatarTranscriptReply } from '../utils/avatarSpeakText.js';
import {
  extractMediaUrlsFromText,
  normalizeMediaUrl,
} from '../utils/resolveMediaSrc.js';

async function ensureThree() {
  if (window.__THREE__) return window.__THREE__;
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  window.__THREE__ = { THREE, GLTFLoader, OrbitControls };
  return window.__THREE__;
}

function authFetchUrl(path) {
  return resolveFetchUrl(path);
}

function applyTextureToMesh(mesh, tex, THREE) {
  if (tex && THREE?.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  if (tex) tex.needsUpdate = true;
  const prev = mesh.material.map;
  mesh.material.map = tex;
  mesh.material.color.setHex(0xffffff);
  mesh.material.needsUpdate = true;
  if (prev && prev !== tex) {
    try {
      prev.dispose();
    } catch (_) {}
  }
}

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
  return /mouth|lip|viseme|jaw|phoneme/i.test(String(name || ''));
}

function isIdleLikeClipName(name) {
  return /idle|blink|breathe|look[_ -]?around|stand|rest/i.test(String(name || ''));
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

function parseMention(text, members) {
  const raw = String(text || '').trim();
  const m = raw.match(/^@([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (m) {
    const handle = m[1].toLowerCase();
    const member = (members || []).find((x) => String(x.handle || '').toLowerCase() === handle);
    return { handle: m[1], member: member || null, body: String(m[2] || '').trim() || raw };
  }
  return { handle: null, member: null, body: raw };
}

function slotTransform(slot, THREE) {
  const pos = slot?.position || [0, 1.2, -1.5];
  const rot = slot?.rotation || [0, 0, 0];
  const scale = slot?.scale || [1.6, 0.9, 1];
  return {
    position: new THREE.Vector3(Number(pos[0]) || 0, Number(pos[1]) || 1.2, Number(pos[2]) || -1.5),
    rotation: new THREE.Euler(Number(rot[0]) || 0, Number(rot[1]) || 0, Number(rot[2]) || 0),
    scale: new THREE.Vector3(Number(scale[0]) || 1.6, Number(scale[1]) || 0.9, Number(scale[2]) || 1),
  };
}

function drawChartToCanvas(spec) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#e2e8f0';
  ctx.font = '16px sans-serif';
  const title = spec?.title || spec?.name || 'Chart';
  ctx.fillText(String(title).slice(0, 48), 16, 28);

  const type = String(spec?.type || spec?.chartType || spec?.kind || '').toLowerCase();
  const labels =
    (Array.isArray(spec?.labels) && spec.labels) ||
    (Array.isArray(spec?.categories) && spec.categories) ||
    null;
  let pts = [];
  if (Array.isArray(spec?.values) && labels && labels.length === spec.values.length) {
    pts = labels.map((lab, i) => ({
      label: String(lab),
      y: Number(spec.values[i]) || 0,
    }));
  } else if (Array.isArray(spec?.values) && spec.values.every((v) => v && typeof v === 'object')) {
    pts = spec.values.map((v, i) => ({
      label: String(v.label ?? v.name ?? v.x ?? i + 1),
      y: Number(v.value ?? v.y ?? v[1] ?? 0),
    }));
  } else {
    const series =
      spec?.series?.[0]?.data ||
      spec?.data ||
      spec?.points ||
      (Array.isArray(spec?.values) ? spec.values.map((v, i) => ({ x: i, y: Number(v) || 0 })) : null) ||
      [];
    pts = (Array.isArray(series) ? series : []).map((p, i) => ({
      label: String(p.label ?? p.name ?? p.x ?? i + 1),
      y: Number(p.y ?? p[1] ?? p.value ?? 0),
    }));
  }

  if (!pts.length) {
    ctx.fillText('No chart data', 16, 60);
    return canvas;
  }

  const wantPie =
    type === 'pie' ||
    type === 'doughnut' ||
    /pie/i.test(String(title)) ||
    (Boolean(labels) && pts.length >= 2 && pts.length <= 16 && !/line|bar|trend/i.test(type));

  if (wantPie) {
    const total = pts.reduce((s, p) => s + Math.max(0, p.y), 0) || 1;
    const cx = 220;
    const cy = 200;
    const r = 110;
    const colors = ['#38bdf8', '#f472b6', '#a3e635', '#fbbf24', '#c084fc', '#fb7185', '#2dd4bf', '#60a5fa', '#f97316', '#94a3b8'];
    let angle = -Math.PI / 2;
    pts.forEach((p, i) => {
      const slice = (Math.max(0, p.y) / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      angle += slice;
    });
    let ly = 56;
    pts.forEach((p, i) => {
      const pct = ((Math.max(0, p.y) / total) * 100).toFixed(1);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(360, ly - 10, 12, 12);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '13px sans-serif';
      ctx.fillText(`${String(p.label).slice(0, 18)} ${pct}%`, 380, ly);
      ly += 20;
    });
    return canvas;
  }

  const ys = pts.map((p) => p.y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const pad = { l: 40, r: 16, t: 48, b: 36 };
  const w = canvas.width - pad.l - pad.r;
  const h = canvas.height - pad.t - pad.b;
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, pad.t + h);
  ctx.lineTo(pad.l + w, pad.t + h);
  ctx.stroke();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = pad.l + (i / Math.max(pts.length - 1, 1)) * w;
    const y = pad.t + h - ((p.y - minY) / (maxY - minY || 1)) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  return canvas;
}
export default function VirtualRoom() {
  const { agentId, avatarId: avatarIdParam, roomId: roomIdParam } = useParams();
  const nav = useNavigate();
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const membersRuntimeRef = useRef({});
  const overlaysRef = useRef({});
  const cardStackElsRef = useRef({});
  const dragRef = useRef(null);
  const layoutTimerRef = useRef(0);
  const [room, setRoom] = useState(null);
  const [scenes, setScenes] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [status, setStatus] = useState('Loading…');
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [typed, setTyped] = useState('');
  /** Closable HTML media cards pinned to an avatar (newest first). */
  const [avatarCards, setAvatarCards] = useState([]);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const mixersRef = useRef([]);
  const clockRef = useRef(null);
  /** Per-avatar lip-sync RAF ids and Audio elements so multi-member runs can speak in parallel. */
  const visemeRafByAvatarRef = useRef({});
  const audioByAvatarRef = useRef({});
  const roomIdRef = useRef(null);

  const closeAvatarCard = useCallback((cardId) => {
    setAvatarCards((prev) => {
      const card = prev.find((c) => c.id === cardId);
      if (card?.displayUrl?.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(card.displayUrl);
        } catch (_) {}
      }
      return prev.filter((c) => c.id !== cardId);
    });
  }, []);

  const pushAvatarCard = useCallback(async ({ avatarId, handle, kind, url, chart, slotId }) => {
    if (!avatarId) return;
    let displayUrl = null;
    let mediaKind = String(kind || 'image').toLowerCase();
    let sourceUrl = url ? normalizeMediaUrl(url) : null;
    try {
      if (mediaKind === 'image' || mediaKind === 'video') {
        if (!sourceUrl) return;
        const token = getAuthToken();
        const res = await fetch(authFetchUrl(sourceUrl), {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`media fetch ${res.status} for ${sourceUrl.slice(0, 80)}`);
        const blob = await res.blob();
        displayUrl = URL.createObjectURL(blob);
        if (blob.type.startsWith('video/')) mediaKind = 'video';
        else if (blob.type.startsWith('image/')) mediaKind = 'image';
      } else {
        const canvas = drawChartToCanvas(chart || {});
        displayUrl = canvas.toDataURL('image/png');
        mediaKind = 'chart';
      }
    } catch (e) {
      console.warn('[VirtualRoom] avatar card load failed', e?.message || e);
      return;
    }

    setAvatarCards((prev) => {
      if (sourceUrl && prev.some((c) => c.avatarId === avatarId && c.sourceUrl === sourceUrl)) {
        try {
          if (displayUrl?.startsWith('blob:')) URL.revokeObjectURL(displayUrl);
        } catch (_) {}
        return prev;
      }
      const card = {
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        avatarId,
        handle: handle || '',
        kind: mediaKind,
        displayUrl,
        sourceUrl,
        slotId: slotId || null,
        createdAt: Date.now(),
      };
      console.info('[VirtualRoom] avatar media card', {
        avatarId,
        kind: mediaKind,
        url: (sourceUrl || '').slice(0, 96),
      });
      // Newest on top of the stack
      return [card, ...prev];
    });
  }, []);

  const applySceneOutputs = useCallback(
    async (sceneOutputs, sceneJson, anchorAvatarId = null) => {
      const { THREE } = await ensureThree();
      const three = sceneRef.current;
      if (!three?.scene) return;
      const slots = Array.isArray(sceneJson?.mediaSlots) ? sceneJson.mediaSlots : [];
      const list = Array.isArray(sceneOutputs) ? sceneOutputs : [];
      const member = (room?.members || []).find((m) => m.avatar_id === anchorAvatarId);

      for (const out of list) {
        if (!out || typeof out !== 'object') continue;
        const slotId = String(out.slotId || out.slot_id || 'panel');
        const kind = String(out.kind || 'chart').toLowerCase();
        const matchedSlot = slots.find((s) => String(s.id) === slotId);
        // Images/videos for a speaking avatar always become closable HTML cards (never reshuffle into scene planes).
        const useAvatarCard =
          !!anchorAvatarId &&
          (out.anchor === 'avatar' ||
            kind === 'image' ||
            kind === 'video' ||
            !matchedSlot);

        const payload = out.payload || {};
        if (useAvatarCard) {
          const rawUrl = payload.url || payload.mediaUrl || payload.src;
          const chartPayload =
            payload.chart ||
            payload.spec ||
            (Array.isArray(payload.values) || Array.isArray(payload.labels) || Array.isArray(payload.series)
              ? payload
              : null);
          const hasChartData =
            chartPayload &&
            (Array.isArray(chartPayload.values) ||
              Array.isArray(chartPayload.data) ||
              Array.isArray(chartPayload.series) ||
              Array.isArray(chartPayload.labels));
          // Skip empty Brain placeholders (e.g. kind:video/graph with no url/chart).
          if (!rawUrl && !hasChartData) continue;
          await pushAvatarCard({
            avatarId: anchorAvatarId,
            handle: member?.handle,
            kind,
            url: rawUrl || null,
            chart: hasChartData ? chartPayload : null,
            slotId,
          });
          continue;
        }

        // Explicit scene mediaSlots only (3D planes in the environment).
        if (!matchedSlot) continue;
        const xf = slotTransform(matchedSlot, THREE);
        const overlayKey = `scene:${slotId}`;
        let mesh = overlaysRef.current[overlayKey];
        if (!mesh) {
          const geo = new THREE.PlaneGeometry(1, 1);
          const mat = new THREE.MeshBasicMaterial({ color: 0x111827, side: THREE.DoubleSide });
          mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(xf.position);
          mesh.rotation.copy(xf.rotation);
          mesh.scale.copy(xf.scale);
          three.scene.add(mesh);
          overlaysRef.current[overlayKey] = mesh;
        } else {
          mesh.position.copy(xf.position);
          mesh.rotation.copy(xf.rotation);
          mesh.scale.copy(xf.scale);
        }
        try {
          if (kind === 'video' || kind === 'image') {
            const rawUrl = payload.url || payload.mediaUrl || payload.src;
            if (!rawUrl) continue;
            const url = normalizeMediaUrl(String(rawUrl));
            const token = getAuthToken();
            const res = await fetch(authFetchUrl(url), {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) throw new Error(`media fetch ${res.status} for ${url.slice(0, 80)}`);
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            if (kind === 'video' || blob.type.startsWith('video/')) {
              const video = document.createElement('video');
              video.src = objUrl;
              video.crossOrigin = 'anonymous';
              video.muted = true;
              video.playsInline = true;
              video.loop = true;
              await video.play().catch(() => {});
              applyTextureToMesh(mesh, new THREE.VideoTexture(video), THREE);
            } else {
              const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('image decode failed'));
                i.src = objUrl;
              });
              applyTextureToMesh(mesh, new THREE.Texture(img), THREE);
            }
          } else {
            const canvas = drawChartToCanvas(payload.chart || payload.spec || payload);
            applyTextureToMesh(mesh, new THREE.CanvasTexture(canvas), THREE);
          }
        } catch (e) {
          console.warn('[VirtualRoom] scene slot apply failed', slotId, e?.message || e);
        }
      }
    },
    [pushAvatarCard, room?.members]
  );

  const playPlayback = useCallback(
    async (playback, memberAvatarId) => {
      const scene = sceneRef.current;
      if (!scene || !playback) return;
      const { THREE } = await ensureThree();
      const runtime =
        membersRuntimeRef.current[memberAvatarId] ||
        membersRuntimeRef.current[playback.avatarId] ||
        Object.values(membersRuntimeRef.current)[0];
      if (!runtime) return;

      if (visemeRafByAvatarRef.current[runtime.avatarId]) {
        cancelAnimationFrame(visemeRafByAvatarRef.current[runtime.avatarId]);
        delete visemeRafByAvatarRef.current[runtime.avatarId];
      }
      if (audioByAvatarRef.current[runtime.avatarId]) {
        try {
          audioByAvatarRef.current[runtime.avatarId].pause();
        } catch (_) {}
        delete audioByAvatarRef.current[runtime.avatarId];
      }

      const actions = runtime.actions || {};
      const uniqueActions = [...new Set(Object.values(actions).filter(Boolean))];
      uniqueActions.forEach((a) => {
        try {
          a.fadeOut(0.2);
        } catch (_) {}
      });

      const member = (room?.members || []).find((m) => m.avatar_id === runtime.avatarId);
      const catalog = playback.animationCatalog || member?.animation_catalog || [];
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
        (member?.idle_clip && !isMouthOrLipClipName(member.idle_clip) ? member.idle_clip : null) ||
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

      if (playback.sceneOutputs?.length) {
        await applySceneOutputs(playback.sceneOutputs, room?.scene?.scene_json || {}, runtime.avatarId);
      }

      if (playback.audioUrl) {
        try {
          const token = getAuthToken();
          const res = await fetch(authFetchUrl(playback.audioUrl), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`audio fetch ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          const avatarKey = runtime.avatarId;
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
          audio.play().catch(() => restoreIdle());
        } catch (e) {
          console.warn('audio play failed', e);
          restoreIdle();
        }
      } else if (!started && idleAction) {
        idleAction.setEffectiveWeight(1).play();
      }
    },
    [room, applySceneOutputs]
  );

  function scheduleLayoutSave(avatarId, position) {
    const rid = roomIdRef.current;
    if (!rid) return;
    if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    layoutTimerRef.current = setTimeout(() => {
      api
        .vrRoomsPatchLayout(rid, {
          members: { [avatarId]: { x: position.x, y: position.y, z: position.z } },
        })
        .catch((e) => console.warn('[VirtualRoom] layout save failed', e?.message || e));
    }, 400);
  }

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    (async () => {
      try {
        let roomData = null;
        if (roomIdParam) {
          const r = await api.vrRoomsGet(roomIdParam);
          roomData = r.room;
        } else if (agentId) {
          const r = await api.vrRoomsByAgent(agentId);
          roomData = r.room;
          if (roomData?.id && !cancelled) nav(`/vr-rooms/${roomData.id}`, { replace: true });
        } else if (avatarIdParam) {
          const av = await api.avatarsGet(avatarIdParam);
          if (av.avatar?.agent_id) {
            const r = await api.vrRoomsByAgent(av.avatar.agent_id);
            roomData = r.room;
            if (roomData?.id && !cancelled) nav(`/vr-rooms/${roomData.id}`, { replace: true });
          } else {
            roomData = {
              id: null,
              name: `${av.avatar?.name || 'Avatar'} preview`,
              scene_id: null,
              scene: null,
              members: [
                {
                  avatar_id: av.avatar.id,
                  handle: 'preview',
                  name: av.avatar.name,
                  model_url: av.avatar.model_url,
                  animation_catalog: av.avatar.animation_catalog || [],
                  idle_clip: av.avatar.idle_clip,
                  outbound_workflow_id: null,
                  inbound_workflow_id: null,
                  position: { x: 0, y: 0, z: 0 },
                },
              ],
            };
          }
        }
        if (!roomData) throw new Error('Room not found');
        if (cancelled) return;
        roomIdRef.current = roomData.id;
        setRoom(roomData);
        const sc = await api.vrScenesList().catch(() => ({ scenes: [] }));
        if (!cancelled) setScenes(sc.scenes || []);
        setStatus('Loading models…');

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
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
        camera.position.set(0, 1.6, 4.5);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 1, 0);
        controls.update();

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const dir = new THREE.DirectionalLight(0xffffff, 0.9);
        dir.position.set(2, 4, 3);
        scene.add(dir);

        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(6, 48),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        const token = getAuthToken();
        const loader = new GLTFLoader();
        const envRoot = new THREE.Group();
        envRoot.name = 'vr-environment';
        scene.add(envRoot);

        async function loadGlb(url) {
          const modelRes = await fetch(authFetchUrl(url), {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!modelRes.ok) throw new Error(`Model download failed (${modelRes.status})`);
          const modelBuf = await modelRes.arrayBuffer();
          return new Promise((resolve, reject) => loader.parse(modelBuf, '', resolve, reject));
        }

        if (roomData.scene?.model_url) {
          try {
            const gltf = await loadGlb(roomData.scene.model_url);
            envRoot.clear();
            envRoot.add(gltf.scene);
            floor.visible = false;
          } catch (e) {
            console.warn('[VirtualRoom] scene load failed', e);
          }
        }

        membersRuntimeRef.current = {};
        mixersRef.current = [];
        const members = roomData.members || [];
        for (let i = 0; i < members.length; i += 1) {
          const m = members[i];
          if (!m.model_url) continue;
          const gltf = await loadGlb(m.model_url);
          const root = gltf.scene;
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const scale = 1.6 / Math.max(size.y, 0.001);
          root.scale.setScalar(scale);
          const pos = m.position || { x: i * 1.4 - (members.length - 1) * 0.7, y: 0, z: 0 };
          root.position.set(Number(pos.x) || 0, Number(pos.y) || 0, Number(pos.z) || 0);
          root.userData.avatarId = m.avatar_id;
          root.userData.draggable = true;
          scene.add(root);
          const mixer = new THREE.AnimationMixer(root);
          mixersRef.current.push(mixer);
          const actions = buildClipActions(mixer, gltf.animations || []);
          const catalog = m.animation_catalog || [];
          const idleKey =
            (m.idle_clip && !isMouthOrLipClipName(m.idle_clip) ? m.idle_clip : null) ||
            pickIdleClipName(catalog, actions);
          const idleAction = idleKey ? resolveClipAction(actions, idleKey) : null;
          if (idleAction) idleAction.reset().setLoop(THREE.LoopRepeat, Infinity).play();
          membersRuntimeRef.current[m.avatar_id] = { avatarId: m.avatar_id, root, mixer, actions };
        }

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();

        function onPointerDown(ev) {
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          const roots = Object.values(membersRuntimeRef.current).map((r) => r.root);
          const hits = raycaster.intersectObjects(roots, true);
          if (!hits.length) return;
          let obj = hits[0].object;
          while (obj && !obj.userData?.draggable) obj = obj.parent;
          if (!obj) return;
          controls.enabled = false;
          dragRef.current = { root: obj, avatarId: obj.userData.avatarId };
        }
        function onPointerMove(ev) {
          if (!dragRef.current) return;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointer, camera);
          if (raycaster.ray.intersectPlane(dragPlane, hit)) {
            dragRef.current.root.position.x = hit.x;
            dragRef.current.root.position.z = hit.z;
          }
        }
        function onPointerUp() {
          if (!dragRef.current) return;
          const { root, avatarId } = dragRef.current;
          dragRef.current = null;
          controls.enabled = true;
          scheduleLayoutSave(avatarId, root.position);
        }
        renderer.domElement.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);

        sceneRef.current = { scene, camera, renderer, controls, envRoot, floor, loadGlb, THREE };
        clockRef.current = new THREE.Clock();
        setStatus('Ready');

        const projectVec = new THREE.Vector3();
        const tick = () => {
          raf = requestAnimationFrame(tick);
          const dt = clockRef.current?.getDelta() || 0.016;
          mixersRef.current.forEach((m) => m.update(dt));
          controls.update();
          renderer.render(scene, camera);
          // Pin HTML media card stacks to each avatar (screen space).
          const rect = renderer.domElement.getBoundingClientRect();
          const mountRect = mountRef.current?.parentElement?.getBoundingClientRect?.() || rect;
          for (const [avatarId, runtime] of Object.entries(membersRuntimeRef.current)) {
            const el = cardStackElsRef.current[avatarId];
            if (!el || !runtime?.root) continue;
            const box = new THREE.Box3().setFromObject(runtime.root);
            const center = box.getCenter(projectVec);
            center.y = box.max.y + 0.15;
            center.project(camera);
            const x = ((center.x + 1) / 2) * rect.width + (rect.left - mountRect.left);
            const y = ((-center.y + 1) / 2) * rect.height + (rect.top - mountRect.top);
            const behind = center.z > 1;
            el.style.left = `${Math.round(x)}px`;
            el.style.top = `${Math.round(y)}px`;
            el.style.visibility = behind ? 'hidden' : 'visible';
          }
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
          renderer.domElement.removeEventListener('pointerdown', onPointerDown);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
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
      if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
    };
  }, [agentId, avatarIdParam, roomIdParam, nav]);

  async function changeScene(sceneId) {
    if (!room?.id) return;
    setStatus('Switching scene…');
    try {
      const { room: next } = await api.vrRoomsPatchScene(room.id, sceneId || null);
      setRoom(next);
      const three = sceneRef.current;
      if (!three?.envRoot) return;
      three.envRoot.clear();
      three.floor.visible = true;
      if (next.scene?.model_url) {
        const gltf = await three.loadGlb(next.scene.model_url);
        three.envRoot.add(gltf.scene);
        three.floor.visible = false;
      }
      setStatus('Ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('Error');
    }
  }

  function sceneContextVars(member) {
    const sj = room?.scene?.scene_json || {};
    const slots = Array.isArray(sj.mediaSlots) ? sj.mediaSlots : [];
    return {
      scene_id: room?.scene_id || '',
      scene_name: room?.scene?.name || '',
      media_slots: JSON.stringify(slots.map((s) => ({ id: s.id, kind: s.kind || 'chart' }))),
      member_handle: member?.handle || '',
      room_id: room?.id || '',
    };
  }

  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);
  const inputRef = useRef(null);

  function extractMediaFromRun(finalRun, avatarId) {
    const outs = [];
    const pushUrl = (url, kindHint, slotPrefix) => {
      const resolved = normalizeMediaUrl(String(url || ''));
      if (!resolved) return;
      const looksMedia =
        /^https?:\/\//i.test(resolved) ||
        /^\/api\/media\//i.test(resolved) ||
        /\.(png|jpe?g|gif|webp|mp4|webm)(\?|$)/i.test(resolved);
      if (!looksMedia) return;
      const kind =
        kindHint || (/\.(mp4|webm)(\?|$)/i.test(resolved) ? 'video' : 'image');
      outs.push({
        slotId: `${slotPrefix}-${outs.length}`,
        kind,
        anchor: 'avatar',
        payload: { url: resolved, mediaUrl: resolved },
      });
    };

    for (const s of finalRun?.steps || []) {
      const o = s.output || {};
      const playback = o.playback || o.result;
      if (Array.isArray(playback?.sceneOutputs)) {
        for (const so of playback.sceneOutputs) outs.push({ ...so, anchor: so.anchor || 'avatar' });
      }
      const toolName = s.node_type === 'tool' ? s.node_label || o.tool || '' : '';
      const url =
        o.url ||
        o.result?.url ||
        o.media?.url ||
        o.video?.url ||
        o.image?.url ||
        (typeof o.result === 'string' && /api\/media\//i.test(o.result) ? o.result : null);
      if (url) {
        const kind = /video/i.test(toolName) || /\.(mp4|webm)(\?|$)/i.test(url) ? 'video' : 'image';
        pushUrl(url, kind, `run-${s.node_id || 'n'}`);
      }
      if (s.node_type === 'agent' && o.text) {
        for (const u of extractMediaUrlsFromText(o.text)) {
          pushUrl(u, null, 'txt');
        }
      }
    }
    const seen = new Set();
    return outs.filter((x) => {
      const u = x.payload?.url || x.slotId;
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }

  async function runMemberOutbound(member, body, userDisplayText) {
    if (!member?.outbound_workflow_id) {
      throw new Error(`No outbound workflow for @${member?.handle || 'member'}`);
    }
    setStatus(`@${member.handle} working…`);
    const run = await api.agentWorkflowRun(member.outbound_workflow_id, {
      trigger: 'manual',
      input: body,
      variables: sceneContextVars(member),
    });
    const runId = run.id || run.run_id;
    let final = run;
    let played = false;
    let transcriptAdded = false;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 500));
      final = await api.agentWorkflowRunGet(runId);
      const agentStep = (final.steps || []).find((s) => s.node_type === 'agent' && s.status === 'completed');
      if (agentStep?.output?.text && !transcriptAdded) {
        transcriptAdded = true;
        const display =
          extractAvatarTranscriptReply(agentStep.output.text) ||
          extractSpokenAvatarReply(agentStep.output.text) ||
          agentStep.output.text;
        setTranscript((t) => [
          ...t,
          { role: 'avatar', text: display, at: Date.now(), handle: member.handle },
        ]);
        setStatus(`@${member.handle} speaking…`);
      }
      const step = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
      const playback = step?.output?.playback || step?.output?.result;
      if (playback?.audioUrl && !played) {
        played = true;
        await playPlayback(playback, member.avatar_id);
      }
      if (final.status === 'completed' || final.status === 'failed') break;
    }
    if (final.status === 'failed') throw new Error(final.error_message || 'Outbound run failed');
    if (!played) {
      const step = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
      const playback = step?.output?.playback || step?.output?.result;
      if (playback) await playPlayback(playback, member.avatar_id);
    }
    const mediaOuts = extractMediaFromRun(final, member.avatar_id);
    if (mediaOuts.length) {
      await applySceneOutputs(mediaOuts, room?.scene?.scene_json || {}, member.avatar_id);
    }
    return final;
  }

  async function startOutbound(text) {
    const members = room?.members || [];
    if (!members.length) {
      setError('Room has no members');
      return;
    }
    const parsed = parseMention(text, members);
    setError('');
    setTranscript((t) => [...t, { role: 'user', text, at: Date.now() }]);

    let assignments = [];
    if (parsed.handle) {
      if (!parsed.member) {
        setError(`Unknown member @${parsed.handle}`);
        return;
      }
      assignments = [
        {
          avatar_id: parsed.member.avatar_id,
          handle: parsed.member.handle,
          agent_id: parsed.member.agent_id,
          query: parsed.body || text,
          outbound_workflow_id: parsed.member.outbound_workflow_id,
          member: parsed.member,
        },
      ];
    } else if (members.length === 1) {
      assignments = [
        {
          ...members[0],
          query: text,
          member: members[0],
        },
      ];
    } else if (room?.id) {
      setStatus('Routing to members…');
      try {
        const routed = await api.vrRoomsRoute(room.id, text);
        assignments = (routed.assignments || []).map((a) => ({
          ...a,
          member: members.find((m) => m.avatar_id === a.avatar_id) || a,
        }));
        if (assignments.length) {
          setTranscript((t) => [
            ...t,
            {
              role: 'system',
              text: `Routed (${routed.source}): ${assignments.map((a) => `@${a.handle}`).join(', ')}`,
              at: Date.now(),
            },
          ]);
        }
      } catch (e) {
        setError(e.message || String(e));
        setStatus('Error');
        return;
      }
    }

    if (!assignments.length) {
      setError('Could not route message to a room member');
      return;
    }

    try {
      // Start all routed member outbound workflows in parallel (agent + media work concurrently).
      // Each avatar has its own audio/viseme state so TTS can overlap safely.
      const labels = assignments
        .map((a) => a.handle || a.member?.handle)
        .filter(Boolean)
        .map((h) => `@${h}`);
      setStatus(
        labels.length > 1 ? `${labels.join(' + ')} working in parallel…` : `${labels[0] || 'Member'} working…`
      );
      const results = await Promise.allSettled(
        assignments.map(async (a) => {
          const member = a.member || members.find((m) => m.avatar_id === a.avatar_id);
          if (!member) return null;
          return runMemberOutbound(member, a.query || text, text);
        })
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length && failed.length === results.length) {
        throw failed[0].reason || new Error('All member outbound runs failed');
      }
      if (failed.length) {
        console.warn(
          '[VirtualRoom] some parallel outbound runs failed',
          failed.map((f) => f.reason?.message || String(f.reason))
        );
        setError(
          `Some members failed: ${failed.map((f) => f.reason?.message || 'error').join('; ')}`
        );
      }
      setStatus('Ready');
    } catch (e) {
      setError(e.message || String(e));
      setStatus('Error');
    }
  }

  function mentionCandidates() {
    const q = String(mentionQuery || '').toLowerCase();
    return (room?.members || []).filter((m) => {
      const h = String(m.handle || '').toLowerCase();
      const n = String(m.name || '').toLowerCase();
      return !q || h.startsWith(q) || n.includes(q);
    });
  }

  function applyMention(member) {
    const el = inputRef.current;
    const value = typed;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const at = before.lastIndexOf('@');
    if (at < 0) return;
    const next = `${before.slice(0, at)}@${member.handle} ${after}`;
    setTyped(next);
    setMentionOpen(false);
    setMentionQuery('');
    setMentionIndex(0);
    requestAnimationFrame(() => {
      const pos = at + member.handle.length + 2;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  function onTypedChange(e) {
    const value = e.target.value;
    setTyped(value);
    const caret = e.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = before.match(/@([a-zA-Z0-9_-]*)$/);
    if (m && (room?.members || []).length) {
      setMentionOpen(true);
      setMentionQuery(m[1] || '');
      setMentionIndex(0);
    } else {
      setMentionOpen(false);
      setMentionQuery('');
    }
  }

  function onTypedKeyDown(e) {
    const cands = mentionCandidates();
    if (mentionOpen && cands.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % cands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + cands.length) % cands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applyMention(cands[mentionIndex] || cands[0]);
        return;
      }
      if (e.key === 'Escape') {
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && typed.trim()) {
      startOutbound(typed.trim());
      setTyped('');
      setMentionOpen(false);
    }
  }

  async function runInboundFromBlob(blob) {
    const members = room?.members || [];
    const member = members.length === 1 ? members[0] : null;
    if (!member?.inbound_workflow_id) {
      setError(
        members.length > 1
          ? 'Voice inbound requires a single-member room (or use typed @mention)'
          : 'No inbound workflow'
      );
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
      const run = await api.agentWorkflowRun(member.inbound_workflow_id, {
        trigger: 'event',
        input: media,
        variables: sceneContextVars(member),
      });
      const runId = run.id || run.run_id;
      let final = run;
      let played = false;
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 400));
        final = await api.agentWorkflowRunGet(runId);
        const agentStep = (final.steps || []).find((s) => s.node_type === 'agent' && s.status === 'completed');
        if (agentStep?.output?.text) {
          const display =
            extractAvatarTranscriptReply(agentStep.output.text) ||
            extractSpokenAvatarReply(agentStep.output.text) ||
            agentStep.output.text;
          setTranscript((t) => {
            if (t.some((x) => x.role === 'avatar' && x.text === display)) return t;
            return [...t, { role: 'avatar', text: display, at: Date.now(), handle: member.handle }];
          });
          setStatus('Speaking…');
        }
        const step = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
        const playback = step?.output?.playback || step?.output?.result;
        if (playback?.audioUrl && !played) {
          played = true;
          await playPlayback(playback, member.avatar_id);
        }
        if (final.status === 'completed' || final.status === 'failed') break;
      }
      if (final.status === 'failed') throw new Error(final.error_message || 'Inbound run failed');
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

  const memberHint =
    (room?.members || []).length > 1
      ? `Type @ to pick, or send without @ to auto-route…`
      : 'Type a message…';

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', background: '#0f1419', color: '#e8eaed', zIndex: 50 }}>
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
        <div
          aria-label="Avatar media cards"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 2 }}
        >
          {Object.entries(
            avatarCards.reduce((acc, card) => {
              (acc[card.avatarId] ||= []).push(card);
              return acc;
            }, {})
          ).map(([avatarId, cards]) => (
            <div
              key={avatarId}
              ref={(el) => {
                if (el) cardStackElsRef.current[avatarId] = el;
                else delete cardStackElsRef.current[avatarId];
              }}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: 'translate(-50%, -100%)',
                width: 280,
                height: 220,
                pointerEvents: 'auto',
              }}
            >
              {cards.map((card, idx) => (
                <div
                  key={card.id}
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    right: 0,
                    background: '#0b1220',
                    border: '1px solid #334155',
                    borderRadius: 10,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                    overflow: 'hidden',
                    zIndex: cards.length - idx,
                    visibility: idx === 0 ? 'visible' : 'hidden',
                    pointerEvents: idx === 0 ? 'auto' : 'none',
                  }}
                >
                  <button
                    type="button"
                    aria-label="Close media"
                    title="Close"
                    onClick={() => closeAvatarCard(card.id)}
                    style={{
                      position: 'absolute',
                      top: 6,
                      right: 6,
                      zIndex: 2,
                      width: 26,
                      height: 26,
                      borderRadius: 999,
                      border: '1px solid #475569',
                      background: 'rgba(15,23,42,0.85)',
                      color: '#e2e8f0',
                      cursor: 'pointer',
                      lineHeight: '22px',
                      fontSize: 16,
                    }}
                  >
                    ×
                  </button>
                  {card.handle ? (
                    <div style={{ padding: '6px 32px 4px 10px', fontSize: 11, opacity: 0.75 }}>
                      @{card.handle} · {card.kind}
                    </div>
                  ) : null}
                  {card.kind === 'video' ? (
                    <video
                      src={card.displayUrl}
                      muted
                      playsInline
                      autoPlay
                      loop
                      style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain', background: '#020617' }}
                    />
                  ) : (
                    <img
                      src={card.displayUrl}
                      alt={card.kind || 'media'}
                      style={{ display: 'block', width: '100%', maxHeight: 180, objectFit: 'contain', background: '#020617' }}
                    />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <aside
        style={{
          width: 360,
          maxWidth: '42vw',
          borderLeft: '1px solid #2a3139',
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
          gap: 8,
          background: '#151b22',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{room?.name || 'Virtual Room'}</strong>
          <Link to="/avatars" style={{ color: '#93c5fd' }}>
            Exit
          </Link>
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {(room?.members || []).map((m) => `@${m.handle}`).join(', ') || 'No members'} · {status}
        </div>
        <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          Scene
          <select
            value={room?.scene_id || ''}
            onChange={(e) => changeScene(e.target.value)}
            style={{
              flex: 1,
              background: '#0f1419',
              color: 'inherit',
              border: '1px solid #333',
              borderRadius: 6,
              padding: 4,
            }}
          >
            <option value="">Empty stage</option>
            {scenes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 11, opacity: 0.65 }}>
          Drag avatars to reposition. Media from an avatar stacks as closable cards above them (× to dismiss).
          Type <code>@</code> to mention; without @ the room auto-routes (no Kanban).
        </div>
        {error && <div style={{ color: '#f87171', fontSize: 13 }}>{error}</div>}
        <div style={{ flex: 1, overflow: 'auto', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {transcript.map((m, i) => (
            <div
              key={i}
              style={{
                opacity: m.role === 'user' ? 0.9 : 1,
                color: m.role === 'system' ? '#93c5fd' : undefined,
                fontStyle: m.role === 'system' ? 'italic' : undefined,
              }}
            >
              <b>
                {m.role === 'user' ? 'You' : m.role === 'system' ? 'Room' : `@${m.handle || 'avatar'}`}:
              </b>{' '}
              {m.text}
            </div>
          ))}
        </div>
        <div style={{ position: 'relative', display: 'flex', gap: 6 }}>
          {mentionOpen && mentionCandidates().length > 0 && (
            <ul
              style={{
                position: 'absolute',
                bottom: '100%',
                left: 0,
                right: 40,
                margin: 0,
                padding: 4,
                listStyle: 'none',
                background: '#0b1220',
                border: '1px solid #334155',
                borderRadius: 8,
                maxHeight: 160,
                overflow: 'auto',
                zIndex: 5,
              }}
            >
              {mentionCandidates().map((m, idx) => (
                <li key={m.avatar_id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(m);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '6px 8px',
                      border: 0,
                      borderRadius: 6,
                      background: idx === mentionIndex ? '#1e3a5f' : 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    @{m.handle} <span style={{ opacity: 0.65 }}>{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputRef}
            value={typed}
            onChange={onTypedChange}
            onKeyDown={onTypedKeyDown}
            placeholder={memberHint}
            style={{
              flex: 1,
              padding: 8,
              borderRadius: 6,
              border: '1px solid #333',
              background: '#0f1419',
              color: 'inherit',
            }}
          />
          <button type="button" onClick={() => typed.trim() && (startOutbound(typed.trim()), setTyped(''))}>
            Send
          </button>
        </div>
        <button
          type="button"
          onClick={toggleRecord}
          style={{
            padding: 10,
            background: recording ? '#b91c1c' : '#2563eb',
            color: '#fff',
            border: 0,
            borderRadius: 8,
          }}
        >
          {recording ? 'Stop & send voice' : 'Hold mic (click to record)'}
        </button>
      </aside>
    </div>
  );
}
