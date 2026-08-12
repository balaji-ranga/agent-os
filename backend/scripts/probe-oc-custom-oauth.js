/**
 * Probe OC connection-scoped custom OAuth from inside backend container.
 * Usage: docker compose exec -T backend node /tmp/probe-oc-custom-oauth.js
 */
const token = String(process.env.OPENCONNECTOR_ADMIN_TOKEN || '').trim();
const base = String(process.env.OPENCONNECTOR_URL || 'http://openconnector:3000').replace(/\/$/, '');
if (!token) {
  console.error('OPENCONNECTOR_ADMIN_TOKEN missing');
  process.exit(1);
}

const clientId = process.env.PROBE_CLIENT_ID || `Ov23liProbe${Date.now().toString(36)}`;
const body = {
  service: 'github',
  connectionName: process.env.PROBE_ALIAS || `ceo-probe-${Date.now().toString(36)}`,
  clientId,
  clientSecret: process.env.PROBE_CLIENT_SECRET || 'probe_secret_not_real',
};

const res = await fetch(`${base}/api/oauth/authorizations`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { raw: text };
}
const url =
  data?.data?.authorizationUrl ||
  data?.authorizationUrl ||
  data?.data?.authorization_url ||
  data?.authorization_url ||
  '';
console.log(
  JSON.stringify(
    {
      status: res.status,
      sent_client_id: clientId,
      url_client_id: (() => {
        try {
          return new URL(url).searchParams.get('client_id');
        } catch {
          return null;
        }
      })(),
      match: url.includes(clientId),
      url_prefix: String(url).slice(0, 160),
      error: data?.error || data?.message || null,
    },
    null,
    2
  )
);
process.exit(url.includes(clientId) ? 0 : 2);
