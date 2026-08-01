/**
 * Estimate storage consumed by one CEO (DB payloads + master-data files + OpenClaw tenant dir).
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/schema.js';
import { getOpenClawDir } from '../config/openclaw-paths.js';
import { masterDataDocsDir } from './master-data.js';
import { mediaStorageBytes } from './ceo-media-artifacts.js';
import { avatarStorageBytes } from './ceo-avatars.js';
import { vrSceneStorageBytes } from './ceo-vr-scenes.js';
import { generatedMediaStorageBytes } from './content-explorer.js';
import { getInboundAttachmentsDir } from './inbound-attachments.js';

function sanitizeIdPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-zA-Z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function dataDir() {
  return process.env.AGENT_OS_DATA_DIR || join(process.cwd(), 'data');
}

function dirSizeBytes(root) {
  if (!root || !existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = join(cur, ent.name);
      try {
        if (ent.isDirectory()) stack.push(p);
        else total += statSync(p).size || 0;
      } catch {
        /* skip */
      }
    }
  }
  return total;
}

function fileSizeBytes(path) {
  try {
    if (!path || !existsSync(path)) return 0;
    return statSync(path).size || 0;
  } catch {
    return 0;
  }
}

/**
 * @returns {{ total_bytes: number, total_mb: number, breakdown: object }}
 */
export function estimateOwnerStorage(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const db = getDb();
  const breakdown = {
    chat_turns_bytes: 0,
    standup_messages_bytes: 0,
    workflow_runs_bytes: 0,
    master_data_docs_bytes: 0,
    master_data_files_bytes: 0,
    media_artifacts_bytes: 0,
    inbound_attachments_bytes: 0,
    generated_media_bytes: 0,
    avatars_bytes: 0,
    vr_scenes_bytes: 0,
    ceo_db_bytes: 0,
    openclaw_tenant_bytes: 0,
  };

  try {
    breakdown.chat_turns_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0) AS b
             FROM chat_turns WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.standup_messages_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(LENGTH(COALESCE(content, ''))), 0) AS b
             FROM standup_messages
             WHERE standup_id IN (SELECT id FROM standups WHERE owner_user_id = ?)`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.workflow_runs_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(
               LENGTH(COALESCE(context_json, '')) + LENGTH(COALESCE(error_message, ''))
             ), 0) AS b
             FROM agent_workflow_runs WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.master_data_docs_bytes =
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS b
             FROM master_data_documents WHERE owner_user_id = ?`
          )
          .get(owner)?.b
      ) || 0;
  } catch (_) {}

  try {
    breakdown.master_data_files_bytes = dirSizeBytes(masterDataDocsDir(owner));
  } catch (_) {}

  try {
    breakdown.media_artifacts_bytes = mediaStorageBytes(owner);
  } catch (_) {}

  try {
    // Inbound is under tenants/{ceo}/… so also counted in openclaw_tenant_bytes;
    // keep an explicit breakdown for Efficiency clarity.
    breakdown.inbound_attachments_bytes = dirSizeBytes(getInboundAttachmentsDir(owner));
  } catch (_) {}

  try {
    breakdown.generated_media_bytes = generatedMediaStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.avatars_bytes = avatarStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.vr_scenes_bytes = vrSceneStorageBytes(owner);
  } catch (_) {}

  try {
    breakdown.ceo_db_bytes = fileSizeBytes(join(dataDir(), 'tenants', sanitizeIdPart(owner), 'ceo.db'));
  } catch (_) {}

  try {
    breakdown.openclaw_tenant_bytes = dirSizeBytes(
      join(getOpenClawDir(), 'tenants', sanitizeIdPart(owner))
    );
  } catch (_) {}

  const masterData = Math.max(breakdown.master_data_docs_bytes, breakdown.master_data_files_bytes);
  // Tenant tree already includes inbound/attachments; do not double-count inbound.
  const total =
    breakdown.chat_turns_bytes +
    breakdown.standup_messages_bytes +
    breakdown.workflow_runs_bytes +
    masterData +
    breakdown.media_artifacts_bytes +
    breakdown.generated_media_bytes +
    breakdown.avatars_bytes +
    breakdown.vr_scenes_bytes +
    breakdown.ceo_db_bytes +
    breakdown.openclaw_tenant_bytes;

  return {
    total_bytes: total,
    total_mb: Math.round((total / (1024 * 1024)) * 100) / 100,
    breakdown: {
      ...breakdown,
      master_data_bytes: masterData,
    },
  };
}
