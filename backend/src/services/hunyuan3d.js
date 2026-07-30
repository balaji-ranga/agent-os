/**
 * Tencent Hunyuan3D optional Docker API client.
 * Env: HUNYUAN3D_URL=http://hunyuan3d:7860
 */
import { createAvatarFromBuffer } from './ceo-avatars.js';

export function hunyuanConfigured() {
  return Boolean(String(process.env.HUNYUAN3D_URL || '').trim());
}

export function hunyuanBaseUrl() {
  return String(process.env.HUNYUAN3D_URL || '').trim().replace(/\/$/, '');
}

export async function hunyuanHealth() {
  const base = hunyuanBaseUrl();
  if (!base) return { ok: false, configured: false, reason: 'HUNYUAN3D_URL unset' };
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, configured: true, status: res.status };
    // Some builds lack /health - try root
    const root = await fetch(`${base}/`, { signal: AbortSignal.timeout(8000) });
    return { ok: root.ok || root.status < 500, configured: true, status: root.status };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

/**
 * Generate GLB via Hunyuan and store as CEO avatar.
 * Tries sync POST /generate then async /send + /status/:uid.
 */
export async function generateAvatarWithHunyuan(ownerUserId, { prompt, imageBase64, name } = {}) {
  const base = hunyuanBaseUrl();
  if (!base) {
    throw Object.assign(
      new Error('Hunyuan3D is not configured (set HUNYUAN3D_URL and start optional-hunyuan3d profile)'),
      { status: 503 }
    );
  }

  const body = {};
  if (imageBase64) {
    body.image = String(imageBase64).replace(/^data:[^;]+;base64,/, '');
  } else if (prompt) {
    body.text = String(prompt).slice(0, 500);
    body.prompt = body.text;
  } else {
    throw Object.assign(new Error('prompt or imageBase64 required'), { status: 400 });
  }
  body.type = 'glb';
  body.texture = true;

  const timeoutMs = Number(process.env.HUNYUAN3D_TIMEOUT_MS || 15 * 60 * 1000);
  console.info('[hunyuan3d] generate start', {
    owner: ownerUserId,
    mode: imageBase64 ? 'image' : 'text',
  });

  // Prefer async send/status when available
  try {
    const sendRes = await fetch(`${base}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (sendRes.ok) {
      const sendJson = await sendRes.json().catch(() => ({}));
      const uid = sendJson.uid || sendJson.id || sendJson.task_id;
      if (uid) {
        const buffer = await pollHunyuanStatus(base, uid, timeoutMs);
        return createAvatarFromBuffer(ownerUserId, {
          buffer,
          filename: 'hunyuan.glb',
          mimeType: 'model/gltf-binary',
          name: name || (prompt ? String(prompt).slice(0, 60) : 'Hunyuan avatar'),
          source: 'hunyuan',
        });
      }
    }
  } catch (e) {
    console.warn('[hunyuan3d] async send failed, trying /generate', e?.message || e);
  }

  const genRes = await fetch(`${base}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!genRes.ok) {
    const errText = await genRes.text().catch(() => '');
    throw Object.assign(
      new Error(`Hunyuan3D generate failed (${genRes.status}): ${errText.slice(0, 300)}`),
      { status: 502 }
    );
  }
  const contentType = String(genRes.headers.get('content-type') || '');
  let buffer;
  if (contentType.includes('json')) {
    const json = await genRes.json();
    const b64 = json.model || json.glb || json.data || json.file;
    if (!b64) throw Object.assign(new Error('Hunyuan JSON response missing model data'), { status: 502 });
    buffer = Buffer.from(String(b64), 'base64');
  } else {
    buffer = Buffer.from(await genRes.arrayBuffer());
  }
  if (!buffer.length) throw Object.assign(new Error('Empty Hunyuan model'), { status: 502 });

  console.info('[hunyuan3d] generate done', { owner: ownerUserId, bytes: buffer.length });
  return createAvatarFromBuffer(ownerUserId, {
    buffer,
    filename: 'hunyuan.glb',
    mimeType: 'model/gltf-binary',
    name: name || (prompt ? String(prompt).slice(0, 60) : 'Hunyuan avatar'),
    source: 'hunyuan',
  });
}

async function pollHunyuanStatus(base, uid, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${base}/status/${encodeURIComponent(uid)}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const json = await res.json().catch(() => ({}));
    const status = String(json.status || json.state || '').toLowerCase();
    if (status === 'completed' || status === 'done' || status === 'success' || json.model || json.glb) {
      const b64 = json.model || json.glb || json.data || json.file;
      if (typeof b64 === 'string') return Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (json.file_path || json.path) {
        // Some servers return a downloadable URL
        const fileUrl = json.url || `${base}/download/${uid}`;
        const f = await fetch(fileUrl, { signal: AbortSignal.timeout(120000) });
        if (f.ok) return Buffer.from(await f.arrayBuffer());
      }
    }
    if (status === 'failed' || status === 'error') {
      throw Object.assign(new Error(json.error || json.message || 'Hunyuan generation failed'), {
        status: 502,
      });
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw Object.assign(new Error('Hunyuan generation timed out'), { status: 504 });
}
