/**
 * Mirror OpenClaw WhatsApp/Telegram inbound media into CEO workspace inbound/attachments.
 * OpenClaw stages downloads under ~/.openclaw/media/inbound/<uuid>.<ext> but agents often
 * only see "[whatsapp attachment unavailable]" when media-understanding fails — this sync
 * makes the bytes available at inbound/attachments/<filename> for workflows + speech_stt.
 *
 * For recent audio/video, also auto-starts the published "Summarize inbound media attachment"
 * workflow — WhatsApp never hits Agent OS POST /chat, so chat-phrase triggers alone miss WA.
 */
import { existsSync, readdirSync, statSync, readFileSync, watch } from "fs";
import { join, extname, basename } from "path";
import { parseTenantOpenClawAgentId, tenantOpenClawAgentId } from "./openclaw-tenant.js";
import { getOpenClawDir } from "../config/openclaw-paths.js";
import { getDb } from "../db/schema.js";
import { saveInboundAttachment } from "./inbound-attachments.js";

const seen = new Set();
/** @type {Map<string, { size: number, at: number }>} */
const pendingSizes = new Map();
let timer = null;
let watcher = null;

const SUMMARIZE_WF_NAME = "Summarize inbound media attachment";
/** Only auto-run summarize for media written within this window (avoids restart storms). */
const AUTO_SUMMARIZE_MAX_AGE_MS = 15 * 60 * 1000;
const AV_EXTS = new Set([
  ".ogg",
  ".opus",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".mp4",
  ".webm",
  ".mov",
]);

function isAudioOrVideoPath(nameOrPath) {
  return AV_EXTS.has(extname(String(nameOrPath || "")).toLowerCase());
}

/** Fire-and-forget summarize workflow for a newly mirrored A/V attachment. */
function maybeAutoSummarizeInbound(ownerUserId, relativePath, mime) {
  if (
    !isAudioOrVideoPath(relativePath) &&
    !String(mime || "").startsWith("audio/") &&
    !String(mime || "").startsWith("video/")
  ) {
    return;
  }
  const input = String(relativePath || "").trim();
  if (!input) return;
  // Dynamic import avoids circular load with agent-workflow-runner.
  import("./agent-workflow-runner.js")
    .then(async ({ startAgentWorkflowRun }) => {
      const row = getDb()
        .prepare(
          `SELECT id FROM agent_workflow_definitions
           WHERE owner_user_id = ? AND name = ? AND status = 'published'
             AND (paused IS NULL OR paused = 0)
           ORDER BY updated_at DESC LIMIT 1`
        )
        .get(ownerUserId, SUMMARIZE_WF_NAME);
      if (!row?.id) {
        console.warn("[inbound-media-sync] summarize workflow missing; skip auto-run", {
          ownerUserId,
          relativePath: input,
        });
        return;
      }
      // Use manual — published summarize graph only enables chat+manual (not event).
      const run = await startAgentWorkflowRun(row.id, ownerUserId, {
        trigger: "manual",
        input,
        actor: { id: "inbound-media-sync", name: "OpenClaw inbound media sync" },
      });
      console.info("[inbound-media-sync] auto-triggered summarize workflow", {
        ownerUserId,
        relativePath: input,
        definition_id: row.id,
        run_id: run?.id || null,
      });
    })
    .catch((e) => {
      console.warn("[inbound-media-sync] auto-summarize failed", {
        ownerUserId,
        relativePath: input,
        error: e?.message || String(e),
      });
    });
}

function inboundMediaDir() {
  return join(getOpenClawDir(), "media", "inbound");
}

function mimeFromExt(ext) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "");
  const map = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    ogg: "audio/ogg",
    opus: "audio/ogg",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    pdf: "application/pdf",
  };
  return map[e] || "application/octet-stream";
}


function listChannelCandidates() {
  try {
    return getDb()
      .prepare(
        `SELECT owner_user_id, agent_id, channel FROM ceo_agent_channels
         WHERE lower(status) IN ('enabled','active','connected')
           AND lower(channel) IN ('whatsapp','telegram','signal')`
      )
      .all()
      .map((r) => ({
        ownerUserId: String(r.owner_user_id || "").trim(),
        agentId: String(r.agent_id || "").trim(),
        channel: String(r.channel || "").trim().toLowerCase(),
        runtimeId: tenantOpenClawAgentId(r.owner_user_id, r.agent_id),
      }))
      .filter((c) => c.ownerUserId && c.agentId);
  } catch (e) {
    console.warn("[inbound-media-sync] channel candidates query failed", e?.message || e);
    return [];
  }
}

function sessionMentionsBasename(runtimeId, basename) {
  const sessionsDir = join(getOpenClawDir(), "agents", runtimeId, "sessions");
  if (!existsSync(sessionsDir)) return false;
  let names;
  try {
    names = readdirSync(sessionsDir);
  } catch {
    return false;
  }
  const needle = String(basename);
  // Prefer newest jsonl first
  const files = names
    .filter((n) => n.endsWith(".jsonl") || n === "sessions.json")
    .map((n) => {
      try {
        return { n, m: statSync(join(sessionsDir, n)).mtimeMs || 0 };
      } catch {
        return { n, m: 0 };
      }
    })
    .sort((a, b) => b.m - a.m)
    .slice(0, 8);
  for (const f of files) {
    try {
      const text = readFileSync(join(sessionsDir, f.n), "utf8");
      if (text.includes(needle) || text.includes(`media/inbound/${needle}`)) return true;
    } catch {
      /* skip */
    }
  }
  return false;
}

function newestSessionMtime(runtimeId) {
  const sessionsDir = join(getOpenClawDir(), "agents", runtimeId, "sessions");
  if (!existsSync(sessionsDir)) return 0;
  let best = 0;
  try {
    for (const n of readdirSync(sessionsDir)) {
      try {
        const m = statSync(join(sessionsDir, n)).mtimeMs || 0;
        if (m > best) best = m;
      } catch {
        /* skip */
      }
    }
  } catch {
    return 0;
  }
  return best;
}

/**
 * Resolve exactly one CEO for an OpenClaw inbound staging file.
 * Never fan-out to all CEOs.
 */
function resolveInboundMediaOwner(fileBasename, fileMtimeMs) {
  const candidates = listChannelCandidates();
  if (!candidates.length) {
    console.warn("[inbound-media-sync] no enabled whatsapp/telegram channels; skip", fileBasename);
    return null;
  }

  // Rank 1: session transcript mentions the basename (authoritative).
  for (const c of candidates) {
    if (sessionMentionsBasename(c.runtimeId, fileBasename)) {
      console.info("[inbound-media-sync] owner via session mention", {
        file: fileBasename,
        owner: c.ownerUserId,
        runtimeId: c.runtimeId,
      });
      return c.ownerUserId;
    }
  }

  // Rank 2: singleton owner across enabled channel candidates.
  const uniqueOwners = [...new Set(candidates.map((c) => c.ownerUserId))];
  if (uniqueOwners.length === 1) {
    console.info("[inbound-media-sync] owner via singleton channel CEO", {
      file: fileBasename,
      owner: uniqueOwners[0],
    });
    return uniqueOwners[0];
  }

  // Rank 3: nearest session mtime within 90s of file mtime.
  const target = Number(fileMtimeMs) || Date.now();
  let best = null;
  for (const c of candidates) {
    const m = newestSessionMtime(c.runtimeId);
    if (!m) continue;
    const delta = Math.abs(m - target);
    if (delta > 90_000) continue;
    if (!best || delta < best.delta) best = { owner: c.ownerUserId, delta, runtimeId: c.runtimeId };
  }
  if (best) {
    console.info("[inbound-media-sync] owner via session mtime proximity", {
      file: fileBasename,
      owner: best.owner,
      deltaMs: best.delta,
      runtimeId: best.runtimeId,
    });
    return best.owner;
  }

  console.warn("[inbound-media-sync] could not resolve owner; refusing fan-out", {
    file: fileBasename,
    candidates: uniqueOwners.length,
  });
  return null;
}

/**
 * @param {string} absPath
 * @param {{ autoSummarize?: boolean }} [opts]
 *   autoSummarize: true = always (watch), false = never (startup backfill),
 *   undefined = only if file mtime is recent.
 */
function syncOneFile(absPath, opts = {}) {
  const name = basename(absPath);
  const key = absPath;
  if (seen.has(key)) return null;
  let st;
  try {
    st = statSync(absPath);
  } catch {
    return null;
  }
  if (!st.isFile() || st.size <= 0) return null;
  if (st.size < 64) return null;

  const ext = extname(name).toLowerCase();
  // OpenClaw often writes *.tmp while downloading; wait for the final rename (mp4/ogg/…).
  if (ext === ".tmp" || ext === ".partial" || ext === ".download" || name.startsWith(".")) {
    console.info("[inbound-media-sync] skip incomplete staging file", { file: name, bytes: st.size });
    return null;
  }
  // Require a known media/doc extension before mirroring + summarize.
  const allowed = new Set([
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".ogg", ".opus", ".mp3", ".wav", ".m4a", ".aac",
    ".mp4", ".webm", ".mov",
    ".pdf",
  ]);
  if (!allowed.has(ext)) {
    console.info("[inbound-media-sync] skip unknown extension", { file: name, ext });
    return null;
  }

  // Size must be stable across poll cycles (still downloading).
  const prev = pendingSizes.get(key);
  if (!prev || prev.size !== st.size) {
    pendingSizes.set(key, { size: st.size, at: Date.now() });
    console.info("[inbound-media-sync] wait for size settle", { file: name, bytes: st.size });
    return null;
  }
  pendingSizes.delete(key);

  seen.add(key);

  // Brief delay opportunity for OpenClaw to write the session transcript first.
  const owner = resolveInboundMediaOwner(name, st.mtimeMs);
  if (!owner) {
    // Allow one retry later by not marking permanently — but we already added to seen.
    // Remove from seen so a later poll can retry once transcript lands.
    seen.delete(key);
    return null;
  }

  const buffer = readFileSync(absPath);
  const mime = mimeFromExt(extname(name));
  const stamped = `wa-${Date.now()}-${name}`;
  const results = [];
  try {
    const out = saveInboundAttachment(owner, {
      buffer,
      filename: stamped,
      mimeType: mime,
    });
    results.push({ owner, relative_path: out.relative_path, bytes: out.bytes });
  } catch (e) {
    console.warn("[inbound-media-sync] save failed", {
      owner,
      name,
      error: e?.message || String(e),
    });
    seen.delete(key);
    return null;
  }
  if (results.length) {
    console.info("[inbound-media-sync] mirrored openclaw inbound media", {
      file: name,
      bytes: buffer.length,
      mime,
      owner,
      paths: results.map((r) => r.relative_path),
    });
    const ageMs = Date.now() - Number(st.mtimeMs || 0);
    const recent = ageMs >= 0 && ageMs <= AUTO_SUMMARIZE_MAX_AGE_MS;
    const doSummarize =
      opts.autoSummarize === true || (opts.autoSummarize !== false && recent);
    if (doSummarize) {
      for (const r of results) {
        maybeAutoSummarizeInbound(r.owner, r.relative_path, mime);
      }
    }
  }
  return results;
}

export function syncOpenClawInboundMediaOnce({ autoSummarize } = {}) {
  const dir = inboundMediaDir();
  if (!existsSync(dir)) return { ok: true, synced: 0, dir };
  let synced = 0;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const out = syncOneFile(abs, { autoSummarize });
    if (out?.length) synced += 1;
  }
  return { ok: true, synced, dir };
}

export function startOpenClawInboundMediaSync({ intervalMs = 5000 } = {}) {
  const dir = inboundMediaDir();
  try {
    // Backfill mirror only — do not storm summarize on every backend restart.
    const first = syncOpenClawInboundMediaOnce({ autoSummarize: false });
    console.info("[inbound-media-sync] started", {
      dir: first.dir,
      initial_synced: first.synced,
      intervalMs,
    });
  } catch (e) {
    console.warn("[inbound-media-sync] initial sync failed", e?.message || e);
  }

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    try {
      // Poll: summarize only when OpenClaw wrote the file recently.
      syncOpenClawInboundMediaOnce({ autoSummarize: undefined });
    } catch (e) {
      console.warn("[inbound-media-sync] poll failed", e?.message || e);
    }
  }, Math.max(2000, Number(intervalMs) || 5000));
  if (typeof timer.unref === "function") timer.unref();

  try {
    if (existsSync(dir) && !watcher) {
      watcher = watch(dir, { persistent: false }, (_evt, filename) => {
        if (!filename) return;
        const abs = join(dir, String(filename));
        setTimeout(() => {
          try {
            syncOneFile(abs, { autoSummarize: true });
          } catch (e) {
            console.warn("[inbound-media-sync] watch sync failed", e?.message || e);
          }
        }, 2000);
      });
    }
  } catch (e) {
    console.warn("[inbound-media-sync] fs.watch unavailable", e?.message || e);
  }

  return { dir };
}
