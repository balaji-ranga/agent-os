const admin = process.env.OPENCONNECTOR_ADMIN_TOKEN;
const headers = { Authorization: admin.startsWith('Bearer ') ? admin : `Bearer ${admin}` };

const connections = await (await fetch('http://openconnector:3000/api/connections', { headers })).json();
const rows = Array.isArray(connections) ? connections : connections.data || [];

// Group by service — shows multi-CEO shape
const byService = {};
for (const r of rows) {
  const s = r.service || '?';
  if (!byService[s]) byService[s] = [];
  byService[s].push({
    id: r.id,
    connectionName: r.connectionName,
    authType: r.authType,
    account: r.profile?.displayName || r.profile?.accountId || null,
    virtual: r.virtual,
    default: r.default,
  });
}

console.log('=== connections grouped by service ===');
for (const [svc, list] of Object.entries(byService).sort()) {
  if (list.length === 1 && list[0].connectionName === 'default') continue; // skip public defaults noise optional
  console.log(svc, list.length, JSON.stringify(list));
}

// Explicit: any service with >1 real (non-default) connection names
console.log('\n=== services with multiple named connections ===');
for (const [svc, list] of Object.entries(byService)) {
  const named = list.filter((x) => x.connectionName && x.connectionName !== 'default');
  if (named.length > 1) console.log(svc, named);
}
console.log('(none yet is OK — only one CEO has connected API-key apps)');
