const activities = new Map();
const TTL_MS = 15 * 60 * 1000;
const MAX_EVENTS = 16;

function clean(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validId(value) {
  const id = clean(value, 100);
  return /^[a-zA-Z0-9_-]{8,100}$/.test(id) ? id : null;
}

function key(ownerUserId, agentId, turnId) {
  const turn = validId(turnId);
  if (!turn) return null;
  return `${clean(ownerUserId, 120)}\u0000${clean(agentId, 120)}\u0000${turn}`;
}

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [activityKey, value] of activities) {
    if (Date.parse(value.updated_at || value.started_at || 0) < cutoff) activities.delete(activityKey);
  }
}

export function beginChatActivity({ ownerUserId, agentId, turnId }) {
  prune();
  const activityKey = key(ownerUserId, agentId, turnId);
  if (!activityKey) return null;
  const now = new Date().toISOString();
  const activity = {
    turn_id: validId(turnId),
    status: 'running',
    current: { phase: 'routing', label: 'Understanding request', detail: '' },
    events: [{ phase: 'routing', label: 'Understanding request', detail: '', status: 'running', at: now }],
    started_at: now,
    updated_at: now,
  };
  activities.set(activityKey, activity);
  return activity;
}

export function updateChatActivity({ ownerUserId, agentId, turnId }, progress = {}) {
  const activityKey = key(ownerUserId, agentId, turnId);
  if (!activityKey) return null;
  const current = activities.get(activityKey) || beginChatActivity({ ownerUserId, agentId, turnId });
  if (!current) return null;
  const event = {
    phase: clean(progress.phase || 'working', 60),
    label: clean(progress.label || 'Agent is working', 180),
    detail: clean(progress.detail, 400),
    status: clean(progress.status || 'running', 30),
    at: new Date().toISOString(),
  };
  const previous = current.events[current.events.length - 1];
  if (previous && previous.phase === event.phase && previous.label === event.label && previous.detail === event.detail) {
    previous.status = event.status;
    previous.at = event.at;
  } else {
    if (previous?.status === 'running') previous.status = 'completed';
    current.events.push(event);
    current.events = current.events.slice(-MAX_EVENTS);
  }
  current.current = { phase: event.phase, label: event.label, detail: event.detail };
  current.status = progress.status === 'failed' ? 'failed' : progress.status === 'completed' ? 'completed' : 'running';
  current.updated_at = event.at;
  activities.set(activityKey, current);
  return current;
}

export function finishChatActivity(scope, { failed = false, label = '' } = {}) {
  return updateChatActivity(scope, {
    phase: failed ? 'failed' : 'complete',
    label: label || (failed ? 'Request could not be completed' : 'Response ready'),
    status: failed ? 'failed' : 'completed',
  });
}

export function getChatActivity({ ownerUserId, agentId, turnId }) {
  prune();
  const activityKey = key(ownerUserId, agentId, turnId);
  const value = activityKey ? activities.get(activityKey) : null;
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

export function clearChatActivitiesForTests() {
  activities.clear();
}
