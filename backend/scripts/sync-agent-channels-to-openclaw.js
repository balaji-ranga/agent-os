/**
 * Re-merge enabled/pairing CEO agent channels into openclaw.json (+ routing sidecar).
 * Usage (VPS): docker compose exec -T -w /opt/agent-os/backend backend node scripts/sync-agent-channels-to-openclaw.js
 */
import { initDb } from '../src/db/schema.js';
import { syncEnabledAgentChannelsToOpenClaw } from '../src/services/ceo-agent-channels.js';

initDb();
const result = syncEnabledAgentChannelsToOpenClaw();
console.log(
  JSON.stringify(
    {
      ok: true,
      synced: result.synced,
      accounts: result.accounts,
    },
    null,
    2
  )
);
process.exit(0);
