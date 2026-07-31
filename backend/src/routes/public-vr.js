/**
 * Public (unauthenticated) Virtual Room guest APIs.
 */
import { Router } from 'express';
import {
  getPublishedVrRoomBySlug,
  assertPublicToken,
  getPublishedRoomRowBySlug,
} from '../services/ceo-vr-rooms.js';
import { routeVrRoomMessage } from '../services/ceo-vr-route.js';
import { readAvatarModelBuffer } from '../services/ceo-avatars.js';
import { readVrSceneModelBuffer } from '../services/ceo-vr-scenes.js';
import { startAgentWorkflowRun } from '../services/agent-workflow-runner.js';
import { getRun } from '../services/agent-workflow-store.js';
import { extractSpokenAvatarReply, extractAvatarTranscriptReply } from '../services/avatar-speak-text.js';
import { readMediaArtifactBuffer } from '../services/ceo-media-artifacts.js';

const router = Router();

const chatHits = new Map();
function rateLimitOk(key, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const row = chatHits.get(key) || { n: 0, t: now };
  if (now - row.t > windowMs) {
    row.n = 0;
    row.t = now;
  }
  row.n += 1;
  chatHits.set(key, row);
  return row.n <= limit;
}

function extractArtifactId(url) {
  const s = String(url || '');
  const m = s.match(/\/media\/artifacts\/(mda_[a-zA-Z0-9]+)(?:\/|$)/i) || s.match(/\b(mda_[a-zA-Z0-9]+)\b/i);
  return m?.[1] || null;
}

/** Rewrite auth-only media paths to public tokenized URLs for guests. */
function publicizePlayback(playback, slug, token) {
  if (!playback || typeof playback !== 'object') return playback;
  const out = { ...playback };
  const aid = extractArtifactId(out.audioUrl);
  if (aid && slug && token) {
    out.audioUrl = `/api/public/vr/${encodeURIComponent(slug)}/artifacts/${encodeURIComponent(aid)}?t=${encodeURIComponent(token)}`;
  }
  return out;
}

router.get('/:slug', (req, res) => {
  try {
    const room = getPublishedVrRoomBySlug(req.params.slug);
    if (!room) return res.status(404).json({ error: 'Not found or unpublished' });
    res.json({ room });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Get failed' });
  }
});

router.get('/:slug/avatars/:avatarId/model', (req, res) => {
  try {
    const row = assertPublicToken(req.params.slug, req.query.t);
    if (!row) return res.status(401).json({ error: 'Invalid or missing token' });
    const guest = getPublishedVrRoomBySlug(req.params.slug);
    const member = guest?.members?.find((m) => m.avatar_id === req.params.avatarId);
    if (!member) return res.status(404).json({ error: 'Avatar not in room' });
    const got = readAvatarModelBuffer(row.owner_user_id, req.params.avatarId);
    if (!got) return res.status(404).json({ error: 'Model not found' });
    res.setHeader('Content-Type', got.row.mime_type || 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(got.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

router.get('/:slug/scenes/:sceneId/model', (req, res) => {
  try {
    const row = assertPublicToken(req.params.slug, req.query.t);
    if (!row) return res.status(401).json({ error: 'Invalid or missing token' });
    if (String(row.scene_id) !== String(req.params.sceneId)) {
      return res.status(404).json({ error: 'Scene not in room' });
    }
    const got = readVrSceneModelBuffer(row.owner_user_id, req.params.sceneId);
    if (!got) return res.status(404).json({ error: 'Scene not found' });
    res.setHeader('Content-Type', got.row.mime_type || 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(got.buffer);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

/** Guest-safe TTS / media artifact download (token + room owner scoped). */
router.get('/:slug/artifacts/:artifactId', (req, res) => {
  try {
    const row = assertPublicToken(req.params.slug, req.query.t);
    if (!row) return res.status(401).json({ error: 'Invalid or missing token' });
    const artifactId = String(req.params.artifactId || '').trim();
    if (!/^mda_[a-zA-Z0-9]+$/i.test(artifactId)) {
      return res.status(400).json({ error: 'Invalid artifact id' });
    }
    const got = readMediaArtifactBuffer(row.owner_user_id, artifactId);
    if (!got) return res.status(404).json({ error: 'Artifact not found' });
    const { row: art, buffer } = got;
    res.setHeader('Content-Type', art.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${String(art.filename || 'audio').replace(/"/g, '')}"`
    );
    res.send(buffer);
  } catch (e) {
    console.error('[public-vr] artifact failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Download failed' });
  }
});

router.post('/:slug/chat', async (req, res) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'anon';
    if (!rateLimitOk(`vr-chat:${req.params.slug}:${ip}`)) {
      return res.status(429).json({ error: 'Too many messages - try again shortly' });
    }
    const row = getPublishedRoomRowBySlug(req.params.slug);
    if (!row) return res.status(404).json({ error: 'Not found or unpublished' });
    const text = String(req.body?.text ?? req.body?.message ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });

    const routed = await routeVrRoomMessage(row.owner_user_id, row.id, text);
    // Prefer explicit @mention assignment; never silently fall back to COO when mention was intended.
    const assignment = (routed.assignments || [])[0];
    if (!assignment?.outbound_workflow_id) {
      return res.status(400).json({ error: 'No agent available in this room' });
    }

    console.info('[public-vr] chat start', {
      slug: row.public_slug,
      source: routed.source,
      handle: assignment.handle,
      avatar_id: assignment.avatar_id,
      workflow: assignment.outbound_workflow_id,
    });

    const run = await startAgentWorkflowRun(assignment.outbound_workflow_id, row.owner_user_id, {
      trigger: 'manual',
      input: assignment.query || text,
      actor: { id: `guest:${String(ip).slice(0, 64)}`, name: 'Guest' },
      variables: {
        member_handle: assignment.handle || '',
        room_id: row.id,
        public_slug: row.public_slug,
        media_slots: '[]',
      },
    });

    const runId = run.id || run.run_id;
    let final = run;
    for (let i = 0; i < 120; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      final = getRun(Number(runId), row.owner_user_id) || getRun(runId, row.owner_user_id);
      if (!final) break;
      if (final.status === 'completed' || final.status === 'failed') break;
    }

    if (!final) return res.status(502).json({ error: 'Run not found' });
    if (final.status === 'failed') {
      return res.status(502).json({ error: final.error_message || 'Agent run failed' });
    }

    const agentStep = (final.steps || []).find((s) => s.node_type === 'agent' && s.status === 'completed');
    const modelStep = (final.steps || []).find((s) => s.node_type === 'model3d' && s.status === 'completed');
    const rawText = agentStep?.output?.text || '';
    const spoken = extractSpokenAvatarReply(rawText) || rawText;
    const transcript = extractAvatarTranscriptReply(rawText) || spoken || rawText;
    const rawPlayback = modelStep?.output?.playback || modelStep?.output?.result || null;
    const playback = publicizePlayback(rawPlayback, row.public_slug, row.public_token);
    if (playback && assignment.avatar_id) {
      playback.avatarId = assignment.avatar_id;
    }

    console.info('[public-vr] chat ok', {
      slug: row.public_slug,
      handle: assignment.handle,
      source: routed.source,
      hasAudio: !!playback?.audioUrl,
      avatar_id: assignment.avatar_id,
    });

    res.json({
      ok: true,
      handle: assignment.handle,
      avatar_id: assignment.avatar_id,
      source: routed.source,
      spoken,
      transcript,
      text: transcript,
      playback,
    });
  } catch (e) {
    console.error('[public-vr] chat failed', e?.message || e);
    res.status(e.status || 500).json({ error: e.message || 'Chat failed' });
  }
});

export default router;
