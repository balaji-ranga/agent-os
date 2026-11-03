# Physical edge IP allowlist

Implementation and validation record, 2026-11-03.

## Configuration

Settings → IP Whitelists includes **Flolah physical edge**. A company administrator can add a single IP, IPv4/IPv6 CIDR, or a list separated by commas, spaces, semicolons or newlines. Lists are validated completely and saved atomically, with a limit of 100 values per request. Existing entries merge selected feature flags.

Rules apply to all hubs belonging to the authenticated company, not an individual device or A2A publication. Use the site's public egress address as observed by Flolah, not a device's private LAN address. A company with multiple sites can add multiple addresses or ranges. Hub credentials remain mandatory.

No physical-edge rules means no additional source-IP restriction. Removing the final physical-edge rule restores this behavior. Deployment does not invent or enable company rules.

## Enforcement and deployment

The backend checks the company policy at authenticated WebSocket upgrade, on incoming hub messages, on policy changes and every 15 seconds for connected hubs. An in-process policy change immediately evicts that company's cached rules and disconnects denied hubs. The cache has a five-second lifetime and a maximum of 1,000 company entries.

Only peers explicitly listed in `FLOLAH_PHYSICAL_TRUSTED_PROXY_CIDRS` may supply `X-Real-IP`. Other peers are evaluated using their socket address. Nginx overwrites this header. This deployment uses host-network Nginx with a loopback-only backend published port; trusted peers are the exact Docker gateway addresses used by host forwarding. Activation checks the loopback binding and derives these addresses from the deployment. A bridge-network proxy can instead use its exact shared-network container address. Network changes require updating this setting. Do not trust the whole internet or arbitrary forwarded headers.

Disconnecting a hub prevents further dispatch through that connection; it does not undo a physical action already dispatched. Existing execution leases and expiry rules still apply.

Prepared release: `edge-ip-1793671529`. The release performs an additive database migration and updates backend/frontend only. Activation checks for concurrent service/source changes and retains rollback images and a database backup.

Activation completed: backend and frontend healthy, gateway unchanged. Signed-in browser verification confirmed the deployed IP-list input, physical-edge checkbox and existing company rules without adding or changing a rule. A read-only local simulator status check also succeeded after deployment.

## Validation

`backend/scripts/test-physical-hub-ip.mjs` uses a temporary database and actual local WebSocket connections. It covers exact addresses, IPv4/IPv6 CIDRs, compressed IPv6, IPv4-mapped addresses, invalid prefixes, atomic list validation, owner isolation, existing feature preservation, company-only scope, untrusted forwarded-header spoofing, trusted proxy resolution, denied handshakes and immediate active disconnection after rule changes.

The release also passed the frontend production build and physical resource API, pagination, workflow, virtual-room workflow and dynamic-output regression checks. No real TV commands or live company allowlist mutations are part of these tests.

## MQTT placement clarification

MQTT is an optional device transport, not the edge-to-Flolah control channel. A broker may run at the site or on a server. Local placement supports communication between local devices and Home Assistant without internet connectivity. A remote broker requires network connectivity, TLS, client credentials and topic-level access controls. Home Assistant can instead use a device's direct integration without MQTT. The current Fire TV integration uses Home Assistant; the virtual fixture uses MQTT.
