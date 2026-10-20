// Backward-compatible entry point. The legacy hourly-bucket acceptance was
// replaced by website-scoped temporary-content coverage on existing UAT sites.
await import('./private-content-live.mjs');
