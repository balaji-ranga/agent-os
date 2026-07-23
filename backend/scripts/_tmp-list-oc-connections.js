const admin = process.env.OPENCONNECTOR_ADMIN_TOKEN;
const res = await fetch('http://openconnector:3000/api/connections', {
  headers: { Authorization: admin.startsWith('Bearer ') ? admin : `Bearer ${admin}` },
});
const d = await res.json();
const rows = Array.isArray(d) ? d : d.data || d.connections || [];
console.log('total', rows.length);
const gh = rows.filter(
  (x) =>
    String(x.service || x.provider || '').includes('github') ||
    String(x.id || '').includes('github')
);
console.log(JSON.stringify(gh, null, 2));
const byService = {};
for (const r of rows) {
  const s = r.service || r.provider || '?';
  byService[s] = (byService[s] || 0) + 1;
}
console.log('by_service_counts', byService);
console.log(
  'sample_fields',
  rows.slice(0, 3).map((r) => ({
    id: r.id,
    service: r.service,
    connectionName: r.connectionName || r.connection_name,
    profile: r.profile,
  }))
);
