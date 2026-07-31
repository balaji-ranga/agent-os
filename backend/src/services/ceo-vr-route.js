/**
 * Virtual Room message routing: map a chat prompt to room members (no Kanban).
 * Reuses COO AGENTS.md intent classification, filtered to avatars already in the room.
 */
import { classifyCooDelegationTargets } from './coo-specialty-delegation.js';
import { getVrRoomForOwner } from './ceo-vr-rooms.js';
import { selectBroadcastRecipients } from './broadcast-routing.js';

const MAX_ASSIGNMENTS = 2;

function normalizeId(id) {
  return String(id || '')
    .trim()
    .toLowerCase();
}

/** Explicit @handle always wins over intent classification. */
function parseMentionAssignment(text, members) {
  const raw = String(text || '').trim();
  const m = raw.match(/^@([a-zA-Z0-9_-]+)\s*([\s\S]*)$/);
  if (!m) return null;
  const handle = String(m[1] || '').toLowerCase();
  const member = (members || []).find((x) => String(x.handle || '').toLowerCase() === handle);
  if (!member) return { unknown: m[1] };
  const body = String(m[2] || '').trim() || raw;
  return {
    member,
    body,
    assignment: {
      avatar_id: member.avatar_id,
      handle: member.handle,
      agent_id: member.agent_id,
      query: body,
      outbound_workflow_id: member.outbound_workflow_id,
    },
  };
}

/**
 * Keyword fallback among room members only (specialty / name / handle / purpose).
 */
function keywordPickMembers(text, members, limit = MAX_ASSIGNMENTS) {
  const msg = String(text || '').trim();
  if (!msg || !members?.length) return [];
  const agents = members
    .filter((m) => m.agent_id)
    .map((m) => ({
      id: m.agent_id,
      name: m.name || m.handle,
      purpose: `${m.handle || ''} ${m.name || ''}`,
      department: '',
    }));
  if (!agents.length) return [];
  try {
    const { agents: picked } = selectBroadcastRecipients(agents, msg, { enableOrgProfile: false });
    const byAgent = new Map(members.map((m) => [normalizeId(m.agent_id), m]));
    const out = [];
    for (const a of picked || []) {
      const m = byAgent.get(normalizeId(a.id));
      if (!m) continue;
      out.push({ member: m, query: msg });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    console.warn('[vr-route] keyword pick failed', e?.message || e);
    return [];
  }
}

/**
 * @returns {Promise<{ assignments: Array<{ avatar_id, handle, agent_id, query, outbound_workflow_id }>, source: string }>}
 */
export async function routeVrRoomMessage(ownerUserId, roomId, text) {
  const room = getVrRoomForOwner(ownerUserId, roomId);
  if (!room) throw Object.assign(new Error('Room not found'), { status: 404 });
  const members = Array.isArray(room.members) ? room.members : [];
  const msg = String(text || '').trim();
  if (!msg) throw Object.assign(new Error('text required'), { status: 400 });
  if (!members.length) {
    return { assignments: [], source: 'empty-room', room_id: room.id };
  }

  const mention = parseMentionAssignment(msg, members);
  if (mention?.unknown) {
    throw Object.assign(new Error(`Unknown member @${mention.unknown}`), { status: 400 });
  }
  if (mention?.assignment) {
    console.info('[vr-route] routed', {
      roomId: room.id,
      source: 'mention',
      count: 1,
      handles: [mention.assignment.handle],
    });
    return { assignments: [mention.assignment], source: 'mention', room_id: room.id };
  }

  if (members.length === 1) {
    const m = members[0];
    return {
      assignments: [
        {
          avatar_id: m.avatar_id,
          handle: m.handle,
          agent_id: m.agent_id,
          query: msg,
          outbound_workflow_id: m.outbound_workflow_id,
        },
      ],
      source: 'single-member',
      room_id: room.id,
    };
  }

  const byAgent = new Map(
    members.filter((m) => m.agent_id).map((m) => [normalizeId(m.agent_id), m])
  );

  let allocated = {};
  let source = 'intent';
  try {
    allocated = await classifyCooDelegationTargets(ownerUserId, msg);
  } catch (e) {
    console.warn('[vr-route] classify failed', e?.message || e);
    allocated = {};
  }

  const assignments = [];
  for (const [agentId, query] of Object.entries(allocated || {})) {
    const m = byAgent.get(normalizeId(agentId));
    if (!m) continue;
    assignments.push({
      avatar_id: m.avatar_id,
      handle: m.handle,
      agent_id: m.agent_id,
      query: String(query || msg).trim() || msg,
      outbound_workflow_id: m.outbound_workflow_id,
    });
    if (assignments.length >= MAX_ASSIGNMENTS) break;
  }

  if (!assignments.length) {
    const kw = keywordPickMembers(msg, members, MAX_ASSIGNMENTS);
    for (const row of kw) {
      assignments.push({
        avatar_id: row.member.avatar_id,
        handle: row.member.handle,
        agent_id: row.member.agent_id,
        query: row.query,
        outbound_workflow_id: row.member.outbound_workflow_id,
      });
    }
    if (assignments.length) source = 'keyword';
  }

  // Last resort: first member with an outbound workflow (still better than blocking chat).
  if (!assignments.length) {
    const m = members.find((x) => x.outbound_workflow_id) || members[0];
    assignments.push({
      avatar_id: m.avatar_id,
      handle: m.handle,
      agent_id: m.agent_id,
      query: msg,
      outbound_workflow_id: m.outbound_workflow_id,
    });
    source = 'fallback-first';
  }

  console.info('[vr-route] routed', {
    roomId: room.id,
    source,
    count: assignments.length,
    handles: assignments.map((a) => a.handle),
  });

  return { assignments, source, room_id: room.id };
}
