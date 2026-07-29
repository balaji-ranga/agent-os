# Deploy assets

## openclaw-chrome-extension/

Vendored **OpenClaw Browser Relay** Chrome extension (Load unpacked). Served to CEOs as:

`GET /api/browser-session/chrome-extension.zip` (authenticated)

Refresh from the running OpenClaw image (preferred) or host npm:

```bash
FORCE_SYNC=1 bash deploy/scripts/sync-openclaw-chrome-extension.sh
```

Do **not** use the Chrome Web Store build for remote/VPS pairing — it only targets localhost.