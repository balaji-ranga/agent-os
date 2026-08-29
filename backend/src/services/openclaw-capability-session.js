import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';
import { getOpenClawDir } from '../config/openclaw-paths.js';

function atomicWriteJson(path, value) {
  const temp = join(dirname(path), `.${randomBytes(8).toString('hex')}.tmp`);
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

/**
 * Drop only the long-lived native channel session for one tenant agent.
 * OpenClaw will create a fresh session on the next inbound channel message and
 * therefore reload the current workspace instructions and tool capabilities.
 * The old transcript is retained under a timestamped reset filename.
 */
export function invalidateOpenClawMainSession(openclawAgentId, { now = new Date() } = {}) {
  const runtimeId = String(openclawAgentId || '').trim();
  if (!runtimeId || runtimeId.includes('/') || runtimeId.includes('\\')) {
    return { invalidated: false, reason: 'invalid_agent_id' };
  }
  const sessionsDir = join(getOpenClawDir(), 'agents', runtimeId, 'sessions');
  const indexPath = join(sessionsDir, 'sessions.json');
  if (!existsSync(indexPath)) return { invalidated: false, reason: 'session_store_missing' };

  let index;
  try {
    index = JSON.parse(readFileSync(indexPath, 'utf8'));
  } catch {
    return { invalidated: false, reason: 'invalid_session_store' };
  }
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return { invalidated: false, reason: 'invalid_session_store' };
  }

  const key = `agent:${runtimeId}:main`;
  const entry = index[key];
  if (!entry) return { invalidated: false, reason: 'main_session_missing' };
  const sessionId = typeof entry === 'string' ? entry : entry.sessionId || entry.session_id || entry.id;
  delete index[key];
  atomicWriteJson(indexPath, index);

  let archivedTranscript = null;
  if (sessionId) {
    const transcript = join(sessionsDir, `${sessionId}.jsonl`);
    if (existsSync(transcript)) {
      const stamp = now.toISOString().replace(/[:.]/g, '-');
      archivedTranscript = `${transcript}.reset.${stamp}`;
      renameSync(transcript, archivedTranscript);
    }
  }
  return { invalidated: true, session_id: sessionId || null, archived_transcript: archivedTranscript };
}
