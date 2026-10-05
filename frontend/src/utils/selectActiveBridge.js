const timestamp = (value) => {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export function selectActiveBridge(bridges = []) {
  const available = bridges.filter((bridge) => !bridge?.revoked_at);
  const candidates = available;

  return [...candidates].sort((left, right) => {
    const leftOnline = String(left?.effective_status || '').toLowerCase() === 'online';
    const rightOnline = String(right?.effective_status || '').toLowerCase() === 'online';
    if (leftOnline !== rightOnline) return rightOnline - leftOnline;
    return timestamp(right?.last_accepted_heartbeat_at || right?.last_seen_at) - timestamp(left?.last_accepted_heartbeat_at || left?.last_seen_at);
  })[0] || null;
}
