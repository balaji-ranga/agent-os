/**
 * 3D model workflow node - builds Virtual Room playback payload.
 */
import { parseMediaRef } from './ceo-media-artifacts.js';
import { renderWorkflowTemplates } from './agent-workflow-io.js';
import { getAvatarForOwner, avatarModelApiPath } from './ceo-avatars.js';
import { sanitizeAnimationPlan } from './avatar-animation-catalog.js';

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
  };

  console.info('[model3d] playback built', {
    owner,
    avatarId: avatar.id,
    clips: playback.animations.length,
    visemes: (playback.visemes || []).length,
    mouthClip: playback.mouthClip,
    hasAudio: !!playback.audioUrl,
  });

  return {
    ok: true,
    playback,
    text: `Playback for ${avatar.name || avatar.id}: ${playback.animations.length} clip(s)${playback.audioUrl ? ' + audio' : ''}`,
    result: playback,
  };
}
