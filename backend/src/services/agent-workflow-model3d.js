/**
 * 3D model workflow node - builds Virtual Room playback payload.
 */
import { parseMediaRef } from './ceo-media-artifacts.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { getAvatarForOwner, avatarModelApiPath } from './ceo-avatars.js';
import { sanitizeAnimationPlan } from './avatar-animation-catalog.js';
import { getToolMeta } from './content-tools-meta.js';
import { internalAuthHeaders } from '../middleware/internal-auth.js';
import { getVideoConfig } from '../config/tools.js';
import { getOpenClawMediaDir } from '../config/openclaw-paths.js';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

function generatedMediaDir() {
  return getOpenClawMediaDir('generated');
}

function backendBaseUrl() {
  const port = process.env.PORT || 3001;
  return (process.env.AGENT_OS_BACKEND_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
}

async function callContentTool(toolName, body, ownerUserId) {
  const row = getToolMeta(toolName);
  if (!row?.enabled) throw new Error(`Tool unavailable: ${toolName}`);
  let targetUrl = row.endpoint;
  if (targetUrl.startsWith('/')) targetUrl = backendBaseUrl() + targetUrl;
  const headers = internalAuthHeaders();
  if (ownerUserId) headers['x-ceo-user-id'] = String(ownerUserId);
  const response = await fetch(targetUrl, {
    method: row.method || 'POST',
    headers,
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(180000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Tool ${toolName} failed (${response.status})`);
  return data;
}

async function pollReplicatePredictionUrl(ownerUserId, jobId, { maxAttempts = 40, delayMs = 3000 } = {}) {
  const { primary } = getVideoConfig(ownerUserId);
  if (!primary?.apiToken || !jobId) return null;
  const base = String(primary.apiUrl || '').replace(/\/$/, '');
  for (let i = 0; i < maxAttempts; i += 1) {
    const res = await fetch(`${base}/predictions/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${primary.apiToken}` },
      signal: AbortSignal.timeout(20000),
    });
    const pred = await res.json().catch(() => ({}));
    const status = String(pred.status || '');
    const outVal = Array.isArray(pred.output) ? pred.output[0] : pred.output;
    const url = typeof outVal === 'string' ? outVal : outVal?.url || null;
    if (url) return url;
    if (status === 'failed' || status === 'canceled') {
      console.warn('[model3d] replicate prediction ended', status, pred.error || '');
      return null;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

async function persistRemoteVideoUrl(remoteUrl) {
  const url = String(remoteUrl || '').trim();
  if (!url) return null;
  if (/^\/api\/media\//i.test(url)) return url;
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`download video failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = String(res.headers.get('content-type') || '').toLowerCase();
  let ext = 'mp4';
  if (ct.includes('webm')) ext = 'webm';
  else if (ct.includes('gif')) ext = 'gif';
  const dir = generatedMediaDir();
  mkdirSync(dir, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  writeFileSync(join(dir, filename), buf);
  return `/api/media/openclaw/generated/${filename}`;
}

function parseJsonish(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return value;
  let s = String(value).trim();
  if (!s) return null;
  // Strip common LLM markdown fences
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) s = fenced[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeAnimation(raw) {
  const obj = parseJsonish(raw) || {};
  const clips = Array.isArray(obj.clips)
    ? obj.clips
        .map((c) => {
          if (typeof c === 'string') return { name: c, weight: 1, loop: false, timeScale: 1 };
          if (!c || typeof c !== 'object') return null;
          return {
            name: String(c.name || '').trim(),
            weight: c.weight != null ? Number(c.weight) : 1,
            loop: !!c.loop,
            timeScale: c.timeScale != null ? Number(c.timeScale) : 1,
            startSec: c.startSec != null ? Number(c.startSec) : undefined,
            endSec: c.endSec != null ? Number(c.endSec) : undefined,
          };
        })
        .filter((c) => c && c.name)
    : [];
  const visemes = Array.isArray(obj.visemes)
    ? obj.visemes
        .map((v) => ({
          t: Number(v.t ?? v.time ?? 0),
          name: String(v.name || v.viseme || '').trim(),
          weight: v.weight != null ? Number(v.weight) : undefined,
        }))
        .filter((v) => v.name)
    : [];
  return {
    clips,
    idle: obj.idle != null ? String(obj.idle) : null,
    mouthClip: obj.mouthClip != null ? String(obj.mouthClip) : null,
    visemes,
    lookAt: obj.lookAt ?? null,
    sceneOutputs: Array.isArray(obj.sceneOutputs)
      ? obj.sceneOutputs.filter((o) => o && typeof o === 'object')
      : [],
  };
}

/**
 * @param {Record<string, any>} resolvedInputs
 * @param {object} nodeConfig
 * @param {object} context
 */
export async function executeModel3dTask(resolvedInputs, nodeConfig = {}, context = null) {
  const owner = context?.owner_user_id || context?.actor?.id;
  if (!owner) throw new Error('model3d node requires workflow owner');

  const render = (v) =>
    context && v != null && typeof v === 'string' ? renderWorkflowTemplates(v, context) : v;

  const avatarId = String(
    render(resolvedInputs.avatarId || nodeConfig.avatarId || context?.workflow_variables?.avatar_id || '') || ''
  ).trim();
  if (!avatarId) throw new Error('model3d requires avatarId');

  const avatar = getAvatarForOwner(owner, avatarId);
  if (!avatar) throw new Error(`Avatar not found: ${avatarId}`);

  const audioRef =
    parseMediaRef(resolvedInputs.audio) ||
    parseMediaRef(resolvedInputs.media) ||
    null;

  let animation = normalizeAnimation(resolvedInputs.animation);
  const visemesOverride = parseJsonish(resolvedInputs.visemes);
  if (Array.isArray(visemesOverride)) {
    animation = {
      ...animation,
      visemes: visemesOverride
        .map((v) => ({
          t: Number(v.t ?? v.time ?? 0),
          name: String(v.name || v.viseme || '').trim(),
          weight: v.weight != null ? Number(v.weight) : undefined,
        }))
        .filter((v) => v.name),
    };
  }

  const catalog = (() => {
    try {
      return JSON.parse(avatar.animation_catalog_json || '[]');
    } catch {
      return [];
    }
  })();

  const replyHint = String(
    resolvedInputs.text ||
      resolvedInputs.prompt ||
      (typeof context?.node_outputs?.['agent-1'] === 'string'
        ? context.node_outputs['agent-1']
        : context?.node_outputs?.['agent-1']?.text) ||
      ''
  );
  animation = sanitizeAnimationPlan(animation, catalog, replyHint, {
    preferredIdle: avatar.idle_clip || null,
  });

  if (Array.isArray(catalog) && catalog.length) {
    const allowed = new Set(catalog.map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean));
    animation.clips = animation.clips.filter((c) => allowed.has(c.name));
    if (animation.idle && !allowed.has(animation.idle)) {
      animation.idle = sanitizeAnimationPlan({}, catalog, '', { preferredIdle: avatar.idle_clip || null }).idle;
    }
    if (animation.mouthClip && !allowed.has(animation.mouthClip)) {
      animation.mouthClip = null;
    }
    animation.visemes = (animation.visemes || []).filter((v) => allowed.has(v.name));
  }

  let sceneOutputs = mergeAgentMediaIntoSceneOutputs(
    resolveSceneOutputs(animation.sceneOutputs || [], context, replyHint),
    replyHint,
    avatar.id
  );

  const userInput = String(
    context?.initial_input?.text ||
      context?.initial_input ||
      resolvedInputs.prompt ||
      ''
  );
  sceneOutputs = await fulfillRequestedMedia(owner, userInput, replyHint, sceneOutputs, avatar.id);

  const modelUrl = avatarModelApiPath(avatar.id);
  const playback = {
    avatarId: avatar.id,
    modelUrl,
    audioUrl: audioRef?.url || null,
    audio: audioRef,
    animations: animation.clips,
    idle: animation.idle,
    mouthClip: animation.mouthClip || null,
    visemes: animation.visemes,
    lookAt: animation.lookAt,
    animationCatalog: catalog,
    sceneOutputs,
  };

  console.info('[model3d] playback built', {
    owner,
    avatarId: avatar.id,
    clips: playback.animations.length,
    visemes: (playback.visemes || []).length,
    mouthClip: playback.mouthClip,
    hasAudio: !!playback.audioUrl,
    sceneOutputs: (playback.sceneOutputs || []).length,
  });

  return {
    ok: true,
    playback,
    text: `Playback for ${avatar.name || avatar.id}: ${playback.animations.length} clip(s)${playback.audioUrl ? ' + audio' : ''}${
      playback.sceneOutputs.length ? ` + ${playback.sceneOutputs.length} scene output(s)` : ''
    }`,
    result: playback,
  };
}

/**
 * Resolve Brain sceneOutputs against agent/media prior outputs.
 * Brain routes; it must not invent URLs — we fill from agent JSON / media refs when present.
 */
function resolveSceneOutputs(rawList, context, replyHint = '') {
  const list = Array.isArray(rawList) ? rawList : [];
  if (!list.length) {
    // Heuristic: if agent reply embeds chart-like JSON and media_slots exist, auto-route first chart slot.
    const slotsRaw = context?.workflow_variables?.media_slots || context?.variables?.media_slots;
    let slots = [];
    try {
      slots = typeof slotsRaw === 'string' ? JSON.parse(slotsRaw) : slotsRaw;
    } catch {
      slots = [];
    }
    if (Array.isArray(slots) && slots.length) {
      const chart = extractChartLikePayload(replyHint) || extractChartLikeFromContext(context);
      if (chart) {
        const slot = slots.find((s) => /chart|graph/i.test(String(s.kind || ''))) || slots[0];
        return [
          {
            slotId: String(slot.id || 'panel-1'),
            kind: String(slot.kind || 'chart'),
            from: 'agent',
            payload: { chart },
          },
        ];
      }
    }
    return [];
  }

  return list
    .map((o) => {
      const slotId = String(o.slotId || o.slot_id || '').trim();
      if (!slotId) return null;
      const kind = String(o.kind || 'chart').toLowerCase();
      let payload = o.payload && typeof o.payload === 'object' ? { ...o.payload } : {};
      if (o.from === 'mediaRef' || payload.mediaId || payload.artifactId) {
        const ref =
          parseMediaRef(payload) ||
          parseMediaRef(payload.media) ||
          parseMediaRef(payload.mediaId || payload.artifactId);
        if (ref?.url) payload = { ...payload, url: ref.url, mediaUrl: ref.url };
      }
      if ((kind === 'chart' || kind === 'graph') && !payload.chart && !payload.spec && !payload.values) {
        const chart = extractChartLikePayload(replyHint) || extractChartLikeFromContext(context);
        if (chart) payload = { ...payload, chart };
      }
      return { slotId, kind, from: o.from || 'agent', payload };
    })
    .filter(Boolean);
}

function extractChartLikePayload(text) {
  if (!text) return null;
  const obj = parseJsonish(text);
  if (!obj || typeof obj !== 'object') return null;
  if (obj.chart) return obj.chart;
  if (obj.spec && (obj.spec.series || obj.spec.data)) return obj.spec;
  if (Array.isArray(obj.values) || Array.isArray(obj.data) || Array.isArray(obj.series)) return obj;
  if (obj.title && (obj.values || obj.data || obj.series)) return obj;
  return null;
}

function extractChartLikeFromContext(context) {
  const agentOut = context?.node_outputs?.['agent-1'];
  const text =
    typeof agentOut === 'string'
      ? agentOut
      : agentOut?.text || agentOut?.result || '';
  return extractChartLikePayload(text);
}

/** Pull image/video URLs from agent markdown or plain absolute/API paths. */
function extractMediaUrlsFromText(text) {
  const s = String(text || '');
  const out = [];
  const normalize = (raw) => {
    let u = String(raw || '').trim();
    if (!u) return null;
    u = u.replace(/\.\s+(png|jpe?g|gif|webp|mp4|webm)\b/gi, '.$1');
    u = u.replace(/[)\].,;:'"]+$/g, '');
    const m = u.match(/(?:https?:\/\/[^\s]+)|(?:\/?api\/media\/[^\s]+)/i);
    if (m) u = m[0];
    if (/^api\/media\//i.test(u)) u = `/${u}`;
    else if (!/^https?:\/\//i.test(u) && /api\/media\//i.test(u)) {
      const idx = u.toLowerCase().indexOf('api/media/');
      u = `/${u.slice(idx)}`;
    }
    return u;
  };
  const push = (url, kindHint) => {
    const u = normalize(url);
    if (!u) return;
    const kind = kindHint || (/\.(mp4|webm)(\?|$)/i.test(u) ? 'video' : 'image');
    if (!out.some((x) => x.url === u)) out.push({ kind, url: u });
  };
  let m;
  const mdImg = /!\[[^\]]*\]\(([^)]+)\)/g;
  while ((m = mdImg.exec(s))) push(m[1], 'image');
  const mdLink = /\[[^\]]*\]\(([^)]*api\/media\/[^)]+)\)/gi;
  while ((m = mdLink.exec(s))) push(m[1]);
  const urlRe =
    /(?:https?:\/\/[^\s)\]"'<>]+)|(?:\/?api\/media\/[^\s)\]"'<>]*?\.(?:\s*)(?:png|jpe?g|gif|webp|mp4|webm))/gi;
  while ((m = urlRe.exec(s))) push(m[0]);
  return out;
}

function mergeAgentMediaIntoSceneOutputs(sceneOutputs, replyHint, avatarId) {
  const list = Array.isArray(sceneOutputs) ? [...sceneOutputs] : [];
  const media = extractMediaUrlsFromText(replyHint);
  let i = 0;
  for (const item of media) {
    const slotId = `avatar-${avatarId || 'x'}-${item.kind}-${i}`;
    if (list.some((o) => o?.payload?.url === item.url || o?.payload?.mediaUrl === item.url)) continue;
    list.push({
      slotId,
      kind: item.kind,
      from: 'agent',
      anchor: 'avatar',
      payload: { url: item.url, mediaUrl: item.url },
    });
    i += 1;
  }
  const chart = extractChartLikePayload(replyHint);
  if (chart && !list.some((o) => /chart|graph/i.test(String(o.kind || '')))) {
    list.push({
      slotId: `avatar-${avatarId || 'x'}-chart`,
      kind: 'chart',
      from: 'agent',
      anchor: 'avatar',
      payload: { chart },
    });
  }
  return list;
}

function stripMentions(text) {
  return String(text || '')
    .replace(/@[\w.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPlaceholderChart(chart) {
  return (
    chart &&
    String(chart.title || '') === 'Demo' &&
    JSON.stringify(chart.values || []) === '[1,3,2,5]'
  );
}

/** Detect chart/graph kind from free text (generic — not pie-only). */
function detectChartKind(text) {
  const t = String(text || '');
  if (/\b(pie|doughnut|donut)\b/i.test(t)) return 'pie';
  if (/\b(bar|column)\b/i.test(t)) return 'bar';
  if (/\bscatter\b/i.test(t)) return 'scatter';
  if (/\barea\b/i.test(t)) return 'area';
  if (/\bline\b/i.test(t)) return 'line';
  return 'bar';
}

function chartImagePrompt(kind, topic) {
  const t = String(topic || 'requested data').slice(0, 220);
  const base = `A clean professional ${kind} chart of: ${t}. Flat design, white background, clear legend and labels.`;
  if (kind === 'pie') return `${base} Show percentage labels on slices.`;
  if (kind === 'bar') return `${base} Include axis labels.`;
  if (kind === 'line' || kind === 'area') return `${base} Include X/Y axes.`;
  return base;
}

/**
 * Split user asks into image / video / chart intents (any subject — not rover/pie-specific).
 * Returns prompts/topics the model3d step can fulfill if the agent omitted media.
 * Exported for unit smoke tests.
 */
export function parseMediaIntents(userInput) {
  const text = stripMentions(userInput);
  const images = [];
  const videos = [];
  const charts = [];

  const pushUnique = (arr, value, max = 3) => {
    const v = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400);
    if (!v || arr.includes(v) || arr.length >= max) return;
    arr.push(v);
  };

  // Prefer explicit image lists before clause-splitting on "and"
  const listMatch = text.match(/(?:\d+\s+)?images?\s*[:\-]\s*(.+?)(?=\s*[.;]|$)/i);
  if (listMatch) {
    for (const item of listMatch[1].split(/\s*(?:,|;|\band\b)\s*/i)) {
      pushUnique(images, item.replace(/^(?:an?\s+|the\s+)/i, ''));
    }
  }

  // Clause boundaries: "... and bring me a pie chart...", "; ", ". "
  const clauses = text
    .split(/\s+(?:and|then)\s+(?=(?:(?:also|please)\s+)?(?:bring|generat|creat|mak|draw|get|show|plot|a\s+|an\s+|the\s+)|(?:pie|bar|line|area|scatter)\b)|[.;]+/i)
    .map((c) => c.trim())
    .filter(Boolean);
  const parts = clauses.length ? clauses : [text];

  for (const part of parts) {
    const isChart =
      /\b(chart|graph|plot)\b/i.test(part) ||
      /\b(pie|doughnut|donut|bar|column|line|area|scatter)\s+(?:chart|graph|plot)?\b/i.test(part);
    const isVideo = /\bvideos?\b/i.test(part) && !isChart;
    const isImage =
      !isChart &&
      !listMatch &&
      (/\b(images?|pictures?|photos?|illustration|rendering)\b/i.test(part) ||
        /\bgenerate_image\b/i.test(part));

    if (isChart) {
      const topic = part
        .replace(/\b(generat\w*|creat\w*|mak\w*|draw(?:\s+me)?|bring(?:\s+me)?|get|show(?:\s+me)?|plot|provide)\b/gi, ' ')
        .replace(/\b(a|an|the|of|for|with|please|me)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      charts.push({ kind: detectChartKind(part), topic: topic || part.slice(0, 220) });
      continue;
    }
    if (isVideo) {
      const m =
        part.match(/(?:video)\s+(?:of|about|showing|for)\s+(.+)$/i) ||
        part.match(/(?:generat\w*|creat\w*|mak\w*)\s+(?:a\s+|an\s+)?(?:short\s+)?video\s+(?:of\s+)?(.+)$/i);
      pushUnique(videos, m?.[1] || part.replace(/\b(generat\w*|creat\w*|mak\w*|video|a|an|the|of)\b/gi, ' '));
      continue;
    }
    if (isImage) {
      const m =
        part.match(/(?:image|picture|photo|illustration|rendering)\s+(?:of|about|showing|for)\s+(.+)$/i) ||
        part.match(
          /(?:generat\w*|creat\w*|mak\w*|draw\w*|bring(?:\s+me)?|get|show(?:\s+me)?)\s+(?:an?\s+)?(?:image|picture|photo)\s+(?:of\s+)?(.+)$/i
        );
      pushUnique(images, m?.[1] || part.replace(/\b(generat\w*|creat\w*|mak\w*|draw\w*|bring(?:\s+me)?|get|show(?:\s+me)?|images?|pictures?|photos?|a|an|the|of|two|three|\d+)\b/gi, ' '));
    }
  }

  // Whole-message fallbacks when clause split missed intents
  if (!images.length && /\b(images?|pictures?|photos?)\b/i.test(text) && !/\bonly\s+(?:a\s+)?(?:chart|graph)\b/i.test(text)) {
    const m = text.match(/(?:image|picture|photo)\s+(?:of|about|showing|for)\s+(.+?)(?=\s+and\s+|\s*[.;]|$)/i);
    if (m) pushUnique(images, m[1]);
    else if (/\b(generat\w*|creat\w*|mak\w*|draw\w*|bring|get)\b[\s\S]{0,80}\b(image|picture|photo)\b/i.test(text)) {
      pushUnique(
        images,
        text
          .replace(/\b(chart|graph|plot|pie|bar|line|video)[\s\S]*$/i, ' ')
          .replace(/\b(generat\w*|creat\w*|mak\w*|draw\w*|bring(?:\s+me)?|get|show(?:\s+me)?|image|picture|photo|a|an|the|of)\b/gi, ' ')
      );
    }
  }
  if (!videos.length && /\b(generat\w*|creat\w*|mak\w*)\b[\s\S]{0,48}\bvideos?\b/i.test(text)) {
    const m = text.match(/(?:video)\s+(?:of|about|showing|for)\s+(.+?)(?=\s+and\s+|\s*[.;]|$)/i);
    pushUnique(videos, m?.[1] || 'short cinematic clip matching the request');
  }
  if (!charts.length && (/\b(chart|graph|plot|pie|doughnut|donut)\b/i.test(text) || /"values"\s*:/.test(text))) {
    charts.push({
      kind: detectChartKind(text),
      topic: text
        .replace(/\b(generat\w*|creat\w*|mak\w*|draw\w*|bring(?:\s+me)?|get|show(?:\s+me)?)\b/gi, ' ')
        .replace(/\b(image|picture|photo|video)\b[\s\S]{0,60}/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220) || 'requested chart',
    });
  }

  return { images, videos, charts };
}

/**
 * When the user asked for image/video/chart but the agent reply omitted media,
 * fulfill via content tools inside the model3d workflow step (still no Kanban).
 * Generic for any subject/chart kind — not pie/rover-specific.
 */
async function fulfillRequestedMedia(owner, userInput, replyHint, sceneOutputs, avatarId) {
  let outs = Array.isArray(sceneOutputs) ? [...sceneOutputs] : [];
  const intents = parseMediaIntents(userInput);
  // Also honor tool names mentioned in the agent reply (agent started but forgot URL).
  if (/\bgenerate_image\b/i.test(replyHint) && !intents.images.length) {
    intents.images.push(stripMentions(userInput).slice(0, 220) || 'requested image');
  }
  if (/\bgenerate_video\b/i.test(replyHint) && !intents.videos.length) {
    intents.videos.push(stripMentions(userInput).slice(0, 220) || 'requested video');
  }

  const imageCount = () =>
    outs.filter((o) => String(o.kind).toLowerCase() === 'image' && (o.payload?.url || o.payload?.mediaUrl) && !/chart/i.test(String(o.slotId || ''))).length;
  const videoCount = () =>
    outs.filter((o) => String(o.kind).toLowerCase() === 'video' && (o.payload?.url || o.payload?.mediaUrl)).length;
  const hasChartVisual = () =>
    outs.some((o) => {
      if (/chart|graph/i.test(String(o.kind || ''))) {
        const chart = o.payload?.chart || (o.payload?.values ? o.payload : null);
        if (isPlaceholderChart(chart)) return false;
        if (chart || o.payload?.url || o.payload?.mediaUrl) return true;
      }
      return /chart/i.test(String(o.slotId || '')) && (o.payload?.url || o.payload?.mediaUrl);
    });

  const needImages = Math.max(0, intents.images.length - imageCount());
  for (let i = 0; i < needImages; i += 1) {
    const prompt = intents.images[imageCount()] || intents.images[i] || intents.images[0];
    if (!prompt) break;
    try {
      console.info('[model3d] fulfilling generate_image', { owner, prompt: prompt.slice(0, 80) });
      const data = await callContentTool('generate_image', { prompt }, owner);
      const url = data?.url || data?.result?.url || data?.image_url;
      if (url) {
        outs.push({
          slotId: `avatar-${avatarId}-image-${outs.length}`,
          kind: 'image',
          from: 'mediaRef',
          anchor: 'avatar',
          payload: { url, mediaUrl: url },
        });
      }
    } catch (e) {
      console.warn('[model3d] generate_image fulfill failed', e?.message || e);
    }
  }

  const needVideos = Math.max(0, intents.videos.length - videoCount());
  for (let i = 0; i < needVideos; i += 1) {
    const prompt = intents.videos[i] || intents.videos[0];
    if (!prompt) break;
    try {
      console.info('[model3d] fulfilling generate_video', { owner, prompt: prompt.slice(0, 80) });
      let data = await callContentTool('generate_video', { prompt }, owner);
      let url = data?.url || data?.result?.url || data?.video_url || null;
      const jobId = data?.job_id || data?.result?.job_id;
      if (!url && jobId) {
        url = await pollReplicatePredictionUrl(owner, jobId);
      }
      if (url) {
        try {
          if (/^https?:\/\//i.test(url)) {
            const persisted = await persistRemoteVideoUrl(url);
            if (persisted) url = persisted;
          }
        } catch (e) {
          console.warn('[model3d] video persist skipped', e?.message || e);
        }
        outs.push({
          slotId: `avatar-${avatarId}-video-${outs.length}`,
          kind: 'video',
          from: 'mediaRef',
          anchor: 'avatar',
          payload: { url, mediaUrl: url },
        });
      } else {
        console.info('[model3d] generate_video returned no url', {
          job: jobId || null,
          status: data?.status || data?.result?.status || null,
        });
      }
    } catch (e) {
      console.warn('[model3d] generate_video fulfill failed', e?.message || e);
    }
  }

  if (intents.charts.length && !hasChartVisual()) {
    const req = intents.charts[0];
    const kind = req.kind || detectChartKind(userInput);
    const chartFromReply = extractChartLikePayload(replyHint) || extractChartLikePayload(userInput);
    const usableChart = chartFromReply && !isPlaceholderChart(chartFromReply) ? chartFromReply : null;

    // Prefer structured canvas chart when the agent (or user) provided real values.
    // Otherwise render via generate_image for any chart kind (pie/bar/line/…).
    if (usableChart && Array.isArray(usableChart.values || usableChart.data || usableChart.series)) {
      outs.push({
        slotId: `avatar-${avatarId}-chart`,
        kind: 'chart',
        from: 'agent',
        anchor: 'avatar',
        payload: { chart: { type: usableChart.type || kind, ...usableChart } },
      });
    } else {
      try {
        const prompt = chartImagePrompt(kind, req.topic);
        console.info('[model3d] fulfilling chart via generate_image', {
          owner,
          kind,
          prompt: prompt.slice(0, 100),
        });
        const data = await callContentTool('generate_image', { prompt }, owner);
        const url = data?.url || data?.result?.url || data?.image_url;
        if (url) {
          outs.push({
            slotId: `avatar-${avatarId}-chart-image`,
            kind: 'image',
            from: 'mediaRef',
            anchor: 'avatar',
            payload: { url, mediaUrl: url },
          });
        } else if (usableChart) {
          outs.push({
            slotId: `avatar-${avatarId}-chart`,
            kind: 'chart',
            from: 'agent',
            anchor: 'avatar',
            payload: { chart: { type: kind, ...usableChart } },
          });
        } else {
          console.warn('[model3d] chart fulfill produced no media; skipping placeholder Demo chart');
        }
      } catch (e) {
        console.warn('[model3d] chart fulfill failed', e?.message || e);
        if (usableChart) {
          outs.push({
            slotId: `avatar-${avatarId}-chart`,
            kind: 'chart',
            from: 'agent',
            anchor: 'avatar',
            payload: { chart: { type: kind, ...usableChart } },
          });
        }
      }
    }
  }

  // Drop accidental Demo placeholder charts.
  outs = outs.filter((o) => {
    const c = o?.payload?.chart;
    if (!c) return true;
    if (isPlaceholderChart(c)) {
      console.warn('[model3d] dropping placeholder Demo chart');
      return false;
    }
    return true;
  });

  return outs;
}
