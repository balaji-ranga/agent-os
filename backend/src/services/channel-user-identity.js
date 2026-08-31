import { createHash } from 'crypto';
import { getDb } from '../db/schema.js';
import { isCeoDelegate } from './org-permissions.js';

export function normalizeChannelMobile(value) {
  let raw = String(value || '').trim().toLowerCase();
  raw = raw.replace(/^whatsapp:/, '').split('@')[0].split(':')[0];
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  return digits;
}

export function channelSenderFingerprint(value) {
  const normalized = normalizeChannelMobile(value);
  return normalized ? createHash('sha256').update(normalized).digest('hex') : null;
}

export function loadCompanyActor(ownerUserId, actorUserId) {
  const row = getDb().prepare(
    `SELECT * FROM platform_users WHERE id=? AND enabled=1
       AND (id=? OR (role='org_user' AND owner_user_id=?))`
  ).get(actorUserId, ownerUserId, ownerUserId);
  if (!row) return null;
  return { ...row, is_ceo_delegate: isCeoDelegate(row) };
}

export function resolveChannelActor({ ownerUserId, senderId, channel = 'whatsapp' }) {
  const mobile = normalizeChannelMobile(senderId);
  if (!ownerUserId || !mobile) throw Object.assign(new Error('Verified channel user identity is unavailable'), { status: 403 });
  const candidates = getDb().prepare(
    `SELECT * FROM platform_users WHERE enabled=1 AND (id=? OR (role='org_user' AND owner_user_id=?))`
  ).all(ownerUserId, ownerUserId).filter((row) => normalizeChannelMobile(row.mobile) === mobile);
  if (candidates.length !== 1) {
    const reason = candidates.length ? 'ambiguous' : 'not mapped to an active company user';
    throw Object.assign(new Error(`Channel sender is ${reason}; task action denied`), { status: 403 });
  }
  const actor = candidates[0];
  return { ...actor, is_ceo_delegate: isCeoDelegate(actor), channel, sender_fingerprint: channelSenderFingerprint(senderId) };
}
