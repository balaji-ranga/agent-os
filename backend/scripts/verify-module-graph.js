/**
 * Import-graph smoke check: loads the routers and services touched by the budgets /
 * org-leaf-member work so circular-import or syntax breaks surface without booting the server.
 *
 * Usage: node backend/scripts/verify-module-graph.js
 */
const MODULES = [
  '../src/services/org-member-keys.js',
  '../src/services/org-agent-members.js',
  '../src/services/token-usage.js',
  '../src/services/agent-budgets.js',
  '../src/services/agent-efficiency.js',
  '../src/services/org-member-delegation.js',
  '../src/services/coo-specialty-delegation.js',
  '../src/services/delegation-queue.js',
  '../src/services/org-context.js',
  '../src/routes/efficiency.js',
  '../src/routes/org-members.js',
  '../src/routes/agents.js',
];

const main = async () => {
  for (const mod of MODULES) {
    try {
      await import(mod);
      console.log('[verify] ok', mod);
    } catch (e) {
      console.error('[verify] FAILED', mod, e?.message || e);
      process.exit(1);
    }
  }
  console.log('[verify] PASS');
  process.exit(0);
};

main();
