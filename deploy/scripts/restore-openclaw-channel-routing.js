/**
 * Restore channels/bindings into openclaw.json from agent-os-channel-routing.json.
 * Invoked from openclaw-entrypoint after configure-openclaw-docker.js.
 *
 * Usage: node deploy/scripts/restore-openclaw-channel-routing.js
 */
import { restoreChannelRoutingIntoOpenClawJson } from '../../scripts/lib/openclaw-channel-routing.js';

const result = restoreChannelRoutingIntoOpenClawJson();
if (!result.ok) {
  console.warn('[restore-openclaw-channel-routing]', result.reason || 'failed');
  process.exit(0); // non-fatal for gateway boot
}
if (result.restored || result.changed) {
  console.log('[restore-openclaw-channel-routing] applied source=%s', result.source || 'config');
} else {
  console.log('[restore-openclaw-channel-routing] ok (no restore needed)');
}
