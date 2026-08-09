# IP Whitelists (firewall)

## Where to manage

| Place | Route / UI | Notes |
|-------|------------|--------|
| **Central (recommended)** | **Settings → IP Whitelists** (`/settings/ip-whitelists`) | Full control: pick which products each IP/CIDR applies to |
| AgentExchange → Security | Federated | A2A policy + IPs for one publish |
| Workflow → Download for Windows | Federated | Desktop package IPs |
| Connectors → Browser Session package | Federated | Local worker IPs |
| Connectors → Local IBKR bridge | Link to central | Cloud webhook IP lock |

There is **one storage**: per-CEO `owner_ip_whitelists`. Federated UIs only help convenience — they do not keep a separate backend.

## Targets (apply flags)

| Target | Protects | Empty list means |
|--------|----------|------------------|
| **IBKR bridge** | Laptop POSTs to `/api/ibkr-trading/local-bridge-webhook` | Any IP OK (hook secret still required) |
| **Workflow download** | Desktop client API with `dsk_…` token | Any IP OK (token required) |
| **A2A publish** | Public card/invoke/OAuth/enquiry when policy is **IP whitelist** | Empty matching list **denies** all |
| **Browser Session package** | Local worker `/api/browser-worker/v1/*` with `bwk_…` | Any IP OK (token required) |

A2A still needs **Deny all / Allow all / IP whitelist** on the publication. Other products have no separate policy switch — whitelist is optional hardening.

## Rules format

- Exact **IPv4** or **IPv6**
- **IPv4 CIDR** (e.g. `203.0.113.0/24`)
- IPv6 **must be exact** (no `/64` ranges yet)

Optional scopes:

- **definition_id** — limit a desktop rule to one workflow
- **publish_id** — limit an A2A rule to one publication  
  Omit = all of that product for your account (still filtered by apply flag).

## Entitlements

- Rules are **owner-scoped** (your CEO account). Other CEOs never see your list.
- Admins manage only when **impersonating** a CEO.
- Tokens/secrets are never bypassed by an empty or full whitelist.

## Ops note (VPS)

Reverse proxies can hide the real client IP. Production uses host-network nginx + trusted `X-Real-IP` so deny/whitelist match public IPs. See deploy `docker-compose.vps-client-ip.yml`.

## Related

- Desktop package: [17-desktop-windows-download.md](./17-desktop-windows-download.md)
- A2A Security: [09-a2a-agent-exchange.md](./09-a2a-agent-exchange.md)
- Browser Session worker: [22-browser-session-and-recipes.md](./22-browser-session-and-recipes.md) · [BROWSER-SESSION-DESKTOP-LOCAL.md](../BROWSER-SESSION-DESKTOP-LOCAL.md)
- IBKR bridge: [20-ibkr-monthly-trading.md](./20-ibkr-monthly-trading.md) · [../IBKR-LOCAL-BRIDGE.md](../IBKR-LOCAL-BRIDGE.md)
