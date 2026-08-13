Flolah Local Browser Worker (Windows)
=====================================

This package is bound to YOUR Flolah account only. The BROWSER_WORKER_TOKEN in .env
is minted for you - keep the zip private. Revoke tokens from Connectors if lost.

Browser profile (cookies / logins)
---------------------------------
Uses Playwright launchPersistentContext with BROWSER_USER_DATA_DIR (default browser-profile).
Logins (e.g. Facebook, LinkedIn) in the headed window persist across worker restarts.
This is NOT your everyday Chrome profile by default.

Google / Flow sign-in
---------------------
If Google says "This browser or app may not be secure", add to .env:
  BROWSER_CHANNEL=chrome
  BROWSER_USER_DATA_DIR=browser-profile-chrome
  BROWSER_HEADLESS=0
Then restart Start-BrowserWorker.ps1 and sign in in the Chrome window (requires Google Chrome installed).
Keep BROWSER_HEADLESS=0 for first logins and 2FA. Do not delete the profile folder while logged in.

Setup
-----
1. Unzip to a private folder on your PC.
2. Confirm .env:
   - BROWSER_WORKER_TOKEN (already set; starts with bwk_)
   - AGENT_OS_BASE_URL (your Flolah origin, no /api suffix)
   - LOOPBACK_PORT=3020
   - BROWSER_HEADLESS=0  (headed; only set 1 if you intentionally want headless)
   - BROWSER_USER_DATA_DIR=browser-profile
3. First run installs Playwright Chromium (npm once) if node_modules is missing:
     .\scripts\Start-BrowserWorker.ps1
4. A Chromium window opens. Log into sites you need; leave the process running.
5. Optional: .\scripts\Register-TaskScheduler.ps1  (start at Windows logon)

Connectors -> Browser Session package
------------------------------------
- Download this package (owner-scoped token).
- Optionally add client IP allowlist (Connectors or Settings -> IP Whitelists). Empty = any IP + token. Same central store.
- Status shows online after register/heartbeat.
- Revoke old tokens from the same panel; re-download mints a new token.

Loopback for workflows (optional)
--------------------------------
POST http://127.0.0.1:3020/v1/open  Authorization: Bearer <same token>
Body: {"url":"https://example.com"}
Also: /v1/snapshot, /v1/act, /v1/status  ·  GET /health (no auth)

Security
--------
- Token is hashed on Flolah; only your owner_user_id receives jobs.
- Loopback binds 127.0.0.1 only by default.
- IP whitelist applies to worker -> cloud calls when configured.
- browser-profile holds session cookies - treat like a password store; do not share.

Lite pack: install Node.js 18+ on PATH.
